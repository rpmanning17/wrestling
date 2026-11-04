-- Read-only canonical recovery validation, 2026-11-04. No DDL/DML.
-- Active recovery a29c4460-5e56-4d22-902d-ea39c65bfcac; failed chat run is never activated.
-- 34,809 history points; as of 2026-11-04; last bout 2026-10-31.
-- Old active model UUID: d64fd4ba-de14-4d07-bac8-2961e12d506d.
-- Incomplete building UUID (NOT to activate): a957ed42-8ee2-4792-944d-5f63a0b4ce72.

-- 1) Count and provenance for the full source table.
select count(*) as raw_rows,
       min(event_date) as first_match_date,
       max(event_date) as last_match_date,
       count(*) filter (where extract(year from event_date) = 2025) as calendar_2025_rows,
       count(distinct source_file) as source_files,
       count(*) filter (where source_file is null or btrim(source_file) = '' or source_row is null) as missing_source_provenance,
       count(*) filter (where event_date is null or winner_name is null or loser_name is null
          or btrim(winner_name) = '' or btrim(loser_name) = '') as missing_essentials
from public.matches;

-- 6) Preservation hashes. Store results before any activation and repeat after.
select
  md5(string_agg(id::text || ':' || coalesce(result,'') || ':' || coalesce(win_type,''),
      E'\n' order by id)) as id_result_method_md5,
  md5(string_agg(
      id::text || ':' || coalesce(event_date::text,'') || ':' || coalesce(event_name,'') || ':' ||
      coalesce(weight_class,'') || ':' || coalesce(round,'') || ':' ||
      coalesce(winner_name,'') || ':' || coalesce(loser_name,''),
      E'\n' order by id)) as full_identity_context_md5
from public.matches;

-- 7) Model status and stored-row counts, without multiplying rating rows by history rows.
with r as (
  select model_id, count(*) as rating_rows,
         sum(wins) as total_wins, sum(losses) as total_losses,
         count(*) filter (where match_count <> wins + losses or wins < 0 or losses < 0) as invalid_records,
         count(*) filter (where rating_deviation is null or rating_deviation <= 0 or rating_deviation > 350
                or rating is null or volatility is null or volatility <= 0) as invalid_rating_states,
         count(*) filter (where conservative_score is null
                or abs(conservative_score - (rating - rating_deviation)) > 0.003) as inconsistent_conservative,
         count(*) filter (where avg_opponent_rating is null or sos_expected_win_pct is null
                or sos_expected_win_pct < 0 or sos_expected_win_pct > 1) as missing_or_invalid_sos
  from public.wrestler_model_ratings
  group by model_id
), h as (
  select model_id, count(*) as history_rows,
         count(distinct athlete_key) as history_athletes,
         count(*) filter (where rating is null or rating_deviation is null
                 or rating_deviation <= 0 or rating_deviation > 350) as invalid_history_states
  from public.wrestler_rating_history
  group by model_id
)
select m.id, m.status, m.model_version, m.as_of_date, m.match_cutoff,
       m.matches_total, m.matches_rated, m.wrestlers_rated, m.config_hash, m.input_fingerprint,
       coalesce(r.rating_rows,0) as stored_ratings,
       coalesce(h.history_rows,0) as stored_history,
       coalesce(h.history_athletes,0) as athletes_with_history,
       coalesce(r.total_wins,0) as total_wins, coalesce(r.total_losses,0) as total_losses,
       coalesce(r.invalid_records,0) as bad_records,
       coalesce(r.invalid_rating_states,0) as bad_rating_states,
       coalesce(r.inconsistent_conservative,0) as bad_conservative_scores,
       coalesce(r.missing_or_invalid_sos,0) as bad_sos,
       coalesce(h.invalid_history_states,0) as bad_history_states,
       coalesce(r.rating_rows,0)=m.wrestlers_rated as ratings_complete,
       coalesce(r.total_wins,0)=m.matches_rated and coalesce(r.total_losses,0)=m.matches_rated as record_balanced,
       coalesce(h.history_athletes,0)=m.wrestlers_rated as history_complete
