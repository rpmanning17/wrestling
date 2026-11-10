begin;
select pg_advisory_xact_lock(194260711,1);
lock table public.matches,public.source_identity_current_rows in share row exclusive mode;
create table private.club_person_source_counts(
 season text not null,team text not null,person_id uuid not null,
 bouts integer not null check(bouts>=0),wins integer not null check(wins>=0),losses integer not null check(losses>=0),
 alias_key text generated always as(regexp_replace(lower(trim(team)),'[^a-z0-9]+',' ','g')) stored,
 primary key(season,team,person_id),check(bouts=wins+losses));
alter table private.club_person_source_counts enable row level security;
revoke all on private.club_person_source_counts from public,anon,authenticated,service_role;
grant select on private.club_person_source_counts to anon;
create policy personal_app_club_counts on private.club_person_source_counts for select to anon
 using((select private.personal_app_request_is_valid()));
insert into private.club_person_source_counts(season,team,person_id,bouts,wins,losses)
 select p.club_season,p.team,p.person_id,count(*)::integer,count(*) filter(where side='winner')::integer,count(*) filter(where side='loser')::integer
 from private.match_cohort_appearances p where p.club_contested and p.person_id is not null and p.club_opponent_person_id is not null and p.person_id<>p.club_opponent_person_id and nullif(trim(p.team),'') is not null group by p.club_season,p.team,p.person_id;
create function private.sync_club_person_source_counts() returns trigger
language plpgsql security definer set search_path='' as $sync$
declare old_ok boolean:=false;new_ok boolean:=false;remaining integer;
begin
 if TG_OP<>'INSERT' then old_ok:=coalesce(OLD.club_contested and OLD.person_id is not null and OLD.club_opponent_person_id is not null and OLD.person_id<>OLD.club_opponent_person_id and nullif(trim(OLD.team),'') is not null,false);end if;
 if TG_OP<>'DELETE' then new_ok:=coalesce(NEW.club_contested and NEW.person_id is not null and NEW.club_opponent_person_id is not null and NEW.person_id<>NEW.club_opponent_person_id and nullif(trim(NEW.team),'') is not null,false);end if;
 if TG_OP='UPDATE' and (OLD.club_season,OLD.team,OLD.person_id,OLD.side,old_ok)
 is not distinct from (NEW.club_season,NEW.team,NEW.person_id,NEW.side,new_ok) then return null;end if;
 if old_ok then
 update private.club_person_source_counts set bouts=bouts-1,wins=wins-case OLD.side when 'winner' then 1 else 0 end,
 losses=losses-case OLD.side when 'loser' then 1 else 0 end
 where season=OLD.club_season and team=OLD.team and person_id=OLD.person_id returning bouts into remaining;
 if not found then raise exception 'Club source count missing during maintenance';end if;
 if remaining=0 then delete from private.club_person_source_counts where season=OLD.club_season and team=OLD.team and person_id=OLD.person_id;end if;
 end if;
 if new_ok then
 insert into private.club_person_source_counts(season,team,person_id,bouts,wins,losses)
 values(NEW.club_season,NEW.team,NEW.person_id,1,case NEW.side when 'winner' then 1 else 0 end,case NEW.side when 'loser' then 1 else 0 end)
 on conflict(season,team,person_id) do update set bouts=club_person_source_counts.bouts+1,
 wins=club_person_source_counts.wins+excluded.wins,losses=club_person_source_counts.losses+excluded.losses;
 end if;
 return null;
end $sync$;
revoke all on function private.sync_club_person_source_counts() from public,anon,authenticated,service_role;
create trigger sync_club_person_source_counts after insert or update or delete on private.match_cohort_appearances
 for each row execute function private.sync_club_person_source_counts();
create index match_club_alias_covering_idx on private.match_cohort_appearances(club_alias_key,club_contested)
 include(club_season,person_id,club_opponent_person_id,team,club_opponent_alias_key,side);

