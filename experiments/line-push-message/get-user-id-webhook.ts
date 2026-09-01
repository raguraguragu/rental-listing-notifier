/**
 * LINE Webhook で userId をキャプチャするツール
 *
 * 実行手順:
 *   1. このスクリプトを起動: npx tsx experiments/line-push-message/get-user-id-webhook.ts
 *   2. 別ターミナルで ngrok を起動: npx ngrok http 3000
 *   3. ngrok が表示する https://xxxx.ngrok-free.app をコピー
 *   4. LINE Developers Console → Messaging API設定 → Webhook URL に
 *      https://xxxx.ngrok-free.app/webhook を設定
 *   5. スマホの LINE で @492kwuja にメッセージを送信
 *   6. このターミナルに userId が表示される
 *   7. 終わったら Webhook URL を元の値 (https://cb.lmes.jp/line/callback/add/208194) に戻す
 */

import { createServer } from 'node:http';

const PORT = 3000;

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body) as {
          events: Array<{ source?: { userId?: string; type: string }; type: string }>;
        };

        for (const event of payload.events ?? []) {
          const userId = event.source?.userId;
          if (userId) {
            console.log('\n==============================');
            console.log('✅ userId を取得しました！');
            console.log(`userId: ${userId}`);
            console.log('==============================');
            console.log('\n.env の LINE_USER_ID にこの値を設定してください');
          }
        }

        // LINEに200を返す（返さないとエラーになる）
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      } catch (e) {
        res.writeHead(400);
        res.end();
      }
    });
  } else {
    res.writeHead(200);
    res.end('LINE userId capture server is running');
  }
});

server.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
  console.log('');
  console.log('次のステップ:');
  console.log('  1. 別ターミナルで: npx ngrok http 3000');
  console.log('  2. ngrokのhttps URLを LINE Developers Console の Webhook URL に設定');
  console.log('     例: https://xxxx.ngrok-free.app/webhook');
  console.log('  3. スマホのLINEで @492kwuja にメッセージを送信');
  console.log('  4. ここに userId が表示されます');
});
