/**
 * Supabase スキーマ適用スクリプト
 *
 * 実行方法:
 *   npm run db:push
 *
 * 事前準備:
 *   .env に DATABASE_URL を追加する
 *   値は Supabase ダッシュボード → Project Settings → Database
 *        → Connection string → URI (Transaction pooler) からコピー
 *   パスワード部分は [YOUR-PASSWORD] を実際のDBパスワードに置き換える
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('エラー: .env に DATABASE_URL が設定されていません。');
  console.error('Supabase ダッシュボード → Project Settings → Database → Connection string → URI を設定してください。');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '..', 'supabase', 'schema.sql');
const sql = readFileSync(sqlPath, 'utf-8');

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log('Supabase に接続しました');

  await client.query(sql);
  console.log('supabase/schema.sql を適用しました');
} finally {
  await client.end();
}
