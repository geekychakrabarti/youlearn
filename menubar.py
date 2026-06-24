"""
YouLearn Menu Bar App
Runs in the macOS menu bar — click to open, stop, or quit.
Launch with: uv run python menubar.py
"""
import rumps
import subprocess
import threading
import time
import os
import json
import webbrowser
import urllib.request
from pathlib import Path

PORT = 8000
URL = f"http://localhost:{PORT}"
DOCS_URL = "https://github.com/geekychakrabarti/youlearn/blob/main/docs/USER_GUIDE.md"
PROJECT_DIR = Path(__file__).parent

# Resolve uv — works even when launched from .app bundle with stripped PATH
UV = str(Path.home() / ".local" / "bin" / "uv")
if not Path(UV).exists():
    import shutil
    UV = shutil.which("uv") or UV


def _is_running() -> bool:
    try:
        urllib.request.urlopen(f"{URL}/api/playlists", timeout=1).close()
        return True
    except Exception:
        return False


class YouLearnApp(rumps.App):
    def __init__(self):
        super().__init__("YouLearn", quit_button=None)
        self._server_proc = None

        self.menu = [
            rumps.MenuItem("▶ Open YouLearn", callback=self.open_browser),
            rumps.MenuItem("? Start Tour", callback=self.start_tour),
            rumps.MenuItem("📖 Help & Documentation", callback=self.open_help),
            rumps.MenuItem("📁 Set Storage Location…", callback=self.set_storage),
            None,
            rumps.MenuItem("● Starting…"),
            None,
            rumps.MenuItem("Quit YouLearn", callback=self.quit_app),
        ]

        # Menu bar icon
        icon_path = PROJECT_DIR / "frontend" / "menubar-icon.png"
        if icon_path.exists():
            try:
                self.icon = str(icon_path)
                self.template = True
            except Exception:
                pass

        # Auto-start in background
        threading.Thread(target=self._auto_start, daemon=True).start()

    # ── helpers ──────────────────────────────────────────────

    def _set_status(self, text):
        for title in list(self.menu.keys()):
            if title in ("● Starting…", "● Running on port 8000",
                         "○ Server stopped", "⚠ Failed to start",
                         "○ Starting server…"):
                self.menu[title].title = text
                return

    def _auto_start(self):
        time.sleep(1)
        if _is_running():
            self._on_server_up()
        else:
            self._do_start()

    def _do_start(self):
        self._set_status("○ Starting server…")
        try:
            proc = subprocess.Popen(
                [UV, "run", "uvicorn", "app.main:app", f"--port={PORT}"],
                cwd=str(PROJECT_DIR),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            self._server_proc = proc
            for _ in range(20):
                time.sleep(0.5)
                if _is_running():
                    self._on_server_up()
                    return
            self._set_status("⚠ Failed to start")
        except Exception as e:
            self._set_status(f"⚠ {e}")

    def _on_server_up(self):
        self._set_status(f"● Running on port {PORT}")
        webbrowser.open(URL)

    # ── menu callbacks ────────────────────────────────────────

    @rumps.clicked("▶ Open YouLearn")
    def open_browser(self, _):
        if _is_running():
            webbrowser.open(URL)
        else:
            threading.Thread(target=self._do_start, daemon=True).start()

    @rumps.clicked("? Start Tour")
    def start_tour(self, _):
        if _is_running():
            webbrowser.open(f"{URL}#start-tour")
        else:
            threading.Thread(target=self._do_start, daemon=True).start()

    @rumps.clicked("📖 Help & Documentation")
    def open_help(self, _):
        webbrowser.open(DOCS_URL)

    @rumps.clicked("📁 Set Storage Location…")
    def set_storage(self, _):
        """Open a native folder picker to set the video/DB storage location."""
        script = '''
        tell application "System Events"
            activate
        end tell
        set chosen to choose folder with prompt "Choose where YouLearn stores your videos and database:"
        POSIX path of chosen
        '''
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True
        )
        if result.returncode != 0 or not result.stdout.strip():
            return  # User cancelled

        folder = result.stdout.strip().rstrip("/")
        if not folder:
            return

        # Save to config via API if server running, else write directly
        config_path = PROJECT_DIR / "config.json"
        try:
            cfg = {}
            if config_path.exists():
                with open(config_path) as f:
                    cfg = json.load(f)
            cfg["video_folder"] = folder
            cfg["db_path"] = str(Path(folder) / "youlearn.db")
            with open(config_path, "w") as f:
                json.dump(cfg, f, indent=2)

            rumps.notification(
                "YouLearn",
                "Storage location updated",
                f"Videos and database will be saved to:\n{folder}\n\nRestart YouLearn to apply.",
                sound=False
            )
        except Exception as e:
            rumps.notification("YouLearn", "Could not save settings", str(e), sound=False)

    def _kill_server(self):
        if self._server_proc:
            try:
                self._server_proc.terminate()
                self._server_proc = None
            except Exception:
                pass
        subprocess.run(
            ["bash", "-c", f"lsof -ti tcp:{PORT} | xargs kill -9 2>/dev/null; true"],
            capture_output=True
        )

    def quit_app(self, _):
        self._kill_server()
        rumps.quit_application()

    @rumps.clicked("Quit YouLearn")
    def quit_clicked(self, _):
        self.quit_app(None)


if __name__ == "__main__":
    YouLearnApp().run()

