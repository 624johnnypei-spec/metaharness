#!/bin/sh
set -eu
MH_INSTALL_REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
exec python3 - "$MH_INSTALL_REPO" "$@" <<'PY'
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

repo = Path(sys.argv[1])
args = sys.argv[2:]
if "--help" in args:
    print("Usage: launchd/install.sh [--render-only] [tick distill serve]")
    print("Default: tick every 30 minutes, distill at 03:30 local time.")
    print("Optional serve binds to MH_SERVE_HOST (default 127.0.0.1).")
    raise SystemExit(0)
if sys.version_info < (3, 10):
    raise SystemExit("Python 3.10+ is required.")
render_only = "--render-only" in args
jobs = [arg for arg in args if arg != "--render-only"] or ["tick", "distill"]
if any(job not in {"tick", "distill", "serve"} for job in jobs):
    raise SystemExit("Choose only tick, distill or serve.")
if not render_only and sys.platform != "darwin":
    raise SystemExit("launchd is macOS-only; use cron or a systemd user timer on Linux.")
root = Path(os.environ.get("MH_HOME", str(repo))).expanduser().resolve()
state = root / "state"
state.mkdir(parents=True, exist_ok=True, mode=0o700)
out = Path.home() / "Library" / "LaunchAgents"
out.mkdir(parents=True, exist_ok=True)
values = {
    "{{PYTHON}}": sys.executable,
    "{{REPO}}": str(repo),
    "{{ROOT}}": str(root),
    "{{STATE}}": str(state),
    "{{HOME}}": str(Path.home()),
    "{{PATH}}": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
    "{{HOST}}": os.environ.get("MH_SERVE_HOST", "127.0.0.1"),
}

def fill(value):
    if isinstance(value, str):
        for key, replacement in values.items():
            value = value.replace(key, replacement)
        return value
    if isinstance(value, list):
        return [fill(item) for item in value]
    if isinstance(value, dict):
        return {key: fill(item) for key, item in value.items()}
    return value

for job in dict.fromkeys(jobs):
    label = f"com.metaharness.{job}"
    source = repo / "launchd" / f"{label}.plist"
    path = out / source.name
    with source.open("rb") as f:
        data = fill(plistlib.load(f))
    if path.exists():
        backup = state / "backups" / f"{source.name}.orig"
        if not backup.exists():
            backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copy2(path, backup)
            backup.chmod(0o600)
    with path.open("wb") as f:
        plistlib.dump(data, f, sort_keys=False)
    if render_only:
        print(f"rendered {path}")
        continue
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", f"{domain}/{label}"], capture_output=True)
    subprocess.run(["launchctl", "bootstrap", domain, str(path)], check=True)
    print(f"loaded {job}")
PY
