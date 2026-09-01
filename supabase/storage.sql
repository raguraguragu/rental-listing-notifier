-- ============================================================
-- Supabase Storage: property-images バケットのセットアップ
-- ============================================================
-- 実行方法: Supabase ダッシュボード → SQL Editor → このファイルを貼り付けて Run
-- ※ supabase CLI: supabase db push でも適用可能

-- property-images バケットを作成（パブリック = LINEから直接アクセス可能）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'property-images',
  'property-images',
  true,
  10485760,  -- 10MB
  ARRAY['image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
