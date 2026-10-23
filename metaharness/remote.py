"""Sync the local memory with an optional cloud hub. No database key leaves the hub."""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import tempfile
import urllib.parse
import urllib.request

from .core import CURATED, SELF, STATE, add_note, live_notes, load_state, log, render_brief, save_state, user_name


def _save_config(cfg: dict) -> None:
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp = tempfile.mkstemp(prefix="remote-", dir=STATE)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(cfg, f, indent=2)
            f.write("\n")
        os.replace(tmp, STATE / "remote.json")
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def validate_url(url: str, backend: str) -> str:
    if backend not in {"supabase", "cloudflare", "self-hosted"}:
        raise ValueError("choose supabase, cloudflare or self-hosted; use mh init --backend local for local only")
    url = url.strip().rstrip("/")
    parsed = urllib.parse.urlsplit(url)
    schemes = {"https", "http"} if backend == "self-hosted" else {"https"}
    if (parsed.scheme not in schemes or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise ValueError("use the hub base URL without credentials, query or fragment")
    return url


def setup(url: str, backend: str = "supabase") -> str:
    url = validate_url(url, backend)
    config = load_state("config")
    cfg = load_state("remote")
    if config.get("url") != url or config.get("backend") != backend or not cfg.get("token"):
        cfg = {"token": secrets.token_urlsafe(32)}
    cfg.pop("url", None)
    _save_config(cfg)
    config.update(backend=backend, url=url)
    config.setdefault("name", "the user")
    save_state("config", config)
    digest = hashlib.sha256(cfg["token"].encode()).hexdigest()
    provision = (f"On the server, run: ./mh serve --token-sha256 {digest}\n"
                 if backend == "self-hosted" else
                 "Run this SQL in your own hub database:\n\n"
                 "insert into mh_config (key, value)\n"
                 f"values ('token_sha256', '{digest}')\n"
                 "on conflict (key) do update set value = excluded.value;\n")
    return (
        f"Backend: {backend}. URL saved in state/config.json; token in owner-only state/remote.json.\n\n"
        + provision + "\n"
        f"Claude connector: {url}/mcp/{cfg['token']}\n"
        f"GPT schema: {url}/openapi.json\n"
        f"Bearer token: {cfg['token']}\n\n"
        "Keep the token and connector URL private. Provision the server hash, then run ./mh tick."
    )


def configured() -> bool:
    config = load_state("config")
    return bool(config.get("backend", "local") != "local" and config.get("url") and load_state("remote").get("token"))


def sync_remote() -> str:
    cfg = load_state("remote")
    config = load_state("config")
    if not configured():
        raise RuntimeError("hub not configured; run mh remote setup --backend <backend> --url <url>")
    files = {n: (SELF / n).read_text() for n in CURATED if (SELF / n).exists()}
    files["brief.md"] = render_brief()
    files["config.json"] = json.dumps({"name": user_name()}, ensure_ascii=False)
    files["journal-digest.md"] = "\n\n".join(
        f"- [{n['ts'][:10]} {n['source']}/{n['kind']}] {n['text']}" for n in live_notes())
    body = json.dumps({"files": files, "ack": cfg.get("pending_ack", [])}).encode()
    req = urllib.request.Request(config["url"] + "/sync", data=body, method="POST", headers={
        "Authorization": f"Bearer {cfg['token']}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        notes = json.loads(r.read())["notes"]
    if not isinstance(notes, list):
        raise ValueError("hub returned invalid notes")
    for n in notes:
        if not isinstance(n, dict) or not isinstance(n.get("id"), str) or not n["id"]:
            raise ValueError("hub returned a note without an id")
        if not isinstance(n.get("text"), str) or not n["text"].strip():
            raise ValueError("hub returned an empty note")
        add_note(n["text"], source=n["source"], kind=n["kind"], scope=n["scope"], ts=n["ts"])
    # Acknowledge only after every note was saved, on the next sync.
    cfg["pending_ack"] = [n["id"] for n in notes]
    _save_config(cfg)
    if notes:
        log(f"remote: pulled {len(notes)} notes")
    return f"pushed {len(files)} files, pulled {len(notes)} notes"
