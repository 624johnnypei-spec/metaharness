"""Pull what each agent already remembers into the shared journal.

Every adapter is read-only against the agent's own files and skips files whose
mtime hasn't changed since the last run, so `mh harvest` is cheap to run often.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

from .core import HOME, SELF, add_note, file_mtime_iso, load_state, log, note_id, save_state, update_journal

FRONTMATTER = re.compile(r"^---\n(.*?)\n---\n?", re.S)


def _frontmatter(text: str) -> tuple[dict, str]:
    m = FRONTMATTER.match(text)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"')
    return meta, text[m.end():]


def _scope_from_claude_dir(name: str) -> str:
    # Encoded project paths end in the project name; the home directory is personal.
    parts = name.strip("-").split("-")
    for anchor in ("Desktop", "Documents", "Developer", "Downloads"):
        if anchor in parts:
            return "-".join(parts[parts.index(anchor) + 1:]) or "personal"
    return "personal"


class Harvester:
    def __init__(self) -> None:
        self.cursor = load_state("harvest")
        self.added = 0

    def changed(self, p: Path) -> bool:
        key, mtime = str(p), p.stat().st_mtime
        if self.cursor.get(key) == mtime:
            return False
        self.cursor[key] = mtime
        return True

    def add(self, text: str, **kw) -> None:
        if add_note(text, **kw):
            self.added += 1

    def retire_missing(self, origin_prefix: str, current: list[str]) -> None:
        """Entry-list stores (codex summary, GEMINI.md, Hermes) rewrite themselves; drop entries they dropped."""
        keep = {note_id(t) for t in current}

        def f(n: dict) -> bool:
            if (n.get("origin") or "").startswith(origin_prefix) and n["id"] not in keep and not n.get("retired"):
                n["retired"] = True
                return True
            return False
        update_journal(f)

    def retire_deleted_files(self) -> None:
        """A memory file an agent deleted should stop showing up for everyone else."""
        def f(n: dict) -> bool:
            o = n.get("origin") or ""
            for prefix in ("claude:",):
                if o.startswith(prefix) and not Path(o[len(prefix):]).exists() and not n.get("retired"):
                    n["retired"] = True
                    return True
            return False
        update_journal(f)

    # --- adapters -------------------------------------------------------

    def claude_code(self) -> None:
        for f in sorted((HOME / ".claude" / "projects").glob("*/memory/*.md")):
            if f.name == "MEMORY.md" or not self.changed(f):
                continue
            meta, body = _frontmatter(f.read_text(errors="ignore"))
            mtype = meta.get("type") or meta.get("metadata.type") or ""
            if not mtype:
                m = re.search(r"^\s+type:\s*(\w+)", f.read_text(errors="ignore"), re.M)
                mtype = m.group(1) if m else "note"
            scope = _scope_from_claude_dir(f.parent.parent.name)
            title = meta.get("name", f.stem)
            desc = meta.get("description", "")
            text = f"{title}: {desc}\n\n{body.strip()[:1500]}".strip()
            self.add(text, source="claude-code", kind=mtype, scope=scope,
                     origin=f"claude:{f}", ts=file_mtime_iso(f))

    def codex(self) -> None:
        f = HOME / ".codex" / "memories" / "memory_summary.md"
        if not f.exists() or not self.changed(f):
            return
        sections = re.split(r"\n## ", "\n" + f.read_text(errors="ignore"))
        kinds = {"User Profile": "profile", "User preferences": "preference", "General Tips": "tip"}
        seen = []
        for sec in sections:
            head, _, body = sec.partition("\n")
            kind = kinds.get(head.strip())
            if not kind:
                continue
            chunks = [c.strip() for c in re.split(r"\n\s*\n|\n(?=- )", body) if c.strip()]
            for c in chunks:
                c = re.sub(r"^- ", "", c)
                seen.append(c)
                self.add(c, source="codex", kind=kind, scope="personal",
                         origin=f"codex:summary:{note_id(c)}", ts=file_mtime_iso(f))
        self.retire_missing("codex:summary:", seen)

    def gemini(self) -> None:
        f = HOME / ".gemini" / "GEMINI.md"
        if not f.exists() or not self.changed(f):
            return
        m = re.search(r"## Gemini Added Memories\n(.*?)(?=\n#|\n<!--|\Z)", f.read_text(errors="ignore"), re.S)
        lines = [l.strip().lstrip("-* ").strip() for l in (m.group(1).splitlines() if m else [])]
        lines = [l for l in lines if l]
        for line in lines:
            self.add(line, source="gemini", kind="note", scope="personal",
                     origin=f"gemini:{note_id(line)}", ts=file_mtime_iso(f))
        self.retire_missing("gemini:", lines)

    def hermes_local(self) -> None:
        # Hermes Agent keeps USER.md / MEMORY.md with entries separated by "§".
        for f in sorted((HOME / ".hermes" / "memories").glob("*.md")):
            if not self.changed(f):
                continue
            kind = "profile" if f.stem.upper() == "USER" else "note"
            entries = [e.strip() for e in f.read_text(errors="ignore").split("§") if e.strip()]
            for entry in entries:
                self.add(entry, source="hermes", kind=kind, scope="personal",
                         origin=f"hermes:{f.stem}:{note_id(entry)}", ts=file_mtime_iso(f))
            self.retire_missing(f"hermes:{f.stem}:", entries)

    def inbox(self) -> None:
        inbox = SELF / "inbox"
        done = inbox / "processed"
        for f in sorted(inbox.glob("*")):
            if f.is_dir() or f.suffix not in (".md", ".txt"):
                continue
            meta, body = _frontmatter(f.read_text(errors="ignore"))
            self.add(body.strip(), source=meta.get("source", "inbox"), kind=meta.get("kind", "note"),
                     scope=meta.get("scope", "personal"), origin=f"inbox:{f.name}", ts=file_mtime_iso(f))
            done.mkdir(exist_ok=True)
            shutil.move(str(f), done / f.name)

    def run(self) -> int:
        for adapter in (self.retire_deleted_files, self.claude_code, self.codex, self.gemini, self.hermes_local, self.inbox):
            cursor = self.cursor.copy()
            try:
                adapter()
            except Exception as e:
                self.cursor = cursor
                # Retry unchanged files after a transient adapter failure.
                log(f"harvest {adapter.__name__} failed: {e!r}")
        save_state("harvest", self.cursor)
        return self.added


def harvest() -> int:
    return Harvester().run()
