import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { createHub, type MemoryFile, type Note, type Store } from "../../../shared/hub.ts";
import { InputError, readPending } from "../../../shared/security.ts";

export function supabaseStore(db: SupabaseClient): Store {
  const check = (error: { message: string } | null) => { if (error) throw new Error(error.message); };
  const store: Store = {
    async tokenHash() {
      const { data, error } = await db.from("mh_config").select("value").eq("key", "token_sha256").maybeSingle();
      check(error);
      return data?.value ?? "";
    },
    async file(name) {
      const { data, error } = await db.from("mh_files").select("content").eq("name", name).maybeSingle();
      check(error);
      return data?.content ?? "";
    },
    async lastSync() {
      const { data, error } = await db.from("mh_files").select("updated_at").eq("name", "brief.md").maybeSingle();
      check(error);
      return data?.updated_at ?? null;
    },
    async files(names) {
      const { data, error } = await db.from("mh_files").select("name,content").in("name", names);
      check(error);
      return (data ?? []) as MemoryFile[];
    },
    async pending() {
      return readPending(async offset => {
        const { data, error } = await db.from("mh_notes").select("*").eq("pulled", false)
          .order("ts").order("id").range(offset, offset + 7);
        check(error);
        return (data ?? []) as Note[];
      });
    },
    async pendingCount() {
      const { count, error } = await db.from("mh_notes").select("*", { count: "exact", head: true }).eq("pulled", false);
      check(error);
      return count ?? 0;
    },
    async insert(note) {
      const { error } = await db.from("mh_notes").insert(note);
      if (error?.code === "23505") return false;
      if (error?.code === "P0001" && error.message === "pending note queue is full") throw new InputError("pending note queue is full; sync before saving more", 429);
      check(error);
      return true;
    },
    async sync(files, ack) {
      const rows = Object.entries(files).map(([name, content]) => ({ name, content, updated_at: new Date().toISOString() }));
      if (rows.length) {
        const { error } = await db.from("mh_files").upsert(rows);
        check(error);
      }
      if (ack.length) {
        const { error } = await db.from("mh_notes").update({ pulled: true }).in("id", ack);
        check(error);
      }
      return store.pending();
    },
  };
  return store;
}

const secrets = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const db = createClient(Deno.env.get("SUPABASE_URL")!,
  secrets.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } });
const handler = createHub(supabaseStore(db), "/functions/v1/metaharness", "/metaharness",
  { allowedOrigins: Deno.env.get("MH_ALLOWED_ORIGINS") });
Deno.serve((req, info) => handler(req, info.remoteAddr.hostname));
