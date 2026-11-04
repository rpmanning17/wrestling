-- Run separately as database administrator; never part of normal migration replay.
-- Aborts if any inserted alias has changed or disappeared since the migration.
begin;
set local lock_timeout = '5s';
lock table public.club_aliases in share row exclusive mode;
do $$ begin
  if exists (select 1 from private.club_normalization_20261104_inserted i left join public.club_aliases a using(alias_key)
    where to_jsonb(a) is distinct from to_jsonb(i)) then
    raise exception 'An inserted alias changed; rollback requires reconciliation';
  end if;
end $$;
delete from public.club_aliases a using private.club_normalization_20261104_inserted i
where a.alias_key=i.alias_key;
drop table private.club_normalization_20261104_inserted;
commit;
