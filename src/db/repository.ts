import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import type { PropertyListing } from '../types.js';

export class NotificationRepository {
  constructor(private readonly client: SupabaseClient) {}

  /** 指定の LINE ユーザーIDが line_users テーブルに登録されているか判定する */
  async lineUserExists(lineUserId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('line_users')
      .select('user_id')
      .eq('user_id', lineUserId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data != null;
  }

  async hasNotified(lineUserId: string, propertyFingerprint: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('notified_properties')
      .select('id')
      .eq('line_user_id', lineUserId)
      .eq('property_fingerprint', propertyFingerprint)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data != null;
  }

  async recordNotification(lineUserId: string, propertyFingerprint: string, listing: PropertyListing, message: string): Promise<void> {
    const { error: propertyError } = await this.client
      .from('notified_properties')
      .insert({
        line_user_id: lineUserId,
        property_fingerprint: propertyFingerprint,
        first_listing: listing
      });

    if (propertyError && propertyError.code !== '23505') {
      throw propertyError;
    }

    const { error: logError } = await this.client
      .from('notification_logs')
      .insert({
        line_user_id: lineUserId,
        property_fingerprint: propertyFingerprint,
        status: 'sent',
        message
      });

    if (logError) {
      throw logError;
    }
  }

  async recordFailure(lineUserId: string, propertyFingerprint: string, errorMessage: string): Promise<void> {
    const { error } = await this.client
      .from('notification_logs')
      .insert({
        line_user_id: lineUserId,
        property_fingerprint: propertyFingerprint,
        status: 'failed',
        error: errorMessage
      });

    if (error) {
      throw error;
    }
  }

  /**
   * JPEG 画像バッファを Supabase Storage の `property-images` バケットにアップロードし、
   * 公開 URL を返す。
   * @param imageBuffer JPEG データの Buffer
   * @param filename `{property_fingerprint}.jpg` 形式の一意なファイル名
   */
  async uploadPropertyImage(imageBuffer: Buffer, filename: string): Promise<string> {
    let { data, error } = await this.client.storage
      .from('property-images')
      .upload(filename, imageBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    // バケットが存在しない場合は作成してから再試行する
    if (error && /bucket not found/i.test(error.message)) {
      await this.ensureImageBucket();
      ({ data, error } = await this.client.storage
        .from('property-images')
        .upload(filename, imageBuffer, {
          contentType: 'image/jpeg',
          upsert: true,
        }));
    }

    if (error || !data) {
      throw new Error(`Supabase Storage アップロード失敗: ${error?.message ?? 'unknown error'}`);
    }

    const { data: { publicUrl } } = this.client.storage
      .from('property-images')
      .getPublicUrl(data.path);

    return publicUrl;
  }

  /** property-images バケットが存在しなければ作成する（パブリック） */
  private async ensureImageBucket(): Promise<void> {
    const { error } = await this.client.storage.createBucket('property-images', {
      public: true,
      fileSizeLimit: 10485760, // 10MB
      allowedMimeTypes: ['image/jpeg', 'image/png'],
    });
    // 既に存在する場合のエラーは無視する
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`Supabase Storage バケット作成失敗: ${error.message}`);
    }
  }
}

export function createNotificationRepository(config: AppConfig): NotificationRepository {
  return new NotificationRepository(createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  }));
}