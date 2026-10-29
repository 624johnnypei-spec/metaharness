import { createHub, type MemoryFile, type Note, type Store } from "../shared/hub.ts";
import { InputError, readPending } from "../shared/security.ts";

type Result<T> = { success: boolean; results: T[]; meta: { changes: number }; error?: string };
interface Statement {
  bind(...values: (string | number)[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<Result<T>>;
  run<T>(): Promise<Result<T>>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch<T>(statements: Statement[]): Promise<Result<T>[]>;
}

export function d1Store(db: Database, options: { maxQueries?: number } = {}): Store {
  let queries = 0;
  const takeQuery = () => {
    if (queries >= (options.maxQueries ?? Infinity)) throw new InputError("request database budget exceeded; retry with a smaller MCP batch", 429);
    queries++;
  };
  const first = <T>(statement: Statement) => { takeQuery(); return statement.first<T>(); };
  const all = <T>(statement: Statement) => { takeQuery(); return statement.all<T>(); };
  const run = (statement: Statement) => { takeQuery(); return statement.run(); };
  const check = <T>(result: Result<T>) => {
    if (!result.success) throw new Error(result.error ?? "database request failed");
    return result;
  };
  const store: Store = {
    async tokenHash() {
      return (await first<{ value: string }>(db.prepare("select value from mh_config where key = 'token_sha256'")))?.value ?? "";
    },
    async file(name) {
      return (await first<{ content: string }>(db.prepare("select content from mh_files where name = ?1").bind(name)))?.content ?? "";
    },
    async lastSync() {
      return (await first<{ updated_at: string }>(db.prepare("select updated_at from mh_files where name = 'brief.md'")))?.updated_at ?? null;
    },
    async files(names) {
      if (!names.length) return [];
      const query = `select name, content from mh_files where name in (${names.map((_, i) => "?" + (i + 1)).join(",")})`;
      return check(await all<MemoryFile>(db.prepare(query).bind(...names))).results;
    },
    async pending() {
      return readPending(async offset => check(await all<Note>(db.prepare("select * from mh_notes where pulled = 0 order by ts, id limit 8 offset ?1")
        .bind(offset))).results);
    },
    async pendingCount() {
      return (await first<{ count: number }>(db.prepare("select count(*) as count from mh_notes where pulled = 0")))?.count ?? 0;
    },
    async insert(note) {
      const result = await run(db.prepare("insert into mh_notes (id, ts, source, kind, scope, text) select ?1, ?2, ?3, ?4, ?5, ?6 where (select count(*) from mh_notes where pulled = 0) < 1000 on conflict (id) do nothing")
        .bind(note.id, note.ts, note.source, note.kind, note.scope, note.text));
      const inserted = check(result).meta.changes > 0;
      if (!inserted && await store.pendingCount() >= 1000) throw new InputError("pending note queue is full; sync before saving more", 429);
      return inserted;
    },
    async sync(files, ack) {
      const now = new Date().toISOString();
      const statements = Object.entries(files).map(([name, content]) => db.prepare(
        "insert into mh_files (name, content, updated_at) values (?1, ?2, ?3) on conflict (name) do update set content = excluded.content, updated_at = excluded.updated_at")
        .bind(name, content, now));
      for (const id of ack) statements.push(db.prepare("update mh_notes set pulled = 1 where id = ?1").bind(id));
      if (statements.length) {
        takeQuery(); // D1 counts a batch as one invocation query.
        for (const result of await db.batch(statements)) check(result);
      }
      return store.pending();
    },
  };
  return store;
}

export default {
  fetch(request: Request, env: { DB: Database; MH_ALLOWED_ORIGINS?: string }): Promise<Response> {
    // Cloudflare supplies cf and overwrites CF-Connecting-IP at the edge. Do not
    // trust forwarded-address headers in ordinary/local Request objects.
    const clientAddress = "cf" in request ? request.headers.get("CF-Connecting-IP") ?? "unknown" : "unknown";
    return createHub(d1Store(env.DB, { maxQueries: 48 }), "", "", { allowedOrigins: env.MH_ALLOWED_ORIGINS })(request, clientAddress);
  },
};