create function private.calculate_person_club_summaries(target_season text,target_clubs text[])
returns setof public.person_club_rankings_current language plpgsql stable security invoker set search_path='' as $fn$
begin return query execute $query$with active_ratings as materialized(select person_id,rating,conservative_score,rating_deviation from public.person_rating_current),
 participation as materialized (
 select p.club_season season,p.team,p.club_alias_key alias_key,p.club_opponent_alias_key opponent_alias_key,
 p.person_id,p.club_opponent_person_id opponent_id,case p.side when 'winner' then 1 else 0 end won
 from private.match_cohort_appearances p
 where p.club_contested and p.person_id is not null and p.club_opponent_person_id is not null and p.person_id<>p.club_opponent_person_id
 and ($1='ALL' or p.club_season=$1) and ($2 is null or p.club_alias_key=any(array(
 select a.alias_key from public.club_aliases a where a.club_key=any($2)
 union select substring(k from 5) from unnest($2) k where k like 'raw:%'
 )))
 ), alias_keys as materialized (
 select alias_key from participation union select opponent_alias_key from participation
 ), club_keys as materialized (
 select k.alias_key,coalesce(a.club_key,'raw:'||k.alias_key) club_key,a.canonical_name
 from alias_keys k left join public.club_aliases a on a.alias_key=k.alias_key
 ), resolved as (
 select p.season,p.person_id,p.opponent_id,p.won,k.club_key,
 coalesce(k.canonical_name,trim(p.team)) club_name,o.club_key opponent_club_key
 from participation p left join club_keys k on k.alias_key=p.alias_key
 left join club_keys o on o.alias_key=p.opponent_alias_key
 where nullif(trim(p.team),'') is not null
 ), scoped AS (select case when $1='ALL' then 'ALL' else resolved.season end season,resolved.club_key,resolved.club_name,resolved.opponent_club_key,resolved.person_id,resolved.opponent_id,resolved.won
 from resolved where ($1='ALL' or resolved.season=$1) and ($2 is null or resolved.club_key=any($2))
 ), roster AS (
         SELECT DISTINCT scoped.season,
            scoped.club_key,
            scoped.person_id
           FROM scoped
        ), rated_roster AS (
         SELECT r_1.season,
            r_1.club_key,
            r_1.person_id,
            p.conservative_score,
            p.rating_deviation,
            row_number() OVER (PARTITION BY r_1.season, r_1.club_key ORDER BY p.conservative_score DESC NULLS LAST) AS power_rank
           FROM roster r_1
             LEFT JOIN active_ratings p ON p.person_id = r_1.person_id
        ), roster_summary AS (
         SELECT rated_roster.season,
            rated_roster.club_key,
            count(*)::integer AS wrestlers,
            count(rated_roster.conservative_score)::integer AS rated_wrestlers,
            round(avg(rated_roster.conservative_score), 1) AS avg_conservative,
            round(percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (rated_roster.conservative_score::double precision))::numeric, 1) AS median_conservative,
            round(avg(rated_roster.conservative_score) FILTER (WHERE rated_roster.power_rank <= 5), 1) AS top_five_conservative,
            round(avg(rated_roster.rating_deviation), 1) AS avg_rating_deviation
           FROM rated_roster
          GROUP BY rated_roster.season, rated_roster.club_key
        ), rated AS (
         SELECT s.season,
            s.club_key,
            s.club_name,
            s.opponent_club_key,
            s.person_id,
            s.opponent_id,
            s.won,
            opponent.rating AS opponent_rating
           FROM scoped s
             LEFT JOIN active_ratings opponent ON opponent.person_id = s.opponent_id
        ), bouts AS (
         SELECT rated.season,
            rated.club_key,
            max(rated.club_name) AS club_name,
            count(*)::integer AS bouts,
            count(*) FILTER (WHERE rated.won = 1)::integer AS wins,
            count(*) FILTER (WHERE rated.won = 0)::integer AS losses,
            count(*) FILTER (WHERE rated.club_key = rated.opponent_club_key)::integer AS in_house_bouts,
            round(avg(rated.opponent_rating), 1) AS avg_opponent_rating,
            avg(1.0::double precision / (1.0::double precision + power(10.0::double precision, (rated.opponent_rating::double precision - 1500.0::double precision) / 400.0::double precision)))::numeric AS schedule_expected_win_pct
           FROM rated
          GROUP BY rated.season, rated.club_key
        )
 SELECT b.season,
    b.club_key,
    b.club_name,
    b.bouts,
    b.wins,
    b.losses,
    r.wrestlers,
    r.rated_wrestlers,
    r.avg_conservative,
    r.median_conservative,
    r.top_five_conservative,
    r.avg_rating_deviation,
    b.avg_opponent_rating,
    b.in_house_bouts,
    b.schedule_expected_win_pct
   FROM bouts b
     JOIN roster_summary r ON r.season = b.season AND r.club_key = b.club_key;
 $query$ using target_season,target_clubs;end $fn$;
