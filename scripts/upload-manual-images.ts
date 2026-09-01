import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

/**
 * マニュアル画像を非公開バケット `manual-images` にアップロードする。
 *
 * 画像はリポジトリに含めない（公開リポジトリに置くと誰でも取得できるため）。
 * 手元の原本フォルダを指定して、この1回だけ実行する。
 *
 * 使い方:
 *   npx tsx scripts/upload-manual-images.ts <画像フォルダのパス>
 *
 * 事前に supabase/manual-images.sql を実行してバケットを作っておくこと。
 */

const BUCKET = 'manual-images';
const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

/**
 * Supabase Storage のキーは ASCII しか使えないため、日本語のファイル名を
 * 変換する。ここのキー名は web/src/pages/Manual.tsx の SHOTS と一致させること。
 */
const NAME_MAP: Record<string, string> = {
  '物件を検索の画面.png': 'search-properties.png',
  '検索条件の保存とタイトルの入力.png': 'save-condition.png',
  'LINEのユーザID確認.png': 'line-user-list.png',
  'LINEの表示名の検索結果.png': 'line-user-search-result.png',
  '検索条件保存のタイトル入力例.png': 'title-input-example.png'
};

const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error('画像フォルダのパスを指定してください。');
  console.error('  例) npx tsx scripts/upload-manual-images.ts ./manual-originals');
  process.exit(1);
}

const client = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const entries = await readdir(sourceDir);
const images = entries.filter((name) => CONTENT_TYPES[extname(name).toLowerCase()]);

if (images.length === 0) {
  console.error(`${sourceDir} に画像が見つかりませんでした。`);
  process.exit(1);
}

console.log(`バケット ${BUCKET} へ ${images.length} 枚をアップロードします。`);

for (const name of images) {
  const key = NAME_MAP[name];
  if (!key) {
    console.warn(`  スキップ: ${name} (NAME_MAP に定義がありません)`);
    continue;
  }

  const buffer = await readFile(join(sourceDir, name));
  const contentType = CONTENT_TYPES[extname(name).toLowerCase()]!;

  const { error } = await client.storage
    .from(BUCKET)
    .upload(key, buffer, { contentType, upsert: true });

  if (error) {
    console.error(`  失敗: ${name} - ${error.message}`);
    process.exit(1);
  }
  console.log(`  完了: ${name} → ${key} (${(buffer.length / 1024).toFixed(0)} KB)`);
}

console.log('\nアップロードが完了しました。');
console.log('バケットは非公開のため、ログイン済みユーザーだけが署名付きURLで閲覧できます。');
