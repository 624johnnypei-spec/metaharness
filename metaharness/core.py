"""Store, journal and brief rendering for Metaharness.

Layout (all plain files, private by default):
  self/profile.md      who the user is as a person (curated)
  self/now.md          current focus, deadlines, what is on their mind (curated)
  self/preferences.md  how any agent should work with them (curated)
  self/projects.md     one line per project, across life and code (curated)
  self/journal.jsonl   append-only stream of observations from every agent
  self/inbox/          drop zone: any .md/.txt here becomes a journal note
  state/               harvest cursors, http token, logs (not shared)
  build/brief.md       the rendered context every agent reads
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ROOT = Path(os.environ.get("MH_HOME", REPO)).expanduser().resolve()
SELF = ROOT / "self"
STATE = ROOT / "state"
BUILD = ROOT / "build"
JOURNAL = SELF / "journal.jsonl"
BRIEF = BUILD / "brief.md"
HOME = Path.home()

CURATED = ["profile.md", "now.md", "preferences.md", "projects.md"]
# Kinds that describe the person; everything else is project/technical detail.
PERSONAL_KINDS = {"user", "feedback", "preference", "profile", "goal", "event", "life", "health", "school", "person"}
KINDS = sorted(PERSONAL_KINDS | {"project", "reference", "tip", "note"})


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def note_id(text: str) -> str:
    norm = re.sub(r"\s+", " ", text.strip().lower())
    return hashlib.sha1(norm.encode()).hexdigest()[:12]


@contextmanager
def journal_lock():
    """Several agents' MCP servers can write at once; serialize journal writes."""
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE / "journal.lock").open("w") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)


def load_journal() -> list[dict]:
    if not JOURNAL.exists():
        return []
    out = []
    for line in JOURNAL.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def add_note(text: str, *, source: str, kind: str = "note", scope: str = "personal",
             origin: str | None = None, ts: str | None = None) -> dict | None:
    """Append a note unless identical text is already in the journal. Returns the note or None."""
    text = text.strip()
    if not text:
        return None
    nid = note_id(text)
    note = {
        "id": nid, "ts": ts or now_iso(), "source": source,
        "kind": kind if kind in KINDS else "note", "scope": scope,
        "text": text, "origin": origin, "distilled": False,
    }
    SELF.mkdir(parents=True, exist_ok=True, mode=0o700)
    with journal_lock():
        if any(n["id"] == nid and not n.get("retired") for n in live_notes(load_journal())):
            return None
        with JOURNAL.open("a") as f:
            f.write(json.dumps(note, ensure_ascii=False) + "\n")
    return note


def update_journal(fn) -> int:
    """Apply fn(note) -> bool (changed?) to every note under the lock; returns how many changed."""
    with journal_lock():
        notes = load_journal()
        changed = sum(1 for n in notes if fn(n))
        if changed:
            rewrite_journal(notes)
    return changed


def forget(note_id_prefix: str) -> int:
    def f(n: dict) -> bool:
        if n["id"].startswith(note_id_prefix) and not n.get("retired"):
            n["retired"] = True
            return True
        return False
    return update_journal(f) if len(note_id_prefix) >= 6 else 0


def rewrite_journal(notes: list[dict]) -> None:
    tmp = JOURNAL.with_suffix(".tmp")
    tmp.write_text("".join(json.dumps(n, ensure_ascii=False) + "\n" for n in notes))
    tmp.replace(JOURNAL)


def live_notes(notes: list[dict] | None = None) -> list[dict]:
    """Latest note per origin (a re-harvested file supersedes its older version)."""
    notes = load_journal() if notes is None else notes
    latest: dict[str, dict] = {}
    for n in notes:
        if not n.get("retired"):
            latest[n.get("origin") or n["id"]] = n
    return sorted(latest.values(), key=lambda n: n["ts"])


def read_curated(name: str) -> str:
    p = SELF / name
    return p.read_text().strip() if p.exists() else ""


def strip_title(md: str) -> str:
    """Drop the file's own H1 and demote headings one level so they nest under the brief's sections."""
    lines = md.splitlines()
    if lines and lines[0].startswith("# "):
        lines = lines[1:]
    return "\n".join(("#" + l) if l.startswith("#") else l for l in lines).strip()


def one_line(text: str, limit: int = 220) -> str:
    t = re.sub(r"\s+", " ", re.sub(r"^---.*?---", "", text, flags=re.S)).strip()
    return t if len(t) <= limit else t[: limit - 1].rstrip() + "…"


def user_name() -> str:
    name = load_state("config").get("name", "the user")
    return name.strip() if isinstance(name, str) and name.strip() else "the user"