revoke all on function private.calculate_person_club_summaries(text,text[]) from public,anon,authenticated,service_role;
grant execute on function private.calculate_person_club_summaries(text,text[]) to anon;
create or replace function public.person_club_rankings_for_season(target_season text,target_club text default null)
returns setof public.person_club_rankings_current language plpgsql stable security invoker set search_path='' as $fn$
begin return query execute 'select * from private.calculate_person_club_summaries($1,$2)'
 using target_season,case when target_club is null then null else array[target_club] end;end $fn$;
create function public.person_club_rankings_for_keys(target_season text,target_keys text[])
returns setof public.person_club_rankings_current language plpgsql stable security invoker set search_path='' as $fn$
begin return query execute 'select * from private.calculate_person_club_summaries($1,coalesce($2,array[]::text[]))' using target_season,target_keys;end $fn$;
revoke all on function public.person_club_rankings_for_keys(text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.person_club_rankings_for_keys(text,text[]) to anon;
create function public.person_club_directory(target_season text,target_sort text)
returns table(club_key text,club_name text,bouts integer,wrestlers integer,sort_value numeric)
language plpgsql stable security invoker set search_path='' as $fn$
begin
 if target_sort in('wrestlers','bouts') then return query execute $basic$with aliases as materialized(select alias_key,club_key,canonical_name from public.club_aliases),
 mapped_counts as materialized (
 select coalesce(a.club_key,'raw:'||s.alias_key) club_key,coalesce(a.canonical_name,trim(s.team)) club_name,s.person_id,s.bouts
 from private.club_person_source_counts s left join aliases a on a.alias_key=s.alias_key
 where $1='ALL' or s.season=$1
 ), base as materialized (
 select club_key,max(club_name) club_name,sum(bouts)::integer bouts,count(distinct person_id)::integer wrestlers
 from mapped_counts group by club_key
 ) select club_key,club_name,bouts,wrestlers,
 case $2 when 'wrestlers' then wrestlers else bouts end::numeric sort_value from base$basic$ using target_season,target_sort;
 elsif target_sort in('avg_conservative','median_conservative','top_five_conservative') then return query execute $rated$with aliases as materialized(select alias_key,club_key,canonical_name from public.club_aliases),
 mapped_counts as materialized (
 select coalesce(a.club_key,'raw:'||s.alias_key) club_key,coalesce(a.canonical_name,trim(s.team)) club_name,s.person_id,s.bouts
 from private.club_person_source_counts s left join aliases a on a.alias_key=s.alias_key
 where $1='ALL' or s.season=$1
 ), base as materialized (
 select club_key,max(club_name) club_name,sum(bouts)::integer bouts,count(distinct person_id)::integer wrestlers
 from mapped_counts group by club_key
 ) , active_ratings as materialized(select person_id,conservative_score from public.person_rating_current),
 roster as (select distinct club_key,person_id from mapped_counts),
 ranked as(select r.club_key,p.conservative_score,row_number()over(partition by r.club_key order by p.conservative_score desc nulls last) power_rank
 from roster r left join active_ratings p on p.person_id=r.person_id),
 summaries as(select club_key,case $2
 when 'avg_conservative' then round(avg(conservative_score),1)
 when 'median_conservative' then round(percentile_cont(0.5::double precision) within group(order by conservative_score::double precision)::numeric,1)
 when 'top_five_conservative' then round(avg(conservative_score) filter(where power_rank<=5),1) end sort_value
 from ranked group by club_key)
 select b.club_key,b.club_name,b.bouts,b.wrestlers,s.sort_value from base b join summaries s using(club_key)$rated$ using target_season,target_sort;
 elsif target_sort='avg_opponent_rating' then return query execute $opponents$with aliases as materialized(select alias_key,club_key,canonical_name from public.club_aliases),
 mapped_counts as materialized (
 select coalesce(a.club_key,'raw:'||s.alias_key) club_key,coalesce(a.canonical_name,trim(s.team)) club_name,s.person_id,s.bouts
 from private.club_person_source_counts s left join aliases a on a.alias_key=s.alias_key
 where $1='ALL' or s.season=$1
 ), base as materialized (
 select club_key,max(club_name) club_name,sum(bouts)::integer bouts,count(distinct person_id)::integer wrestlers
 from mapped_counts group by club_key
 ) , active_ratings as materialized(select person_id,rating from public.person_rating_current),
 opponent_summary as(
 select coalesce(a.club_key,'raw:'||p.club_alias_key) club_key,round(avg(r.rating),1) sort_value
 from private.match_cohort_appearances p left join aliases a on a.alias_key=p.club_alias_key
 left join active_ratings r on r.person_id=p.club_opponent_person_id
 where p.club_contested and p.person_id is not null and p.club_opponent_person_id is not null and p.person_id<>p.club_opponent_person_id
 and nullif(trim(p.team),'') is not null and($1='ALL' or p.club_season=$1)
 group by coalesce(a.club_key,'raw:'||p.club_alias_key))
 select b.club_key,b.club_name,b.bouts,b.wrestlers,o.sort_value from base b left join opponent_summary o using(club_key)$opponents$ using target_season,target_sort;
 else raise exception 'Unsupported club directory sort';end if;
end $fn$;
revoke all on function public.person_club_directory(text,text) from public,anon,authenticated,service_role;
grant execute on function public.person_club_directory(text,text) to anon;
create or replace function public.person_club_roster_for_season(target_season text,target_club text default null)
returns setof public.person_club_roster_current language plpgsql stable security invoker set search_path='' as $fn$
begin return query execute $query$
with aliases as materialized(select * from public.club_aliases),
 active_ratings as materialized(select person_id,rating,rating_deviation,conservative_score,sos_expected_win_pct,avg_opponent_rating,rating_status from public.person_rating_current),
 scoped as (
 select case when $1='ALL' then 'ALL' else s.season end season,coalesce(a.club_key,'raw:'||s.alias_key) club_key,
 coalesce(a.canonical_name,trim(s.team)) club_name,s.person_id,s.bouts,s.wins,s.losses
 from private.club_person_source_counts s left join aliases a on a.alias_key=s.alias_key
 where ($1='ALL' or s.season=$1) and ($2 is null or coalesce(a.club_key,'raw:'||s.alias_key)=$2)
 )
select s.season,s.club_key,max(s.club_name) club_name,s.person_id::text athlete_key,p.display_name athlete_name,
 sum(s.bouts)::integer bouts,sum(s.wins)::integer wins,sum(s.losses)::integer losses,
 r.rating,r.rating_deviation,r.conservative_score,r.sos_expected_win_pct,r.avg_opponent_rating,r.rating_status
from scoped s join public.wrestler_people p on p.id=s.person_id left join active_ratings r on r.person_id=s.person_id
group by s.season,s.club_key,s.person_id,p.display_name,r.rating,r.rating_deviation,r.conservative_score,r.sos_expected_win_pct,r.avg_opponent_rating,r.rating_status;
$query$ using target_season,target_club;end $fn$;
do $verify$ begin
 if exists((select season,team,person_id,bouts,wins,losses from private.club_person_source_counts
 except select p.club_season,p.team,p.person_id,count(*)::integer,count(*) filter(where side='winner')::integer,count(*) filter(where side='loser')::integer
 from private.match_cohort_appearances p where p.club_contested and p.person_id is not null and p.club_opponent_person_id is not null and p.person_id<>p.club_opponent_person_id and nullif(trim(p.team),'') is not null group by p.club_season,p.team,p.person_id)
 union all(select p.club_season,p.team,p.person_id,count(*)::integer,count(*) filter(where side='winner')::integer,count(*) filter(where side='loser')::integer
 from private.match_cohort_appearances p where p.club_contested and p.person_id is not null and p.club_opponent_person_id is not null and p.person_id<>p.club_opponent_person_id and nullif(trim(p.team),'') is not null group by p.club_season,p.team,p.person_id
 except select season,team,person_id,bouts,wins,losses from private.club_person_source_counts)) then raise exception 'Club source counts differ';end if;
end $verify$;
analyze private.club_person_source_counts;
analyze private.match_cohort_appearances;
notify pgrst,'reload schema';
commit;

