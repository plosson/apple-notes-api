# apple-notes-api

REST API for **Apple Notes** on macOS. Runs locally next to Notes.app (e.g. on a Mac mini), speaks JSON over HTTP, and is designed so agents (including a future **agentio** plugin) can call it. This is **not** an MCP server.

Inspired by the MIT-licensed [sweetrb/apple-notes-mcp](https://github.com/sweetrb/apple-notes-mcp) (AppleScript/JXA access to Notes.app). This project reimplements a clean REST façade in original TypeScript — see [NOTICE](./NOTICE).

## Requirements

- **macOS** with Notes.app and an account signed in (typically iCloud)
- **Node.js ≥ 20**
- **Automation** permission for the process that runs this server to control **Notes** (System Settings → Privacy & Security → Automation)
- Optional: **Full Disk Access** is *not* required for the AppleScript/JXA paths used here

> On Linux/CI the server can start and serve `/health`, but note routes return `501 PlatformUnsupported` because `osascript` / Notes.app are darwin-only.

## Install

```bash
git clone https://github.com/plosson/apple-notes-api.git
cd apple-notes-api
npm install
cp .env.example .env
# edit .env — set NOTES_API_KEY
```

Generate a key:

```bash
openssl rand -hex 32
```

## Configure

| Variable | Default | Meaning |
|---|---|---|
| `NOTES_API_KEY` | _(required)_ | Bearer token for `/v1/*` |
| `NOTES_API_HOST` | `127.0.0.1` | Bind address |
| `NOTES_API_PORT` | `8787` | Port |
| `NOTES_API_ALLOW_INSECURE` | unset | Set `1` to start **without** a key (local only) |
| `NOTES_API_OSASCRIPT_TIMEOUT_MS` | `30000` | Per-call osascript timeout |

Without `NOTES_API_KEY`, the process **refuses to start** unless `NOTES_API_ALLOW_INSECURE=1`.

## Run

```bash
export NOTES_API_KEY="$(openssl rand -hex 32)"
npm start
# → http://127.0.0.1:8787
```

Or load from `.env` with your preferred tooling (`direnv`, launchd, etc.).

A launchd example plist is in [`launchd/com.plosson.apple-notes-api.plist.example`](./launchd/com.plosson.apple-notes-api.plist.example).

## Expose (Tailscale / tunnels) — at your own risk

This API can read and write your personal notes. Defaults bind to **localhost only**.

You own exposure:

- Prefer [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve) or an SSH tunnel to reach the Mac mini from your other devices / agents
- Do **not** put this on the public internet without TLS, a strong `NOTES_API_KEY`, and a clear threat model
- Rotating `NOTES_API_KEY` invalidates all clients immediately

## API

All `/v1/*` routes require:

```http
Authorization: Bearer <NOTES_API_KEY>
```

### `GET /health` (no auth)

```json
{ "ok": true, "version": "1.0.0", "platform": "darwin" }
```

### `GET /v1/folders`

```json
{ "folders": [{ "id": "...", "name": "Notes", "account": "iCloud" }] }
```

### `GET /v1/notes?folder=&q=&limit=`

List / search note **metadata** (`id`, `name`, `folder`, `created`, `modified`).

### `GET /v1/notes/:id`

Full note. `body` is plaintext (HTML stripped), `bodyHtml` is the raw Notes HTML, `bodyMarkdown` is a best-effort conversion.

### `POST /v1/notes`

```json
{ "name": "Title", "body": "Hello", "folder": "Notes" }
```

Plaintext `body` is wrapped as simple HTML for Notes. If `body` already looks like HTML, it is stored as-is. `folder` is optional (defaults to a folder named `Notes`, else the first folder).

### `PATCH /v1/notes/:id`

```json
{ "name": "New title", "body": "...", "folder": "Work" }
```

### `DELETE /v1/notes/:id`

Moves the note to **Recently Deleted** when Notes.app supports it (standard `delete` via AppleScript).

Note ids are the Notes.app AppleScript/JXA `id` values.

## curl examples

```bash
export KEY=your-secret
export BASE=http://127.0.0.1:8787

curl -s "$BASE/health"

curl -s -H "Authorization: Bearer $KEY" "$BASE/v1/folders" | jq

curl -s -H "Authorization: Bearer $KEY" "$BASE/v1/notes?limit=20" | jq

curl -s -H "Authorization: Bearer $KEY" "$BASE/v1/notes?q=grocery" | jq

curl -s -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"From API","body":"Hello from apple-notes-api"}' \
  "$BASE/v1/notes" | jq

NOTE_ID=x-coredata://...   # from create/list response
curl -s -H "Authorization: Bearer $KEY" "$BASE/v1/notes/$NOTE_ID" | jq

curl -s -X PATCH -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"body":"Updated body"}' \
  "$BASE/v1/notes/$NOTE_ID" | jq

curl -s -X DELETE -H "Authorization: Bearer $KEY" \
  "$BASE/v1/notes/$NOTE_ID" | jq
```

## agentio

A future **agentio** plugin can treat this service as a remote Notes backend: configure base URL (e.g. Tailscale IP / MagicDNS) + `NOTES_API_KEY`, then map agent tools to these REST endpoints. This repo intentionally stays a plain HTTP API so any agent runtime can call it.

## Limitations

- **macOS only** for real Notes operations
- **Locked / password-protected notes** cannot be read or modified via AppleScript
- **HTML fidelity**: Notes stores rich HTML; plaintext and markdown fields are lossy conversions
- **Permissions**: first call triggers the Automation prompt; deny → `403 PermissionDenied`
- **Large libraries / slow Notes.app**: calls can hit the osascript timeout
- **Shared / collaboration edge cases** and some attachment-heavy notes may behave oddly through the scripting bridge
- Folder must **already exist** to create/move into it (this API does not create folders yet)

## Development

```bash
npm run typecheck
npm test
npm run dev
```

## License

MIT — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

Attribution: inspired by [sweetrb/apple-notes-mcp](https://github.com/sweetrb/apple-notes-mcp) (MIT, Rob Sweet).
