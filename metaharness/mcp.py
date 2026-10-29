"""Dependency-free MCP over stdio and an optional HTTP memory hub."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import socket
import threading
import time
import re
import secrets
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from .core import CURATED, KINDS, STATE, add_note, load_state, read_curated, render_brief, save_state, search, user_name
from .hub import Hub, string
from .security import DATA_NOTICE, MAX_BODY, MAX_BATCH, MAX_META, bounded, metadata
from .http_security import RateLimiter, RequestError, allowed_origin

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
        if not isinstance(msg.get("params", {}), dict):
            raise ValueError("params must be an object")
        person = hub.name() if hub else user_name()
        if method == "initialize":
            result = {
                "protocolVersion": msg.get("params", {}).get("protocolVersion", PROTOCOL),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "metaharness", "version": "0.1.0"},
                "instructions": f"Shared memory of {person}, used by all of their AI agents. {DATA_NOTICE}",
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
    while True:
        line = sys.stdin.readline(MAX_BODY + 1)
        if not line:
            break
        if len(line.encode()) > MAX_BODY:
            raise ValueError("MCP request too large")
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        msgs = msg if isinstance(msg, list) else [msg]
        if len(msgs) > MAX_BATCH:
            raise ValueError("MCP batch too large")
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
    limiter = RateLimiter()
    origins = os.environ.get("MH_ALLOWED_ORIGINS", "")
    methods = {"/context": "GET", "/status": "GET", "/search": "GET", "/remember": "POST", "/sync": "POST", "/openapi.json": "GET"}

    class H(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def handle_one_request(self):
            # Absolute deadline also covers clients drip-feeding headers before auth.
            def expire():
                try:
                    self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            timer = threading.Timer(10, expire)
            timer.daemon = True
            timer.start()
            try:
                super().handle_one_request()
            finally:
                timer.cancel()

        def _send(self, code: int, body: str = "", ctype: str = "application/json", allow: str = "") -> None:
            data = body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
            if code == 429:
                self.send_header("Retry-After", "60")
            self.send_header("Vary", "Origin")
            origin = self.headers.get("Origin", "")
            if origin and allowed_origin(origin, origins):
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Agent, MCP-Protocol-Version")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            if allow:
                self.send_header("Allow", allow)
            self.end_headers()
            self.wfile.write(data)

        def _json(self, body, code: int = 200) -> None:
            self._send(code, json.dumps(body))

        def _body(self):
            if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) > 1:
                raise RequestError(400, "invalid request framing")
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 <= length <= MAX_BODY:
                raise RequestError(413, "request too large")
            chunks, remaining, deadline = [], length, time.monotonic() + 10
            while remaining:
                self.connection.settimeout(max(0.01, min(5, deadline - time.monotonic())))
                if time.monotonic() >= deadline:
                    raise RequestError(408, "request timed out")
                chunk = self.rfile.read1(min(65536, remaining))
                if not chunk:
                    raise RequestError(400, "incomplete request")
                chunks.append(chunk)
                remaining -= len(chunk)
            return json.loads(b"".join(chunks) or b"{}")

        def _handle(self) -> None:
            url = urlsplit(self.path)
            path = url.path
            if len(self.path) > 4096:
                raise RequestError(414, "request URL too long")
            if not allowed_origin(self.headers.get("Origin", ""), origins):
                raise RequestError(403, "origin not allowed")
            if not limiter.allow("ingress:" + self.client_address[0], 240):
                raise RequestError(429, "request rate limit; retry later")
            mcp = path == "/mcp" or re.fullmatch(r"/mcp/[^/]+", path)
            token = path[len("/mcp/"):] if mcp and path.startswith("/mcp/") else self.headers.get("Authorization", "")
            token = re.sub(r"^Bearer\s+", "", token, flags=re.I).strip()
            if not token or len(token) > 512 or not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), hub.digest()):
                if not limiter.allow("bad:" + self.client_address[0], 20):
                    raise RequestError(429, "too many authentication attempts; retry later")
                self._json({"error": "unauthorized"}, 401)
                return
            if not limiter.allow("ok:" + self.client_address[0], 120):
                raise RequestError(429, "request rate limit; retry later")
            if path == "/openapi.json" and self.command == "GET":
                authority = self.headers.get("Host", f"{host}:{port}")
                if not re.fullmatch(r"[A-Za-z0-9.\-:\[\]]+", authority):
                    self._json({"error": "invalid host"}, 400)
                    return
                scheme = "https" if self.headers.get("X-Forwarded-Proto") == "https" else "http"
                self._json(openapi(f"{scheme}://{authority}"))
                return
            source = metadata(self.headers.get("X-Agent", "remote"), "source")
            if mcp:
                if self.command == "DELETE":
                    self._send(204)
                elif self.command != "POST":
                    self._send(405, allow="POST, DELETE")
                else:
                    body = self._body()
                    msgs = body if isinstance(body, list) else [body]
                    if not msgs or len(msgs) > MAX_BATCH:
                        raise RequestError(400, "MCP batch too large")
                    replies, reply_bytes = [], 2
                    for msg in msgs:
                        reply = handle(msg, source, hub)
                        if reply:
                            reply_bytes += len(json.dumps(reply).encode()) + 1
                            if reply_bytes > MAX_BODY:
                                raise RequestError(413, "response too large")
                            replies.append(reply)
                    if replies:
                        self._json(replies if isinstance(body, list) else replies[0])
                    else:
                        self._send(202)
                return
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
            except RequestError as error:
                self._json({"error": str(error)}, error.status)
            except (TimeoutError, socket.timeout):
                self._json({"error": "request timed out"}, 408)
            except (ValueError, KeyError, TypeError, AttributeError, RecursionError):
                self._json({"error": "invalid request"}, 400)
            except Exception:
                self._json({"error": "server error"}, 500)

        do_POST = do_GET
        do_DELETE = do_GET
        do_PUT = do_GET
        do_PATCH = do_GET

        def do_OPTIONS(self) -> None:
            path = urlsplit(self.path).path
            allowed = ("POST", "DELETE") if path == "/mcp" or re.fullmatch(r"/mcp/[^/]+", path) else (methods.get(path),)
            headers = {item.strip().lower() for item in self.headers.get("Access-Control-Request-Headers", "").split(",") if item.strip()}
            if (not self.headers.get("Origin") or not allowed_origin(self.headers.get("Origin", ""), origins)
                    or self.headers.get("Access-Control-Request-Method") not in allowed
                    or not headers <= {"authorization", "content-type", "x-agent", "mcp-protocol-version"}):
                self._json({"error": "preflight not allowed"}, 403)
            elif not limiter.allow("options:" + self.client_address[0], 120):
                self._json({"error": "request rate limit; retry later"}, 429)
            else:
                self._send(204)

        def log_message(self, *args) -> None:
            pass

    print(f"metaharness http on {host}:{port}", file=sys.stderr)
    class BoundedServer(ThreadingHTTPServer):
        daemon_threads = True
        slots = threading.BoundedSemaphore(32)
        def process_request(self, request, client_address):
            if not self.slots.acquire(blocking=False):
                self.shutdown_request(request)
                return
            try:
                super().process_request(request, client_address)
            except BaseException:
                self.slots.release()
                raise
        def process_request_thread(self, request, client_address):
            try:
                super().process_request_thread(request, client_address)
            finally:
                self.slots.release()
    BoundedServer((host, port), H).serve_forever()
