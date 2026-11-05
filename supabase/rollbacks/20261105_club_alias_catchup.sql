-- Administrator-only rollback. Refuse to remove aliases changed after this migration.
begin;
set local lock_timeout = '5s';
lock table public.club_aliases in share row exclusive mode;
do $$
begin
  if (select count(*) from private.club_alias_catchup_20261105_inserted) <> 27 or
    exists (
      select 1 from private.club_alias_catchup_20261105_inserted i
      left join public.club_aliases a using (alias_key)
      where (a.alias_key, a.club_key, a.canonical_name, a.relationship, a.created_at)
        is distinct from
        (i.alias_key, i.club_key, i.canonical_name, i.relationship, i.created_at)
    ) then
    raise exception 'Club catch-up rollback requires reconciliation';
  end if;
end $$;
delete from public.club_aliases a
using private.club_alias_catchup_20261105_inserted i
where a.alias_key = i.alias_key;
drop table private.club_alias_catchup_20261105_inserted;
commit;
