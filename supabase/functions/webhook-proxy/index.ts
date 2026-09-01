/**
 * LINE Webhook プロキシ — Supabase Edge Function
 *
 * 役割:
 *   1. LINE から Webhook を受信し、署名を検証する
 *   2. userId + displayName を Supabase の line_users テーブルへ upsert する
 *   3. エルメへリクエストをそのまま転送する
 *
 * 必要な環境変数 (Supabase ダッシュボード → Settings → Edge Functions → Secrets):
 *   LINE_CHANNEL_SECRET         — LINE チャンネルシークレット（署名検証用）
 *   LINE_CHANNEL_ACCESS_TOKEN   — LINE チャンネルアクセストークン（プロフィール取得用）
 *   ELME_WEBHOOK_URL            — エルメの Webhook URL
 *
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は Edge Functions 内で自動注入されます。
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

// Supabase Edge Runtime の waitUntil 宣言
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LINE_CHANNEL_SECRET = Deno.env.get('LINE_CHANNEL_SECRET')!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')!;
const ELME_WEBHOOK_URL = Deno.env.get('ELME_WEBHOOK_URL')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ────────────────────────────────────────────────────────────
// LINE 署名検証
// HMAC-SHA256(channelSecret, requestBody) を Base64 エンコードしたものと比較する
// ────────────────────────────────────────────────────────────
async function verifyLineSignature(body: string, signature: string): Promise<boolean> {
  if (!LINE_CHANNEL_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(LINE_CHANNEL_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}

// ────────────────────────────────────────────────────────────
// LINE プロフィール取得
// ────────────────────────────────────────────────────────────
async function getDisplayName(userId: string): Promise<string> {
  if (!LINE_CHANNEL_ACCESS_TOKEN) return '';
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) {
      console.error(`[プロフィール取得失敗] userId=${userId} status=${res.status}`);
      return '';
    }
    const data = await res.json() as { displayName?: string };
    return data.displayName ?? '';
  } catch (e) {
    console.error('[プロフィール取得エラー]', e);
    return '';
  }
}

// ────────────────────────────────────────────────────────────
// Supabase への upsert
// ────────────────────────────────────────────────────────────
async function upsertLineUser(
  userId: string,
  displayName: string,
  eventType: string,
): Promise<void> {
  const { error } = await supabase.from('line_users').upsert(
    {
      user_id: userId,
      display_name: displayName,
      event_type: eventType,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) {
    console.error('[Supabase upsert エラー]', error);
  } else {
    console.log(`[line_users upsert 完了] userId=${userId} displayName=${displayName}`);
  }
}

// ────────────────────────────────────────────────────────────
// エルメへ転送
// ────────────────────────────────────────────────────────────
async function forwardToElme(body: string, signature: string): Promise<void> {
  if (!ELME_WEBHOOK_URL) {
    console.warn('[エルメ転送] ELME_WEBHOOK_URL が未設定のためスキップ');
    return;
  }
  try {
    const res = await fetch(ELME_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': signature,
      },
      body,
    });
    console.log(`[エルメ転送 完了] status=${res.status}`);
  } catch (e) {
    console.error('[エルメ転送 エラー]', e);
  }
}

// ────────────────────────────────────────────────────────────
// メイン処理（200 返却後にバックグラウンド実行）
// ────────────────────────────────────────────────────────────
async function processWebhook(body: string, signature: string): Promise<void> {
  type LineEvent = {
    type: string;
    source?: { userId?: string; type: string };
  };
  type LinePayload = { events?: LineEvent[] };

  let payload: LinePayload;
  try {
    payload = JSON.parse(body) as LinePayload;
  } catch (e) {
    console.error('[JSON パースエラー]', e);
    return;
  }

  const seen = new Set<string>();
  for (const event of payload.events ?? []) {
    const userId = event.source?.userId;
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);

    const displayName = await getDisplayName(userId);
    await upsertLineUser(userId, displayName, event.type);
  }

  await forwardToElme(body, signature);
}

// ────────────────────────────────────────────────────────────
// エントリーポイント
// ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // LINE の疎通確認 GET リクエストに応答
  if (req.method === 'GET') {
    return new Response('LINE Webhook Proxy is running', { status: 200 });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const signature = req.headers.get('x-line-signature') ?? '';
  const body = await req.text();

  // 署名検証（なりすまし防止）
  const valid = await verifyLineSignature(body, signature);
  if (!valid) {
    console.error('[署名検証失敗] 不正なリクエストを拒否');
    return new Response('Unauthorized', { status: 401 });
  }

  // LINE に 200 を即返しつつ、バックグラウンドで処理を続ける
  EdgeRuntime.waitUntil(processWebhook(body, signature));

  return new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
