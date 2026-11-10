begin;
create index source_identity_cohort_lookup_idx on public.source_identity_current_rows(source_kind,source_id) include(person_id);
create index match_cohort_source_covering_idx on private.match_cohort_appearances(source_match_id,side)
 include(athlete_name,team,event_date,event_name,age_group,bracket_weight_lbs,athlete_key,age_value);
analyze public.source_identity_current_rows;
analyze private.match_cohort_appearances;
commit;

