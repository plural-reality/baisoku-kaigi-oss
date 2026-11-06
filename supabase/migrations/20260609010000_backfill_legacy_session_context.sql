-- Legacy sessions created before facilitator_goal/facilitator_context had only
-- sessions.goal/context. Those values are the canonical 本題, not an explicit
-- participant-facing override. Move only the unambiguous legacy shape:
-- both facilitator fields are blank and at least one public field has content.
alter table public.sessions
  add column if not exists facilitator_goal text,
  add column if not exists facilitator_context text;

with legacy_sessions as (
  select id, goal, context
  from public.sessions
  where
    nullif(trim(coalesce(facilitator_goal, '')), '') is null
    and nullif(trim(coalesce(facilitator_context, '')), '') is null
    and (
      nullif(trim(coalesce(goal, '')), '') is not null
      or nullif(trim(coalesce(context, '')), '') is not null
    )
)
update public.sessions as sessions
set
  facilitator_goal = legacy_sessions.goal,
  facilitator_context = legacy_sessions.context,
  goal = '',
  context = ''
from legacy_sessions
where sessions.id = legacy_sessions.id;
