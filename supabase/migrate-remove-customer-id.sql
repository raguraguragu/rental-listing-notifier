-- ============================================================
-- customer_id を廃止し line_user_id に統一するマイグレーション
-- Supabase ダッシュボード → SQL Editor で実行する
-- ============================================================

-- 1. customer_search_conditions から customer_id カラムを削除
ALTER TABLE customer_search_conditions DROP COLUMN IF EXISTS customer_id;

-- 2. notified_properties の customer_id を line_user_id に変更
ALTER TABLE notified_properties RENAME COLUMN customer_id TO line_user_id;
ALTER TABLE notified_properties ALTER COLUMN line_user_id TYPE text;

-- ユニーク制約を張り直す（customer_id → line_user_id）
-- ※ 制約名が異なる場合は Supabase の制約名に合わせて変更してください
ALTER TABLE notified_properties DROP CONSTRAINT IF EXISTS notified_properties_customer_id_property_fingerprint_key;
ALTER TABLE notified_properties ADD CONSTRAINT notified_properties_line_user_id_property_fingerprint_key
  UNIQUE (line_user_id, property_fingerprint);

-- インデックス再作成
DROP INDEX IF EXISTS idx_notified_properties_customer;
CREATE INDEX IF NOT EXISTS idx_notified_properties_user ON notified_properties (line_user_id);

-- 3. notification_logs の customer_id を line_user_id に変更
ALTER TABLE notification_logs RENAME COLUMN customer_id TO line_user_id;
ALTER TABLE notification_logs ALTER COLUMN line_user_id TYPE text;

-- インデックス再作成
DROP INDEX IF EXISTS idx_notification_logs_customer;
CREATE INDEX IF NOT EXISTS idx_notification_logs_user ON notification_logs (line_user_id, created_at DESC);
