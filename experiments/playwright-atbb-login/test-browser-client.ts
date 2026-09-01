/**
 * BrowserAtbbClient の全条件統合テスト
 * src/atbb/client.ts の本番コードをそのまま使って
 * ATBBの全保存条件 × 全物件を取得しテキストファイルに出力する
 *
 * 実行: npx tsx experiments/playwright-atbb-login/test-browser-client.ts
 */

import 'dotenv/config';
import { execSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { BrowserAtbbClient } from '../../src/atbb/client.js';
import type { AppConfig } from '../../src/config.js';
import type { CustomerSearchCondition } from '../../src/types.js';

const username = process.env['ATBB_USERNAME'];
const password = process.env['ATBB_PASSWORD'];
if (!username || !password) {
  console.error('エラー: ATBB_USERNAME と ATBB_PASSWORD を .env に設定してください');
  process.exit(1);
}

const config: AppConfig = {
  SUPABASE_URL: 'https://placeholder.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
  ATBB_USERNAME: username,
  ATBB_PASSWORD: password,
  ATBB_SOURCE_MODE: 'browser',
  ATBB_FIXTURE_PATH: 'data/sample-listings.json',
  LINE_CHANNEL_ACCESS_TOKEN: 'placeholder',
};

const branch = execSync('git branch --show-current').toString().trim();
const now = new Date();
const dateStr = now.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
const timeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const outPath = `experiments/playwright-atbb-login/results-${dateStr}.txt`;

console.log(`ブランチ: ${branch}`);
console.log('ATBBにログインして全条件を取得します...\n');

const client = new BrowserAtbbClient(config);
await client.start();

try {
  // ① ATBB から保存条件一覧を取得
  const savedConditions = await client.fetchSavedConditions();
  console.log(`保存条件: ${savedConditions.length} 件\n`);

  const lines: string[] = [
    `取得日時: ${dateStr} ${timeStr}`,
    `ブランチ: ${branch}`,
    `保存条件数: ${savedConditions.length} 件`,
    '=================================',
    '',
  ];

  let totalListings = 0;

  // ② 各条件ごとに物件を取得
  for (const saved of savedConditions) {
    console.log(`\n▼ 条件: ${saved.name} (conditionId: ${saved.conditionId})`);

    const condition: CustomerSearchCondition = {
      id: saved.conditionId,
      lineUserId: '(test)',
      name: saved.name,
      atbbSavedConditionId: saved.conditionId,
    };

    const listings = await client.fetchListings(condition);
    totalListings += listings.length;

    lines.push(`■ ${saved.name}`);
    lines.push(`  conditionId: ${saved.conditionId}`);
    lines.push(`  取得件数: ${listings.length} 件`);
    lines.push('');

    for (let i = 0; i < listings.length; i++) {
      const l = listings[i]!;
      const listingLines = [
        `  --- 物件 ${i + 1} ---`,
        `  sourceId : ${l.sourceId ?? '不明'}`,
        `  建物名   : ${l.name}${l.roomNumber ? ` ${l.roomNumber}` : ''}`,
        `  住所     : ${l.address || '不明'}`,
        `  最寄り   : ${l.nearestStation || '不明'}`,
        `  間取り   : ${l.layout || '不明'}`,
        `  面積     : ${l.areaSquareMeters != null ? `${l.areaSquareMeters}㎡` : '不明'}`,
        `  賃料     : ${l.rentYen != null ? `${(l.rentYen / 10000).toFixed(2)}万円` : '不明'}`,
        `  管理費   : ${l.managementFeeYen != null ? `${l.managementFeeYen}円` : '不明'}`,
        `  階数     : ${l.floor ?? '不明'}`,
        `  新着     : ${l.isNew ? '✓' : '×'}`,
        '',
      ];
      lines.push(...listingLines);
      console.log(listingLines.join('\n'));
    }
  }

  lines.unshift(`合計物件数: ${totalListings} 件`, '');
  const output = lines.join('\n');
  await writeFile(outPath, output, 'utf-8');

  console.log(`\n✓ ${outPath} に保存しました`);
  console.log(`  保存条件: ${savedConditions.length} 件 / 合計物件: ${totalListings} 件`);

} finally {
  await client.close();
}

