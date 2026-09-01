import type { PropertyListing } from './types.js';

function formatYen(value: number | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  return `${Math.round(value / 10000 * 10) / 10}万円`;
}

function formatSingleListing(listing: PropertyListing, index?: number): string {
  const header = index != null ? `【${index}件目】` : '';
  const lines = [
    header ? header : null,
    `物件名：${listing.name}${listing.roomNumber ? ` ${listing.roomNumber}` : ''}`,
    listing.address ? `住所：${listing.address}` : null,
    listing.nearestStation ? `最寄り：${listing.nearestStation}` : null,
    listing.floor ? `階数：${listing.floor}` : null,
    listing.layout ? `間取り：${listing.layout}` : null,
    listing.areaSquareMeters ? `広さ：${listing.areaSquareMeters}㎡` : null,
    formatYen(listing.rentYen) ? `賃料：${formatYen(listing.rentYen)}` : null,
    listing.managementFeeYen != null ? `管理費：${listing.managementFeeYen.toLocaleString()}円` : null,
    listing.detailUrl ? `詳細：${listing.detailUrl}` : null,
  ];

  return lines.filter((line): line is string => line !== null).join('\n');
}

export function formatListingsMessage(listings: PropertyListing[]): string {
  if (listings.length === 1) {
    return [
      '🆕 新着物件が見つかりました。',
      '',
      formatSingleListing(listings[0]!),
      '',
      '詳細をご希望でしたら、このまま返信してください。'
    ].join('\n');
  }

  const listingBlocks = listings.map((listing, i) => formatSingleListing(listing, i + 1));
  return [
    `🆕 新着物件が${listings.length}件見つかりました。`,
    '',
    listingBlocks.join('\n\n'),
    '',
    '詳細をご希望でしたら、物件番号を添えて返信してください。'
  ].join('\n');
}

/** LINEのテキストメッセージ上限 */
const MAX_LINE_MESSAGE_LENGTH = 5000;

/**
 * 物件リストを5000文字以内に収まる複数メッセージに分割して返す。
 */
export function splitListingsIntoMessages(listings: PropertyListing[]): string[] {
  if (listings.length === 0) return [];

  const messages: string[] = [];
  let batch: PropertyListing[] = [];

  for (const listing of listings) {
    const candidate = [...batch, listing];
    const msg = formatListingsMessage(candidate);
    if (msg.length > MAX_LINE_MESSAGE_LENGTH && batch.length > 0) {
      messages.push(formatListingsMessage(batch));
      batch = [listing];
    } else {
      batch = candidate;
    }
  }

  if (batch.length > 0) {
    messages.push(formatListingsMessage(batch));
  }

  return messages;
}

// 後方互換のため残す
export function formatListingMessage(listing: PropertyListing): string {
  return formatListingsMessage([listing]);
}