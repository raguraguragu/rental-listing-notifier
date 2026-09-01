import { createHash } from 'node:crypto';

/**
 * ログ出力用のマスク処理。
 *
 * GitHub Actions の実行ログはリポジトリを公開すると誰でも閲覧できるため、
 * 顧客の個人情報（LINEユーザーID・氏名）や ATBB の会員間情報（物件名・
 * 物件URL）をそのまま出力してはいけない。
 *
 * 一方でログは障害調査に使うため、完全に伏せるのではなく
 * 「同じ対象なら毎回同じ表記になる」形に置き換えて追跡できるようにする。
 */

/**
 * LINEユーザーIDを部分マスクする。
 * 先頭5文字と末尾4文字だけ残すので、個人は特定できないが
 * 同一ユーザーかどうかの突き合わせはできる。
 */
export function maskUserId(userId: string): string {
  if (!userId) return '(空)';
  if (userId.length <= 12) return '***';
  return `${userId.slice(0, 5)}…${userId.slice(-4)}`;
}

/**
 * 顧客名や物件名など、そのまま出すと個人情報・会員間情報になる文字列を
 * 短いハッシュに置き換える。同じ入力なら常に同じ値になる。
 */
export function maskName(value: string | null | undefined): string {
  if (!value) return '(空)';
  return `#${createHash('sha256').update(value).digest('hex').slice(0, 8)}`;
}

/**
 * URLからホストとパスだけを残す。
 * ATBBのURLはクエリ文字列に物件番号などを含むため落とす。
 */
export function maskUrl(url: string | null | undefined): string {
  if (!url) return '(空)';
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(不正なURL)';
  }
}

/** 物件指紋を短縮表示する（Storage上のファイル名と対応が取れる） */
export function shortFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, 8);
}
