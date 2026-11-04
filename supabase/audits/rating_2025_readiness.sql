-- Mat Notes: 2025 backfill and expanded rating model read-only audit.
-- Date: 2026-11-04. Execute through an authorized administrator SQL read connection.
-- ZERO DDL / DML. Do not use this file to activate models or mutate raw matches.
-- Expected fingerprint values below came from the 67,736-row production snapshot
-- on 2026-11-04; investigate any differences before calculating or activating.
--
-- Reference raw MD5 (id/result/method):
--   6d0c35fc56e3f9acecc54bca603bc771
-- Reference context MD5 (id/date/event/weight/round/winner/loser):
--   055ef1cf665dc4a1d8cdee5cd76bcae6
-- Expanded calculated target: 64,050 rated bouts; 11,724 wrestlers;
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

-- 2) Exactly which calendar years the November 4 import contributed.
select created_at::date as import_date, extract(year from event_date)::int as bout_year,
       count(*) as rows
from public.matches
group by 1, 2
order by 1, 2;

-- 3) Idempotent raw-source provenance: no repeated file/row pairs.
select count(*) as raw_rows, count(distinct (source_file, source_row)) as unique_source_pairs,
       count(*) - count(distinct (source_file, source_row)) as repeated_source_pairs
from public.matches;

-- 4) Strict duplicate candidates are NOT a safe general rematch dedupe rule.
-- This query checks only same-directed, identical date/event/bracket/round/result/method.
-- Any matches with opposite winners must NOT be removed on a pair heuristic alone.
with signatures as (
  select event_date, lower(btrim(event_name)) as event_label,
         coalesce(weight_class, '') as bracket,
         coalesce(round, '') as round_label,
         lower(btrim(winner_name)) as winner, lower(btrim(loser_name)) as loser,
         coalesce(result, '') as score, upper(btrim(coalesce(win_type, ''))) as outcome,
         count(*) as n
  from public.matches
  group by 1, 2, 3, 4, 5, 6, 7, 8
  having count(*) > 1
)
select count(*) as duplicate_candidate_groups, coalesce(sum(n - 1), 0) as extra_rows
from signatures;

-- 5) For review only: unrecognized outcome codes. The only current code is OTHER1,
-- six rows. Four 2025 rows have numeric scores but that does not establish wrestled method.
select event_date, source_file, source_row, win_type, result, weight_class
from public.matches
where upper(btrim(coalesce(win_type, ''))) not in
  ('F', 'DEC', 'TF', 'MD', 'FOR', 'DEF', 'M FOR', 'DQ', 'MFFL', 'NC')
order by event_date, source_file, source_row;

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

-- 8) Data API still selects exactly one active model; candidate is never active early.
select status, count(*) from public.rating_models group by status order by status;
