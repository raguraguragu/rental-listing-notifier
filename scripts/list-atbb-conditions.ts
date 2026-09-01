/**
 * ATBBに登録されている保存条件の一覧を取得して表示するスクリプト
 * 実行: npx tsx scripts/list-atbb-conditions.ts
 */
import 'dotenv/config';
import { createAtbbClient } from '../src/atbb/client.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const client = createAtbbClient(config);

await client.start();
try {
  const conditions = await client.fetchSavedConditions();
  console.log(`\nATBB保存条件: ${conditions.length}件\n`);
  for (const c of conditions) {
    console.log(`  conditionId: ${c.conditionId}\n  name:        ${c.name}\n`);
  }
} finally {
  await client.close();
}
