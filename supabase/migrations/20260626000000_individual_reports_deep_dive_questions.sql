-- deep_dive_questions: LLM が生成した参加者向けの深掘り問い。
-- POST で生成・保存し GET でも返すことで、ページリロード後も表示を保持する。
-- DEFAULT '[]' で既存行は空配列になり、クライアントは常に配列として扱える。
alter table public.individual_reports
  add column if not exists deep_dive_questions jsonb not null default '[]'::jsonb;
