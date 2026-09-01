import { createAtbbClient, type AtbbClient } from './atbb/client.js';
import { loadConfig } from './config.js';
import { createNotificationRepository, type NotificationRepository } from './db/repository.js';
import { LineMessagingClient } from './line/client.js';
import { maskUserId, shortFingerprint } from './log.js';
import { createPropertyFingerprint } from './propertyKey.js';
import type { CustomerSearchCondition } from './types.js';

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts: number; delayMs: number; label: string; beforeRetry?: () => Promise<void> }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const messageText = error instanceof Error ? error.message : String(error);
      if (attempt < options.maxAttempts) {
        console.warn(`  [RETRY] ${options.label}: 試行${attempt}回目失敗 (${messageText})。${options.delayMs / 1000}秒後に再試行...`);
        if (options.beforeRetry) {
          await options.beforeRetry().catch(() => { /* クリーンアップ失敗は無視 */ });
        }
        await new Promise((r) => setTimeout(r, options.delayMs));
      }
    }
  }
  throw lastError;
}

/** ATBBの条件名が `{LINE_USER_ID}_{名前}` 形式か判定するパターン */
const LINE_USER_ID_PATTERN = /^(U[0-9a-f]{32})_(.+)$/;

/**
 * ATBBの保存条件一覧を取得し、条件名から LINE user ID が読み取れて、
 * かつその ID が line_users テーブルに登録されている条件だけを通知対象として返す。
 */
async function resolveConditions(
  atbbClient: AtbbClient,
  repository: NotificationRepository
): Promise<CustomerSearchCondition[]> {
  const atbbConditions = await withRetry(
    () => atbbClient.fetchSavedConditions(),
    { maxAttempts: 3, delayMs: 10000, label: 'ATBB保存条件一覧取得' }
  );
  const conditions: CustomerSearchCondition[] = [];

  for (const cond of atbbConditions) {
    const match = cond.name.match(LINE_USER_ID_PATTERN);
    if (!match) continue;
    const [, lineUserId, label] = match;
    if (!lineUserId || !label) continue;

    // 条件名のLINEユーザーIDが line_users に登録されていなければ通知しない
    if (!(await repository.lineUserExists(lineUserId))) {
      console.log(`条件 conditionId=${cond.conditionId}: LINEユーザー ${maskUserId(lineUserId)} は line_users に未登録のためスキップ`);
      continue;
    }

    conditions.push({
      id: cond.conditionId,
      lineUserId,
      name: label,
      atbbSavedConditionId: cond.conditionId,
      searchUrl: null
    });
  }

  return conditions;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const repository = createNotificationRepository(config);
  const atbbClient = createAtbbClient(config);
  const lineClient = new LineMessagingClient(config.LINE_CHANNEL_ACCESS_TOKEN);

  // ログイン（ブラウザ起動）も失敗時はリトライする。再試行前に中途半端な
  // ブラウザを閉じてリソースリークを防ぐ。
  await withRetry(
    () => atbbClient.start(),
    {
      maxAttempts: 3,
      delayMs: 10000,
      label: 'ATBBログイン',
      beforeRetry: () => atbbClient.close(),
    }
  );
  try {
    // ATBBの保存条件から通知対象を解決する（条件名が {LINE_USER_ID}_{名前} 形式で
    // かつ LINEユーザーIDが line_users に登録されているもの）
    const conditions = await resolveConditions(atbbClient, repository);
    console.log(`通知対象の検索条件: ${conditions.length}件`);

    for (const condition of conditions) {
      try {
        const listings = await withRetry(
          () => atbbClient.fetchListings(condition),
          { maxAttempts: 3, delayMs: 10000, label: `条件 conditionId=${condition.id} ATBB取得` }
        );
        console.log(`条件 conditionId=${condition.id}: ${listings.length}件を確認`);

        // 未通知の物件だけ抽出
        // 同一バッチ内に同じ指紋（号室違いなど）が複数あっても1件しか送らないよう、
        // この実行で既に拾った指紋は seen に記録してスキップする。一覧の先頭側
        // （ATBBの並び順で先に出てきた号室）が代表として送られる。
        const newListings = [];
        const seen = new Set<string>();
        for (const listing of listings) {
          const fingerprint = createPropertyFingerprint(listing);
          if (seen.has(fingerprint)) {
            continue;
          }
          if (await repository.hasNotified(condition.lineUserId, fingerprint)) {
            continue;
          }
          seen.add(fingerprint);
          newListings.push({ listing, fingerprint });
        }

        if (newListings.length === 0) {
          console.log(`  → 新着なし`);
          continue;
        }

        console.log(`  → 新着${newListings.length}件の画像を取得・送信`);

        // 各新着物件のインフォシートをスクリーンショットして画像送信
        for (const { listing, fingerprint } of newListings) {
          try {
            let imageUrl: string | null = null;

            if (listing.infoSheetUrl) {
              console.log(`    [INFO] 物件 ${shortFingerprint(fingerprint)} のインフォシートを取得中...`);
              const screenshot = await withRetry(
                () => atbbClient.screenshotInfoSheet(listing.infoSheetUrl!),
                { maxAttempts: 2, delayMs: 3000, label: `物件 ${shortFingerprint(fingerprint)} スクリーンショット` }
              );
              if (screenshot) {
                imageUrl = await withRetry(
                  () => repository.uploadPropertyImage(screenshot, `${fingerprint}.jpg`),
                  { maxAttempts: 2, delayMs: 3000, label: `物件 ${shortFingerprint(fingerprint)} 画像アップロード` }
                );
                console.log(`    [INFO] アップロード完了: ${shortFingerprint(fingerprint)}.jpg`);
              }
            }

            if (imageUrl) {
              await withRetry(
                () => lineClient.sendImages(condition.lineUserId, [imageUrl!]),
                { maxAttempts: 3, delayMs: 5000, label: `物件 ${shortFingerprint(fingerprint)} LINE画像送信` }
              );
              await repository.recordNotification(condition.lineUserId, fingerprint, listing, imageUrl);
              console.log(`    → 画像送信完了: 物件 ${shortFingerprint(fingerprint)}`);
            } else {
              console.warn(`    [WARN] 物件 ${shortFingerprint(fingerprint)}: インフォシートURLが未取得のため通知をスキップ`);
              // スキップした場合は次回もリトライするため fingerprint を記録しない
            }
          } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            console.error(`  [ERROR] 物件 ${shortFingerprint(fingerprint)}: 送信失敗 - ${messageText}`);
            await repository.recordFailure(condition.lineUserId, fingerprint, messageText);
          }
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        console.error(`[ERROR] 条件 conditionId=${condition.id}: 処理失敗 - ${messageText}`);
        // 次の条件へ継続
      }
    }
  } finally {
    await atbbClient.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});