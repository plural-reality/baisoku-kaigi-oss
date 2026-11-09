-- How a free-text answer was entered: 'typed' by the participant, or
-- 'suggested' (one of the W6 suggestion buttons was clicked). NULL for scale
-- answers and for rows from before this column existed. Additive and nullable:
-- no backfill; idempotent so it can be applied to the shared staging/prod DB by
-- hand.
alter table public.responses
  add column if not exists answer_source text null;

alter table public.responses
  drop constraint if exists responses_answer_source_check;
alter table public.responses
  add constraint responses_answer_source_check
  check (answer_source is null or answer_source in ('typed', 'suggested'));
