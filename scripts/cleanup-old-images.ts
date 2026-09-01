import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

/**
 * property-images バケットから古い物件画像を削除する。
 *
 * LINEは画像メッセージ送信時に画像を取得済みのため、一定期間を過ぎた
 * スクリーンショットを保持し続ける必要は薄い。放置するとSupabaseの
 * ストレージ容量を圧迫し、上限に達するとアップロードが失敗して
 * 通知が静かに止まるため、定期的に古い画像を削除する。
 *
 * 重要: 削除するのは Storage 上のファイルのみ。notified_properties の行は
 * 絶対に消さないこと。行を消すと「未通知」と判定され重複通知が発生する。
 *
 * 使い方:
 *   npm run storage:cleanup           … 削除対象を表示するだけ(ドライラン)
 *   npm run storage:cleanup -- --apply … 実際に削除する
 *
 * 保持期間は IMAGE_RETENTION_MONTHS で変更できる(既定: 6ヶ月)。
 */

const BUCKET = 'property-images';
const LIST_PAGE_SIZE = 100;
const DELETE_CHUNK_SIZE = 100;

const retentionMonths = Number(process.env.IMAGE_RETENTION_MONTHS ?? 6);
if (!Number.isFinite(retentionMonths) || retentionMonths <= 0) {
  console.error(`IMAGE_RETENTION_MONTHS が不正です: ${process.env.IMAGE_RETENTION_MONTHS}`);
  process.exit(1);
}

const apply = process.argv.includes('--apply');

const threshold = new Date();
threshold.setMonth(threshold.getMonth() - retentionMonths);

const client = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/** バケット内の全ファイルをページングで取得する */
async function listAllFiles(): Promise<{ name: string; createdAt: string; size: number }[]> {
  const files: { name: string; createdAt: string; size: number }[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await client.storage
      .from(BUCKET)
      .list('', { limit: LIST_PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });

    if (error) {
      throw new Error(`一覧取得に失敗しました: ${error.message}`);
    }
    if (!data || data.length === 0) {
      break;
    }

    for (const file of data) {
      // フォルダ相当のエントリ(metadata を持たない)は対象外
      const metadata = file.metadata as { size?: number } | null;
      if (!metadata) continue;
      files.push({
        name: file.name,
        createdAt: String(file.created_at ?? ''),
        size: metadata.size ?? 0
      });
    }

    offset += data.length;
    if (data.length < LIST_PAGE_SIZE) {
      break;
    }
  }

  return files;
}

const allFiles = await listAllFiles();
const totalBytes = allFiles.reduce((sum, f) => sum + f.size, 0);

// created_at が取れないファイルは判断できないため削除しない(安全側に倒す)
const stale = allFiles.filter((f) => f.createdAt && new Date(f.createdAt) < threshold);
const staleBytes = stale.reduce((sum, f) => sum + f.size, 0);

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

console.log(`バケット: ${BUCKET}`);
console.log(`保持期間: ${retentionMonths}ヶ月 (${threshold.toISOString().slice(0, 10)} より前が対象)`);
console.log(`現在: ${allFiles.length}枚 / ${mb(totalBytes)} MB`);
console.log(`削除対象: ${stale.length}枚 / ${mb(staleBytes)} MB`);
console.log(`削除後の見込み: ${allFiles.length - stale.length}枚 / ${mb(totalBytes - staleBytes)} MB`);

if (stale.length === 0) {
  console.log('\n削除対象はありません。');
  process.exit(0);
}

if (!apply) {
  console.log('\n[ドライラン] 実際には削除していません。削除するには --apply を付けてください。');
  process.exit(0);
}

let deleted = 0;
for (let i = 0; i < stale.length; i += DELETE_CHUNK_SIZE) {
  const chunk = stale.slice(i, i + DELETE_CHUNK_SIZE);
  const { error } = await client.storage.from(BUCKET).remove(chunk.map((f) => f.name));

  if (error) {
    console.error(`削除に失敗しました (${i + 1}〜${i + chunk.length}件目): ${error.message}`);
    process.exit(1);
  }

  deleted += chunk.length;
  console.log(`  削除: ${deleted}/${stale.length}枚`);
}

console.log(`\n完了: ${deleted}枚 / ${mb(staleBytes)} MB を削除しました。`);
console.log('notified_properties は変更していないため、重複通知は発生しません。');
