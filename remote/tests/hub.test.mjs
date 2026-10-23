// Node 22.18+: real SQLite for D1 SQL; simulated Supabase query transport. No cloud requests.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare/index.ts';

const token = 'test-token';
const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
const sql = new DatabaseSync(':memory:');
sql.exec(await readFile(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8'));
sql.prepare('insert into mh_config values (?, ?)').run('token_sha256', digest);
let failD1 = false;
class Statement {
  constructor(query, values = []) { this.query = query; this.values = values; }
  bind(...values) { return new Statement(this.query, values); }
  first() { return sql.prepare(this.query).get(...this.values) ?? null; }
  all() { return { success: true, results: sql.prepare(this.query).all(...this.values), meta: { changes: 0 } }; }
  run() {
    if (failD1 && this.query.startsWith('insert into mh_files')) throw new Error('write failed');
    return { success: true, results: [], meta: sql.prepare(this.query).run(...this.values) };
  }
}
const d1 = { prepare: query => new Statement(query), async batch(statements) {
  sql.exec('begin');
  try { const result = statements.map(s => s.run()); sql.exec('commit'); return result; }
  catch (e) { sql.exec('rollback'); throw e; }
} };

const tables = { mh_config: [{ key: 'token_sha256', value: digest }], mh_files: [], mh_notes: [] };
let failSupabase = false;
class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = 'select'; }
  select() { return this; }
  eq(k, v) { this.filters.push(r => r[k] === v); return this; }
  in(k, v) { this.filters.push(r => v.includes(r[k])); return this; }
  order() { return this; }
  range(start, end) { this.bounds = [start, end + 1]; return this; }
  insert(data) { this.op = 'insert'; this.data = data; return this; }
  upsert(data) { this.op = 'upsert'; this.data = data; return this; }
  update(data) { this.op = 'update'; this.data = data; return this; }
  maybeSingle() { this.single = true; return this; }
  then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject); }
  run() {
    if (failSupabase && this.op === 'upsert') return { data: null, error: { message: 'write failed' } };
    const rows = tables[this.table];
    if (this.op === 'insert') {
      if (rows.some(r => r.id === this.data.id)) return { error: { code: '23505', message: 'duplicate' } };
      rows.push({ pulled: false, ...this.data }); return { error: null };
    }
    if (this.op === 'upsert') {
      for (const row of this.data) { const ix = rows.findIndex(r => r.name === row.name); if (ix === -1) rows.push(row); else rows[ix] = row; }
      return { error: null };
    }
    let hits = rows.filter(r => this.filters.every(f => f(r)));
    if (this.op === 'update') { for (const row of hits) Object.assign(row, this.data); return { error: null }; }
    if (this.bounds) hits = hits.slice(...this.bounds);
    return { data: this.single ? hits[0] ?? null : hits, error: null };
  }
}
globalThis.__mhTestClient = { from: table => new Query(table) };
let supabaseHandler;
globalThis.Deno = { env: { get: key => key === 'SUPABASE_URL' ? 'https://example.invalid' : undefined }, serve: handler => { supabaseHandler = handler; } };
const temp = await mkdtemp(join(tmpdir(), 'mh-hub-'));
try {
  const entry = new URL('../supabase/functions/metaharness/index.ts', import.meta.url);
  const hub = new URL('../shared/hub.ts', import.meta.url);
  let source = await readFile(entry, 'utf8');
  source = source.replace(/^import .* from "npm:[^\n]+;/m, 'const createClient = () => globalThis.__mhTestClient; type SupabaseClient = any;');
  source = source.replace('../../../shared/hub.ts', hub.href);
  await writeFile(join(temp, 'supabase.ts'), source);
  await import(pathToFileURL(join(temp, 'supabase.ts')).href);

  for (const backend of ['cloudflare', 'supabase']) {
    const base = backend === 'cloudflare' ? 'https://example.invalid' : 'https://example.invalid/functions/v1/metaharness';
    const request = (path, options = {}) => {
      const req = new Request(base + path, options);
      return backend === 'cloudflare' ? worker.fetch(req, { DB: d1 }) : supabaseHandler(req);
    };
    const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const post = body => ({ method: 'POST', headers, body: JSON.stringify(body) });
    const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
    let r = await request('/openapi.json');
    const spec = await r.json();
    assert.equal(spec.servers[0].url, base);
    assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
    assert.deepEqual(Object.keys(spec.paths).sort(), ['/context', '/remember', '/search']);
    assert.equal((await request('/context')).status, 401);
    assert.equal((await request('/context', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    r = await request('/sync', post({ files: { 'config.json': '{"name":"Test"}', 'brief.md': '# Test\nLikes tea' }, ack: [] }));
    assert.deepEqual((await r.json()).notes, []);
    r = await request('/mcp/' + token, { method: 'POST', body: JSON.stringify(rpc('initialize')) });
    assert.match((await r.json()).result.instructions, /Test/);
    r = await request('/mcp', post(rpc('tools/list')));
    const tools = (await r.json()).result.tools;
    assert.deepEqual(tools.map(x => x.name), ['get_context', 'remember', 'search', 'read_section']);
    assert.match(tools[0].description, /Test/);
    r = await request('/mcp', post(rpc('tools/call', { name: 'get_context' })));
    assert.match((await r.json()).result.content[0].text, /Likes tea/);
    r = await request('/mcp', post(rpc('tools/call', { name: 'read_section', arguments: { name: '../../secret' } })));
    assert.equal((await r.json()).result.isError, true);
    assert.equal((await request('/mcp', { headers })).status, 405);
    assert.equal((await request('/mcp', post({ jsonrpc: '2.0', method: 'notifications/initialized' }))).status, 202);
    for (const path of ['/missing-one', '/missing-two']) assert.equal((await request(path, { headers })).status, 404);
    r = await request('/remember', post({ text: 'Prefers green tea', kind: 'preference', source: 'test' }));
    assert.match((await r.json()).result, /Saved/);
    r = await request('/remember', post({ text: 'Prefers green tea' }));
    assert.equal((await r.json()).result, 'Already known.');
    r = await request('/remember', post({ text: '日本語が好き' }));
    assert.equal(r.status, 200);
    assert.match(await (await request('/search?q=日本語', { headers })).text(), /日本語/);
    assert.equal((await request('/sync', post({ files: { 'invalid.txt': 'bad' }, ack: [] }))).status, 500);
    r = await request('/sync', post({ files: {}, ack: [] }));
    const pending = (await r.json()).notes;
    assert.equal(pending.length, 2);
    if (backend === 'cloudflare') failD1 = true; else failSupabase = true;
    r = await request('/sync', post({ files: { 'brief.md': 'failed' }, ack: [pending[0].id] }));
    assert.equal(r.status, 500);
    failD1 = failSupabase = false;
    r = await request('/sync', post({ files: {}, ack: [] }));
    assert.equal((await r.json()).notes.length, 2);
    r = await request('/sync', post({ files: {}, ack: [pending[0].id] }));
    assert.equal((await r.json()).notes.length, 1);
    if (backend === 'cloudflare') sql.prepare('update mh_config set value = ?').run('0'.repeat(64));
    else tables.mh_config[0].value = '0'.repeat(64);
    assert.equal((await request('/context', { headers })).status, 401);
    console.log(`PASS ${backend}: auth/rotation, MCP, schema, search, dedupe, file validation, sync failure recovery`);
  }
} finally {
  sql.close();
  await rm(temp, { recursive: true, force: true });
  delete globalThis.__mhTestClient;
  delete globalThis.Deno;
}
