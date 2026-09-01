/**
 * notified_properties の property_fingerprint を新ルールで再計算するスクリプト
 *
 * 重複判定ルール（建物名・住所・間取り・専有面積）を変更したため、既存レコードの
 * 指紋を first_listing から計算し直す。新ルールで同一物件に畳まれる重複レコードは
 * 1件だけ残して他を削除する。これにより、ルール変更後の初回実行で過去通知済みの
 * 物件が「未通知」と誤判定されて再通知されるのを防ぐ。
 *
 * 実行方法:
 *   npm run db:recompute            # ドライラン（変更内容を表示するだけ）
 *   npm run db:recompute -- --apply # 実際にDBを更新する
 *
 * 事前準備:
 *   .env に SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要。
 *
 * 注意:
 *   notification_logs（履歴）の property_fingerprint は対象外。重複通知の判定に
 *   使われるのは notified_properties だけなので、履歴はそのまま残す。
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createPropertyFingerprint } from '../src/propertyKey.js';
import type { PropertyListing } from '../src/types.js';

const APPLY = process.argv.includes('--apply');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('エラー: .env に SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です。');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

type NotifiedRow = {
  id: string;
  line_user_id: string;
  property_fingerprint: string;
  first_listing: PropertyListing;
  created_at: string;
};

const { data, error } = await supabase
  .from('notified_properties')
  .select('id, line_user_id, property_fingerprint, first_listing, created_at');

if (error) {
  console.error('notified_properties の取得に失敗しました:', error.message);
  process.exit(1);
}

const rows = (data ?? []) as NotifiedRow[];
console.log(`notified_properties レコード数: ${rows.length}`);
console.log(APPLY ? '=== 適用モード（DBを更新します）===' : '=== ドライラン（DBは変更しません。適用するには -- --apply）===');

// (line_user_id, 新しい指紋) ごとにレコードをまとめる
const groups = new Map<string, { newFp: NotifiedRow['property_fingerprint']; lineUserId: string; rows: NotifiedRow[] }>();

for (const row of rows) {
  const newFp = createPropertyFingerprint(row.first_listing);
  const key = `${row.line_user_id}::${newFp}`;
  let group = groups.get(key);
  if (!group) {
    group = { newFp, lineUserId: row.line_user_id, rows: [] };
    groups.set(key, group);
  }
  group.rows.push(row);
}

let toUpdate = 0;
let toDelete = 0;
const deleteIds: string[] = [];
const updates: Array<{ id: string; newFp: string }> = [];

for (const group of groups.values()) {
  // 残すレコードは作成日が最も古いもの（最初に通知したもの）
  const sorted = [...group.rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const survivor = sorted[0]!;
  const losers = sorted.slice(1);

  if (losers.length > 0) {
    toDelete += losers.length;
    for (const loser of losers) {
      deleteIds.push(loser.id);
      console.log(`  [削除] ${loser.line_user_id} | ${loser.first_listing?.name ?? '(名前不明)'} ${loser.first_listing?.roomNumber ?? ''} (重複: ${loser.property_fingerprint.slice(0, 12)}…)`);
    }
  }

  if (survivor.property_fingerprint !== group.newFp) {
    toUpdate += 1;
    updates.push({ id: survivor.id, newFp: group.newFp });
    console.log(`  [更新] ${survivor.line_user_id} | ${survivor.first_listing?.name ?? '(名前不明)'} : ${survivor.property_fingerprint.slice(0, 12)}… → ${group.newFp.slice(0, 12)}…`);
  }
}

console.log('');
console.log(`畳み込み後の物件数: ${groups.size}`);
console.log(`削除対象（重複）: ${toDelete}件`);
console.log(`指紋更新対象: ${toUpdate}件`);

if (!APPLY) {
  console.log('');
  console.log('ドライランのため変更していません。適用するには: npm run db:recompute -- --apply');
  process.exit(0);
}

// 1. 先に重複レコードを削除する（ユニーク制約 (line_user_id, property_fingerprint)
//    との衝突を避けるため、更新より前に行う）
if (deleteIds.length > 0) {
  const { error: delError } = await supabase
    .from('notified_properties')
    .delete()
    .in('id', deleteIds);
  if (delError) {
    console.error('重複レコードの削除に失敗しました:', delError.message);
    process.exit(1);
  }
  console.log(`✓ 重複 ${deleteIds.length}件を削除しました`);
}

// 2. 残ったレコードの指紋を更新する
let updated = 0;
for (const { id, newFp } of updates) {
  const { error: updError } = await supabase
    .from('notified_properties')
    .update({ property_fingerprint: newFp })
    .eq('id', id);
  if (updError) {
    console.error(`指紋更新に失敗しました (id=${id}):`, updError.message);
    process.exit(1);
  }
  updated += 1;
}
console.log(`✓ 指紋 ${updated}件を更新しました`);

console.log('再計算マイグレーション完了');
