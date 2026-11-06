-- facilitator_goal / facilitator_context は「公開用 goal/context と独立した、
-- AI・進行用の内部オーバーライド」。未設定（NULL）なら各読み取り経路
-- （statements/generate, event-thread/analyze など）が sessionFacilitatorGoal/
-- Context で公開用 goal/context に fallback する。
--
-- 既存行を goal/context で backfill すると公開用テキストが facilitator_* に
-- 流入し、管理画面の「基本設定」と「公開設定」が混合してしまうため backfill は行わない。
alter table public.sessions
  add column if not exists facilitator_goal text,
  add column if not exists facilitator_context text;
