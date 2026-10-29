"""SQLite storage for the optional self-hosted memory hub."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from contextlib import contextmanager

from . import core
from .security import DATA_NOTICE, MAX_NOTE, MAX_QUERY, MAX_FILE, MAX_ACK, bounded, metadata, private_dir, scrub_secrets
from .http_security import RequestError

FILES = core.CURATED + ["brief.md", "journal-digest.md", "config.json"]


def string(value, default: str = "") -> str:
    if value is None:
        return default
    if not isinstance(value, str):
        raise ValueError("expected a string")
    return value


class Hub:
    def __init__(self, token_sha256: str):
        private_dir(core.STATE)
        self.path = core.STATE / "hub.sqlite"
        fd = os.open(self.path, os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        self.path.chmod(0o600)
        with self.db() as db:
            db.executescript("""
                create table if not exists mh_files (
                    name text primary key, content text not null, updated_at text not null);
                create table if not exists mh_notes (
                    id text primary key, ts text not null, source text not null,
                    kind text not null, scope text not null, text text not null,
                    pulled integer not null default 0);
                create table if not exists mh_config (key text primary key, value text not null);
            """)
            db.execute("insert into mh_config values ('token_sha256', ?) "
                       "on conflict(key) do update set value=excluded.value", (token_sha256,))

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def digest(self) -> str:
        with self.db() as db:
            row = db.execute("select value from mh_config where key='token_sha256'").fetchone()
        return row[0] if row else ""

    def file(self, name: str) -> str | None:
        with self.db() as db:
            row = db.execute("select content from mh_files where name=?", (name,)).fetchone()
        if not row:
            return None
        if name == "config.json":
            cfg = json.loads(row[0])
            return json.dumps({"name": scrub_secrets(cfg.get("name", ""))})
        return scrub_secrets(row[0])

    def name(self) -> str:
        cfg = json.loads(self.file("config.json") or "{}")
        return cfg.get("name", "").strip() or core.user_name()

    def _pending(self, db) -> list[dict]:
        notes, total = [], 2
        for row in db.execute("select * from mh_notes where pulled=0 order by ts, id limit 256"):
            note = dict(row)
            for key in ("text", "source", "scope", "kind"):
                note[key] = scrub_secrets(note[key])
            if len(note["text"]) > MAX_NOTE:
                suffix = "\n[truncated legacy note]"
                note["text"] = note["text"][:MAX_NOTE - len(suffix)] + suffix
            for key in ("source", "scope", "kind"):
                note[key] = re.sub(r"[\x00-\x1f\x7f]", " ", note[key])[:80]
            size = len(json.dumps(note, ensure_ascii=False).encode()) + 1
            if total + size > 512 * 1024:
                break
            notes.append(note)
            total += size
        return notes

    def pending(self) -> list[dict]:
        with self.db() as db:
            return self._pending(db)

    def status(self) -> dict:
        with self.db() as db:
            row = db.execute("select updated_at from mh_files where name='brief.md'").fetchone()
            pending = db.execute("select count(*) from mh_notes where pulled=0").fetchone()[0]
        return {"last_sync": row[0] if row else None, "pending_notes": pending}

    def context(self) -> str:
        brief = self.file("brief.md")
        if brief is None:
            return core.render_brief()
        notes = self.pending()
        if notes:
            brief += "\n\n## New remote memories (not yet synced locally)\n\n"
            brief += "\n".join(f"- [{n['ts'][:10]} · {n['source']}] {n['text']}" for n in notes)
        return DATA_NOTICE + "\n\n" + (brief or "Metaharness has no context yet. Run mh tick on the local machine.")

    def section(self, name: str) -> str:
        if name not in core.CURATED:
            raise ValueError("unknown section")
        return (self.file(name) or "") if self.file("brief.md") is not None else core.read_curated(name)

    def remember(self, args: dict, source: str) -> str:
        if not isinstance(args, dict):
            raise ValueError("expected an object")
        text = scrub_secrets(bounded(string(args.get("text")), MAX_NOTE, "text")).strip()
        bounded(text, MAX_NOTE, "text")
        if not text:
            raise ValueError("text is required")
        kind = metadata(string(args.get("kind"), "note"), "kind")
        kind = kind if kind in core.KINDS else "note"
        source = metadata(string(args.get("source"), source), "source")
        scope = metadata(string(args.get("scope"), "personal"), "scope")
        nid = hashlib.sha256(re.sub(r"\s+", " ", text.lower()).encode()).hexdigest()[:12]
        ts = core.now_iso()
        with self.db() as db:
            db.execute("begin immediate")
            if db.execute("select id from mh_notes where id=?", (nid,)).fetchone():
                return "Already known."
            if db.execute("select count(*) from mh_notes where pulled=0").fetchone()[0] >= MAX_ACK:
                raise RequestError(429, "pending note limit reached; run mh tick")
            core.add_note(text, source=source, kind=kind, scope=scope, ts=ts)
            db.execute("insert into mh_notes (id,ts,source,kind,scope,text) values (?,?,?,?,?,?)",
                       (nid, ts, source, kind, scope, text))
        return f"Saved ({nid}). Other agents can read it now; the next tick imports it locally."

    def search(self, query: str, limit: int = 8) -> list[dict]:
        bounded(query, MAX_QUERY, "query")
        limit = max(1, min(50, limit))
        if self.file("brief.md") is None:
            return core.search(query, limit)
        terms = [t for t in re.findall(r"\w+", query.lower()) if len(t) > 1]
        if not terms:
            return []
        docs = []
        with self.db() as db:
            for row in db.execute("select name,content from mh_files"):
                if row["name"] not in core.CURATED + ["journal-digest.md"]:
                    continue
                docs += [{"where": row["name"], "text": sec.strip()}
                         for sec in re.split(r"\n(?=#{1,3} |- )", scrub_secrets(row["content"])) if sec.strip()]
        docs += [{"where": f"note {n['ts'][:10]} {n['source']}", "text": n["text"]} for n in self.pending()]
        scored = []
        for doc in docs:
            low = doc["text"].lower()
            score = sum(low.count(t) + (3 if t in low else 0) for t in terms)
            if score:
                scored.append((score, doc))
        scored.sort(key=lambda item: -item[0])
        return [doc for _, doc in scored[:limit]]

    def sync(self, body: dict) -> dict:
        if not isinstance(body, dict):
            raise ValueError("expected an object")
        files, ack = body.get("files", {}), body.get("ack", [])
        if not isinstance(files, dict) or any(name not in FILES or not isinstance(text, str) for name, text in files.items()):
            raise ValueError("invalid files")
        if not isinstance(ack, list) or len(ack) > MAX_ACK or any(not isinstance(nid, str) or not re.fullmatch(r"[a-f0-9]{12}", nid) for nid in ack):
            raise ValueError("ack must contain note ids")
        if any(len(text.encode()) > MAX_FILE for text in files.values()):
            raise RequestError(413, "file too large")
        if "config.json" in files:
            cfg = json.loads(files["config.json"])
            if not isinstance(cfg, dict) or not isinstance(cfg.get("name"), str):
                raise ValueError("config.name must be a string")
            files = {**files, "config.json": json.dumps({"name": metadata(cfg["name"], "name")})}
        files = {name: text if name == "config.json" else scrub_secrets(text) for name, text in files.items()}
        if any(len(text.encode()) > MAX_FILE for text in files.values()):
            raise ValueError("file too large after redaction")
        ts = core.now_iso()
        with self.db() as db:
            db.execute("begin immediate")
            db.executemany("insert into mh_files (name,content,updated_at) values (?,?,?) "
                           "on conflict(name) do update set content=excluded.content, updated_at=excluded.updated_at",
                           [(name, text, ts) for name, text in files.items()])
            db.executemany("update mh_notes set pulled=1 where id=?", [(nid,) for nid in ack])
            notes = self._pending(db)
        return {"notes": notes}
