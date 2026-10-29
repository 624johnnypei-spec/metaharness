-- Serialize insert admission across Edge Function isolates. Existing queues can
-- still be acknowledged/drained; only new pending notes are subject to the cap.
create or replace function public.mh_limit_pending() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if not new.pulled then
    perform pg_advisory_xact_lock(689234761);
    if (select count(*) from public.mh_notes where not pulled) >= 1000 then
      raise exception 'pending note queue is full';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.mh_limit_pending() from public, anon, authenticated;
drop trigger if exists mh_limit_pending on public.mh_notes;
create trigger mh_limit_pending before insert on public.mh_notes
for each row execute function public.mh_limit_pending();
