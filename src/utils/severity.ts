import type { IncidentRecord } from '../types/incident';
import { THAI_MONTHS_SHORT } from './thaiDate';

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface SeverityMeta {
  level: SeverityLevel;
  rank: number;
  label: string;
  color: string;
}

export const SEVERITY_LEVELS: readonly SeverityMeta[] = [
  { level: 'critical', rank: 4, label: 'สูงสุด', color: '#ef4444' },
  { level: 'high', rank: 3, label: 'สูง', color: '#f97316' },
  { level: 'medium', rank: 2, label: 'ปานกลาง', color: '#eab308' },
  { level: 'low', rank: 1, label: 'ต่ำ', color: '#22c55e' },
] as const;

export function getIncidentWeight(item: Pick<IncidentRecord, 'eventCount'>): number {
  return item.eventCount && item.eventCount > 0 ? item.eventCount : 1;
}

/**
 * Classify incident severity into 4 tactical C2 ranks (`critical` -> `low`).
 * Respects explicit category classification first (e.g. weapons seizures remain `low` unless actual
 * casualties occurred) and strips negated casualty phrases before inspecting details.
 */
export function classifyIncidentSeverity(category: string, details = ''): SeverityMeta {
  const cat = (category || '').trim();
  const cleanedDetails = (details || '')
    .replace(/\([^)]*(?:ภาพรวมพื้นที่|ความเสียหายรวม):[^)]*\)/g, '')
    .replace(/ไม่มีผู้(?:ได้รับ)?บาดเจ็บ(?:(?:หรือ|และ)เสียชีวิต)?/g, '');

  if (/ปะทะ|ปิดล้อม|ระเบิด|ปืน|ซุ่มยิง|ซุ่มโจมตี|ลอบยิง|M79|I\.?E\.?D\.?|คาร์บอมบ์/i.test(cat)) {
    return SEVERITY_LEVELS[0];
  }
  if (/วางเพลิง|ลอบเผา/.test(cat)) {
    return SEVERITY_LEVELS[1];
  }
  if (/ข่าวสาร|ความเคลื่อนไหว|เฝ้าระวัง/.test(cat)) {
    return SEVERITY_LEVELS[2];
  }
  if (/ก่อกวน|โปรยตะปู|ตะปูเรือใบ|เผายาง/.test(cat)) {
    if (/เสียชีวิต/.test(cleanedDetails)) return SEVERITY_LEVELS[0];
    if (/บาดเจ็บ/.test(cleanedDetails)) return SEVERITY_LEVELS[1];
    return SEVERITY_LEVELS[2];
  }
  if (/ทำลายกล้อง|กล้อง\s*CCTV|กล้องวงจรปิด/i.test(cat)) {
    if (/เสียชีวิต/.test(cleanedDetails)) return SEVERITY_LEVELS[0];
    if (/บาดเจ็บ/.test(cleanedDetails)) return SEVERITY_LEVELS[1];
    return SEVERITY_LEVELS[2];
  }
  if (/ตรวจยึด|จับกุม|อุบัติเหตุ|ภัยพิบัติ/.test(cat)) {
    if (/เสียชีวิต/.test(cleanedDetails)) return SEVERITY_LEVELS[0];
    if (/บาดเจ็บ/.test(cleanedDetails)) return SEVERITY_LEVELS[1];
    return SEVERITY_LEVELS[3];
  }

  if (
    /ปะทะ|ลอบวางระเบิด|วางระเบิด|ไปป์บอมบ์|ระเบิดแสวงเครื่อง|ซุ่มยิง|ลอบยิง|M79|I\.?E\.?D\.?|คาร์บอมบ์|เสียชีวิต/i.test(
      cleanedDetails
    )
  ) {
    return SEVERITY_LEVELS[0];
  }
  if (/วางเพลิง|ลอบเผา|เผาอาคาร|เผาศาลา|เผาป้อม|เผารถ|บาดเจ็บ/.test(cleanedDetails)) {
    return SEVERITY_LEVELS[1];
  }
  if (/ก่อกวน|โปรยตะปู|ตะปูเรือใบ|เผายาง|ทำลายกล้อง|เผากล้อง|ยิงทำลายกล้อง|พ่นสี|ป้ายผ้า|วัตถุต้องสงสัย/.test(cleanedDetails)) {
    return SEVERITY_LEVELS[2];
  }

  return SEVERITY_LEVELS[3];
}

