# apple-notes-api

REST API for **Apple Notes** on macOS. Runs locally next to Notes.app (e.g. on a Mac mini), speaks JSON over HTTP, and is designed so agents (including a future **agentio** plugin) can call it. This is **not** an MCP server.

Inspired by the MIT-licensed [sweetrb/apple-notes-mcp](https://github.com/sweetrb/apple-notes-mcp) (AppleScript/JXA access to Notes.app). This project reimplements a clean REST façade in original TypeScript — see [NOTICE](./NOTICE).

## Requirements

- **macOS** with Notes.app and an account signed in (typically iCloud)
- **Node.js ≥ 20**
- **Python 3** (ships with macOS)
- **Automation** permission for the process that runs this server to control **Notes** (System Settings → Privacy & Security → Automation)
- Optional: **Full Disk Access** is *not* required for the AppleScript/JXA paths used here

> On Linux/CI the server can start and serve `/health`, but note routes return `501 PlatformUnsupported` because `osascript` / Notes.app are darwin-only.

## Install

```bash
git clone https://github.com/plosson/apple-notes-api.git
cd apple-notes-api
./scripts/install.sh
```

That's it. The script:

1. Generates a random API key and writes `.env`
2. Creates a Python venv and installs the menu bar app dependency
3. Installs two launchd agents under `~/Library/LaunchAgents/` — one for the server, one for the menu bar app
4. Starts both immediately and at every login

Your API key is printed at the end. Copy it to any agent or client that needs to call the API.

## Menu bar app

A small **𝐍 / N** icon appears in your menu bar:

- **𝐍** — server is running
- **N** — server is stopped

Click it to **Start**, **Stop**, **Copy API Key** to clipboard, or **Quit** the menu bar app (the server keeps running).

## Uninstall

```bash
./scripts/uninstall.sh
```

Stops both agents, removes the launchd plists, and optionally removes `.env` and the Python venv.

## Configure

Edit `.env` to change settings, then re-run `./scripts/install.sh` to apply.

| Variable | Default | Meaning |
|---|---|---|
| `NOTES_API_KEY` | _(generated)_ | Bearer token for `/v1/*` |
| `NOTES_API_HOST` | `127.0.0.1` | Bind address |
| `NOTES_API_PORT` | `8787` | Port |
| `NOTES_API_ALLOW_INSECURE` | unset | Set `1` to start **without** a key (local only) |
| `NOTES_API_OSASCRIPT_TIMEOUT_MS` | `30000` | Per-call osascript timeout |

Without `NOTES_API_KEY`, the process **refuses to start** unless `NOTES_API_ALLOW_INSECURE=1`.

## Run without the daemon (development)

```bash
npm start   # reads .env automatically
# → http://127.0.0.1:8787
```

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

## Testing

Unit and route tests use Node's built-in test runner (`tsx --test`) and **never** talk to Notes.app:

- `src/notes/html.test.ts` — HTML/plaintext helpers
- `src/notes/service.test.ts` — `NotesService` with an injectable mocked JXA runner
- `src/server.test.ts` — auth (401), health (200), and CRUD paths via a fake `NotesApi`

`NotesService` accepts a `JxaRunner` (default: real `osascript` on macOS). CI runs these mocked tests on Ubuntu and macOS (Node 20 + 22). Live Notes.app integration tests can be added later behind an opt-in skip/flag.

## License

MIT — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

Attribution: inspired by [sweetrb/apple-notes-mcp](https://github.com/sweetrb/apple-notes-mcp) (MIT, Rob Sweet).
