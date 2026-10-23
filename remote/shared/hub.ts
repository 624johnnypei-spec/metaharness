export type Note = { id: string; ts: string; source: string; kind: string; scope: string; text: string; pulled?: boolean | number };
export type MemoryFile = { name: string; content: string };
export interface Store {
  tokenHash(): Promise<string>;
  file(name: string): Promise<string>;
  files(names: string[]): Promise<MemoryFile[]>;
  pending(): Promise<Note[]>;
  insert(note: Note): Promise<boolean>;
  sync(files: Record<string, string>, ack: string[]): Promise<Note[]>;
}

export function createHub(store: Store, publicPath = "", internalPath = publicPath) {
const CURATED = ["profile.md", "now.md", "preferences.md", "projects.md"];
const FILES = [...CURATED, "brief.md", "journal-digest.md", "config.json"];
const KINDS = ["event", "feedback", "goal", "health", "life", "note", "person", "preference", "profile",
  "project", "reference", "school", "tip", "user"];
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Agent, MCP-Protocol-Version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const text = (body: string) => new Response(body, {
  headers: { ...CORS, "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" } });

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
  return value as Record<string, unknown>;
}

function string(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new Error("expected a string");
  return value;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authed(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = await store.tokenHash();
  const got = await sha256(token.trim().replace(/^Bearer\s+/i, ""));
  if (expected.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function getFile(name: string): Promise<string> {
  return store.file(name);
}

async function userName(): Promise<string> {
  const cfg = JSON.parse(await getFile("config.json") || "{}");
  return typeof cfg.name === "string" && cfg.name.trim() ? cfg.name : "the user";
}

async function context(): Promise<string> {
  let brief = await getFile("brief.md");
  const notes = await store.pending();
  if (notes?.length) {
    brief += "\n\n## New remote memories (not yet synced locally)\n\n" +
      notes.map((n) => `- [${String(n.ts).slice(0, 10)} · ${n.source}] ${n.text}`).join("\n");
  }
  return brief || "Metaharness has no context yet. Run mh tick on the local machine.";
}

async function remember(a: Record<string, unknown>, source: string): Promise<string> {
  const text = string(a.text).trim();
  if (!text) throw new Error("text is required");
  const id = (await sha256(text.toLowerCase().replace(/\s+/g, " "))).slice(0, 12);
  const kind = string(a.kind, "note");
  const saved = await store.insert({ id, text, ts: new Date().toISOString(),
    source: string(a.source, source), kind: KINDS.includes(kind) ? kind : "note",
    scope: string(a.scope, "personal"),
  });
  if (!saved) return "Already known.";
  return `Saved (${id}). Other agents can read it now; the next tick imports it locally.`;
}

async function search(q: string, limit = 8): Promise<string> {
  const terms = (q.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((t) => t.length > 1);
  if (!terms.length) return "No matches.";
  const docs: { where: string; text: string }[] = [];
  const files = await store.files([...CURATED, "journal-digest.md"]);
  for (const f of files ?? []) {
    for (const sec of f.content.split(/\n(?=#{1,3} |- )/)) if (sec.trim()) docs.push({ where: f.name, text: sec.trim() });
  }
  const notes = await store.pending();
  for (const n of notes ?? []) docs.push({ where: `note ${String(n.ts).slice(0, 10)} ${n.source}`, text: n.text });
  return docs.map((d) => {
    const low = d.text.toLowerCase();
    let score = 0;
    for (const t of terms) { const count = low.split(t).length - 1; score += count + (count ? 3 : 0); }
    return { score, d };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, limit))).map(({ d }) => `[${d.where}]\n${d.text}`).join("\n\n") || "No matches.";
}

function tools(name: string) {
  return [
    { name: "get_context", description: `Get the shared personal context for ${name}. Call at the start of a conversation.`,
      inputSchema: { type: "object", properties: { topic: { type: "string" } } } },
    { name: "remember", description: `Save a durable fact about ${name}: preferences, goals, deadlines, life events, or how to work together. Never save secrets.`,
      inputSchema: { type: "object", properties: { text: { type: "string" }, kind: { type: "string", enum: KINDS },
        scope: { type: "string" }, source: { type: "string" } }, required: ["text"] } },
    { name: "search", description: `Keyword search across shared memories of ${name}.`,
      inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["query"] } },
    { name: "read_section", description: "Read one curated file in full: " + CURATED.join(", "),
      inputSchema: { type: "object", properties: { name: { type: "string", enum: CURATED } }, required: ["name"] } },
  ];
}

async function callTool(name: string, a: Record<string, unknown>, source: string): Promise<string> {
  if (name === "get_context") return a.topic ? await context() + "\n\n## Relevant memories\n\n" + await search(string(a.topic), 6) : context();
  if (name === "remember") return remember(a, source);
  if (name === "search") return search(string(a.query), Number(a.limit) || 8);
  if (name === "read_section") {
    const section = string(a.name);
    if (!CURATED.includes(section)) throw new Error("name must be one of " + CURATED.join(", "));
    return getFile(section);
  }
  throw new Error("unknown tool " + name);
}

async function handleRpc(value: unknown, source: string) {
  const m = object(value);
  if (m.id === undefined || m.id === null) return null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
  const params = object(m.params ?? {});
  switch (m.method) {
    case "initialize":
      return ok({ protocolVersion: params.protocolVersion ?? "2025-06-18", capabilities: { tools: {} },
        serverInfo: { name: "metaharness", version: "0.1.0" },
        instructions: `Shared memory of ${await userName()}. Call get_context before answering and remember durable facts.` });
    case "ping": return ok({});
    case "tools/list": return ok({ tools: tools(await userName()) });
    case "tools/call":
      try {
        return ok({ content: [{ type: "text", text: await callTool(string(params.name), object(params.arguments ?? {}), source) }] });
      } catch (e) {
        return ok({ content: [{ type: "text", text: "Error: " + (e as Error).message }], isError: true });
      }
    default: return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "method not found: " + m.method } };
  }
}

function openapi(base: string) {
  const markdown = { "200": { description: "Memory", content: { "text/markdown": { schema: { type: "string" } } } } };
  return {
    openapi: "3.1.0", info: { title: "Metaharness", version: "0.1.0", description: "One shared personal memory across AI agents." },
    servers: [{ url: base }], security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    paths: {
      "/context": { get: { operationId: "getContext", summary: "Get the shared context before answering", responses: markdown } },
      "/search": { get: { operationId: "searchMemory", summary: "Search shared memories",
        parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }], responses: markdown } },
      "/remember": { post: { operationId: "remember", summary: "Save a durable personal fact", "x-openai-isConsequential": true,
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["text"],
          properties: { text: { type: "string" }, kind: { type: "string", enum: KINDS }, scope: { type: "string" }, source: { type: "string" } } } } } },
        responses: { "200": { description: "Saved", content: { "application/json": { schema: {
          type: "object", properties: { result: { type: "string" } } } } } } } } },
    },
  };
}

