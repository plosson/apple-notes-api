# Install + Menu Bar App Design

**Date:** 2026-10-01
**Status:** Approved

## Goal

One-command install that sets up the apple-notes-api as a macOS daemon and puts a menu bar icon for start/stop/status. One-command uninstall that cleans everything up.

## New Files

```
scripts/
  install.sh          # one-command setup
  uninstall.sh        # clean teardown
  menubar.py          # rumps menu bar app
launchd/
  com.plosson.apple-notes-api.plist.example          # existing, updated
  com.plosson.apple-notes-api.menubar.plist.example  # new
```

## Architecture

Two launchd agents, both under `~/Library/LaunchAgents/`:

| Agent | Label | Manages |
|---|---|---|
| Server | `com.plosson.apple-notes-api` | Node.js API (`tsx src/index.ts`) |
| Menu bar | `com.plosson.apple-notes-api.menubar` | `python3 scripts/menubar.py` |

Both have `RunAtLoad=true` and `KeepAlive=true`. The server plist embeds env vars (key, host, port) written by the install script. The menu bar plist sets `WorkingDirectory` to the repo root.

## install.sh

1. Verify prerequisites: `node`, `python3`, `pip3` — exit with a clear message if missing
2. If `.env` is absent or `NOTES_API_KEY` still equals the placeholder value, generate a new key via `openssl rand -hex 32` and write `.env`
3. `pip3 install --quiet rumps`
4. Render both plist files from their `.example` counterparts, substituting:
   - `YOUR_USER` → `$(whoami)`
   - `REPO_DIR` → `$(pwd)`
   - `NODE_BIN` → `$(which node)`
   - `NOTES_API_KEY` → value from `.env`
5. Copy rendered plists to `~/Library/LaunchAgents/`
6. `launchctl load` both agents
7. Print the API key so the user can configure their agents

## uninstall.sh

1. `launchctl unload` both agents (ignore errors if not loaded)
2. Remove both plists from `~/Library/LaunchAgents/`
3. Ask whether to delete `.env` (default: keep)

## menubar.py

- Built with `rumps`
- **Icon:** plain `N` in menu bar title; switches to unicode bold `𝐍` (U+1D40D) when server is running
- **Status check:** `launchctl list com.plosson.apple-notes-api` every 5 seconds; running = exit code 0 and PID present
- **Menu items (when running):**
  - `𝐍 Running on :8787` (disabled info item)
  - `Stop`
  - ─
  - `Quit menu bar app`
- **Menu items (when stopped):**
  - `N  Stopped` (disabled info item)
  - `Start`
  - ─
  - `Quit menu bar app`
- **Stop** → `launchctl unload ~/Library/LaunchAgents/com.plosson.apple-notes-api.plist`
- **Start** → `launchctl load ~/Library/LaunchAgents/com.plosson.apple-notes-api.plist`
- **Quit menu bar app** → exits only the Python process; server keeps running

## Error Handling

- install.sh: each step checks exit code; on failure, print what failed and exit 1
- menubar.py: if `launchctl` call fails, show a `rumps.alert()` with the error
- uninstall.sh: unload failures are non-fatal (service may already be stopped)

## Out of Scope

- Port configuration from the menu bar
- Log viewer in the menu bar
- Multiple accounts / instances
