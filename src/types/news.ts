export type NewsCategoryId =
  | 'politics'
  | 'economy'
  | 'social'
  | 'narcotics'
  | 'security'
  | 'weather'
  | 'migrant';

export type SourceTier = 'official-public' | 'mainstream-credible' | 'local-neutral';

export interface NewsCategoryMeta {
  id: NewsCategoryId;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  bgColor: string;
}

export interface RawNewsCandidate {
  title: string;
  summary?: string;
  link: string;
  sourceName: string;
  publishedAt: string; // ISO string
  queryHintCategory?: NewsCategoryId;
}

export interface CuratedNewsItem {
  id: string;
  category: NewsCategoryId;
  title: string;
  summary: string;
  link: string;
  sourceName: string;
  sourceTier: SourceTier;
  publishedAt: string; // ISO string
  provinces: string[];
  districtHint?: string;
  score: number;
}

export interface NewsCurationStats {
  totalChecked: number;
  acceptedCount: number;
  excludedDramaCount: number;
  excludedSourceCount: number;
  excludedStaleCount: number;
  excludedOutOfAreaCount: number;
  excludedDuplicateCount: number;
}

export interface DailyNewsFeed {
  generatedAt: string;
  windowHours: number;
  items: CuratedNewsItem[];
  stats: NewsCurationStats;
  sourceMode?: 'static' | 'live-gas' | 'merged';
}

export interface NewsToIncidentDraft {
  newsId: string;
  title: string;
  summary: string;
  link: string;
  sourceName: string;
  publishedAt: string;
  newsCategory: NewsCategoryId;
  mappedIncidentCategory: string;
  province: string;
  district: string;
}

export interface IntelBrief5W1H {
  what: string;
  who: string;
  whereWhen: string;
  whyHow: string;
  assessment: string;
  sourceCode: string;
}

export interface NiaBriefSummary {
  headline: string;
  publishedLabel: string;
  paragraph: string;
  sourceCode: string;
}

export type DailyLogOrigin = 'news' | 'manual';

export interface DailyLogRecord {
  id: string;
  occurredAt: string; // YYYY-MM-DDTHH:mm
  category: NewsCategoryId;
  title: string;
  summary: string;
  province: string;
  district: string;
  subdistrict: string;
  lat: number | null;
  lng: number | null;
  sourceName: string;
  sourceLink?: string;
  reliabilityCode: string;
  entryOrigin: DailyLogOrigin;
  analystNote?: string;
  reporter: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: 'synced' | 'pending' | 'failed';
  syncError?: string;
  newsId?: string;
}

export interface DailyLogDraft {
  newsId?: string;
  category: NewsCategoryId;
  occurredAt: string;
  title: string;
  summary: string;
  province: string;
  district: string;
  sourceName: string;
  sourceLink?: string;
  reliabilityCode: string;
  entryOrigin: DailyLogOrigin;
}
