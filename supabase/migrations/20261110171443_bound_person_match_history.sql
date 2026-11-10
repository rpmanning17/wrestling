begin;
-- Drive match history from the selected person assignments into the matches UUID
-- primary key. The original text-key equality remains an exactness guard.
create function public.person_match_history(person_ids uuid[],match_side text)
returns table(id uuid,event_date date,event_name text,city text,weight_class text,
 winner_name text,winner_team text,winner_person_id uuid,loser_name text,loser_team text,
 loser_person_id uuid,result text,win_type text)
language plpgsql stable security invoker set search_path='' as $function$
begin
 if match_side not in ('winner','loser') or match_side is null then raise exception 'Invalid match side'; end if;
 return query execute $history$
 with wanted as materialized (select distinct unnest($1::uuid[]) person_id),
 selected as materialized (
  select a.source_id,a.person_id from wanted
  join public.source_identity_current_rows a on a.person_id=wanted.person_id
  and a.source_kind=case $2 when 'winner' then 'match_winner' else 'match_loser' end
 )
 select m.id,m.event_date,m.event_name,m.city,m.weight_class,m.winner_name,m.winner_team,
 case $2 when 'winner' then a.person_id else other.person_id end,
 m.loser_name,m.loser_team,case $2 when 'loser' then a.person_id else other.person_id end,
 m.result,m.win_type
 from selected a cross join lateral (
  select m.* from public.matches m
  where m.id=case when a.source_id~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   then a.source_id::uuid end
  and m.id::text=a.source_id offset 0
 ) m left join lateral (
  select other.person_id from public.source_identity_current_rows other
  where other.source_kind=case $2 when 'winner' then 'match_loser' else 'match_winner' end
  and other.source_id=m.id::text offset 0
 ) other on true
 $history$ using person_ids,match_side;
end $function$;
revoke all on function public.person_match_history(uuid[],text) from public,authenticated,service_role;
grant execute on function public.person_match_history(uuid[],text) to anon;
notify pgrst,'reload schema';
commit;

