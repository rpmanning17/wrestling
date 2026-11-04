begin;
-- Classification labels/votes are unchanged; expose tied support only for tier eligibility.
create or replace view public.wrestler_cohort_current with (security_invoker=true) as
with raw as (
  select athlete_name, team, event_date, event_name, age_group,
    bracket_weight_lbs, weigh_in_lbs, 4 as source_rank from public.tournament_entries
  union all
  select athlete_name, team, event_date, event_name, age_group,
    coalesce(bracket_weight_lbs, substring(bracket_weight_label from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric), null, 3
    from public.tournament_observations where identity_resolution in ('exact_existing','new_identity')
  union all
  select athlete_name, team, event_date, event_name, age_group, bracket_weight_lbs, null, 2
    from public.wrestler_evidence
  union all
  select p.name, p.team, m.event_date, m.event_name,
    (regexp_match(m.weight_class, '(?<![0-9])(6|8|10|12|14|16|18) ?[uU](?![a-zA-Z])'))[1] || 'U',
    substring(m.weight_class from '([0-9]+(?:[.][0-9]+)?)[^0-9]*$')::numeric, null, 1
    from public.matches m cross join lateral (values (m.winner_name,m.winner_team),(m.loser_name,m.loser_team)) p(name,team)
), canonical as (
  select coalesce(a.canonical_key,lower(trim(r.athlete_name))) athlete_key,
    coalesce(a.canonical_name,r.athlete_name) athlete_name, r.team,r.event_date,
    regexp_replace(lower(trim(r.event_name)), '\s+', ' ', 'g') event_name,
    r.age_group,r.bracket_weight_lbs,r.weigh_in_lbs,r.source_rank
  from raw r left join public.wrestler_aliases a on a.alias_key=lower(trim(r.athlete_name))
  where trim(r.event_name)<>''
), dates as (
  select distinct athlete_key,event_name,event_date from canonical
), breaks as (
  select *,case when event_date-lag(event_date) over (partition by athlete_key,event_name order by event_date)>7 then 1 else 0 end new_event from dates
), islands as (
  select *,sum(new_event) over (partition by athlete_key,event_name order by event_date) event_number from breaks
), event_dates as (
  select athlete_key,event_name,event_number,max(event_date) event_date from islands group by 1,2,3
), events as (
  select *,row_number() over (partition by athlete_key order by event_date desc,event_name desc) recency from event_dates
), recent as (
  select c.*,e.recency,e.event_date latest_date,e.event_number,
    (case e.recency when 1 then 0.5 when 2 then 0.3 else 0.2 end)::numeric *
      case when c.event_name ~ '\mduals?\M' then 0.5 else 1 end event_weight
  from canonical c join islands i using (athlete_key,event_name,event_date)
    join events e using (athlete_key,event_name,event_number) where e.recency<=3
), field_rows as (
  select r.athlete_key,r.event_name,r.event_number,r.recency,r.event_weight,f.*
  from recent r cross join lateral (values
    ('age',nullif(regexp_replace(coalesce(r.age_group,''),'[^0-9]','','g'),'')::numeric,r.source_rank),
    ('weight',case when r.weigh_in_lbs between 30 and 400 then r.weigh_in_lbs
      when r.bracket_weight_lbs between 30 and 400 then r.bracket_weight_lbs end,
      case when r.weigh_in_lbs is not null then 5 else r.source_rank end)
  ) f(field,value,priority) where f.value is not null
), preferred as (
  select *,max(priority) over (partition by athlete_key,event_name,event_number,field) top_priority from field_rows
), distinct_values as (
  select distinct athlete_key,event_name,event_number,recency,event_weight,field,value
  from preferred where priority=top_priority
), divided as (
  select *,event_weight/count(*) over (partition by athlete_key,event_name,event_number,field) vote from distinct_values
), totals as (
  select athlete_key,field,value,sum(vote) score,min(recency) newest from divided group by 1,2,3
), winners as (
  select *,count(*) over (partition by athlete_key,field,score) score_ties, row_number() over (partition by athlete_key,field order by score desc,newest,value) place from totals
), labels as materialized (
  select athlete_key,max(value) filter(where field='age')::integer || 'U' age_group,
    max(value) filter(where field='weight') bracket_weight_lbs,
    bool_and(score_ties=1) and count(*)=2 tier_eligible from winners where place=1 group by 1
), metadata as materialized (
  select distinct on (athlete_key) athlete_key,athlete_name,team,latest_date evidence_date
  from recent order by athlete_key,latest_date desc,source_rank desc,athlete_name,team
)
select coalesce(m.athlete_key,l.athlete_key) athlete_key,m.athlete_name,m.team,m.evidence_date,l.age_group,l.bracket_weight_lbs,
  floor(l.bracket_weight_lbs/10)::integer*10 weight_bucket,
  null::smallint division_birth_year_start,null::smallint division_birth_year_end,
  50::smallint confidence_score,'limited'::text confidence_label,'recent_events'::text evidence_type,coalesce(l.tier_eligible,false) tier_eligible
from metadata m full join labels l using (athlete_key);


-- Midpoint population deciles: equal conservative scores always share a tier.
create or replace view public.wrestler_strength_current with (security_invoker=true) as
with cohort_evidence as (
 select * from public.wrestler_cohort_current where age_group is not null and bracket_weight_lbs is not null
),
joined as (
  select
    evidence.athlete_key,
    coalesce(evidence.athlete_name, current_rating.athlete_name) as athlete_name,
    coalesce(nullif(evidence.team, ''), current_rating.team, '') as team,
    evidence.age_group, evidence.division_birth_year_start, evidence.division_birth_year_end,
    evidence.weight_bucket, evidence.bracket_weight_lbs, evidence.evidence_date,
    evidence.confidence_score, evidence.confidence_label, evidence.evidence_type, evidence.tier_eligible,
    current_rating.model_id, current_rating.model_version, current_rating.as_of_date,
    current_rating.rating, current_rating.rating_deviation, current_rating.volatility,
    current_rating.conservative_score, current_rating.rating_status,
    current_rating.match_count, current_rating.wins, current_rating.losses,
    current_rating.last_match_date
  from cohort_evidence evidence
  join public.wrestler_rating_current current_rating on current_rating.athlete_key = evidence.athlete_key
),
normalized as (
  select joined.*,
    count(*) over (partition by age_group, weight_bucket, conservative_score)::integer as tied_population,
    min(conservative_score) over (partition by age_group, weight_bucket) as cohort_min,
    max(conservative_score) over (partition by age_group, weight_bucket) as cohort_max,
    count(*) over (partition by age_group, weight_bucket)::integer as cohort_size,
    rank() over (partition by age_group, weight_bucket order by conservative_score desc)::integer as cohort_rank
  from joined
)
select
  athlete_key, athlete_name, team, age_group, division_birth_year_start, division_birth_year_end,
  weight_bucket, weight_bucket || '–' || (weight_bucket + 9) || ' lb' as weight_band,
  bracket_weight_lbs::numeric(5,2) as bracket_weight_lbs, evidence_date, confidence_score, confidence_label, evidence_type,
  model_id, model_version, as_of_date,
  rating, rating_deviation, volatility, conservative_score, rating_status,
  match_count, wins, losses, last_match_date,
  case
    when cohort_max = cohort_min then 1000.00
    else round((conservative_score - cohort_min) / nullif(cohort_max - cohort_min, 0) * 1000, 2)
  end as strength_score,
  cohort_rank, cohort_size,
  case when cohort_size >= 20 and tier_eligible
    then ceil(10.0 * (cohort_rank - 1 + tied_population / 2.0) / cohort_size)::integer end as cohort_tier,
  case when not tier_eligible then 'Age or weight evidence has tied support; current placement is an estimate.'
    when cohort_size < 20 then 'At least 20 rated wrestlers are required for Cohort Tier.' end as tier_unavailable_reason
from normalized;



-- Existing club aggregate: reference-1500 expectation against each observed opponent.
create or replace view public.club_rankings_current with (security_invoker = true) as
with participant_results as (
  select replace(m.season, '–', '-') as season, m.winner_name athlete_name,
    m.loser_name opponent_name, m.winner_team team, m.loser_team opponent_team,
    1::int as won
  from public.matches m where upper(trim(m.win_type)) in ('F','DEC','MD','TF') and lower(trim(m.winner_name)) <> lower(trim(m.loser_name))
  union all
  select replace(m.season, '–', '-') as season, m.loser_name athlete_name,
    m.winner_name opponent_name, m.loser_team team, m.winner_team opponent_team,
    0::int as won
  from public.matches m where upper(trim(m.win_type)) in ('F','DEC','MD','TF') and lower(trim(m.winner_name)) <> lower(trim(m.loser_name))
),
resolved as (
  select p.season, p.won,
    coalesce(a.club_key, 'raw:' || regexp_replace(lower(trim(p.team)), '[^a-z0-9]+', ' ', 'g')) as club_key,
    coalesce(a.canonical_name, trim(p.team)) as club_name,
    coalesce(opp_alias.club_key, 'raw:' || regexp_replace(lower(trim(p.opponent_team)), '[^a-z0-9]+', ' ', 'g')) as opponent_club_key,
    coalesce(athlete_alias.canonical_key, lower(trim(p.athlete_name))) as athlete_key,
    coalesce(rival_alias.canonical_key, lower(trim(p.opponent_name))) as opponent_key
  from participant_results p
  left join public.club_aliases a on a.alias_key = regexp_replace(lower(trim(p.team)), '[^a-z0-9]+', ' ', 'g')
  left join public.club_aliases opp_alias on opp_alias.alias_key = regexp_replace(lower(trim(p.opponent_team)), '[^a-z0-9]+', ' ', 'g')
  left join public.wrestler_aliases athlete_alias on athlete_alias.alias_key = lower(trim(p.athlete_name))
  left join public.wrestler_aliases rival_alias on rival_alias.alias_key = lower(trim(p.opponent_name))
  where nullif(trim(p.team), '') is not null and nullif(trim(p.athlete_name), '') is not null
),
scoped as (
  select 'ALL'::text as season, club_key, club_name, opponent_club_key, athlete_key, opponent_key, won from resolved
  union all
  select season, club_key, club_name, opponent_club_key, athlete_key, opponent_key, won from resolved
),
roster as (
  select distinct season, club_key, athlete_key from scoped
),
rated_roster as (
  select r.season,r.club_key,r.athlete_key,
    wr.conservative_score,wr.rating_deviation,
    row_number() over(partition by r.season,r.club_key order by wr.conservative_score desc nulls last) as power_rank
  from roster r left join public.wrestler_rating_current wr on wr.athlete_key=r.athlete_key
),
roster_summary as (
  select season,club_key,
    count(*)::int as wrestlers,
    count(conservative_score)::int as rated_wrestlers,
    round(avg(conservative_score)::numeric,1) as avg_conservative,
    round(percentile_cont(0.5) within group (order by conservative_score)::numeric,1) as median_conservative,
    round(avg(conservative_score) filter(where power_rank<=5)::numeric,1) as top_five_conservative,
    round(avg(rating_deviation)::numeric,1) as avg_rating_deviation
  from rated_roster group by season,club_key
),
bout_summary as (
  select s.season,s.club_key,max(s.club_name) as display_name,
    count(*)::int as bouts,
    count(*) filter(where s.won=1)::int as wins,
    count(*) filter(where s.won=0)::int as losses,
    count(*) filter(where s.club_key=s.opponent_club_key)::int as in_house_bouts,
    round(avg(opp.rating)::numeric,1) as avg_opponent_rating,
    avg(1.0 / (1.0 + power(10.0, (opp.rating-1500.0)/400.0))) as schedule_expected_win_pct
  from scoped s
  left join public.wrestler_rating_current opp on opp.athlete_key=s.opponent_key
  group by s.season,s.club_key
)
select b.season,b.club_key,b.display_name as club_name,b.bouts,b.wins,b.losses,
  r.wrestlers,r.rated_wrestlers,r.avg_conservative,r.median_conservative,
  r.top_five_conservative,r.avg_rating_deviation,b.avg_opponent_rating,b.in_house_bouts,b.schedule_expected_win_pct
from bout_summary b join roster_summary r on r.season=b.season and r.club_key=b.club_key;


commit;
