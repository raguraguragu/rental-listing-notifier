-- ============================================================
-- マニュアル画像用の非公開バケット
-- ============================================================
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run
--
-- 目的:
--   操作マニュアルのスクリーンショットには顧客の氏名・LINEユーザーIDや
--   ATBBの会員間情報が写り込む。これらを web/public/ に置くと、
--   静的ファイルとして誰でも直接URLで取得できてしまう
--   （React側の認証ガードは静的ファイルには効かない）。
--
--   そこで画像を非公開バケットに置き、ログイン済みユーザーだけが
--   署名付きURL（有効期限つき）を発行して閲覧できるようにする。
-- ============================================================

-- 非公開バケットを作成（public = false が重要）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'manual-images',
  'manual-images',
  false,
  10485760, -- 10MB
  array['image/png', 'image/jpeg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ログイン済み(authenticated)だけが読み取れるポリシー。
-- 未ログイン(anon)には何も許可しないので、署名付きURLも発行できない。
drop policy if exists "authenticated can read manual images" on storage.objects;

create policy "authenticated can read manual images"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'manual-images');
