const got = require('got');

// If Boost cannot pass these as API connector inputs, set them here in Boost.
// Do not commit a real token to GitHub.
const GITHUB_OWNER = '';
const GITHUB_TOKEN = '';

module.exports = async (data, logger, callback) => {
  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function currentUtcTimestampSeconds() {
    const now = new Date();

    return (
      `${now.getUTCFullYear()}-` +
      `${pad2(now.getUTCMonth() + 1)}-` +
      `${pad2(now.getUTCDate())} ` +
      `${pad2(now.getUTCHours())}:` +
      `${pad2(now.getUTCMinutes())}:` +
      `${pad2(now.getUTCSeconds())}`
    );
  }

  function normaliseTimestamp(value) {
    if (value == null) {
      return currentUtcTimestampSeconds();
    }

    const raw = String(value).trim();

    const boostMinuteOnlyMatch = raw.match(
      /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/
    );

    if (boostMinuteOnlyMatch) {
      const now = new Date();
      const seconds = pad2(now.getUTCSeconds());

      return `${boostMinuteOnlyMatch[1]} ${boostMinuteOnlyMatch[2]}:${seconds}`;
    }

    const boostSecondMatch = raw.match(
      /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/
    );

    if (boostSecondMatch) {
      return `${boostSecondMatch[1]} ${boostSecondMatch[2]}`;
    }

    const alreadyCorrectMatch = raw.match(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
    );

    if (alreadyCorrectMatch) {
      return raw;
    }

    return raw;
  }

  function unwrapBoostValue(value) {
    if (value == null) {
      return null;
    }

    if (typeof value === 'object') {
      if (value.value != null) {
        return value.value;
      }

      if (value.text != null) {
        return value.text;
      }

      if (value.content != null) {
        return value.content;
      }

      return null;
    }

    return value;
  }

  function firstString(candidates) {
    for (const candidate of candidates) {
      const value = unwrapBoostValue(candidate);

      if (value != null && String(value).trim() !== '') {
        return String(value).trim();
      }
    }

    return '';
  }

  function encodeRepoPath(filePath) {
    return String(filePath)
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
  }

  function contentsUrl(owner, repo, filePath) {
    return (
      `https://api.github.com/repos/${encodeURIComponent(owner)}/` +
      `${encodeURIComponent(repo)}/contents/${encodeRepoPath(filePath)}`
    );
  }

  function result(payload) {
    return callback(helpers.toResult(payload));
  }

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const githubOwner = firstString([
    data.request?.github_owner,
    GITHUB_OWNER
  ]);
  const githubRepo =
    firstString([data.request?.github_repo]) || 'medical-flags';
  const githubBranch =
    firstString([data.request?.github_branch]) || 'main';
  const githubEventsPath =
    firstString([data.request?.github_events_path]) || 'events.json';
  const githubToken = firstString([
    data.request?.github_token,
    GITHUB_TOKEN
  ]);

  const flag = firstString([
    data.request?.flag,
    data.request?.variables?.flag,
    data.user_data?.variables?.flag,
    data.user_data?.conversation?.variables?.flag
  ]);

  const timestampRaw =
    data.request?.global_current_datetime_utc ??
    data.request?.global_current_datetime ??
    data.request?.timestamp ??
    null;

  const timestamp = normaliseTimestamp(timestampRaw);

  const dialog_id =
    data.user_data?.conversation?.external_ids?.[0]?.external ?? null;

  const session_id =
    data.user_data?.conversation?.id ?? '';

  const event = {
    timestamp,
    flag,
    session_id,
    dialog_id
  };

  logger.log('Preparing medical flag append');
  logger.log({
    githubOwner,
    githubRepo,
    githubBranch,
    githubEventsPath,
    hasGithubToken: Boolean(githubToken),
    flag,
    session_id,
    dialog_id,
    timestamp,
    timestampRaw
  });

  if (!githubOwner || !githubToken || !flag || !session_id || !dialog_id) {
    logger.log('Missing required medical flag fields');

    return result({
      api_success: false,
      error: 'Missing required medical flag fields',
      github_owner: githubOwner,
      github_repo: githubRepo,
      github_events_path: githubEventsPath,
      has_github_token: Boolean(githubToken),
      ...event
    });
  }

  const url = contentsUrl(githubOwner, githubRepo, githubEventsPath);
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken}`,
    'User-Agent': 'boost-medical-flags-poc',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      logger.log(`Reading current events.json, attempt ${attempt}`);

      const getResponse = await got.get(url, {
        headers,
        searchParams: { ref: githubBranch },
        responseType: 'json',
        throwHttpErrors: false,
        timeout: { request: 10000 }
      });

      let events = [];
      let sha = null;

      if (getResponse.statusCode === 200) {
        sha = getResponse.body?.sha ?? null;

        const encodedContent = String(getResponse.body?.content ?? '')
          .replace(/\s/g, '');

        const decodedContent = encodedContent
          ? Buffer.from(encodedContent, 'base64').toString('utf8').trim()
          : '';

        events = decodedContent ? JSON.parse(decodedContent) : [];

        if (!Array.isArray(events)) {
          throw new Error(`${githubEventsPath} must contain a JSON array`);
        }
      } else if (getResponse.statusCode !== 404) {
        throw new Error(
          `GitHub read failed with HTTP ${getResponse.statusCode}: ` +
          JSON.stringify(getResponse.body)
        );
      }

      events.push(event);

      const content = Buffer.from(
        `${JSON.stringify(events, null, 2)}\n`,
        'utf8'
      ).toString('base64');

      const payload = {
        message: `Append medical flag event for ${dialog_id}`,
        branch: githubBranch,
        content
      };

      if (sha) {
        payload.sha = sha;
      }

      logger.log('Writing updated events.json');
      logger.log({
        url,
        event,
        existing_count: events.length - 1,
        new_count: events.length,
        has_sha: Boolean(sha)
      });

      const putResponse = await got.put(url, {
        headers,
        json: payload,
        responseType: 'json',
        throwHttpErrors: false,
        timeout: { request: 10000 }
      });

      if (putResponse.statusCode === 200 || putResponse.statusCode === 201) {
        logger.log('Medical flag append succeeded');
        logger.log({
          statusCode: putResponse.statusCode,
          html_url: putResponse.body?.content?.html_url ?? null
        });

        return result({
          api_success: true,
          event,
          event_count: events.length,
          github_html_url: putResponse.body?.content?.html_url ?? null,
          github_api_url: url
        });
      }

      if (putResponse.statusCode === 409 && attempt < 3) {
        logger.log('GitHub write conflict, retrying');
        await sleep(250 * attempt);
        continue;
      }

      throw new Error(
        `GitHub write failed with HTTP ${putResponse.statusCode}: ` +
        JSON.stringify(putResponse.body)
      );
    }
  } catch (err) {
    logger.log('Medical flag append failed');
    logger.log({
      message: err?.message ?? String(err),
      statusCode: err?.response?.statusCode ?? null,
      responseBody: err?.response?.body ?? null
    });

    return result({
      api_success: false,
      error:
        err?.response?.body
          ? JSON.stringify(err.response.body)
          : String(err?.message ?? err),
      event,
      github_api_url: url
    });
  }
};