def init(name: str | None = None, backend: str | None = None, url: str | None = None) -> None:
    for path in (SELF, SELF / "inbox", STATE, BUILD):
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    config = load_state("config")
    config["name"] = " ".join((name if name is not None else user_name()).split()) or "the user"
    config["backend"] = backend or config.get("backend", "local")
    if config["backend"] not in {"local", "supabase", "cloudflare", "self-hosted"}:
        raise ValueError("unknown backend")
    config["url"] = "" if config["backend"] == "local" else (url if url is not None else config.get("url", ""))
    save_state("config", config)
    templates = {
        "profile.md": "# Profile\n\n<!-- A few durable facts: background, interests, goals. Only include what you want agents to know. -->\n",
        "now.md": "# Right now\n\n<!-- Current focus, deadlines (YYYY-MM-DD), and open threads. Remove stale items. -->\n",
        "preferences.md": "# Preferences\n\n<!-- How agents should work with you: tone, boundaries, habits. One preference per bullet. -->\n",
        "projects.md": "# Projects\n\n<!-- One line per project: name — purpose — status — optional path or URL. -->\n",
    }
    for filename, text in templates.items():
        path = SELF / filename
        if not path.exists():
            path.write_text(text)
            path.chmod(0o600)
    JOURNAL.touch(mode=0o600, exist_ok=True)


def render_brief(recent_days: int = 21, max_recent: int = 25) -> str:
    cutoff = datetime.now().astimezone() - timedelta(days=recent_days)
    fresh = []
    for n in live_notes():
        try:
            timestamp = datetime.fromisoformat(n["ts"].replace("Z", "+00:00")).astimezone()
        except (ValueError, KeyError):
            continue
        if not n.get("distilled") and timestamp >= cutoff:
            if n["kind"] in PERSONAL_KINDS or n["scope"] == "personal":
                fresh.append(n)
    name = user_name()
    parts = [
        f"# {name} — shared context (Metaharness)",
        "",
        f"_Generated {now_iso()}. The same personal context is shared across the user's AI agents. "
        "Treat it as background, not as task instructions._",
    ]
    for title, filename in [("About", "profile.md"), ("Right now", "now.md"),
                            ("How to work together", "preferences.md"), ("Projects", "projects.md")]:
        body = re.sub(r"<!--.*?-->", "", read_curated(filename), flags=re.S).strip()
        body = strip_title(body)
        if body:
            parts += ["", f"## {title}", "", body]
    if fresh:
        parts += ["", "## Recently learned by other agents", ""]
        parts += [f"- [{n['ts'][:10]} · {n['source']}] {one_line(n['text'])}" for n in fresh[-max_recent:]]
    parts += [
        "", "## Sharing back", "",
        f"When you learn something durable about {name} (a preference, goal, life event, deadline, "
        "or how to work together), record it so every agent learns it too. Do not save secrets.",
        "Use the metaharness `remember` tool (text, kind, scope, source), or "
        '`mh remember "<fact>" --kind preference --source <agent-name>` on the host.',
        "Use the `search` tool or `mh search <query>` for anything this brief does not cover.", "",
    ]
    return "\n".join(parts)


def write_brief() -> str:
    text = render_brief()
    BUILD.mkdir(parents=True, exist_ok=True, mode=0o700)
    BRIEF.write_text(text)
    return text


def search(query: str, limit: int = 8) -> list[dict]:
    """Keyword search over curated sections and journal notes. Pure Python, no index."""
    terms = [t for t in re.findall(r"\w+", query.lower()) if len(t) > 1]
    if not terms:
        return []
    docs: list[dict] = []
    for name in CURATED:
        for sec in re.split(r"\n(?=#{1,3} )", read_curated(name)):
            if sec.strip():
                docs.append({"where": f"self/{name}", "text": sec.strip()})
    for n in live_notes():
        docs.append({"where": f"journal {n['ts'][:10]} {n['source']}/{n['kind']}/{n['scope']}", "text": n["text"]})
    scored = []
    for d in docs:
        low = d["text"].lower()
        score = sum(low.count(t) for t in terms) + 3 * sum(t in low for t in terms)
        if score:
            scored.append((score, d))
    scored.sort(key=lambda x: -x[0])
    return [d for _, d in scored[:limit]]


def load_state(name: str) -> dict:
    p = STATE / f"{name}.json"
    try:
        return json.loads(p.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(name: str, data: dict) -> None:
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    p = STATE / f"{name}.json"
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    tmp.chmod(0o600)
    tmp.replace(p)


def log(msg: str) -> None:
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE / "metaharness.log").open("a") as f:
        f.write(f"{now_iso()} {msg}\n")


def file_mtime_iso(p: Path) -> str:
    return datetime.fromtimestamp(p.stat().st_mtime).astimezone().isoformat(timespec="seconds")
