begin;
set local lock_timeout='5s';
-- Final readers use native person/age/athlete/club keys. These trial indexes
-- no longer serve a final read path; source-side UUID primary keys remain.
drop index private.match_cohort_source_covering_idx;
drop index private.match_cohort_source_text_idx;
drop index private.match_cohort_age_idx;
-- Compact entries left behind by the two locked projection backfills.
reindex index private.match_cohort_person_covering_idx;
commit;