from public.rating_models m
left join r on r.model_id=m.id
left join h on h.model_id=m.id
order by m.created_at desc;
with m as (select string_agg(concat_ws(chr(31),id::text,coalesce(event_date::text,''),coalesce(winner_name,''),coalesce(loser_name,''),coalesce(win_type,''),coalesce(result,''),coalesce(weight_class,'')),chr(10) order by concat_ws(chr(31),id::text,coalesce(event_date::text,''),coalesce(winner_name,''),coalesce(loser_name,''),coalesce(win_type,''),coalesce(result,''),coalesce(weight_class,'')) collate "C") as lines from public.matches), a as (select coalesce(string_agg(alias_key || '>' || canonical_key,chr(10) order by (alias_key || '>' || canonical_key) collate "C"),'') as lines from public.wrestler_aliases) select encode(sha256(convert_to(m.lines || chr(10) || '--aliases--' || chr(10) || a.lines,'UTF8')),'hex') from m cross join a;
with a as materialized (select alias_key,canonical_key from public.wrestler_aliases),
b as materialized (select coalesce(aw.canonical_key,lower(btrim(winner_name))) as w,coalesce(al.canonical_key,lower(btrim(loser_name))) as l from public.matches
left join a aw on aw.alias_key=lower(btrim(winner_name)) left join a al on al.alias_key=lower(btrim(loser_name))
where upper(btrim(win_type)) in ('F','DEC','MD','TF')),
contested as materialized (select * from b where w<>l),
r as materialized (select * from public.wrestler_model_ratings where model_id='a29c4460-5e56-4d22-902d-ea39c65bfcac'),
appearances as materialized (select w as athlete_key,l as opponent_key,true as won from contested union all select l,w,false from contested),
expected as (select p.athlete_key,count(*) as bouts,count(*) filter(where won) as wins,count(*) filter(where not won) as losses,avg(o.rating) as avg_opp,
avg(1.0::double precision/(1+power(10.0::double precision,(o.rating::double precision-1500)/400))) as expectation,
count(*) filter(where won and o.rating>=1737.8) as quality_wins,count(*) filter(where not won and o.rating>=1737.8) as quality_losses
from appearances p join r o on o.athlete_key=p.opponent_key group by p.athlete_key)
select (select count(*) from contested) as contested_bouts,count(*) as athletes_checked,
count(*) filter(where e.bouts is null or e.bouts<>r.match_count or e.wins<>r.wins or e.losses<>r.losses) as record_mismatches,
count(*) filter(where e.avg_opp is null or abs(e.avg_opp-r.avg_opponent_rating)>0.006) as opponent_average_mismatches,
count(*) filter(where e.expectation is null or abs(e.expectation-r.sos_expected_win_pct)>0.000006) as sos_mismatches,
count(*) filter(where e.quality_wins<>r.quality_wins or e.quality_losses<>r.quality_losses) as quality_record_mismatches
from r left join expected e using(athlete_key);;
select count(*) as raw_rows,md5(string_agg(to_jsonb(m)::text,chr(10) order by id)) as full_source_md5 from public.matches m;
select (select encode(sha256(convert_to(string_agg(to_jsonb(r)::text,chr(10) order by athlete_key collate "C"),'UTF8')),'hex') from public.wrestler_model_ratings r where model_id='a29c4460-5e56-4d22-902d-ea39c65bfcac') as ratings_sha256,
(select encode(sha256(convert_to(string_agg(to_jsonb(h)::text,chr(10) order by athlete_key collate "C",period_end),'UTF8')),'hex') from public.wrestler_rating_history h where model_id='a29c4460-5e56-4d22-902d-ea39c65bfcac') as history_sha256;
select status,count(*) from public.rating_models group by status;
