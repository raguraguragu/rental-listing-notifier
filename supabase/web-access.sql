-- ============================================================
-- Web管理画面（Cloudflare Pages）用のアクセス制御
-- ============================================================
-- 実行方法: Supabase ダッシュボード → SQL Editor → このファイルを貼り付けて Run
--
-- 目的:
--   ブラウザ（anonキー）からのアクセスは、Supabase Authで
--   ログイン済み（role = authenticated）のときだけ line_users を
--   読み取れるようにする。未ログインだと1件も返らない（最後の砦）。
--
--   GitHub Actions / Edge Function は service_role キーを使うため、
--   RLSをバイパスする。このポリシーの影響は受けない。
-- ============================================================

-- 念のためRLSが有効であることを保証（schema.sqlで有効化済み）
alter table line_users enable row level security;

-- 既存の同名ポリシーがあれば作り直す
drop policy if exists "authenticated can read line_users" on line_users;

-- ログイン済みユーザーだけが SELECT 可能
-- （Web画面は閲覧専用。INSERT/UPDATE/DELETE ポリシーは作らないので
--   ブラウザからの書き込みはすべて拒否される）
create policy "authenticated can read line_users"
  on line_users
  for select
  to authenticated
  using (true);
