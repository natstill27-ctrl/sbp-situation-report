import newsRules from '../data/newsRules.json';
import type {
  CuratedNewsItem,
  NewsCategoryId,
  NewsCategoryMeta,
  NewsCurationStats,
  RawNewsCandidate,
  SourceTier,
} from '../types/news';

export const NEWS_CATEGORIES: NewsCategoryMeta[] = [
  {
    id: 'politics',
    label: 'การเมือง',
    shortLabel: 'การเมือง',
    description: 'ความเคลื่อนไหวทางการเมือง ท้องถิ่น อบจ./เทศบาล การเลือกตั้ง นโยบายภาครัฐ',
    color: '#1d4ed8',
    bgColor: '#dbeafe',
  },
  {
    id: 'economy',
    label: 'เศรษฐกิจ',
    shortLabel: 'เศรษฐกิจ',
    description: 'การค้าชายแดน ยางพารา-ปาล์ม ท่องเที่ยว การลงทุน โลจิสติกส์ และสินค้าหนีภาษี',
    color: '#0f766e',
    bgColor: '#ccfbf1',
  },
  {
    id: 'social',
    label: 'สังคมและประชาคม',
    shortLabel: 'สังคม/ประชาคม',
    description: 'ภัยพิบัติ/อุทกภัย สาธารณสุข การศึกษา แรงงาน ประชาคม และการพัฒนาชุมชน',
    color: '#7c3aed',
    bgColor: '#ede9fe',
  },
  {
    id: 'narcotics',
    label: 'ยาเสพติด',
    shortLabel: 'ยาเสพติด',
    description: 'การสกัดกั้น จับกุม ตรวจยึด เครือข่ายลำเลียงยาเสพติดพื้นที่ชายแดนและภาคใต้',
    color: '#c2410c',
    bgColor: '#ffedd5',
  },
  {
    id: 'security',
    label: 'ความมั่นคงและเหตุรุนแรง',
    shortLabel: 'ความมั่นคง',
    description: 'สถานการณ์ความมั่นคง กอ.รมน.ภาค 4 สน. ปะทะ ระเบิด ลอบยิง และเหตุรุนแรง',
    color: '#b91c1c',
    bgColor: '#fee2e2',
  },
];

export const NEWS_CATEGORY_MAP: Record<NewsCategoryId, NewsCategoryMeta> = {
  politics: NEWS_CATEGORIES[0],
  economy: NEWS_CATEGORIES[1],
  social: NEWS_CATEGORIES[2],
  narcotics: NEWS_CATEGORIES[3],
  security: NEWS_CATEGORIES[4],
};

export const SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  'official-public': 'สื่อสาธารณะ/หน่วยงานรัฐ',
  'mainstream-credible': 'สื่อหลักระดับประเทศ',
  'local-neutral': 'สื่อท้องถิ่นเป็นกลาง',
};

const TIER_PRIORITY: Record<SourceTier, number> = {
  'official-public': 3,
  'mainstream-credible': 2,
  'local-neutral': 1,
};

const BLOCKLIST_LOWER = newsRules.sourceBlocklist.map((s) => s.toLowerCase());

const DRAMA_REGEXES = newsRules.dramaRejectionPatterns.map((p) => new RegExp(p, 'i'));

const PROVINCE_ALIASES = newsRules.provinceAliases as Record<string, string>;

export interface SourceEvaluation {
  accepted: boolean;
  tier?: SourceTier;
  normalizedName: string;
}

/**
 * Evaluate a news outlet against the strict editorial allowlist/blocklist.
 * Rejects social-media aggregators, tabloids, and unvetted outlets.
 */
