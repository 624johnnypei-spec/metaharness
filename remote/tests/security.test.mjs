import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHub } from '../shared/hub.ts';
import { allowedOrigin, boundedNotes, MAX_PENDING_BYTES, RateLimiter, readPending, scrubNote, scrubSecrets } from '../shared/security.ts';

test('secret patterns match both human text and credential-bearing URLs', () => {
  const secrets = ['sk-proj-' + 'x'.repeat(24), 'ghp_' + 'a'.repeat(22),
    'eyJabcdefghijk.abcdefghijk.abcdefghijk', 'token="sensitivevalue"', 'Bearer abcdefghijklmnop',
    'https://host.invalid/mcp/' + 'a'.repeat(32), 'https://user:password@host.invalid',
    '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
    '-----BEGIN PRIVATE KEY-----\nsecret', '{"password":"sensitivevalue"}'];
  for (const value of secrets) assert.match(scrubSecrets(value), /REDACTED/);
  assert.equal(scrubSecrets('Likes green tea'), 'Likes green tea');
  const once = scrubSecrets('token="abcde"');
  assert.equal(scrubSecrets(once), once);
  const legacy = { id: '123456789abc', text: 'password=abcde', source: 'Bearer abcdefghijklmnop', kind: 'note', scope: 'personal' };
  const cleaned = scrubNote(legacy);
  assert.equal(cleaned.id, legacy.id);
  assert.doesNotMatch(JSON.stringify(cleaned), /abcde|abcdefghijklmnop/);
});

test('CORS accepts canonical loopback and explicitly configured HTTPS origins only', () => {
  for (const origin of ['http://localhost:4173', 'http://127.0.0.1:8123', 'http://[::1]:8123']) assert.equal(allowedOrigin(origin), origin);
  for (const origin of ['null', 'http://evil.invalid', 'http://localhost.evil.invalid', 'http://127.0.0.1:80', 'http://localhost/', 'https://trusted.invalid/path']) assert.equal(allowedOrigin(origin), null);
  assert.equal(allowedOrigin('https://trusted.invalid', 'https://trusted.invalid, https://second.invalid'), 'https://trusted.invalid');
  assert.equal(allowedOrigin('https://trusted.invalid'), null);
});

test('limiter separates valid callers from failed authentication and expires windows', () => {
  let now = 0;
  const limiter = new RateLimiter(() => now, 4);
  for (let n = 0; n < 20; n++) assert.equal(limiter.allow('peer', false), true);
  assert.equal(limiter.allow('peer', false), false);
  for (let n = 0; n < 120; n++) assert.equal(limiter.allow('peer', true), true);
  assert.equal(limiter.allow('peer', true), false);
  assert.equal(limiter.allow('other-peer', true), true);
  now = 60_000;
  assert.equal(limiter.allow('peer', false), true);
  for (let n = 0; n < 50; n++) limiter.allow('new-' + n, false);
  assert.ok(limiter.entries.size <= 4);
});

test('pending slices honor JSON byte size and preserve an ordered drainable prefix', () => {
  const notes = Array.from({ length: 1001 }, (_, n) => ({ id: n, text: '😀'.repeat(16000) }));
  const selected = boundedNotes(notes);
  assert.ok(selected.length > 0 && selected.length < notes.length);
  assert.ok(Buffer.byteLength(JSON.stringify(selected)) <= MAX_PENDING_BYTES);
  assert.deepEqual(selected, notes.slice(0, selected.length));
  assert.equal(boundedNotes(Array(1001).fill({ id: 1 })).length, 256);
});

test('pending reader stops fetching small pages as soon as its byte budget is reached', async () => {
  const offsets = [];
  const notes = await readPending(async offset => {
    offsets.push(offset);
    return Array.from({ length: 8 }, (_, n) => ({ id: offset + n, text: '😀'.repeat(16000), source: 'test', kind: 'note', scope: 'personal' }));
  });
  assert.deepEqual(offsets, [0, 8]);
  assert.equal(notes.length, 8);
  assert.ok(Buffer.byteLength(JSON.stringify(notes)) <= MAX_PENDING_BYTES);
  let calls = 0;
  const small = await readPending(async offset => {
    calls++;
    return Array.from({ length: 8 }, (_, n) => ({ id: offset + n, text: 'note', source: 'test', kind: 'note', scope: 'personal' }));
  });
  assert.equal(small.length, 256);
  assert.equal(calls, 32);
});

test('handler rejects queue growth and returns actual count separately from bounded notes', async () => {
  const token = 'test-token';
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
  let count = 1001;
  const store = { tokenHash: async () => hash, file: async () => '', files: async () => [], lastSync: async () => null,
    pending: async () => [{ id: '123456789abc', text: 'note' }], pendingCount: async () => count,
    insert: async () => { throw new Error('must not insert'); }, sync: async () => [] };
  const handler = createHub(store, '', '', { limiter: new RateLimiter(), allowedOrigins: 'https://trusted.invalid' });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let response = await handler(new Request('https://hub.invalid/status', { headers }), 'peer');
  assert.deepEqual(await response.json(), { last_sync: null, pending_notes: 1001 });
  response = await handler(new Request('https://hub.invalid/remember', { method: 'POST', headers, body: JSON.stringify({ text: 'extra' }) }), 'peer');
  assert.equal(response.status, 429);
  response = await handler(new Request('https://hub.invalid/status', { headers: { ...headers, Origin: 'https://trusted.invalid' } }), 'peer');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://trusted.invalid');
  for (let n = 0; n < 21; n++) response = await handler(new Request('https://hub.invalid/context'), 'attacker');
  assert.equal(response.status, 429);
  response = await handler(new Request('https://hub.invalid/status', { headers }), 'attacker');
  assert.equal(response.status, 200);
  count = 0;
  response = await handler(new Request('https://hub.invalid/remember', { method: 'POST', headers, body: JSON.stringify({ text: '😀'.repeat(16000) }) }), 'peer');
  // The valid Unicode limit reaches the store; internal details stay hidden.
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'server error' });
});

test('ingress ceiling stops verifier reads without locking out another peer', async () => {
  let verifierReads = 0;
  const handler = createHub({ tokenHash: async () => { verifierReads++; return '0'.repeat(64); } }, '', '', { limiter: new RateLimiter() });
  const request = () => new Request('https://hub.invalid/context', { headers: { Authorization: 'Bearer invalid' } });
  for (let n = 0; n < 245; n++) assert.ok([401, 429].includes((await handler(request(), 'peer')).status));
  assert.equal(verifierReads, 240);
  assert.equal((await handler(request(), 'other-peer')).status, 401);
  assert.equal(verifierReads, 241);
});
