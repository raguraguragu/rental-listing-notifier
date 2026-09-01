/**
 * LINE Messaging API プッシュメッセージ 送信テスト
 *
 * 自分自身のLINEアカウントにメッセージを送信して動作確認する
 *
 * 事前準備:
 *   1. LINE Developers Console でチャネルアクセストークンを取得済み
 *   2. 送信先ユーザーID (userId) を取得する方法:
 *      - 公式LINEに自分でメッセージを送り、Webhookで受け取る
 *      - または LINE Developers Console の「Your user ID」を確認する
 *        (https://developers.line.biz/console/ → プロフィールアイコン)
 *
 * .env に以下を設定してください:
 *   LINE_CHANNEL_ACCESS_TOKEN=your_token_here
 *   LINE_USER_ID=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *
 * 実行: npx tsx experiments/line-push-message/send-test-message.ts
 */

import 'dotenv/config';

const CHANNEL_ACCESS_TOKEN = process.env['LINE_CHANNEL_ACCESS_TOKEN'];
const USER_ID = process.env['LINE_USER_ID'];

if (!CHANNEL_ACCESS_TOKEN) {
  console.error('エラー: LINE_CHANNEL_ACCESS_TOKEN を .env に設定してください');
  process.exit(1);
}
if (!USER_ID) {
  console.error('エラー: LINE_USER_ID を .env に設定してください');
  console.error('取得方法: LINE Developers Console のプロフィールアイコン → Your user ID');
  process.exit(1);
}

async function sendPushMessage(userId: string, text: string): Promise<void> {
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [
        {
          type: 'text',
          text,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`送信失敗 (${response.status} ${response.statusText}): ${errorBody}`);
  }

  const result = await response.json() as { sentMessages: { id: string }[] };
  console.log('送信成功:', result);
}

// --- ダミー物件情報 ---
const dummyListing = {
  name: 'サンプルマンション 301号室',
  address: '東京都渋谷区代々木1-2-3',
  rent: 120000,
  managementFee: 5000,
  deposit: 2,
  keyMoney: 1,
  floor: 3,
  totalFloors: 10,
  area: 35.5,
  layout: '1LDK',
  nearestStation: '代々木駅 徒歩5分',
  url: 'https://example.com/listing/12345',
};

const message = [
  '【新着物件のお知らせ】',
  '',
  `📍 ${dummyListing.name}`,
  `　住所: ${dummyListing.address}`,
  `　間取り: ${dummyListing.layout}　面積: ${dummyListing.area}㎡`,
  `　階数: ${dummyListing.floor}F / ${dummyListing.totalFloors}F`,
  `　最寄り: ${dummyListing.nearestStation}`,
  '',
  `💰 賃料: ${dummyListing.rent.toLocaleString()}円`,
  `　管理費: ${dummyListing.managementFee.toLocaleString()}円`,
  `　敷金: ${dummyListing.deposit}ヶ月　礼金: ${dummyListing.keyMoney}ヶ月`,
  '',
  `🔗 ${dummyListing.url}`,
  '',
  `送信日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
].join('\n');

console.log(`送信先 userId: ${USER_ID}`);
console.log(`メッセージ:\n${message}`);
console.log('送信中...');

await sendPushMessage(USER_ID, message);
