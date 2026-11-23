/**
 * Core data models for the Southern Border Provinces Situation Reporting System.
 */

export type SyncStatus = 'synced' | 'pending' | 'failed';

export type CoordinateFormat =
  | 'latlng'
  | 'google-maps-url'
  | 'dms'
  | 'mgrs'
  | 'utm'
  | 'map-pick';

export interface ParsedCoordinate {
  lat: number;
  lng: number;
  format: CoordinateFormat;
  mgrs: string;
  utm: string;
  rawMatched: string;
}

export interface AreaMatch {
  province: string;
  district: string;
  subdistrict: string;
  code: string;
  inTargetArea: boolean;
  source: 'local-boundary' | 'manual' | 'text-extracted' | 'outside';
}

export interface IncidentRecord {
  id: string;
  occurredAt: string; // ISO local datetime string YYYY-MM-DDTHH:mm
  coordinateRaw: string;
  lat: number | null;
  lng: number | null;
  mgrs: string;
  utm: string;
  province: string;
  district: string;
  subdistrict: string;
  inTargetArea: boolean;
  category: string;
  details: string;
  reporter: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  syncStatus: SyncStatus;
  lastSyncAttempt?: string;
  syncError?: string;
  sourceSheet?: 'local' | 'ipb' | 'legacy';
  legacyRowNumber?: number;
  eventCount?: number;
  batchId?: string;
}

export interface MultiAreaDraftItem {
  id: string;
  occurredAt: string;
  category: string;
  province: string;
  district: string;
  subdistrict: string;
  lat: number | null;
  lng: number | null;
  eventCount: number;
  details: string;
  damageSummary: string;
  casualtiesSummary: string;
  coordMatched: boolean;
  areaMatched: boolean;
}

export interface MultiAreaParseResult {
  occurredAt?: string;
  province?: string;
  reportedTotalCount?: number;
  items: MultiAreaDraftItem[];
  matchedHints: string[];
  warnings: string[];
}

export interface GasFieldMapping {
  id: string;
  occurredAt: string;
  occurredAtBE: string;
  coordinateRaw: string;
  lat: string;
  lng: string;
  mgrs: string;
  utm: string;
  province: string;
  district: string;
  subdistrict: string;
  inTargetArea: string;
  category: string;
  details: string;
  reporter: string;
  createdAt: string;
}

export interface AppSettings {
  systemTitle: string;
  agencyName: string;
  agencySubtitle: string;
  gasWebhookUrl: string;
  gasFetchUrl: string;
  autoSyncOnSave: boolean;
  categories: string[];
  fieldMapping: GasFieldMapping;
  defaultReporter: string;
  offlinePmtilesUrl?: string;
  legacyDualWrite: boolean;
  legacySheetName: string;
  ipbSheetName: string;
  legacyIncidentType: string;
  legacySendLine: boolean;
  autoPullOnLoad: boolean;
}

export interface PaperParseResult {
  occurredAt?: string;
  province?: string;
  district?: string;
  subdistrict?: string;
  category?: string;
  coordinate?: ParsedCoordinate;
  matchedHints: string[];
}
