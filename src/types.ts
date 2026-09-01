export type CustomerSearchCondition = {
  id: string;
  lineUserId: string;
  name: string;
  atbbSavedConditionId?: string | null;
  searchUrl?: string | null;
};

export type PropertyListing = {
  sourceId?: string | null;
  name: string;
  roomNumber?: string | null;
  address: string;
  floor?: string | null;
  layout?: string | null;
  areaSquareMeters?: number | null;
  rentYen?: number | null;
  managementFeeYen?: number | null;
  nearestStation?: string | null;
  detailUrl?: string | null;
  /** ATBBインフォシートの絶対URL（スクリーンショット取得に使用） */
  infoSheetUrl?: string | null;
  managementCompany?: string | null;
  isNew?: boolean | null;
};

export type NotificationResult = {
  delivered: boolean;
  providerMessageId?: string;
};