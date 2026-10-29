// Optional real PostgreSQL engine regression; dependency is installed in a
// disposable test directory, never used by the product or deployed function.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.argv[2] || '@electric-sql/pglite');
const db = new PGlite();
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for (const name of ['0001_metaharness.sql', '0002_pending_limit.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from public.mh_notes'), /permission denied/);
    await assert.rejects(db.query('select * from public.mh_config'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await db.exec("insert into public.mh_notes (id,source,text) select lpad(to_hex(n),12,'0'),'test','Sample note' from generate_series(1,1000) n");
  await assert.rejects(db.query("insert into public.mh_notes (id,source,text) values ('ffffffffffff','test','Overflow')"), /queue is full/);
  assert.equal((await db.query('select count(*)::int as count from public.mh_notes')).rows[0].count, 1000);
  await db.exec("update public.mh_notes set pulled=true where id='000000000001'");
  await db.query('insert into public.mh_notes (id,source,text) values ($1,$2,$3)', ['ffffffffffff', 'test', "Sample '); DROP TABLE mh_notes;--"]);
  assert.equal((await db.query('select count(*)::int as count from public.mh_notes where not pulled')).rows[0].count, 1000);
  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/migrations/0002_pending_limit.sql', import.meta.url), 'utf8'));
  console.log('PASS PostgreSQL: migrations, RLS/grants, queue trigger, acknowledgment, parameters and repeatable upgrade');
} finally { await db.close(); }
