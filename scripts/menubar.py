#!/usr/bin/env python3
import os
import subprocess
import rumps

LABEL = "com.plosson.apple-notes-api"
PLIST_PATH = os.path.expanduser(f"~/Library/LaunchAgents/{LABEL}.plist")
PORT = os.environ.get("NOTES_API_PORT", "8787")

ICON_RUNNING = "\U0001d40d"  # 𝐍 mathematical bold capital N
ICON_STOPPED = "N"


def _is_running() -> bool:
    result = subprocess.run(
        ["launchctl", "list", LABEL],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and '"PID"' in result.stdout


class NotesApiApp(rumps.App):
    def __init__(self):
        super().__init__(ICON_STOPPED, quit_button=None)
        self._running = None
        self.status_item = rumps.MenuItem("Checking...", callback=None)
        self.toggle_item = rumps.MenuItem("Start", callback=self.on_toggle)
        self.menu = [
            self.status_item,
            self.toggle_item,
            None,
            rumps.MenuItem("Quit menu bar app", callback=self.on_quit),
        ]
        self._refresh()

    def _refresh(self):
        running = _is_running()
        if running == self._running:
            return
        self._running = running
        self.title = ICON_RUNNING if running else ICON_STOPPED
        self.status_item.title = f"Running on :{PORT}" if running else "Stopped"
        self.toggle_item.title = "Stop" if running else "Start"

    @rumps.timer(5)
    def poll(self, _):
        self._refresh()

    def on_toggle(self, _):
        import time
        action = "unload" if self._running else "load"
        result = subprocess.run(
            ["launchctl", action, PLIST_PATH],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            rumps.alert(
                title=f"Failed to {'stop' if self._running else 'start'}",
                message=result.stderr or result.stdout or "Unknown error",
            )
            return
        if action == "load":
            time.sleep(0.5)
        self._refresh()

    def on_quit(self, _):
        rumps.quit_application()


if __name__ == "__main__":
    NotesApiApp().run()
