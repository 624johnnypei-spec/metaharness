from __future__ import annotations

import argparse
import sys
import subprocess

from . import core


def tick(local_only: bool = False) -> None:
    from .harvest import harvest
    from .remote import configured, sync_remote
    from .sync import sync
    print(f"harvested {harvest()} new notes")
    failures = []
    if configured() and not local_only:
        try:
            print("remote:", sync_remote())
        except Exception as e:
            failures.append(str(e))
    print("synced:", ", ".join(sync(core.write_brief())) or "no changes")
    if configured() and not local_only and not failures:
        try:
            sync_remote()
        except Exception as e:
            failures.append(str(e))
    if failures:
        core.log(f"remote sync failed: {failures[0]}")
        raise RuntimeError(f"local sync completed; cloud sync failed: {failures[0]}")


def install(local_only: bool = False) -> None:
    from .sync import install_mcp, install_skills, render_setup
    for k, v in install_mcp().items():
        print(f"mcp  {k:20} {v}")
    render_setup()
    for k, v in install_skills().items():
        print(f"skill {k:19} {v}")
    tick(local_only)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="mh", description="Metaharness: one shared memory for every AI agent.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("init", help="create your private memory and install agent integrations")
    i.add_argument("--name", help="name used in the shared context (default: the user)")
    i.add_argument("--backend", choices=["local", "supabase", "cloudflare", "self-hosted"],
                   help="memory backend (default: local, or keep the current choice)")
    i.add_argument("--url", help="base URL of your own hub")
    sub.add_parser("context", help="print the brief every agent gets")
    r = sub.add_parser("remember", help="record a durable fact about the user")
    r.add_argument("text")
    r.add_argument("--kind", default="note", choices=core.KINDS)
    r.add_argument("--scope", default="personal")
    r.add_argument("--source", default="cli")
    fg = sub.add_parser("forget", help="retire a journal note by id (see `mh status -v`)")
    fg.add_argument("id")
    s = sub.add_parser("search", help="search everything agents know")
    s.add_argument("query", nargs="+")
    s.add_argument("-n", type=int, default=8)
    sub.add_parser("harvest", help="pull memories from installed agents' own stores")
    sub.add_parser("sync", help="render the brief and push it into local agents")
    sub.add_parser("tick", help="harvest + cloud sync + update local agents")
    d = sub.add_parser("distill", help="fold new notes into the curated profile with an LLM")
    d.add_argument("--engine", default="claude", choices=["claude", "codex"])
    d.add_argument("--dry-run", action="store_true", help="print the prompt without running an LLM")
    sub.add_parser("install", help="register MCP and the interview skill, then tick")
    sub.add_parser("uninstall", help="remove managed brief blocks from agent instruction files")
    st = sub.add_parser("status", help="show journal notes and their sources")
    st.add_argument("-v", action="store_true", help="also list pending notes with ids")
    m = sub.add_parser("mcp", help="run the MCP server on stdio")
    m.add_argument("--source", default="mcp-client")
    h = sub.add_parser("serve", help="run the HTTP server for remote agents")
    h.add_argument("--host", default="127.0.0.1")
    h.add_argument("--port", type=int, default=8766)
    h.add_argument("--token-sha256", help="SHA-256 of the client token; the server stores only this hash")
    remote = sub.add_parser("remote", help="configure or sync the optional cloud hub")
    rs = remote.add_subparsers(dest="remote_cmd", required=True)
    setup = rs.add_parser("setup", help="generate a token and print cloud setup instructions")
    setup.add_argument("--backend", choices=["supabase", "cloudflare", "self-hosted"], required=True)
    setup.add_argument("--url", required=True, help="base URL of your own hub")
    rs.add_parser("sync", help="pull cloud notes and upload the current local memory")
    a = ap.parse_args(argv)

    try:
        if a.cmd == "init":
            name = a.name
            if name is None and sys.stdin.isatty():
                name = input(f"Name [{core.user_name()}]: ").strip() or core.user_name()
            config = core.load_state("config")
            backend = a.backend or config.get("backend", "local")
            url = a.url if a.url is not None else config.get("url", "")
            pending_setup = False
            if backend != "local":
                from .remote import setup as remote_setup, validate_url, configured
                url = validate_url(url, backend)
                pending_setup = not configured() or config.get("backend") != backend or config.get("url") != url
                if pending_setup:
                    print(remote_setup(url, backend))
            core.init(name, backend, url)
            install(local_only=pending_setup)
            if pending_setup:
                print("Local setup complete. Provision the printed token hash on your hub, then run ./mh tick.")
            print("Ready. Start a new agent session and run /know-me.")
        elif a.cmd == "context":
            print(core.render_brief())
        elif a.cmd == "remember":
            n = core.add_note(a.text, source=a.source, kind=a.kind, scope=a.scope)
            print(f"saved {n['id']}" if n else "already known")
        elif a.cmd == "forget":
            print(f"retired {core.forget(a.id)} note(s)")
        elif a.cmd == "search":
            for hit in core.search(" ".join(a.query), a.n):
                print(f"── {hit['where']}\n{hit['text']}\n")
        elif a.cmd == "harvest":
            from .harvest import harvest
            print(f"harvested {harvest()} new notes")
        elif a.cmd == "tick":
            tick()
        elif a.cmd == "sync":
            from .sync import sync
            print("synced:", ", ".join(sync(core.write_brief())) or "no changes")
        elif a.cmd == "distill":
            from .distill import distill
            print(distill(a.engine, a.dry_run))
            if not a.dry_run:
                from .sync import sync
                sync(core.write_brief())
        elif a.cmd == "install":
            install()
        elif a.cmd == "uninstall":
            from .sync import unsync
            print("removed from:", ", ".join(unsync()) or "nothing")
        elif a.cmd == "status":
            notes = core.live_notes()
            by: dict[str, list[int]] = {}
            for n in notes:
                by.setdefault(n["source"], [0, 0])[0 if n.get("distilled") else 1] += 1
            print(f"{len(notes)} live notes in {core.JOURNAL}")
            for src, (done, todo) in sorted(by.items()):
                print(f"  {src:14} {todo:4} pending  {done:4} distilled")
            if a.v:
                for n in notes:
                    if not n.get("distilled"):
                        print(f"  {n['id']}  {n['ts'][:10]} {n['source']}/{n['kind']}  {core.one_line(n['text'], 100)}")
        elif a.cmd == "mcp":
            from .mcp import serve_stdio
            serve_stdio(a.source)
        elif a.cmd == "serve":
            from .mcp import serve_http
            serve_http(a.host, a.port, a.token_sha256)
        elif a.cmd == "remote":
            from .remote import setup as remote_setup, sync_remote
            if a.remote_cmd == "setup":
                print(remote_setup(a.url, a.backend))
            else:
                print(sync_remote())
                core.write_brief()
                print(sync_remote())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
        print(f"mh: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
