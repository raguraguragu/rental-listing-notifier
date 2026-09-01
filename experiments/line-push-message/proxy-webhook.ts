/**
 * LINE Webhook プロキシ ローカル検証ツール
 *
 * 役割:
 *   1. LINE から Webhook を受信
 *   2. userId + displayName をコンソールに出力（Supabase保存の代わり）
 *   3. エルメへリクエストをそのまま転送
 *
 * 実行手順:
 *   1. このスクリプトを起動:
 *        npx tsx experiments/line-push-message/proxy-webhook.ts
 *   2. 別ターミナルで ngrok を起動:
 *        npx ngrok http 3000
 *   3. ngrok が表示する https://xxxx.ngrok-free.app をコピー
 *   4. LINE Developers Console → Messaging API設定 → Webhook URL に
 *        https://xxxx.ngrok-free.app/webhook を設定
 *   5. スマホの LINE で公式アカウントにメッセージを送信 or 友達追加
 *   6. コンソールに userId と displayName が表示されることを確認
 *   7. エルメ管理画面でメッセージが届いていることを確認
 *   8. 検証後は Webhook URL を本番用（Supabase Edge Functions URL）に変更
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import 'dotenv/config';

const PORT = 3000;
const ELME_WEBHOOK_URL = 'https://cb.lmes.jp/line/callback/add/208194';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '';

async function getProfile(userId: string): Promise<string> {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    return '(LINE_CHANNEL_ACCESS_TOKEN未設定)';
  }
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) return '(プロフィール取得失敗)';
    const data = await res.json() as { displayName: string };
    return data.displayName;
  } catch {
    return '(プロフィール取得エラー)';
  }
}

async function forwardToElme(rawBody: string, headers: IncomingMessage['headers']): Promise<void> {
  try {
    const res = await fetch(ELME_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // LINE の署名ヘッダーをそのまま転送（エルメ側の署名検証に必要）
        ...(headers['x-line-signature']
          ? { 'x-line-signature': headers['x-line-signature'] as string }
          : {}),
      },
      body: rawBody,
    });
    console.log(`[エルメ転送] ステータス: ${res.status}`);
  } catch (e) {
    console.error('[エルメ転送] エラー:', e);
  }
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', async () => {
      // まず LINE に 200 を即返す（タイムアウト防止）
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');

      try {
        const payload = JSON.parse(body) as {
          events: Array<{
            type: string;
            source?: { userId?: string; type: string };
          }>;
        };

        // userId の抽出とプロフィール取得
        const userIds = new Set<string>();
        for (const event of payload.events ?? []) {
          const userId = event.source?.userId;
          if (userId) userIds.add(userId);
        }

        for (const userId of userIds) {
          const displayName = await getProfile(userId);
          console.log('\n==============================');
          console.log('✅ ユーザー検出');
          console.log(`  userId:      ${userId}`);
          console.log(`  displayName: ${displayName}`);
          console.log('==============================');
          console.log('[TODO] 本番ではここで Supabase の line_users へ upsert する');
        }

        // エルメへ転送
        await forwardToElme(body, req.headers);

      } catch (e) {
        console.error('[解析エラー]', e);
      }
    });
  } else {
    res.writeHead(200);
    res.end('LINE Webhook proxy is running');
  }
});

server.listen(PORT, () => {
  console.log(`\nプロキシサーバー起動: http://localhost:${PORT}/webhook`);
  console.log('');
  console.log('【次のステップ】');
  console.log('  1. 別ターミナルで: npx ngrok http 3000');
  console.log('  2. ngrok の https://xxxx.ngrok-free.app/webhook を');
  console.log('     LINE Developers Console の Webhook URL に設定');
  console.log('  3. LINEで公式アカウントにメッセージを送信');
  console.log('  4. ここに userId + displayName が表示され、');
  console.log('     エルメにもメッセージが届けばプロキシ成功');
  console.log('');
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.warn('⚠️  .env に LINE_CHANNEL_ACCESS_TOKEN が未設定です');
    console.warn('   設定すると displayName も取得できます');
  }
});
