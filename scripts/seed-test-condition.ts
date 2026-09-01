import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const client = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// テスト用の LINE ユーザーを line_users に登録する。
// ATBBの保存条件名を `{この user_id}_{名前}` 形式にすると通知対象になる。
//
// 実在するユーザーIDはリポジトリに含めないため、環境変数から受け取る。
//   例) SEED_LINE_USER_ID=U0123... npx tsx scripts/seed-test-condition.ts
const seedUserId = process.env.SEED_LINE_USER_ID;
if (!seedUserId) {
  console.error('SEED_LINE_USER_ID が未設定です。対象の LINE ユーザーIDを指定してください。');
  process.exit(1);
}

const { data, error } = await client
  .from('line_users')
  .upsert(
    {
      user_id: seedUserId,
      display_name: process.env.SEED_LINE_DISPLAY_NAME ?? 'テストユーザー',
      event_type: 'seed'
    },
    { onConflict: 'user_id' }
  )
  .select()
  .single();

if (error) {
  console.error('挿入エラー:', error.message);
  process.exit(1);
}

console.log('挿入成功:', data);
