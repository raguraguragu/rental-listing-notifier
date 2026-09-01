-- ============================================================
-- customer_search_conditions テーブルを廃止するマイグレーション
-- 通知対象は「ATBBの保存条件名に含まれるLINEユーザーIDが
-- line_users テーブルに登録されているか」だけで判定するようになり、
-- このテーブルは不要になった。
-- Supabase ダッシュボード → SQL Editor で実行する
-- ============================================================

DROP TRIGGER IF EXISTS trg_customer_search_conditions_updated_at ON customer_search_conditions;
DROP INDEX IF EXISTS idx_customer_search_conditions_enabled;
DROP TABLE IF EXISTS customer_search_conditions;