function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Build consecutive daily incident buckets ending on `anchorYmd` (or latest incident date / today),
 * weighted by each record's `eventCount`.
 */
export function buildDailyTrendBuckets(
  incidents: IncidentRecord[],
  days = 30,
  anchorYmd?: string
): Array<{ ymd: string; label: string; count: number }> {
  const countsByDay = new Map<string, number>();
  let latestValidYmd = '';

  for (const item of incidents) {
    const ymd = (item.occurredAt || item.createdAt || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    countsByDay.set(ymd, (countsByDay.get(ymd) || 0) + getIncidentWeight(item));
    if (!latestValidYmd || ymd > latestValidYmd) {
      latestValidYmd = ymd;
    }
  }

  const resolvedAnchor =
    anchorYmd && /^\d{4}-\d{2}-\d{2}$/.test(anchorYmd)
      ? anchorYmd
      : latestValidYmd || formatLocalYmd(new Date());

  const [ay, am, ad] = resolvedAnchor.split('-').map(Number);
  const totalDays = Math.max(1, days);
  const buckets: Array<{ ymd: string; label: string; count: number }> = [];

  for (let offset = totalDays - 1; offset >= 0; offset--) {
    const dt = new Date(ay, am - 1, ad - offset);
    const ymd = formatLocalYmd(dt);
    const mName = THAI_MONTHS_SHORT[dt.getMonth()] || String(dt.getMonth() + 1);
    buckets.push({
      ymd,
      label: `${dt.getDate()} ${mName}`,
      count: countsByDay.get(ymd) || 0,
    });
  }

  return buckets;
}

export interface AreaSeverityRow {
  key: string;
  label: string;
  total: number;
  counts: Record<SeverityLevel, number>;
  pcts: Record<SeverityLevel, number>;
}

/**
 * Aggregate weighted severity counts and 100%-stacked percentages by province area.
 */
export function buildAreaSeverityStats(incidents: IncidentRecord[]): AreaSeverityRow[] {
  const AREA_LABELS: Record<string, string> = {
    สงขลา: 'จว.สงขลา',
    พัทลุง: 'จว.พัทลุง',
    ตรัง: 'จว.ตรัง',
    สตูล: 'จว.สตูล',
    นราธิวาส: 'จว.นราธิวาส',
    ปัตตานี: 'จว.ปัตตานี',
    ยะลา: 'จว.ยะลา',
    อื่นๆ: 'นอกเขต/อื่นๆ',
  };

  const buckets = new Map<string, Record<SeverityLevel, number>>();
  for (const key of Object.keys(AREA_LABELS)) {
    buckets.set(key, { critical: 0, high: 0, medium: 0, low: 0 });
  }

  for (const item of incidents) {
    const prov = item.province && item.province in AREA_LABELS ? item.province : 'อื่นๆ';
    const sev = classifyIncidentSeverity(item.category, item.details);
    const row = buckets.get(prov)!;
    row[sev.level] += getIncidentWeight(item);
  }

  const rows: AreaSeverityRow[] = [];
  for (const [key, counts] of buckets.entries()) {
    const total = counts.critical + counts.high + counts.medium + counts.low;
    if (total === 0) continue;
    rows.push({
      key,
      label: AREA_LABELS[key],
      total,
      counts,
      pcts: {
        critical: Math.round((counts.critical / total) * 1000) / 10,
        high: Math.round((counts.high / total) * 1000) / 10,
        medium: Math.round((counts.medium / total) * 1000) / 10,
        low: Math.round((counts.low / total) * 1000) / 10,
      },
    });
  }

  return rows.sort((a, b) => b.total - a.total);
}
