/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { HubClient, HubError, KINDS, parseSearchResults } from "../lib/api.ts";
import type { Credentials } from "../lib/types.ts";

const credentials: Credentials = { url: "https://example.invalid/functions/v1/metaharness/", token: "sample-test-token" };
const markdown = (text: string) => new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const fetchWith = (fn: (url: string, options: RequestInit) => Response | Promise<Response>): typeof fetch =>
  ((url, options) => Promise.resolve(fn(String(url), options ?? {}))) as typeof fetch;

test("default browser fetch keeps its global receiver and never leaks the token", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async function (this: unknown, url, options) {
      // Browsers throw Illegal invocation when fetch is invoked as a client method.
      assert.equal(this, globalThis);
      assert.ok(!String(url).includes(credentials.token));
      assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${credentials.token}`);
      assert.equal(options?.body, undefined);
      if (++calls === 2) throw new Error(`Network details containing ${credentials.token}`);
      return markdown("# Default fetch works");
    };
    const client = new HubClient(credentials);
    assert.equal(await client.context(), "# Default fetch works");
    await assert.rejects(client.context(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Could not reach the hub/);
      assert.ok(!error.message.includes(credentials.token));
      return true;
    });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("context preserves base paths and authenticates only in headers", async () => {
  let calls = 0;
  const client = new HubClient(credentials, fetchWith((url, options) => {
    calls++;
    assert.equal(url, "https://example.invalid/functions/v1/metaharness/context");
    assert.ok(!url.includes(credentials.token));
    assert.equal(options.method, "GET");
    assert.deepEqual(options.headers, { Authorization: `Bearer ${credentials.token}`, Accept: "text/markdown", "X-Agent": "app" });
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return markdown("# Sample context");
  }));
  assert.equal(await client.context(), "# Sample context");
  assert.equal(calls, 1);
});

test("remember posts the complete protocol payload with app as source", async () => {
  const client = new HubClient(credentials, fetchWith((url, options) => {
    assert.ok(url.endsWith("/remember"));
    assert.equal(options.method, "POST");
    assert.equal(new Headers(options.headers).get("authorization"), `Bearer ${credentials.token}`);
    assert.equal(new Headers(options.headers).get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(options.body)), { text: "Prefer clear examples", kind: "preference", source: "app" });
    return json({ result: "Saved (sample). Other agents can read it now; the next tick imports it locally." });
  }));
  assert.match((await client.remember(" Prefer clear examples ", "preference")).result, /^Saved/);
});

test("section uses authenticated MCP read_section without a token in its URL", async () => {
  const client = new HubClient(credentials, fetchWith((url, options) => {
    assert.ok(url.endsWith("/mcp"));
    assert.ok(!url.includes(credentials.token));
    assert.deepEqual(JSON.parse(String(options.body)), {
      jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_section", arguments: { name: "profile.md" } },
    });
    return json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "# Sample profile" }] } });
  }));
  assert.equal(await client.section("profile.md"), "# Sample profile");
});

test("search encodes the query and groups results by source in ranked order", async () => {
  const client = new HubClient(credentials, fetchWith((url) => {
    assert.ok(url.endsWith("/search?q=wood%20%26%20hinges%3F"));
    return markdown("[profile.md]\nLikes wood\n\n[now.md]\n## Hinges\nTesting hinges\n\n[profile.md]\nLikes drawing\n\n[note 2026-01-01 app]\nA new idea");
  }));
  assert.deepEqual(await client.search("wood & hinges?"), [
    { source: "profile.md", items: ["Likes wood", "Likes drawing"] },
    { source: "now.md", items: ["## Hinges\nTesting hinges"] },
    { source: "note 2026-01-01 app", items: ["A new idea"] },
  ]);
  assert.deepEqual(parseSearchResults("No matches.\n"), []);
  assert.deepEqual(parseSearchResults("[self/preferences.md]\nClear examples\n\n[journal 2026-01-01 app/note/personal]\nA note"), [
    { source: "self/preferences.md", items: ["Clear examples"] },
    { source: "journal 2026-01-01 app/note/personal", items: ["A note"] },
  ]);
});

test("status accepts a missing sync date and real timestamps", async () => {
  for (const last_sync of [null, "2026-01-01T10:20:30Z", "2026-01-01T19:20:30+09:00"]) {
    const client = new HubClient(credentials, fetchWith(() => json({ last_sync, pending_notes: 3 })));
    assert.deepEqual(await client.status(), { last_sync, pending_notes: 3 });
  }
});

for (const status of [401, 403, 404, 405, 500, 503]) {
  test(`HTTP ${status} returns a clear safe error without echoing the body`, async () => {
    const client = new HubClient(credentials, fetchWith(() => new Response(credentials.token, { status })));
    await assert.rejects(client.context(), (error: unknown) => {
      assert.ok(error instanceof HubError);
      assert.equal(error.status, status);
      assert.ok(!error.message.includes(credentials.token));
      assert.match(error.message, status === 401 || status === 403 ? /Token rejected/ : status === 404 || status === 405 ? /base URL/ : /hub returned an error/);
      return true;
    });
  });
}

test("network failure never leaks a credential-bearing exception", async () => {
  const client = new HubClient(credentials, fetchWith(() => { throw new Error(`Failed ${credentials.token}`); }));
  await assert.rejects(client.context(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Could not reach the hub/);
    assert.ok(!error.message.includes(credentials.token));
    return true;
  });
});

test("wrong URLs returning HTML or unexpected content types are rejected", async () => {
  for (const response of [new Response("<!doctype html><html>Login</html>"), new Response("# Looks like context", { headers: { "Content-Type": "text/html" } }), markdown("<html>Login</html>")]) {
    await assert.rejects(new HubClient(credentials, fetchWith(() => response)).context(), /did not return a Metaharness response/);
  }
});

test("invalid JSON, MCP errors and invalid statuses are rejected safely", async () => {
  await assert.rejects(new HubClient(credentials, fetchWith(() => new Response("invalid", { headers: { "Content-Type": "application/json" } }))).status(), /Metaharness response/);
  for (const body of [{}, { last_sync: "yesterday", pending_notes: 0 }, { last_sync: null, pending_notes: -1 }, { last_sync: null, pending_notes: 1.2 }]) {
    await assert.rejects(new HubClient(credentials, fetchWith(() => json(body))).status(), /Metaharness response/);
  }
  await assert.rejects(new HubClient(credentials, fetchWith(() => json({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: credentials.token }] } }))).section("profile.md"), /could not read this section/);
  await assert.rejects(new HubClient(credentials, fetchWith(() => json({ result: null }))).remember("Text", "note"), /Metaharness response/);
  assert.throws(() => parseSearchResults("Some unrelated page"), /Metaharness response/);
});

test("redirected responses are not consumed as trusted hub content", async () => {
  const response = markdown("# A page on a different origin");
  Object.defineProperty(response, "redirected", { value: true });
  await assert.rejects(new HubClient(credentials, fetchWith(() => response)).context(), /Metaharness response/);
});

test("only the exact demo token enables fictional data, with no network calls", async () => {
  let calls = 0;
  const fetcher = fetchWith(() => { calls++; return markdown("# Real hub"); });
  const demo = new HubClient({ url: "", token: "demo" }, fetcher);
  assert.match(await demo.context(), /fictional person/);
  assert.match(await demo.section("profile.md"), /fictional sample person/);
  assert.ok((await demo.search("wood")).length);
  assert.deepEqual(await demo.status(), { last_sync: null, pending_notes: 0 });
  assert.match((await demo.remember("A new sample note", "note")).result, /Demo/);
  assert.deepEqual(await demo.status(), { last_sync: null, pending_notes: 1 });
  assert.match(await demo.context(), /A new sample note/);
  assert.equal((await demo.remember("a new SAMPLE note", "note")).result, "Already known.");
  assert.equal(calls, 0);
  await assert.rejects(new HubClient({ url: credentials.url, token: " demo " }, fetcher).context(), /without spaces/);
  await assert.rejects(new HubClient({ url: credentials.url, token: "" }, fetcher).context(), /Enter your hub token/);
  assert.equal(await new HubClient({ url: credentials.url, token: "Demo" }, fetcher).context(), "# Real hub");
  assert.equal(calls, 1);
});

test("invalid inputs do not send requests", async () => {
  const client = new HubClient(credentials, fetchWith(() => { assert.fail("No request should be sent"); }));
  await assert.rejects(client.remember("   ", "note"), /Write something/);
  // Runtime validation still protects JS consumers and corrupt persisted values.
  await assert.rejects(client.remember("Text", "unknown" as never), /valid memory kind/);
  await assert.rejects(client.section("../secret" as never), /four curated/);
  assert.deepEqual(KINDS, ["event", "feedback", "goal", "health", "life", "note", "person", "preference", "profile", "project", "reference", "school", "tip", "user"]);
});
