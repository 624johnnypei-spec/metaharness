"""Sync the local memory with an optional cloud hub. No database key leaves the hub."""
from __future__ import annotations

import hashlib
import ipaddress
import re
from datetime import datetime
import json
import os
import secrets
import tempfile
import urllib.parse
import urllib.request

from .security import MAX_BODY, MAX_ACK, MAX_FILE, MAX_NOTE, bounded, metadata, private_dir, scrub_secrets
from .core import CURATED, SELF, STATE, add_note, live_notes, load_state, log, render_brief, save_state, user_name


def _save_config(cfg: dict) -> None:
    private_dir(STATE)
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
    if len(url) > 2048:
        raise ValueError("hub URL is too long")
    parsed = urllib.parse.urlsplit(url)
    _ = parsed.port
    schemes = {"https", "http"} if backend == "self-hosted" else {"https"}
    if (parsed.scheme not in schemes or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise ValueError("use the hub base URL without credentials, query or fragment")
    if parsed.scheme == "http":
        try:
            loopback = ipaddress.ip_address(parsed.hostname).is_loopback
        except ValueError:
            loopback = parsed.hostname == "localhost"
        if not loopback:
            raise ValueError("HTTPS is required except for localhost or loopback addresses")
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
    connect = "metaharness://connect?" + urllib.parse.urlencode({"url": url, "token": cfg["token"]})
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
        f"Connect the app (private): {connect}\n\n"
        "Keep the token, connector URL and app link private. Provision the server hash, then run ./mh tick."
    )


def configured() -> bool:
    config = load_state("config")
    return bool(config.get("backend", "local") != "local" and config.get("url") and load_state("remote").get("token"))


def journal_digest() -> str:
    """Newest complete observations within the hub file budget; local history stays intact."""
    chunks, size = [], 0
    for note in reversed(live_notes()):
        text = scrub_secrets(f"- [{note['ts'][:10]} {note['source']}/{note['kind']}] {note['text']}")
        length = len(text.encode()) + (2 if chunks else 0)
        if size + length > MAX_FILE:
            break
        chunks.append(text)
        size += length
    return "\n\n".join(reversed(chunks))


def sync_remote() -> str:
    cfg = load_state("remote")
    config = load_state("config")
    if not configured():
        raise RuntimeError("hub not configured; run mh remote setup --backend <backend> --url <url>")
    files = {n: scrub_secrets((SELF / n).read_text()) for n in CURATED if (SELF / n).exists()}
    files["brief.md"] = render_brief()
    files["config.json"] = json.dumps({"name": user_name()}, ensure_ascii=False)
    files["journal-digest.md"] = journal_digest()
    body = json.dumps({"files": files, "ack": cfg.get("pending_ack", [])}).encode()
    req = urllib.request.Request(validate_url(config["url"], config["backend"]) + "/sync", data=body, method="POST", headers={
        "Authorization": f"Bearer {cfg['token']}", "Content-Type": "application/json"})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise ValueError("hub redirects are not allowed; use its final HTTPS URL")
    with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as r:
        response = r.read(MAX_BODY + 1)
        if len(response) > MAX_BODY:
            raise ValueError("hub response is too large")
        notes = json.loads(response)["notes"]
    if not isinstance(notes, list) or len(notes) > MAX_ACK:
        raise ValueError("hub returned invalid notes")
    # Validate the entire response before any mutation; malformed acknowledgments
    # must never poison later exchanges with an otherwise functioning hub.
    for n in notes:
        if not isinstance(n, dict) or not isinstance(n.get("id"), str) or not re.fullmatch(r"[a-f0-9]{12}", n["id"]):
            raise ValueError("hub returned an invalid note id")
        bounded(n.get("text"), MAX_NOTE, "note text")
        if not n["text"].strip():
            raise ValueError("hub returned an empty note")
        for key in ("source", "kind", "scope"):
            metadata(n.get(key), key)
        timestamp = bounded(n.get("ts"), 80, "timestamp")
        try:
            parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError()
        except ValueError:
            raise ValueError("hub returned an invalid timestamp") from None
    for n in notes:
        add_note(n["text"], source=n["source"], kind=n["kind"], scope=n["scope"], ts=n["ts"])
    # Acknowledge only after every note was saved, on the next sync.
    cfg["pending_ack"] = [n["id"] for n in notes]
    _save_config(cfg)
    if notes:
        log(f"remote: pulled {len(notes)} notes")
    return f"pushed {len(files)} files, pulled {len(notes)} notes"
