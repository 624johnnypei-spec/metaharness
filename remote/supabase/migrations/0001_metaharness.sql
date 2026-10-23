-- Only the edge function's service role can access these tables.
create table if not exists public.mh_files (
  name text primary key,
  content text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.mh_notes (
  id text primary key,
  ts timestamptz not null default now(),
  source text not null,
  kind text not null default 'note',
  scope text not null default 'personal',
  text text not null check (length(trim(text)) > 0),
  pulled boolean not null default false
);
create index if not exists mh_notes_unpulled on public.mh_notes (ts) where not pulled;
create table if not exists public.mh_config (key text primary key, value text not null);
alter table public.mh_files enable row level security;
alter table public.mh_notes enable row level security;
alter table public.mh_config enable row level security;
revoke all on public.mh_files, public.mh_notes, public.mh_config from anon, authenticated;
grant all on public.mh_files, public.mh_notes, public.mh_config to service_role;
