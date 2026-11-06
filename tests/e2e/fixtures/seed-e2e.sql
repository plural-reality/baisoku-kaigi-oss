-- E2E Test Seed Data
-- Fixed UUIDs for deterministic test data

-- Test session
INSERT INTO sessions (id, title, goal, context, admin_access_token, is_public, host_user_id)
VALUES (
  '00000000-0000-0000-0000-000000000e2e',
  'E2E テストセッション',
  'テスト目的: チーム内の認識差を明らかにする',
  'テストコンテキスト: これはE2Eテスト用のセッションです',
  'e2e00000-0000-0000-0000-000000000001',
  true,
  '00000000-0000-0000-0000-000000000001'
) ON CONFLICT (id) DO NOTHING;

-- Test statements (3 questions)
INSERT INTO statements (id, session_id, text, order_index)
VALUES
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000e2e', 'テスト質問1: AIは仕事を奪うか？', 0),
  ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000e2e', 'テスト質問2: リモートワークは生産性を上げるか？', 1),
  ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000e2e', 'テスト質問3: 教育にAIを導入すべきか？', 2)
ON CONFLICT (id) DO NOTHING;

-- Test participants (2 users)
-- Note: participants PK is (user_id, session_id), not a separate id column
INSERT INTO participants (user_id, session_id, name)
VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000e2e', 'テスト太郎'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000e2e', 'テスト花子')
ON CONFLICT (user_id, session_id) DO NOTHING;
