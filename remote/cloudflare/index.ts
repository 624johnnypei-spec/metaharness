import { createHub, type MemoryFile, type Note, type Store } from "../shared/hub.ts";

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

export function d1Store(db: Database): Store {
  const check = <T>(result: Result<T>) => {
    if (!result.success) throw new Error(result.error ?? "database request failed");
    return result;
  };
  const store: Store = {
    async tokenHash() {
      return (await db.prepare("select value from mh_config where key = 'token_sha256'")
        .first<{ value: string }>())?.value ?? "";
    },
    async file(name) {
      return (await db.prepare("select content from mh_files where name = ?1").bind(name)
        .first<{ content: string }>())?.content ?? "";
    },
    async lastSync() {
      return (await db.prepare("select updated_at from mh_files where name = 'brief.md'")
        .first<{ updated_at: string }>())?.updated_at ?? null;
    },
    async files(names) {
      if (!names.length) return [];
      const query = `select name, content from mh_files where name in (${names.map((_, i) => "?" + (i + 1)).join(",")})`;
      return check(await db.prepare(query).bind(...names).all<MemoryFile>()).results;
    },
    async pending() {
      return check(await db.prepare("select * from mh_notes where pulled = 0 order by ts, id").all<Note>()).results;
    },
    async insert(note) {
      const result = await db.prepare("insert into mh_notes (id, ts, source, kind, scope, text) values (?1, ?2, ?3, ?4, ?5, ?6) on conflict (id) do nothing")
        .bind(note.id, note.ts, note.source, note.kind, note.scope, note.text).run();
      return check(result).meta.changes > 0;
    },
    async sync(files, ack) {
      const now = new Date().toISOString();
      const statements = Object.entries(files).map(([name, content]) => db.prepare(
        "insert into mh_files (name, content, updated_at) values (?1, ?2, ?3) on conflict (name) do update set content = excluded.content, updated_at = excluded.updated_at")
        .bind(name, content, now));
      for (const id of ack) statements.push(db.prepare("update mh_notes set pulled = 1 where id = ?1").bind(id));
      if (statements.length) for (const result of await db.batch(statements)) check(result);
      return store.pending();
    },
  };
  return store;
}

export default {
  fetch(request: Request, env: { DB: Database }): Promise<Response> {
    return createHub(d1Store(env.DB))(request);
  },
};
