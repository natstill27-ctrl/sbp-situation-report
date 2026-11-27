import newsRules from '../data/newsRules.json';
import type { AppSettings } from '../types/incident';
import type { CuratedNewsItem, DailyNewsFeed, NewsCategoryId } from '../types/news';
import { curateRawNewsItems } from './newsCurator';

export interface FetchNewsFeedResult {
  feed: DailyNewsFeed;
  error?: string;
}

function createEmptyFeed(): DailyNewsFeed {
  return {
    generatedAt: new Date().toISOString(),
    windowHours: 72,
    items: [],
    stats: {
      totalChecked: 0,
      acceptedCount: 0,
      excludedDramaCount: 0,
      excludedSourceCount: 0,
      excludedStaleCount: 0,
      excludedOutOfAreaCount: 0,
      excludedDuplicateCount: 0,
    },
    sourceMode: 'static',
  };
}

function normalizeFeedPayload(raw: unknown, fallbackMode: 'static' | 'live-gas'): DailyNewsFeed {
  if (!raw || typeof raw !== 'object') return createEmptyFeed();
  const obj = raw as Partial<DailyNewsFeed>;
  const items = Array.isArray(obj.items) ? (obj.items as CuratedNewsItem[]) : [];
  return {
    generatedAt: typeof obj.generatedAt === 'string' ? obj.generatedAt : new Date().toISOString(),
    windowHours: typeof obj.windowHours === 'number' ? obj.windowHours : 72,
    items,
    stats: obj.stats || {
      totalChecked: items.length,
      acceptedCount: items.length,
      excludedDramaCount: 0,
      excludedSourceCount: 0,
      excludedStaleCount: 0,
      excludedOutOfAreaCount: 0,
      excludedDuplicateCount: 0,
    },
    sourceMode: obj.sourceMode || fallbackMode,
  };
}

function mergeFeeds(primary: DailyNewsFeed, secondary: DailyNewsFeed): DailyNewsFeed {
  const map = new Map<string, CuratedNewsItem>();
  for (const item of secondary.items) {
    map.set(item.id, item);
  }
  for (const item of primary.items) {
    map.set(item.id, item);
  }
  const merged = Array.from(map.values()).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
  return {
    generatedAt: primary.generatedAt || secondary.generatedAt,
    windowHours: Math.max(primary.windowHours, secondary.windowHours),
    items: merged,
    stats: {
      totalChecked: Math.max(primary.stats.totalChecked, merged.length),
      acceptedCount: merged.length,
      excludedDramaCount: primary.stats.excludedDramaCount + secondary.stats.excludedDramaCount,
      excludedSourceCount: primary.stats.excludedSourceCount + secondary.stats.excludedSourceCount,
      excludedStaleCount: Math.max(primary.stats.excludedStaleCount, secondary.stats.excludedStaleCount),
      excludedOutOfAreaCount: Math.max(
        primary.stats.excludedOutOfAreaCount,
        secondary.stats.excludedOutOfAreaCount
      ),
      excludedDuplicateCount:
        primary.stats.excludedDuplicateCount + secondary.stats.excludedDuplicateCount,
    },
    sourceMode: primary.items.length > 0 && secondary.items.length > 0 ? 'merged' : primary.sourceMode,
  };
}

/**
 * Load daily curated news from static `./daily-news.json` and optionally live GAS `?page=news`.
 */
export async function fetchDailyNewsFeed(
  settings: AppSettings,
  options: { preferLiveGas?: boolean; bustCache?: boolean } = {}
): Promise<FetchNewsFeedResult> {
  let staticFeed = createEmptyFeed();
  let staticError: string | undefined;

  try {
    const staticUrl = options.bustCache ? `./daily-news.json?t=${Date.now()}` : './daily-news.json';
    const res = await fetch(staticUrl, { method: 'GET' });
    if (res.ok) {
      const json = (await res.json()) as unknown;
      staticFeed = normalizeFeedPayload(json, 'static');
    } else {
      staticError = `ไม่สามารถโหลดไฟล์ข่าวประจำวัน (HTTP ${res.status})`;
    }
  } catch (err) {
    staticError = err instanceof Error ? err.message : 'ไม่สามารถโหลดไฟล์ข่าวประจำวันได้';
  }

  const baseGasUrl = (settings.gasFetchUrl || settings.gasWebhookUrl).trim();
  if (options.preferLiveGas && baseGasUrl) {
    try {
      const sep = baseGasUrl.includes('?') ? '&' : '?';
      const gasUrl = `${baseGasUrl}${sep}page=news`;
      const gasRes = await fetch(gasUrl, { method: 'GET' });
      if (gasRes.ok) {
        const text = await gasRes.text();
        const parsed = JSON.parse(text) as {
          ok?: boolean;
          rawItems?: Array<{
            title: string;
            summary?: string;
            link: string;
            sourceName: string;
            publishedAt: string;
            queryHintCategory?: NewsCategoryId;
          }>;
          items?: CuratedNewsItem[];
          generatedAt?: string;
          windowHours?: number;
        };

        if (parsed.ok !== false) {
          if (Array.isArray(parsed.rawItems) && parsed.rawItems.length > 0) {
            const curated = curateRawNewsItems(parsed.rawItems, { windowHours: 168 });
            const liveFeed: DailyNewsFeed = {
              generatedAt: parsed.generatedAt || new Date().toISOString(),
              windowHours: parsed.windowHours || 168,
              items: curated.items,
              stats: curated.stats,
              sourceMode: 'live-gas',
            };
            return { feed: mergeFeeds(liveFeed, staticFeed) };
          }
          if (Array.isArray(parsed.items) && parsed.items.length > 0) {
            const liveFeed = normalizeFeedPayload(parsed, 'live-gas');
            return { feed: mergeFeeds(liveFeed, staticFeed) };
          }
        }
      }
    } catch {
      // Fall back gracefully to staticFeed when GAS ?page=news is not yet deployed
    }
  }

  return {
    feed: staticFeed,
    ...(staticFeed.items.length === 0 && staticError ? { error: staticError } : {}),
  };
}

export function getVettedSourcesSummary(): {
  official: string[];
  mainstream: string[];
  local: string[];
} {
  return {
    official: newsRules.sources['official-public'],
    mainstream: newsRules.sources['mainstream-credible'],
    local: newsRules.sources['local-neutral'],
  };
}
