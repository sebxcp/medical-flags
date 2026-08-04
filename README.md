# medical-flags

Proof-of-concept JSON log for medical concern flags from a Boost API block.

The public read endpoint is:

```text
https://<github-owner>.github.io/medical-flags/events.json
```

If GitHub Pages is not enabled yet, the raw GitHub URL is:

```text
https://raw.githubusercontent.com/<github-owner>/medical-flags/main/events.json
```

`events.json` is an array. Each submitted event is appended in this shape:

```json
{
  "timestamp": "2026-08-04 12:00:00",
  "flag": "medical_concern",
  "session_id": "boost-session-id",
  "dialog_id": "external-dialog-id"
}
```

## Boost API block

Paste the code from [`boost/medical-flag-github-block.js`](boost/medical-flag-github-block.js) into the Boost API block.

Pass these request values into the block:

| Name | Required | Value |
| --- | --- | --- |
| `github_owner` | Yes | GitHub user or organisation that owns this repo |
| `github_token` | Yes | Fine-grained GitHub token with `Contents: Read and write` for this repo |
| `flag` | Yes | Boost variable populated by entity extraction, for example `medical_concern` |
| `github_repo` | No | Defaults to `medical-flags` |
| `github_branch` | No | Defaults to `main` |
| `github_events_path` | No | Defaults to `events.json` |
| `global_current_datetime_utc` | No | Boost timestamp, preferred |
| `global_current_datetime` | No | Fallback Boost timestamp |

The GitHub token is only for writing the file to GitHub. The event payload itself is not tokenised; it is stored as plain JSON.

## Publish with GitHub Desktop

1. Add this folder as a local repository in GitHub Desktop.
2. Publish it to GitHub as `medical-flags`.
3. On GitHub, open the repository settings.
4. Go to **Pages**.
5. Set the source to **Deploy from a branch**.
6. Select `main` and `/ (root)`.
7. Save.

After Pages publishes, fetch `events.json` from the Pages URL above.
