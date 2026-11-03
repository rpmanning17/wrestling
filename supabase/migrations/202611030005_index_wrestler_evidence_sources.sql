begin;

create index wrestler_evidence_source_entry_idx
  on public.wrestler_evidence (source_entry_id)
  where source_entry_id is not null;

create index wrestler_evidence_source_match_idx
  on public.wrestler_evidence (source_match_id)
  where source_match_id is not null;

commit;
