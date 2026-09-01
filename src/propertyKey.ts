import { createHash } from 'node:crypto';
import type { PropertyListing } from './types.js';

/**
 * 物件名・住所などの文字列を表記ゆれに強い形へ正規化する。
 * - NFKC で全角/半角（英数字・カナ・記号）を統一
 * - 小文字化で大文字/小文字を統一
 * - 括弧内の読み仮名や注記（例: Ｌｕｐｉｎｕｓ（ルピナス） → lupinus）を除去
 * - 各種ハイフン・長音記号を 1 種類へ統一
 * - 空白・区切り記号を除去
 */
function normalizeText(value: string | number | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    // 括弧内（全角・半角どちらも NFKC 後は半角）の読み仮名・注記を除去
    .replace(/[（(][^（）()]*[）)]/g, '')
    // 各種ハイフン・長音記号・ダッシュを統一
    .replace(/[－ー―—–‐\-]/g, '-')
    // 空白を除去
    .replace(/\s+/g, '')
    // 区切り記号類を除去（住所・建物名の表記ゆれ対策）
    .replace(/[、。，．,.・･／/\\&＆'’`"”]/g, '')
    .trim();
}

function normalizeArea(value: number | null | undefined): string {
  if (value == null) {
    return '';
  }

  return value.toFixed(2);
}

export function createPropertyFingerprint(listing: PropertyListing): string {
  // 同じ物件が掲載業者ごとに別IDで登録されることがあるため、
  // 掲載元ID（sourceId）ではなく物件内容を正規化したハッシュで重複判定する。
  // 表記ゆれ（英語/カナ・大文字/小文字・全角/半角・括弧内注記など）は
  // normalizeText で吸収する。
  //
  // 部屋番号・階数はハッシュに含めない。号室や階が違っても、間取りと専有面積が
  // 同じなら同一物件とみなして重複通知を避けるため。
  // 家賃・管理費も含めない（家賃変更で同じ物件が再通知されるのを避ける）。
  const stableParts = [
    listing.name,
    listing.address,
    listing.layout,
    normalizeArea(listing.areaSquareMeters)
  ].map(normalizeText);

  return createHash('sha256').update(stableParts.join('|')).digest('hex');
}