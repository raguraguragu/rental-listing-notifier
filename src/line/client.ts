import type { NotificationResult } from '../types.js';

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

export class LineMessagingClient {
  constructor(private readonly channelAccessToken: string) {}

  async sendMessage(lineUserId: string, message: string): Promise<NotificationResult> {
    const response = await fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.channelAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [
          {
            type: 'text',
            text: message
          }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LINE送信に失敗しました: ${response.status} ${body}`);
    }

    const data = await response.json().catch(() => ({})) as { sentMessages?: Array<{ id: string }> };
    return { delivered: true, providerMessageId: data.sentMessages?.[0]?.id };
  }

  /**
   * 画像URLのリストをLINE画像メッセージとして送信する。
   * LINE は1リクエストで最大5メッセージのため、5件ごとに分割して送信する。
   * @param imageUrls HTTPS で公開された JPEG/PNG の URL 一覧
   */
  async sendImages(lineUserId: string, imageUrls: string[]): Promise<NotificationResult> {
    if (imageUrls.length === 0) {
      return { delivered: false };
    }

    // 5件ずつバッチ送信
    const batchSize = 5;
    let lastResult: NotificationResult = { delivered: false };

    for (let i = 0; i < imageUrls.length; i += batchSize) {
      const batch = imageUrls.slice(i, i + batchSize);
      const messages = batch.map((url) => ({
        type: 'image' as const,
        originalContentUrl: url,
        previewImageUrl: url,
      }));

      const response = await fetch(LINE_PUSH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.channelAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to: lineUserId, messages }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`LINE画像送信に失敗しました: ${response.status} ${body}`);
      }

      const data = await response.json().catch(() => ({})) as { sentMessages?: Array<{ id: string }> };
      lastResult = { delivered: true, providerMessageId: data.sentMessages?.[0]?.id };
    }

    return lastResult;
  }
}