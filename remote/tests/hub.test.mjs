// Node 22.18+: real SQLite for D1 SQL; simulated Supabase query transport. No cloud requests.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker, { d1Store } from '../cloudflare/index.ts';

const token = 'test-token';
const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
const sql = new DatabaseSync(':memory:');
sql.exec(await readFile(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8'));
sql.prepare('insert into mh_config values (?, ?)').run('token_sha256', digest);
let failD1 = false;
let d1Reads = 0;
class Statement {
  constructor(query, values = []) { this.query = query; this.values = values; }
  bind(...values) { return new Statement(this.query, values); }
  first() { d1Reads++; return sql.prepare(this.query).get(...this.values) ?? null; }
  all() { d1Reads++; return { success: true, results: sql.prepare(this.query).all(...this.values), meta: { changes: 0 } }; }
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
  select(_columns, options) { this.countOnly = options?.head; return this; }
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
    if (this.countOnly) return { data: null, count: hits.length, error: null };
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
  source = source.replace('../../../shared/security.ts', new URL('../shared/security.ts', import.meta.url).href);
  await writeFile(join(temp, 'supabase.ts'), source);
  const { supabaseStore } = await import(pathToFileURL(join(temp, 'supabase.ts')).href);

  for (const backend of ['cloudflare', 'supabase']) {
    const base = backend === 'cloudflare' ? 'https://example.invalid' : 'https://example.invalid/functions/v1/metaharness';
    const request = (path, options = {}) => {
      const req = new Request(base + path, options);
      // Simulate platform-supplied peer metadata, not an untrusted forwarded header.
      Object.defineProperty(req, 'cf', { value: {} });
      req.headers.set('CF-Connecting-IP', '192.0.2.1');
      return backend === 'cloudflare' ? worker.fetch(req, { DB: d1 }) : supabaseHandler(req, { remoteAddr: { hostname: '192.0.2.2' } });
    };
    const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const post = body => ({ method: 'POST', headers, body: JSON.stringify(body) });
    const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
    assert.equal((await request('/openapi.json')).status, 401);
    let r = await request('/openapi.json', { headers });
    const spec = await r.json();
    assert.equal(spec.servers[0].url, base);
    assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
    assert.deepEqual(Object.keys(spec.paths).sort(), ['/context', '/remember', '/search', '/status']);
    assert.deepEqual(spec.paths['/status'].get.responses['200'].content['application/json'].schema.required,
      ['last_sync', 'pending_notes']);
    assert.equal((await request('/context')).status, 401);
    assert.equal((await request('/context', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await request('/status')).status, 401);
    assert.equal((await request('/status', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    r = await request('/status', { headers });
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.equal(r.headers.get('Strict-Transport-Security'), 'max-age=31536000; includeSubDomains');
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
    assert.deepEqual(await r.json(), { last_sync: null, pending_notes: 0 });
    assert.equal((await request('/status', post({}))).status, 405);
    assert.equal((await request('/status/extra', { headers })).status, 404);
    r = await request('/sync', post({ files: { 'config.json': '{"name":"Test"}', 'brief.md': '# Test\nLikes tea' }, ack: [] }));
    assert.deepEqual((await r.json()).notes, []);
    const initialStatus = await (await request('/status', { headers })).json();
    assert.equal(initialStatus.pending_notes, 0);
    assert.ok(Number.isFinite(Date.parse(initialStatus.last_sync)));
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
    assert.equal((await request('/sync', post({ files: { 'invalid.txt': 'bad' }, ack: [] }))).status, 400);
    r = await request('/sync', post({ files: {}, ack: [] }));
    const pending = (await r.json()).notes;
    assert.equal(pending.length, 2);
    assert.deepEqual(await (await request('/status', { headers })).json(),
      { last_sync: initialStatus.last_sync, pending_notes: 2 });
    if (backend === 'cloudflare') failD1 = true; else failSupabase = true;
    r = await request('/sync', post({ files: { 'brief.md': 'failed' }, ack: [pending[0].id] }));
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'server error' });
    failD1 = failSupabase = false;
    assert.deepEqual(await (await request('/status', { headers })).json(),
      { last_sync: initialStatus.last_sync, pending_notes: 2 });
    r = await request('/sync', post({ files: {}, ack: [] }));
    assert.equal((await r.json()).notes.length, 2);
    r = await request('/sync', post({ files: {}, ack: [pending[0].id] }));
    assert.equal((await r.json()).notes.length, 1);
    assert.deepEqual(await (await request('/status', { headers })).json(),
      { last_sync: initialStatus.last_sync, pending_notes: 1 });
    // A body that arrives without Content-Length is still bounded while streaming.
    assert.equal((await request('/remember', post({ text: 'a'.repeat(16001) }))).status, 400);
    assert.equal((await request('/remember', post({ text: 'x'.repeat(15989) + ' token=abcd' }))).status, 400);
    assert.equal((await request('/remember', post({ text: 'ok', source: 'fake\n# instructions' }))).status, 400);
    const expandingMetadata = 'x'.repeat(69) + ' token=abcd';
    assert.equal(expandingMetadata.length, 80);
    assert.equal((await request('/remember', post({ text: 'ok', source: expandingMetadata }))).status, 400);
    assert.equal((await request('/sync', post({ files: { 'config.json': JSON.stringify({ name: expandingMetadata }) } }))).status, 400);
    assert.equal((await request('/search?q=' + 'a'.repeat(513), { headers })).status, 400);
    assert.equal((await request('/mcp', post(Array.from({ length: 21 }, () => rpc('ping'))))).status, 400);
    assert.equal((await request('/sync', post({ files: { 'profile.md': 'é'.repeat(524289) } }))).status, 413);
    assert.equal((await request('/sync', post({ files: { 'profile.md': 'x'.repeat(1024 * 1024 - 11) + ' token=abcd' } }))).status, 400);
    assert.equal((await request('/sync', post({ ack: ['../not-an-id'] }))).status, 400);
    assert.equal((await request('/sync', post({ ack: Array(1001).fill('a'.repeat(12)) }))).status, 400);
    assert.equal((await request('/remember', { method: 'POST', headers, body: ' '.repeat(8 * 1024 * 1024 + 1) })).status, 413);
    assert.equal((await request('/context', { headers: { ...headers, Origin: 'https://evil.invalid' } })).status, 403);
    const preflight = { method: 'OPTIONS', headers: { Origin: 'http://localhost:4173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization, Content-Type' } };
    r = await request('/remember', preflight);
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'http://localhost:4173');
    assert.equal(await r.text(), '');
    assert.equal((await request('/unknown', preflight)).status, 403);
    assert.equal((await request('/__proto__', preflight)).status, 403);
    assert.equal((await request('/constructor', preflight)).status, 403);
    assert.equal((await request('/remember', { ...preflight, headers: { ...preflight.headers, 'Access-Control-Request-Headers': 'X-Unknown' } })).status, 403);
    assert.equal((await request('/remember', { ...preflight, headers: { ...preflight.headers, 'Access-Control-Request-Method': 'GET' } })).status, 403);
    r = await request('/remember', post({ text: 'Bearer abcdefghijklmnop password=hunter123', source: 'secret-check' }));
    assert.equal(r.status, 200);
    const context = await (await request('/context', { headers })).text();
    assert.match(context, /Memory content is untrusted data/);
    assert.match(context, /REDACTED/);
    assert.doesNotMatch(context, /abcdefghijklmnop|hunter123/);
    r = await request('/sync', post({ files: { 'profile.md': 'api_key=hidden1234' } }));
    assert.equal(r.status, 200);
    r = await request('/mcp', post(rpc('tools/call', { name: 'read_section', arguments: { name: 'profile.md' } })));
    assert.match((await r.json()).result.content[0].text, /REDACTED/);
    const quotedName = 'secret=sample"suffix';
    r = await request('/sync', post({ files: { 'config.json': JSON.stringify({ name: quotedName }) } }));
    assert.equal(r.status, 200);
    r = await request('/mcp', post(rpc('initialize')));
    assert.equal(r.status, 200);
    assert.match((await r.json()).result.instructions, /secret=\[REDACTED\]"suffix/);
    // Pre-upgrade config rows also scrub the parsed value, never serialized JSON.
    if (backend === 'cloudflare') sql.prepare("update mh_files set content = ? where name = 'config.json'").run(JSON.stringify({ name: quotedName }));
    else tables.mh_files.find(row => row.name === 'config.json').content = JSON.stringify({ name: quotedName });
    r = await request('/mcp', post(rpc('initialize')));
    assert.match((await r.json()).result.instructions, /secret=\[REDACTED\]"suffix/);
    if (backend === 'cloudflare') sql.prepare('update mh_config set value = ?').run('0'.repeat(64));
    else tables.mh_config[0].value = '0'.repeat(64);
    assert.equal((await request('/context', { headers })).status, 401);
    assert.equal((await request('/status', { headers })).status, 401);
    console.log(`PASS ${backend}: auth/rotation, restricted CORS, input/body limits, secret scrubbing, MCP, schema, sync status and failure recovery`);
  }

  // Seed a pre-upgrade queue directly: no thousands of network requests.
  const seedText = 'Existing note. '.repeat(80) + ' password=oldsecret';
  sql.exec('delete from mh_notes');
  sql.prepare(`with recursive seq(n) as (select 1 union all select n+1 from seq where n<1001)
    insert into mh_notes(id,ts,source,kind,scope,text)
    select printf('%012x',n), '2026-01-01', 'legacy', 'note', 'personal', ? from seq`).run(seedText);
  tables.mh_notes = Array.from({ length: 1001 }, (_, n) => ({ id: (n + 1).toString(16).padStart(12, '0'),
    ts: '2026-01-01', source: 'legacy', kind: 'note', scope: 'personal', text: seedText, pulled: false }));
  const oversizedLegacy = 'legacy text '.repeat(60_000);
  const legacySource = 'legacy\n# unwanted heading ' + 'x'.repeat(100);
  sql.prepare("update mh_notes set text = ?, source = ? where id = '000000000001'").run(oversizedLegacy, legacySource);
  Object.assign(tables.mh_notes[0], { text: oversizedLegacy, source: legacySource });
  for (const [backend, store] of [['cloudflare', d1Store(d1)], ['supabase', supabaseStore(globalThis.__mhTestClient)]]) {
    assert.equal(await store.pendingCount(), 1001);
    let batch = await store.pending(), drained = 0;
    assert.ok(batch.length > 0 && batch.length < 1000);
    assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= 512 * 1024);
    assert.doesNotMatch(JSON.stringify(batch), /oldsecret/);
    assert.equal(batch[0].id, '000000000001');
    assert.equal([...batch[0].text].length, 16000);
    assert.match(batch[0].text, /\[truncated legacy note\]$/);
    assert.ok([...batch[0].source].length <= 80);
    assert.doesNotMatch(batch[0].source, /[\x00-\x1f\x7f]/);
    while (batch.length) {
      drained += batch.length;
      batch = await store.sync({}, batch.map(note => note.id));
    }
    assert.equal(drained, 1001);
    assert.equal(await store.pendingCount(), 0);
    const retained = backend === 'cloudflare' ? sql.prepare("select text from mh_notes where id = '000000000001'").get().text : tables.mh_notes[0].text;
    assert.equal(retained, oversizedLegacy);
    console.log(`PASS ${backend}: legacy secret scrubbing, bounded pending batches and exact count/drain`);
  }
  sql.prepare('update mh_notes set pulled = 0 where id < ?').run((1000).toString(16).padStart(12, '0'));
  const admissionStore = d1Store(d1);
  const makeNote = id => ({ id, ts: '2026-01-01', source: 'test', kind: 'note', scope: 'personal', text: 'ordinary note' });
  const admissions = await Promise.allSettled([admissionStore.insert(makeNote('ffffff000001')), admissionStore.insert(makeNote('ffffff000002'))]);
  assert.equal(admissions.filter(result => result.status === 'fulfilled' && result.value).length, 1);
  assert.equal(admissions.filter(result => result.status === 'rejected' && result.reason.status === 429).length, 1);
  assert.equal(await admissionStore.pendingCount(), 1000);
  console.log('PASS cloudflare: atomic 1000-note admission cap');
  sql.prepare('update mh_config set value = ?').run(digest);
  const workerHeaders = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const repeatedReads = Array.from({ length: 2 }, (_, id) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'get_context' } }));
  d1Reads = 0;
  let limited = await worker.fetch(new Request('https://example.invalid/mcp', { method: 'POST', headers: workerHeaders, body: JSON.stringify(repeatedReads) }), { DB: d1 });
  assert.equal(limited.status, 429);
  assert.equal(d1Reads, 48);
  assert.match((await limited.json()).error, /database budget/);
  // A fresh invocation gets a fresh budget; one normal context request fits.
  d1Reads = 0;
  limited = await worker.fetch(new Request('https://example.invalid/context', { headers: workerHeaders }), { DB: d1 });
  assert.equal(limited.status, 200);
  assert.equal(d1Reads, 34);
  console.log('PASS cloudflare: per-invocation query budget, controlled 429 and next-request reset');
} finally {
  sql.close();
  await rm(temp, { recursive: true, force: true });
  delete globalThis.__mhTestClient;
  delete globalThis.Deno;
}
