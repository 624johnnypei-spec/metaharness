"""Dependency-free MCP over stdio and an optional HTTP memory hub."""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from .core import CURATED, KINDS, STATE, add_note, load_state, read_curated, render_brief, save_state, search, user_name
from .hub import Hub, string

PROTOCOL = "2025-06-18"

TOOLS = [
    {
        "name": "get_context",
        "description": "Get shared personal context about {name}: background, current focus, preferences, "
                       "and projects. Call this at the start "
                       "of a conversation if the brief isn't already in your instructions, or pass `topic` to also "
                       "pull the most relevant memories for that topic.",
        "inputSchema": {"type": "object", "properties": {"topic": {"type": "string"}}},
    },
    {
        "name": "remember",
        "description": "Record a durable fact about {name} so every agent learns it too: "
                       "preferences, goals, deadlines, life events, and how to work together. Not code details.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "The fact, written so a different agent understands it cold."},
                "kind": {"type": "string", "enum": KINDS, "default": "note"},
                "scope": {"type": "string", "description": "'personal' or a project name", "default": "personal"},
                "source": {"type": "string", "description": "Your agent name, e.g. codex, hermes, gemini"},
            },
            "required": ["text"],
        },
    },
    {
        "name": "search",
        "description": "Keyword search across everything every agent has learned about {name}.",
        "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}},
                        "required": ["query"]},
    },
    {
        "name": "read_section",
        "description": "Read one curated file in full: " + ", ".join(CURATED),
        "inputSchema": {"type": "object", "properties": {"name": {"type": "string", "enum": CURATED}},
                        "required": ["name"]},
    },
]


def call_tool(name: str, args: dict, default_source: str, hub: Hub | None = None) -> str:
    if not isinstance(args, dict):
        raise ValueError("expected an object")
    if name == "get_context":
        text = hub.context() if hub else render_brief()
        if args.get("topic"):
            topic = string(args["topic"])
            hits = hub.search(topic, 6) if hub else search(topic, 6)
            text += "\n\n## Relevant to: " + args["topic"] + "\n\n" + "\n\n".join(f"[{h['where']}]\n{h['text']}" for h in hits)
        return text
    if name == "remember":
        if hub:
            return hub.remember(args, default_source)
        text = string(args.get("text")).strip()
        if not text:
            raise ValueError("text is required")
        note = add_note(text, source=string(args.get("source"), default_source),
                        kind=string(args.get("kind"), "note"), scope=string(args.get("scope"), "personal"))
        return f"Saved ({note['id']}). Every agent will see it in the next brief." if note else "Already known."
    if name == "search":
        query = string(args.get("query"))
        limit = max(1, min(50, int(args.get("limit") or 8)))
        hits = hub.search(query, limit) if hub else search(query, limit)
        return "\n\n".join(f"[{h['where']}]\n{h['text']}" for h in hits) or "No matches."
    if name == "read_section":
        if args.get("name") not in CURATED:
            raise ValueError(f"name must be one of {CURATED}")
        return hub.section(args["name"]) if hub else read_curated(args["name"])
    raise ValueError(f"unknown tool {name}")


def handle(msg: dict, default_source: str, hub: Hub | None = None) -> dict | None:
    if not isinstance(msg, dict):
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "invalid request"}}
    mid, method = msg.get("id"), msg.get("method")
    if mid is None:  # notification
        return None
    try:
        person = hub.name() if hub else user_name()
        if method == "initialize":
            result = {
                "protocolVersion": msg.get("params", {}).get("protocolVersion", PROTOCOL),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "metaharness", "version": "0.1.0"},
                "instructions": f"Shared memory of {person}, used by all of their AI agents.",
            }
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": [{**tool, "description": tool["description"].replace("{name}", person)}
                                for tool in TOOLS]}
        elif method == "tools/call":
            p = msg.get("params", {})
            try:
                text = call_tool(p.get("name"), p.get("arguments") or {}, default_source, hub)
                result = {"content": [{"type": "text", "text": text}]}
            except Exception as e:
                result = {"content": [{"type": "text", "text": f"Error: {e}"}], "isError": True}
        else:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}
        return {"jsonrpc": "2.0", "id": mid, "result": result}
    except Exception as e:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": str(e)}}


def serve_stdio(source: str = "mcp-client") -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        msgs = msg if isinstance(msg, list) else [msg]
        replies = [r for r in (handle(m, source) for m in msgs) if r]
        if replies:
            sys.stdout.write(json.dumps(replies if isinstance(msg, list) else replies[0]) + "\n")
            sys.stdout.flush()


