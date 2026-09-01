/**
 * Supabase DB データ全削除スクリプト
 *
 * 全テーブルの行をすべて削除します（テーブル構造は維持）。
 *
 * 実行方法:
 *   npm run db:reset
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('エラー: .env に SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です。');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const tables = [
  'notification_logs',
  'notified_properties',
  'line_users',
] as const;

for (const table of tables) {
  const { error } = await supabase.from(table).delete().not('id', 'is', null);
  if (error) {
    console.error(`${table} の削除に失敗しました:`, error.message);
    process.exit(1);
  }
  console.log(`✓ ${table} を削除しました`);
}

console.log('DB データ全削除完了');