return async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  let path = url.pathname;
  const prefix = [publicPath, internalPath].find((p) => p && (path === p || path.startsWith(p + "/")));
  if (prefix) path = path.slice(prefix.length);
  else if (publicPath) return json({ error: "not found" }, 404);
  const parts = path.split("/").filter(Boolean);
  const route = parts[0] ?? "";
  const base = url.origin + publicPath;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (route === "openapi.json" && parts.length === 1 && req.method === "GET") return json(openapi(base));
  try {
    const token = route === "mcp" ? parts[1] ?? req.headers.get("Authorization") : req.headers.get("Authorization");
    if (!(await authed(token))) return json({ error: "unauthorized" }, 401);
    const source = req.headers.get("X-Agent") ?? "remote";
    if (route === "mcp" && parts.length <= 2) {
      if (req.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
      if (req.method !== "POST") return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST, DELETE" } });
      const body = await req.json();
      const msgs = Array.isArray(body) ? body : [body];
      const replies = [];
      for (const m of msgs) { const reply = await handleRpc(m, source); if (reply) replies.push(reply); }
      if (!replies.length) return new Response(null, { status: 202, headers: CORS });
      return json(Array.isArray(body) ? replies : replies[0]);
    }
    if (parts.length !== 1) return json({ error: "not found" }, 404);
    if (route === "context" && req.method === "GET") return text(await context());
    if (route === "search" && req.method === "GET") return text(await search(url.searchParams.get("q") ?? ""));
    if (route === "remember" && req.method === "POST") return json({ result: await remember(object(await req.json()), source) });
    if (route === "sync" && req.method === "POST") {
      const body = object(await req.json());
      const files = object(body.files ?? {});
      const ack = body.ack ?? [];
      if (!Array.isArray(ack) || ack.some((id) => typeof id !== "string")) throw new Error("ack must contain note ids");
      if (Object.entries(files).some(([name, content]) => !FILES.includes(name) || typeof content !== "string")) throw new Error("invalid file");
      if (files["config.json"]) {
        const cfg = object(JSON.parse(string(files["config.json"])));
        if (typeof cfg.name !== "string") throw new Error("config.name must be a string");
      }
      return json({ notes: await store.sync(files as Record<string, string>, ack) });
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, e instanceof SyntaxError ? 400 : 500);
  }
};
}
