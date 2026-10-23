import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { createHub, type MemoryFile, type Note, type Store } from "../../../shared/hub.ts";

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
    async files(names) {
      const { data, error } = await db.from("mh_files").select("name,content").in("name", names);
      check(error);
      return (data ?? []) as MemoryFile[];
    },
    async pending() {
      const notes: Note[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db.from("mh_notes").select("*").eq("pulled", false)
          .order("ts").order("id").range(offset, offset + 999);
        check(error);
        notes.push(...(data ?? []) as Note[]);
        if (!data || data.length < 1000) return notes;
      }
    },
    async insert(note) {
      const { error } = await db.from("mh_notes").insert(note);
      if (error?.code === "23505") return false;
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
Deno.serve(createHub(supabaseStore(db), "/functions/v1/metaharness", "/metaharness"));