def server_digest(token_sha256: str | None = None) -> str:
    cfg = load_state("server")
    digest = token_sha256 or cfg.get("token_sha256")
    token = None
    if not digest:
        if not sys.stderr.isatty():
            raise ValueError("configure a token hash first: mh serve --token-sha256 <sha256>")
        token = secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode()).hexdigest()
    if not isinstance(digest, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", digest):
        raise ValueError("token hash must contain 64 hexadecimal characters")
    digest = digest.lower()
    if cfg.get("token_sha256") != digest:
        save_state("server", {"token_sha256": digest})
    (STATE / "server.json").chmod(0o600)
    if token:
        print(f"Bearer token (shown once): {token}", file=sys.stderr)
    return digest


def openapi(base: str) -> dict:
    markdown = {"200": {"description": "Memory", "content": {"text/markdown": {"schema": {"type": "string"}}}}}
    return {
        "openapi": "3.1.0", "info": {"title": "Metaharness", "version": "0.1.0", "description": "One shared personal memory across AI agents."},
        "servers": [{"url": base}], "security": [{"bearerAuth": []}],
        "components": {"securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"}}},
        "paths": {
            "/context": {"get": {"operationId": "getContext", "summary": "Get the shared context before answering", "responses": markdown}},
            "/status": {"get": {"operationId": "getStatus", "summary": "Read the last brief sync time and pending note count",
                "responses": {"200": {"description": "Sync status", "content": {"application/json": {"schema": {
                    "type": "object", "required": ["last_sync", "pending_notes"], "properties": {
                        "last_sync": {"type": ["string", "null"], "format": "date-time"},
                        "pending_notes": {"type": "integer", "minimum": 0}}}}}}}}},
            "/search": {"get": {"operationId": "searchMemory", "summary": "Search shared memories",
                "parameters": [{"name": "q", "in": "query", "required": True, "schema": {"type": "string"}}], "responses": markdown}},
            "/remember": {"post": {"operationId": "remember", "summary": "Save a durable personal fact", "x-openai-isConsequential": True,
                "requestBody": {"required": True, "content": {"application/json": {"schema": {
                    "type": "object", "required": ["text"], "properties": {"text": {"type": "string"},
                    "kind": {"type": "string", "enum": KINDS}, "scope": {"type": "string"}, "source": {"type": "string"}}}}}},
                "responses": {"200": {"description": "Saved", "content": {"application/json": {"schema": {
                    "type": "object", "properties": {"result": {"type": "string"}}}}}}}}},
        },
    }


def serve_http(host: str, port: int, token_sha256: str | None = None) -> None:
    hub = Hub(server_digest(token_sha256))

    class H(BaseHTTPRequestHandler):
        def _send(self, code: int, body: str = "", ctype: str = "application/json", allow: str = "") -> None:
            data = body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Agent, MCP-Protocol-Version")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            if allow:
                self.send_header("Allow", allow)
            self.end_headers()
            self.wfile.write(data)

        def _json(self, body, code: int = 200) -> None:
            self._send(code, json.dumps(body))

        def _body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 <= length <= 8 * 1024 * 1024:
                raise ValueError("invalid request size")
            return json.loads(self.rfile.read(length) or b"{}")

        def _handle(self) -> None:
            url = urlsplit(self.path)
            path = url.path
            if path == "/openapi.json" and self.command == "GET":
                authority = self.headers.get("Host", f"{host}:{port}")
                if not re.fullmatch(r"[A-Za-z0-9.\-:\[\]]+", authority):
                    self._json({"error": "invalid host"}, 400)
                    return
                scheme = "https" if self.headers.get("X-Forwarded-Proto") == "https" else "http"
                self._json(openapi(f"{scheme}://{authority}"))
                return
            mcp = path == "/mcp" or re.fullmatch(r"/mcp/[^/]+", path)
            token = path[len("/mcp/"):] if mcp and path.startswith("/mcp/") else self.headers.get("Authorization", "")
            token = re.sub(r"^Bearer\s+", "", token, flags=re.I).strip()
            if not token or not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), hub.digest()):
                self._json({"error": "unauthorized"}, 401)
                return
            source = self.headers.get("X-Agent", "remote")
            if mcp:
                if self.command == "DELETE":
                    self._send(204)
                elif self.command != "POST":
                    self._send(405, allow="POST, DELETE")
                else:
                    body = self._body()
                    msgs = body if isinstance(body, list) else [body]
                    replies = [r for r in (handle(msg, source, hub) for msg in msgs) if r]
                    if replies:
                        self._json(replies if isinstance(body, list) else replies[0])
                    else:
                        self._send(202)
                return
            methods = {"/context": "GET", "/status": "GET", "/search": "GET", "/remember": "POST", "/sync": "POST", "/openapi.json": "GET"}
            if path not in methods:
                self._json({"error": "not found"}, 404)
            elif self.command != methods[path]:
                self._send(405, allow=methods[path])
            elif path == "/context":
                self._send(200, hub.context(), "text/markdown; charset=utf-8")
            elif path == "/status":
                self._json(hub.status())
            elif path == "/search":
                query = parse_qs(url.query).get("q", [""])[0]
                self._send(200, call_tool("search", {"query": query}, source, hub), "text/markdown; charset=utf-8")
            elif path == "/remember":
                self._json({"result": call_tool("remember", self._body(), source, hub)})
            elif path == "/sync":
                self._json(hub.sync(self._body()))

        def do_GET(self) -> None:
            try:
                self._handle()
            except (ValueError, KeyError, TypeError, AttributeError):
                self._json({"error": "invalid request"}, 400)
            except Exception:
                self._json({"error": "server error"}, 500)

        do_POST = do_GET
        do_DELETE = do_GET
        do_PUT = do_GET
        do_PATCH = do_GET

        def do_OPTIONS(self) -> None:
            self._send(204)

        def log_message(self, *args) -> None:
            pass

    print(f"metaharness http on {host}:{port}", file=sys.stderr)
    ThreadingHTTPServer((host, port), H).serve_forever()
