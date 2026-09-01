import { describe, expect, it } from 'vitest';
import { parseRentYen } from '../src/atbb/client.js';
import { formatListingMessage } from '../src/message.js';
import { createPropertyFingerprint } from '../src/propertyKey.js';
import type { PropertyListing } from '../src/types.js';

const baseListing: PropertyListing = {
  name: 'サンプルマンション',
  roomNumber: '301',
  address: '東京都渋谷区1-2-3',
  floor: '3階',
  layout: '1LDK',
  areaSquareMeters: 42.3,
  rentYen: 85000,
  managementFeeYen: 5000,
  nearestStation: '渋谷駅 徒歩7分',
  managementCompany: '管理会社サンプル'
};

describe('createPropertyFingerprint', () => {
  it('家賃や管理費が変わっても同じ物件として扱う', () => {
    const changedRent = {
      ...baseListing,
      rentYen: 90000,
      managementFeeYen: 6000
    };

    expect(createPropertyFingerprint(changedRent)).toBe(createPropertyFingerprint(baseListing));
  });

  it('部屋番号が変わっても（広さ・間取りが同じなら）同じ物件として扱う', () => {
    const anotherRoom = {
      ...baseListing,
      roomNumber: '302'
    };

    expect(createPropertyFingerprint(anotherRoom)).toBe(createPropertyFingerprint(baseListing));
  });

  it('階数が変わっても（広さ・間取りが同じなら）同じ物件として扱う', () => {
    const anotherFloor = {
      ...baseListing,
      roomNumber: '501',
      floor: '5階'
    };

    expect(createPropertyFingerprint(anotherFloor)).toBe(createPropertyFingerprint(baseListing));
  });

  it('間取りが違えば別物件として扱う', () => {
    const anotherLayout = { ...baseListing, layout: '2LDK' };

    expect(createPropertyFingerprint(anotherLayout)).not.toBe(createPropertyFingerprint(baseListing));
  });

  it('専有面積が違えば別物件として扱う', () => {
    const anotherArea = { ...baseListing, areaSquareMeters: 55.0 };

    expect(createPropertyFingerprint(anotherArea)).not.toBe(createPropertyFingerprint(baseListing));
  });

  it('掲載業者違いで sourceId が異なっても同じ物件として扱う', () => {
    const agencyA = { ...baseListing, sourceId: 'seigyo-A' };
    const agencyB = { ...baseListing, sourceId: 'seigyo-B' };

    expect(createPropertyFingerprint(agencyA)).toBe(createPropertyFingerprint(agencyB));
  });

  it('建物名の表記ゆれ（英語/カナ・全角/半角・括弧内注記）を同一視する', () => {
    const fullWidthWithReading: PropertyListing = {
      ...baseListing,
      name: 'Ｌｕｐｉｎｕｓ（ルピナス）',
      roomNumber: '１０３'
    };
    const halfWidth: PropertyListing = {
      ...baseListing,
      name: 'Lupinus',
      roomNumber: '103'
    };

    expect(createPropertyFingerprint(fullWidthWithReading)).toBe(
      createPropertyFingerprint(halfWidth)
    );
  });
});

describe('formatListingMessage', () => {
  it('管理会社情報を通知文に含めない', () => {
    expect(formatListingMessage(baseListing)).not.toContain('管理会社サンプル');
  });

  it('rentYen が設定されていれば賃料が通知文に含まれる', () => {
    expect(formatListingMessage(baseListing)).toContain('賃料');
  });

  it('rentYen が null のとき賃料行を含めない', () => {
    const noRent = { ...baseListing, rentYen: null };
    expect(formatListingMessage(noRent)).not.toContain('賃料');
  });
});

describe('parseRentYen', () => {
  it('万円形式を円に変換する', () => {
    expect(parseRentYen('13万円')).toBe(130000);
    expect(parseRentYen('8.5万円')).toBe(85000);
  });

  it('全角数字・全角万円も変換できる', () => {
    expect(parseRentYen('１３万円')).toBe(130000);
  });

  it('円単位の数字をそのまま返す', () => {
    expect(parseRentYen('130000')).toBe(130000);
  });

  it('null / 空文字は null を返す', () => {
    expect(parseRentYen(null)).toBeNull();
    expect(parseRentYen('')).toBeNull();
  });
});