export function evaluateNewsSource(rawSourceName: string): SourceEvaluation {
  const clean = (rawSourceName || '').trim();
  if (!clean) {
    return { accepted: false, normalizedName: '' };
  }
  const lower = clean.toLowerCase();

  for (const blocked of BLOCKLIST_LOWER) {
    if (lower.includes(blocked)) {
      return { accepted: false, normalizedName: clean };
    }
  }

  const tiers: SourceTier[] = ['official-public', 'mainstream-credible', 'local-neutral'];
  for (const tier of tiers) {
    const list = newsRules.sources[tier] || [];
    for (const allowed of list) {
      const allowedLower = allowed.toLowerCase();
      if (lower === allowedLower || lower.includes(allowedLower) || allowedLower.includes(lower)) {
        return { accepted: true, tier, normalizedName: clean };
      }
    }
  }

  return { accepted: false, normalizedName: clean };
}

/**
 * Detect village gossip, family/relationship drama, superstition/lottery, celebrity, sports, or promo content.
 */
export function isTabloidOrDramaNews(title: string, summary = ''): boolean {
  const combined = `${title || ''} ${summary || ''}`.replace(/\s+/g, ' ').trim();
  if (!combined) return false;
  return DRAMA_REGEXES.some((rx) => rx.test(combined));
}

/**
 * Extract Wing 56 AOR provinces (7 lower-southern provinces) mentioned directly or via district/landmark aliases.
 */
export function extractWing56Provinces(text: string): string[] {
  const found = new Set<string>();
  const clean = (text || '').replace(/\s+/g, ' ');

  for (const prov of newsRules.provinces) {
    if (clean.includes(prov)) {
      found.add(prov);
    }
  }

  for (const [alias, prov] of Object.entries(PROVINCE_ALIASES)) {
    if (clean.includes(alias)) {
      found.add(prov);
    }
  }

  return newsRules.provinces.filter((p) => found.has(p));
}

/**
 * Extract an unambiguous district hint from a news headline/summary if present.
 */
export function extractNewsDistrictHint(text: string): string {
  const clean = (text || '').replace(/\s+/g, ' ');
  for (const alias of Object.keys(PROVINCE_ALIASES)) {
    if (alias === 'กองบิน 56') {
      if (clean.includes(alias)) return 'คลองหอยโข่ง';
      continue;
    }
    if (alias === 'ปาดังเบซาร์' || alias === 'ด่านนอก') {
      if (clean.includes(alias)) return 'สะเดา';
      continue;
    }
    if (alias === 'ปากบารา') {
      if (clean.includes(alias)) return 'ละงู';
      continue;
    }
    if (alias === 'มูโนะ') {
      if (clean.includes(alias)) return 'สุไหงโก-ลก';
      continue;
    }
    if (alias === 'สุไหงโกลก') {
      if (clean.includes(alias)) return 'สุไหงโก-ลก';
      continue;
    }
    if (clean.includes(alias)) {
      return alias;
    }
  }
  return '';
}

function hasGeneralLowerSouthReference(text: string): boolean {
  return newsRules.generalRegionTerms.some((term) => text.includes(term));
}

/**
 * Classify a news item into one of the 5 intelligence domains using weighted keyword scoring.
 */
export function classifyNewsCategory(
  title: string,
  summary = '',
  hintCategory?: NewsCategoryId
): { category: NewsCategoryId; score: number } {
  const titleText = (title || '').trim();
  const bodyText = (summary || '').trim();

  const scores: Record<NewsCategoryId, number> = {
    politics: 0,
    economy: 0,
    social: 0,
    narcotics: 0,
    security: 0,
  };

  const kwMap = newsRules.categoryKeywords as Record<NewsCategoryId, Array<[string, number]>>;
  for (const catId of Object.keys(kwMap) as NewsCategoryId[]) {
    for (const [kw, weight] of kwMap[catId]) {
      if (titleText.includes(kw)) {
        scores[catId] += weight * 2;
      } else if (bodyText.includes(kw)) {
        scores[catId] += weight;
      }
    }
  }

  // Prevent disaster/emergency/health news led by a Governor ("ผู้ว่าฯ ลงพื้นที่น้ำท่วม") from misclassifying as politics
  if (
    scores.social >= 6 &&
    /(น้ำท่วม|อุทกภัย|สถานการณ์น้ำ|ระดับน้ำ|ระบายน้ำ|ผู้ประสบภัย|ฝนตกหนัก|สาธารณสุข|โรคระบาด|กรมควบคุมโรค)/.test(
      titleText
    )
  ) {
    scores.social += 6;
  }

  let bestCat: NewsCategoryId = hintCategory || 'social';
  let bestScore = 0;
  const order: NewsCategoryId[] = ['narcotics', 'security', 'economy', 'politics', 'social'];
  for (const catId of order) {
    if (scores[catId] > bestScore) {
      bestScore = scores[catId];
      bestCat = catId;
    }
  }

  return { category: bestCat, score: bestScore };
}

function normalizeTitleForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/["'“”‘’()[\]{}:;.,!?-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNearDuplicateTitle(a: string, b: string): boolean {
  const na = normalizeTitleForDedup(a);
  const nb = normalizeTitleForDedup(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 24 && nb.length >= 24) {
    if (na.includes(nb.slice(0, 28)) || nb.includes(na.slice(0, 28))) {
      return true;
    }
  }
  const wordsA = new Set(na.split(' ').filter((w) => w.length >= 2));
  const wordsB = new Set(nb.split(' ').filter((w) => w.length >= 2));
  if (wordsA.size < 3 || wordsB.size < 3) return false;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const ratio = overlap / Math.min(wordsA.size, wordsB.size);
  return ratio >= 0.72;
}

function buildNewsId(title: string, publishedAt: string): string {
  const seed = `${publishedAt.slice(0, 10)}|${normalizeTitleForDedup(title).slice(0, 64)}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `NEWS-${(hash >>> 0).toString(36).toUpperCase()}`;
}

export interface CurateOptions {
  nowMs?: number;
  windowHours?: number;
}

/**
 * Filter, classify, deduplicate, and sort raw news candidates into curated daily intelligence items.
 */
export function curateRawNewsItems(
  candidates: RawNewsCandidate[],
  options: CurateOptions = {}
): { items: CuratedNewsItem[]; stats: NewsCurationStats } {
  const nowMs = options.nowMs ?? Date.now();
  const windowHours = options.windowHours ?? 72;
  const minPublishedMs = nowMs - windowHours * 60 * 60 * 1000;

  const stats: NewsCurationStats = {
    totalChecked: candidates.length,
    acceptedCount: 0,
    excludedDramaCount: 0,
    excludedSourceCount: 0,
    excludedStaleCount: 0,
    excludedOutOfAreaCount: 0,
    excludedDuplicateCount: 0,
  };

  const accepted: CuratedNewsItem[] = [];

  for (const raw of candidates) {
    const title = (raw.title || '').replace(/\s+/g, ' ').trim();
    const summary = (raw.summary || '').replace(/\s+/g, ' ').trim();
    if (!title) continue;

    const sourceEval = evaluateNewsSource(raw.sourceName);
    if (!sourceEval.accepted || !sourceEval.tier) {
      stats.excludedSourceCount++;
      continue;
    }

    if (isTabloidOrDramaNews(title, summary)) {
      stats.excludedDramaCount++;
      continue;
    }

    const pubMs = new Date(raw.publishedAt).getTime();
    if (Number.isNaN(pubMs) || pubMs < minPublishedMs || pubMs > nowMs + 12 * 60 * 60 * 1000) {
      stats.excludedStaleCount++;
      continue;
    }

    const combinedText = `${title} ${summary}`;
    const provinces = extractWing56Provinces(combinedText);
    if (provinces.length === 0 && !hasGeneralLowerSouthReference(combinedText)) {
      stats.excludedOutOfAreaCount++;
      continue;
    }

    const { category, score } = classifyNewsCategory(title, summary, raw.queryHintCategory);
    if (score < 4) {
      stats.excludedDramaCount++;
      continue;
    }
    const districtHint = extractNewsDistrictHint(combinedText);

    const candidateItem: CuratedNewsItem = {
      id: buildNewsId(title, raw.publishedAt),
      category,
      title,
      summary: summary && summary !== title ? summary : title,
      link: (raw.link || '').trim(),
      sourceName: sourceEval.normalizedName,
      sourceTier: sourceEval.tier,
      publishedAt: new Date(pubMs).toISOString(),
      provinces: provinces.length > 0 ? provinces : ['ภาคใต้ตอนล่าง'],
      ...(districtHint ? { districtHint } : {}),
      score: score + TIER_PRIORITY[sourceEval.tier],
    };

    const dupIdx = accepted.findIndex((existing) =>
      isNearDuplicateTitle(existing.title, candidateItem.title)
    );
    if (dupIdx >= 0) {
      stats.excludedDuplicateCount++;
      const existing = accepted[dupIdx];
      const existingRank = TIER_PRIORITY[existing.sourceTier] * 100 + existing.score;
      const newRank = TIER_PRIORITY[candidateItem.sourceTier] * 100 + candidateItem.score;
      if (newRank > existingRank) {
        accepted[dupIdx] = candidateItem;
      }
      continue;
    }

    accepted.push(candidateItem);
  }

  accepted.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  stats.acceptedCount = accepted.length;

  return { items: accepted, stats };
}

/**
 * Map a curated news item into the closest existing IPB incident category for 1-click import.
 */
export function mapNewsCategoryToIncidentCategory(
  item: CuratedNewsItem,
  availableCategories: string[]
): string {
  const pick = (patterns: RegExp[]): string | undefined => {
    for (const rx of patterns) {
      const found = availableCategories.find((c) => rx.test(c));
      if (found) return found;
    }
    return undefined;
  };

  if (item.category === 'narcotics') {
    return (
      pick([/ตรวจยึด|จับกุม/, /ข่าวสาร|เฝ้าระวัง/, /อื่นๆ/]) ||
      availableCategories[0] ||
      'อื่นๆ'
    );
  }
  if (item.category === 'security') {
    const text = `${item.title} ${item.summary}`;
    if (/ระเบิด|EOD|วัตถุต้องสงสัย/i.test(text)) return pick([/ระเบิด/]) || availableCategories[0];
    if (/ปะทะ|ปิดล้อม/.test(text)) return pick([/ปะทะ|ปิดล้อม/]) || availableCategories[0];
    if (/ลอบยิง|ซุ่มยิง|ใช้อาวุธปืน/.test(text)) return pick([/ปืน|ลอบยิง/]) || availableCategories[0];
    if (/กล้อง|CCTV/i.test(text)) return pick([/กล้อง|CCTV/i]) || availableCategories[0];
    if (/วางเพลิง|เผา/.test(text)) return pick([/วางเพลิง/]) || availableCategories[0];
    if (/ป้ายผ้า|ตะปู|เผายาง|ก่อกวน/.test(text)) return pick([/ก่อกวน/]) || availableCategories[0];
    if (/จับกุม|ควบคุมตัว|ตรวจยึด/.test(text)) return pick([/ตรวจยึด|จับกุม/]) || availableCategories[0];
    return pick([/ข่าวสาร|เฝ้าระวัง/, /อื่นๆ/]) || availableCategories[0] || 'อื่นๆ';
  }
  if (item.category === 'social' && /น้ำท่วม|อุทกภัย|วาตภัย|ดินถล่ม|ไฟไหม้|อุบัติเหตุ/.test(`${item.title} ${item.summary}`)) {
    return pick([/อุบัติเหตุ|ภัยพิบัติ/, /อื่นๆ/]) || availableCategories[0] || 'อื่นๆ';
  }
  return pick([/ข่าวสาร|เฝ้าระวัง/, /อื่นๆ/]) || availableCategories[0] || 'อื่นๆ';
}
