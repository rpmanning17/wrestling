-- SQL invoker functions require no SET clause to inline a constant age argument.
-- Every table reference is schema-qualified; built-ins resolve in pg_catalog.
-- Preserve invoker execution, RLS, grants and the unchanged three-event vote.
alter function public.current_wrestler_cohorts(integer) reset search_path;
alter function public.current_person_cohorts(integer) reset search_path;
notify pgrst, 'reload schema';
