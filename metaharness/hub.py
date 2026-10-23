"""SQLite storage for the optional self-hosted memory hub."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from contextlib import contextmanager

from . import core

FILES = core.CURATED + ["brief.md", "journal-digest.md", "config.json"]


def string(value, default: str = "") -> str:
    if value is None:
        return default
    if not isinstance(value, str):
        raise ValueError("expected a string")
    return value


class Hub:
    def __init__(self, token_sha256: str):
        core.STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = core.STATE / "hub.sqlite"
        fd = os.open(self.path, os.O_CREAT | os.O_WRONLY, 0o600)
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
        return row[0] if row else None

    def name(self) -> str:
        cfg = json.loads(self.file("config.json") or "{}")
        return cfg.get("name", "").strip() or core.user_name()

    def pending(self) -> list[dict]:
        with self.db() as db:
            return [dict(row) for row in db.execute("select * from mh_notes where pulled=0 order by ts")]

    def context(self) -> str:
        brief = self.file("brief.md")
        if brief is None:
            return core.render_brief()
        notes = self.pending()
        if notes:
            brief += "\n\n## New remote memories (not yet synced locally)\n\n"
            brief += "\n".join(f"- [{n['ts'][:10]} · {n['source']}] {n['text']}" for n in notes)
        return brief or "Metaharness has no context yet. Run mh tick on the local machine."

    def section(self, name: str) -> str:
        if name not in core.CURATED:
            raise ValueError("unknown section")
        return (self.file(name) or "") if self.file("brief.md") is not None else core.read_curated(name)

    def remember(self, args: dict, source: str) -> str:
        text = string(args.get("text")).strip()
        if not text:
            raise ValueError("text is required")
        kind = string(args.get("kind"), "note")
        kind = kind if kind in core.KINDS else "note"
        source = string(args.get("source"), source)
        scope = string(args.get("scope"), "personal")
        nid = hashlib.sha256(re.sub(r"\s+", " ", text.lower()).encode()).hexdigest()[:12]
        ts = core.now_iso()
        with self.db() as db:
            db.execute("begin immediate")
            if db.execute("select id from mh_notes where id=?", (nid,)).fetchone():
                return "Already known."
            core.add_note(text, source=source, kind=kind, scope=scope, ts=ts)
            db.execute("insert into mh_notes (id,ts,source,kind,scope,text) values (?,?,?,?,?,?)",
                       (nid, ts, source, kind, scope, text))
        return f"Saved ({nid}). Other agents can read it now; the next tick imports it locally."

    def search(self, query: str, limit: int = 8) -> list[dict]:
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
                         for sec in re.split(r"\n(?=#{1,3} |- )", row["content"]) if sec.strip()]
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
        if not isinstance(ack, list) or any(not isinstance(nid, str) for nid in ack):
            raise ValueError("ack must contain note ids")
        if "config.json" in files:
            cfg = json.loads(files["config.json"])
            if not isinstance(cfg, dict) or not isinstance(cfg.get("name"), str):
                raise ValueError("config.name must be a string")
        ts = core.now_iso()
        with self.db() as db:
            db.execute("begin immediate")
            db.executemany("insert into mh_files (name,content,updated_at) values (?,?,?) "
                           "on conflict(name) do update set content=excluded.content, updated_at=excluded.updated_at",
                           [(name, text, ts) for name, text in files.items()])
            db.executemany("update mh_notes set pulled=1 where id=?", [(nid,) for nid in ack])
            notes = [dict(row) for row in db.execute("select * from mh_notes where pulled=0 order by ts")]
        return {"notes": notes}
