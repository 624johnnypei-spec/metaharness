create table if not exists mh_files (
  name text primary key,
  content text not null,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) strict;
create table if not exists mh_notes (
  id text primary key,
  ts text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source text not null,
  kind text not null default 'note',
  scope text not null default 'personal',
  text text not null check (length(trim(text)) > 0),
  pulled integer not null default 0 check (pulled in (0, 1))
) strict;
create index if not exists mh_notes_unpulled on mh_notes (ts) where pulled = 0;
create table if not exists mh_config (key text primary key, value text not null) strict;
