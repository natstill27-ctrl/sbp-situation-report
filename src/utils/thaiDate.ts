import type {
  MultiAreaDraftItem,
  MultiAreaParseResult,
  PaperParseResult,
  ParsedCoordinate,
  WatchAdvisoryParseResult,
  WatchAlertLevel,
  WatchAlertRecord,
  WatchAreaTarget,
} from '../types/incident';
import { parseCoordinateInput } from './coordinates';
import { getCenterOfArea, matchAreaByThaiNames } from './geoLookup';

const THAI_DIGITS = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'] as const;

export const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

export const THAI_MONTHS_LONG = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

/** Convert Arabic digits 0-9 to Thai numerals ๐-๙. */
export function toThaiDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => THAI_DIGITS[Number(d)]);
}

/** Convert Thai numerals ๐-๙ to Arabic digits 0-9. */
export function fromThaiDigits(input: string): string {
  return input.replace(/[๐-๙]/g, (ch) => {
    const idx = THAI_DIGITS.indexOf(ch as (typeof THAI_DIGITS)[number]);
    return idx >= 0 ? String(idx) : ch;
  });
}

/** Format YYYY-MM-DD or YYYY-MM-DDTHH:mm into Thai Buddhist Era string. */
export function formatThaiDateTime(
  isoLocal: string,
  options: { shortMonth?: boolean; thaiDigits?: boolean; includeTime?: boolean } = {}
): string {
  if (!isoLocal) return '-';
  const { shortMonth = true, thaiDigits = false, includeTime = true } = options;
  const parsed = new Date(isoLocal.length === 10 ? `${isoLocal}T00:00:00` : isoLocal);
  if (Number.isNaN(parsed.getTime())) return isoLocal;

  const day = parsed.getDate();
  const monthIdx = parsed.getMonth();
  const beYear = parsed.getFullYear() + 543;
  const monthText = shortMonth ? THAI_MONTHS_SHORT[monthIdx] : THAI_MONTHS_LONG[monthIdx];
  const yearText = shortMonth ? String(beYear).slice(-2) : String(beYear);

  let text = shortMonth ? `${day} ${monthText}${yearText}` : `${day} ${monthText} ${yearText}`;
  if (includeTime && isoLocal.includes('T')) {
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mm = String(parsed.getMinutes()).padStart(2, '0');
    text += ` เวลา ${hh}.${mm} น.`;
  }
  return thaiDigits ? toThaiDigits(text) : text;
}

/** Format YYYY-MM-DD into Thai BE display for table headers / CSV (DD/MM/YYYY BE). */
export function formatThaiNumericDate(isoLocal: string): string {
  if (!isoLocal) return '';
  const parsed = new Date(isoLocal.length === 10 ? `${isoLocal}T00:00:00` : isoLocal);
  if (Number.isNaN(parsed.getTime())) return isoLocal;
  const dd = String(parsed.getDate()).padStart(2, '0');
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const yyyy = parsed.getFullYear() + 543;
  if (isoLocal.includes('T')) {
    const hh = String(parsed.getHours()).padStart(2, '0');
    const min = String(parsed.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  }
  return `${dd}/${mm}/${yyyy}`;
}

/** Current local datetime formatted for `<input type="datetime-local">` (YYYY-MM-DDTHH:mm). */
export function getCurrentLocalDateTimeInput(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Parse Thai month name (short or full) to 1..12 month index. */
function matchThaiMonth(token: string): number | null {
  const clean = token.trim();
  const shortIdx = THAI_MONTHS_SHORT.findIndex((m) => clean.startsWith(m.replace('.', '')) || clean === m);
  if (shortIdx >= 0) return shortIdx + 1;
  const longIdx = THAI_MONTHS_LONG.findIndex((m) => clean.startsWith(m));
  if (longIdx >= 0) return longIdx + 1;
  return null;
}

const THAI_MONTH_TOKEN = `(?:${[...THAI_MONTHS_LONG, ...THAI_MONTHS_SHORT]
  .map((m) => m.replace(/\./g, '\\.?'))
  .join('|')})`;

/**
 * Extract date, administrative area hints, and event category hints from a Thai Paper report paragraph.
 * Example supported: "เมื่อ ๙ พ.ย.๖๙ ... ต.แม่หวาด อ.ธารโต จว.ยะลา ... เกิดการปะทะ"
 */
export function extractPaperMetadata(rawText: string, availableCategories: string[]): PaperParseResult {
  const normalized = fromThaiDigits(rawText).replace(/\s+/g, ' ').trim();
  const result: PaperParseResult = { matchedHints: [] };

  // 1. Extract Thai date e.g. "9 พ.ย.69" or "9 พฤศจิกายน 2569"
  const dateRegex = new RegExp(`(?:^|\\s)(\\d{1,2})\\s*(${THAI_MONTH_TOKEN})\\s*(\\d{2,4})`, 'i');
  const dateMatch = normalized.match(dateRegex);
  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = matchThaiMonth(dateMatch[2]);
    let yearBE = Number(dateMatch[3]);
    if (yearBE < 100) yearBE += 2500;
    const yearAD = yearBE - 543;
    if (month && day >= 1 && day <= 31 && yearAD >= 1990 && yearAD <= 2100) {
      // Optional time e.g. 08.30 น., 08:30, or military 4-digit 0415 - 0530 / เวลา 0415
      const dottedTimeMatch = normalized.match(/(?:เวลา\s*)?(\d{1,2})[.:](\d{2})\s*น\.?/);
      const militaryTimeMatch = !dottedTimeMatch
        ? normalized.match(
            /(?:เวลา\s*|,\s*|(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*\d{2,4}\s*,?\s*)([01]\d|2[0-3])([0-5]\d)(?=\s*(?:-|–|ถึง|น\.|เกิด|พบ|มี|คนร้าย|เจ้าหน้า|\s|$))(?!\d)/
          )
        : null;
      const hh = dottedTimeMatch
        ? String(Math.min(23, Number(dottedTimeMatch[1]))).padStart(2, '0')
        : militaryTimeMatch
          ? militaryTimeMatch[1]
          : '08';
      const mm = dottedTimeMatch
        ? String(Math.min(59, Number(dottedTimeMatch[2]))).padStart(2, '0')
        : militaryTimeMatch
          ? militaryTimeMatch[2]
          : '00';
      const pad = (n: number) => String(n).padStart(2, '0');
      result.occurredAt = `${yearAD}-${pad(month)}-${pad(day)}T${hh}:${mm}`;
      result.matchedHints.push(`วันที่: ${dateMatch[0].trim()}`);
    }
  }

  // 2. Extract Province / District / Subdistrict (prefer full coherent ต./อ./จว. tuple first)
  const fullAreaTuple = normalized.match(
    /(?:^|\s)(?:ต\.|ตำบล)\s*([ก-๙]+)\s+(?:อ\.|อำเภอ)\s*([ก-๙]+)\s+(?:จว\.|จ\.|จังหวัด)\s*([ก-๙]+)/
  );

  if (fullAreaTuple) {
    result.subdistrict = fullAreaTuple[1].trim();
    result.district = fullAreaTuple[2].trim();
    result.province = fullAreaTuple[3].trim();
    result.matchedHints.push(`พื้นที่: ต.${result.subdistrict} อ.${result.district} จว.${result.province}`);
  } else {
    const subMatches = Array.from(normalized.matchAll(/(?:^|\s)(?:ต\.|ตำบล)\s*([ก-๙]+)/g));
    const distMatches = Array.from(normalized.matchAll(/(?:^|\s)(?:อ\.|อำเภอ)\s*([ก-๙]+)/g));
    const provMatches = Array.from(normalized.matchAll(/(?:^|\s)(?:จว\.|จ\.|จังหวัด)\s*([ก-๙]+)/g));

    const subMatch = subMatches[0];
    const distMatch = distMatches[0];
    const provMatch = provMatches[0];

    if (provMatch) {
      result.province = provMatch[1].trim();
      result.matchedHints.push(`จังหวัด: ${result.province}`);
    }
    if (distMatch) {
      result.district = distMatch[1].trim();
      result.matchedHints.push(`อำเภอ: ${result.district}`);
    }
    if (subMatch) {
      result.subdistrict = subMatch[1].trim();
      result.matchedHints.push(`ตำบล: ${result.subdistrict}`);
    }
  }

  // 3. Suggest Category based on keywords in report text
  const matchedCat = classifyCategoryFromText(normalized, availableCategories);
  if (matchedCat) {
    result.category = matchedCat;
    result.matchedHints.push(`ประเภท: ${matchedCat}`);
  }

  return result;
}

export const WATCH_ADVISORY_CATEGORY = 'ข่าวสารความเคลื่อนไหว/เฝ้าระวัง';
export const CCTV_DESTRUCTION_CATEGORY = 'ทำลายกล้อง CCTV';

export function isWatchAdvisoryCategory(category: string): boolean {
  return (
    category === WATCH_ADVISORY_CATEGORY ||
    /ข่าวสาร|ความเคลื่อนไหว|เฝ้าระวัง/.test(category || '')
  );
}

const KEYWORD_CATEGORY_MAP: Array<[RegExp, string[]]> = [
  [
    /ปรากฏข่าวสาร|ปรากฎข่าวสาร|ข่าวสารความเคลื่อนไหว|พบความเคลื่อนไหว|พื้นที่เฝ้าระวัง|พื้นที่เพ่งเล็ง|ห้วงเฝ้าระวัง|เตรียมการก่อเหตุ|เตรียมก่อเหตุ/,
    [WATCH_ADVISORY_CATEGORY],
  ],
  [
    /ปะทะ|ยิงปะทะ|ปิดล้อมตรวจค้น|ปิดล้อม-ตรวจค้น|ปิดล้อมและตรวจค้น|ยิงตอบโต้|พิสูจน์ทราบแหล่งพักพิง/,
    ['ปะทะ/ปิดล้อมตรวจค้น', 'ปะทะ'],
  ],
  [
    /ลอบวางระเบิด|วางระเบิด|ขว้างระเบิด|ไปป์บอมบ์|ระเบิดแสวงเครื่อง|เกิดเหตุระเบิด|เหตุระเบิด|แรงระเบิด|คาร์บอมบ์|M79|เอ็ม\s*79|I\.?E\.?D\.?|วัตถุต้องสงสัยคล้ายระเบิด/i,
    ['ระเบิด', 'ลอบวางระเบิด'],
  ],
  [
    /(?:ทำลาย|เผา(?:ทำลาย)?|ยิง(?:และเผา)?(?:ทำลาย)?|ลอบ(?:เผา|ยิง|ทำลาย)|ตัดสาย|พ่นสี(?:ทับ)?|ทุบ(?:ทำลาย)?|ดึง|ปลด)\s*กล้อง(?:\s*วงจรปิด|\s*CCTV|\s*\(?\s*CCTV\s*\)?)|กล้อง(?:\s*วงจรปิด|\s*CCTV|\s*\(?\s*CCTV\s*\)?)\s*(?:ถูก(?:เผา|ยิง|ทำลาย|ตัดสาย)|ได้รับความเสียหาย)/i,
    [CCTV_DESTRUCTION_CATEGORY, 'ทำลายกล้อง'],
  ],
  [
    /ซุ่มยิง|ซุ่มโจมตี|ลอบยิง|ใช้อาวุธปืน|กราดยิง|ถูกยิง|ยิงก่อกวน|ยิงทำลาย|ยิงกล้อง|ยิงเข้าใส่|ยิงใส่|พบรอยกระสุนปืน/,
    ['ใช้อาวุธปืน/ลอบยิง', 'ซุ่มยิง'],
  ],
  [/ตรวจยึด|จับกุม|ควบคุมตัว|ยึดอาวุธ|ยึดของกลาง|เข้ามอบตัว|หมายจับ/, ['ตรวจยึด/จับกุม']],
  [
    /สร้างสถานการณ์ก่อกวน|เหตุก่อกวน|ก่อกวน|โปรยตะปู|ตะปูเรือใบ|เผายาง|พ่นสี|ป้ายผ้า|แขวนป้าย|ตัดต้นไม้ขวางถนน/,
    ['ก่อกวน/โปรยตะปูเรือใบ-เผายาง', 'ก่อกวน'],
  ],
  [
    /วางเพลิง|ลอบเผา|เผาทำลาย|เผาเสา|เผากล้อง|เผาอาคาร|เผาศาลา|เผาป้อม|เผารถ|เผาทรัพย์สิน/,
    ['วางเพลิง'],
  ],
  [/วัตถุระเบิด|ระเบิด/, ['ระเบิด', 'ลอบวางระเบิด']],
  [/กระสุนปืน/, ['ใช้อาวุธปืน/ลอบยิง', 'ซุ่มยิง']],
  [/วัตถุต้องสงสัย/, ['ก่อกวน/โปรยตะปูเรือใบ-เผายาง', 'ก่อกวน']],
  [/อุบัติเหตุ|น้ำท่วม|อุทกภัย|วาตภัย|ดินถล่ม|เพลิงไหม้/, ['อุบัติเหตุ/ภัยพิบัติ']],
];

/** Classify an incident clause into the closest matching category from `availableCategories`. */
export function classifyCategoryFromText(
  text: string,
  availableCategories: string[]
): string | undefined {
  const normalized = fromThaiDigits(text).trim();
  if (!normalized || availableCategories.length === 0) return undefined;

  const cleaned = normalized
    .replace(/\([^)]*(?:ความเสียหายรวม|ภาพรวมพื้นที่):[^)]*\)/g, '')
    .replace(/(?:ตรวจสอบ|เช็ค|ตรวจเช็ค|ไล่ดู|ดู|เก็บหลักฐานจาก)?ภาพ(?:จาก)?(?:กล้อง)?(?:วงจรปิด|CCTV)/gi, '')
    .replace(/ไม่พบ(?:วัตถุระเบิด|ระเบิด|อาวุธปืน|กระสุนปืน)/g, '')
    .replace(/ชุดเก็บกู้(?:และตรวจสอบ)?วัตถุระเบิด|ชุด\s*EOD\s*เข้าตรวจสอบ/gi, '')
    .trim();
  if (!cleaned) return undefined;

  for (const [pattern, candidates] of KEYWORD_CATEGORY_MAP) {
    if (pattern.test(cleaned)) {
      const matchedCat = availableCategories.find((cat) =>
        candidates.some((c) => cat.includes(c) || c.includes(cat))
      );
      if (matchedCat) return matchedCat;
    }
  }
  return undefined;
}

function extractExplicitClock(normalizedBlock: string): string | null {
  const dotted = normalizedBlock.match(/(?:เวลา\s*)?(\d{1,2})[.:](\d{2})\s*น\.?/);
  if (dotted) {
    const hh = String(Math.min(23, Number(dotted[1]))).padStart(2, '0');
    const mm = String(Math.min(59, Number(dotted[2]))).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const military = normalizedBlock.match(
    /(?:เวลา\s*)([01]\d|2[0-3])([0-5]\d)(?=\s*(?:-|–|ถึง|น\.|เกิด|พบ|มี|คนร้าย|เจ้าหน้า|\s|$))(?!\d)/
  );
  if (military) {
    return `${military[1]}:${military[2]}`;
  }
  return null;
}

function splitMultiAreaBlocks(lines: string[]): { headerLines: string[]; rawBlocks: string[] } {
  const hasDeepSubNumbering = lines.some((line) => /^\d+(?:\.\d+){2,}[.)]?\s+/.test(line));
  const deepStarter = /^\d+(?:\.\d+){2,}[.)]?\s+/;
  const flatStarter =
    /^(?:(?:\d+(?:\.\d+)*[.)]?|[-•*])\s*(?=(?:ต\.|ตำบล|อ\.|อำเภอ|จว\.|จ\.|จังหวัด)\s*[ก-๙]+)|(?:ต\.|ตำบล|อ\.|อำเภอ)\s*[ก-๙]+|(?:จว\.|จ\.|จังหวัด)\s*[ก-๙]+\s+(?:จำนวน|แยกเป็น|ประกอบด้วย|เกิดเหตุ|ในพื้นที่))/;

  const isStarter = (line: string) =>
    hasDeepSubNumbering ? deepStarter.test(line) : flatStarter.test(line);

  const headerLines: string[] = [];
  const rawBlocks: string[] = [];
  let startedItems = false;

  for (const line of lines) {
    if (isStarter(line)) {
      startedItems = true;
      rawBlocks.push(line);
    } else if (!startedItems) {
      headerLines.push(line);
    } else if (rawBlocks.length > 0) {
      rawBlocks[rawBlocks.length - 1] = `${rawBlocks[rawBlocks.length - 1]} ${line}`;
    }
  }

  return { headerLines, rawBlocks };
}

interface ResolvedArea {
  province: string;
  district: string;
  subdistrict: string;
  areaMatched: boolean;
}

interface ParsedCountedClause {
  label: string;
  count: number;
  unit: string;
  trailingParen?: string;
  rawClause: string;
}

const PAREN_TOKEN_RE = /\u0000P(\d+)\u0000/g;
const EVENT_COUNT_UNIT_RE = /\d+\s*(?:เหตุการณ์|(?:จุด|ครั้ง|เหตุ|ราย|แห่ง)(?![ก-๙]))/;
const COUNTED_CLAUSE_RE =
  /(.+?)\s*(?:จำนวน\s*)?(?<!\d)(\d+)\s*(เหตุการณ์|(?:จุด|ครั้ง|เหตุ|ราย|แห่ง)(?![ก-๙]))(?:\s*\u0000P(\d+)\u0000)?/g;
const NAMED_LEADING_ACTION_RE =
  /^((?:ลอบ)?วางเพลิง|(?:ลอบ)?วางระเบิด|ลอบเผา|เผาทำลาย|เผา|ยิงก่อกวน|ยิงทำลาย|ลอบยิง|ซุ่มยิง|โจมตี|ทำลาย|ปล้น|ขว้างระเบิด|โปรยตะปูเรือใบ)\s+(?=(?:อบต\.|ทต\.|เทศบาล|ต\.|ตำบล|อ\.|อำเภอ|จว\.|บ\.|บ้าน|ม\.|สถานี|สำนักงาน|โรงเรียน|รร\.|รพ\.|วัด|มัสยิด|เสา|ตู้|ป้อม|จุดตรวจ|ฐาน|ร้าน|อาคาร|ศาลา|กล้อง))/;

function maskTopLevelParens(text: string): { masked: string; parens: string[] } {
  const parens: string[] = [];
  let masked = '';
  let depth = 0;
  let startIdx = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') {
      if (depth === 0) startIdx = i;
      depth++;
    } else if (ch === ')' && depth > 0) {
      depth--;
      if (depth === 0 && startIdx >= 0) {
        const idx = parens.length;
        parens.push(text.slice(startIdx + 1, i).trim());
        masked += `\u0000P${idx}\u0000`;
        startIdx = -1;
      }
    } else if (depth === 0) {
      masked += ch;
    }
  }

  if (depth > 0 && startIdx >= 0) {
    const idx = parens.length;
    parens.push(text.slice(startIdx + 1).trim());
    masked += `\u0000P${idx}\u0000`;
  }

  return { masked, parens };
}

function restoreMaskedParens(text: string, parens: string[]): string {
  return text.replace(PAREN_TOKEN_RE, (_m, idxStr) => {
    const inner = parens[Number(idxStr)];
    return inner !== undefined ? `(${inner})` : '';
  });
}

function parseCountedClauses(text: string): ParsedCountedClause[] {
  const { masked, parens } = maskTopLevelParens(text);
  const clauses: ParsedCountedClause[] = [];

  for (const match of masked.matchAll(COUNTED_CLAUSE_RE)) {
    const cleanLabel = restoreMaskedParens(match[1], parens)
      .replace(/^[,;:\s\-–—]+/, '')
      .replace(/^(?:และ|รวมทั้ง)\s*(?=[ก-๙A-Za-z])/, '')
      .replace(/\s*จำนวน\s*$/, '')
      .trim();

    if (!cleanLabel || cleanLabel === 'และ' || cleanLabel === 'รวมทั้ง') continue;

    const count = Math.max(1, Number(match[2]));
    const unit = match[3];
    const trailingParen = match[4] !== undefined ? parens[Number(match[4])] : undefined;
    clauses.push({
      label: cleanLabel,
      count,
      unit,
      trailingParen,
      rawClause: `${cleanLabel} ${count} ${unit}`,
    });
  }

  return clauses;
}

function splitTopLevelNamedItems(text: string): string[] {
  const { masked, parens } = maskTopLevelParens(text);
  return masked
    .split(
      /\s*[,;]\s*(?:และ\s*)?|\s+และ(?:\s+|(?=(?:อบต\.|ทต\.|เทศบาล|ต\.|ตำบล|อ\.|อำเภอ|จว\.|บ\.|ม\.|สถานี|สำนักงาน|โรงเรียน|รร\.|รพ\.|วัด|มัสยิด|วาง|ลอบ|เผา|ยิง|ปล้น|ขว้าง|โปรย)))/
    )
    .map((seg) => restoreMaskedParens(seg, parens).trim())
    .filter(Boolean);
}

function isCounterPrefixMatch(
  text: string,
  match: RegExpMatchArray,
  fullWord: string
): boolean {
  if (match[1] !== fullWord || match.index === undefined) return false;
  const keywordOffset = match[0].indexOf(match[1]);
  const before = text.slice(0, match.index + Math.max(0, keywordOffset));
  return /\d\s*$/.test(before);
}

function extractAreaFromText(
  text: string,
  fallback: { province: string; district: string; subdistrict: string }
): ResolvedArea {
  const fullTuple = text.match(
    /(?:^|[\s,(])(?:ต\.|ตำบล)\s*([ก-๙]+)\s+(?:อ\.|อำเภอ)\s*([ก-๙]+(?:-[ก-๙]+)?)\s+(?:จว\.|จ\.|จังหวัด)\s*([ก-๙]+)/
  );

  let rawProv = fullTuple?.[3]?.trim() || '';
  if (!rawProv) {
    const provMatch = text.match(/(?:^|[\s,(])(จว\.|จ\.|จังหวัด)\s*([ก-๙]+)/);
    if (provMatch) {
      const cand = provMatch[2].trim();
      if (!isCounterPrefixMatch(text, provMatch, 'จังหวัด') || matchAreaByThaiNames(cand)) {
        rawProv = cand;
      }
    }
  }

  const explicitProvNorm = rawProv ? matchAreaByThaiNames(rawProv)?.province || rawProv : '';
  const changedProv = Boolean(
    explicitProvNorm && fallback.province && explicitProvNorm !== fallback.province
  );
  const effProv = explicitProvNorm || fallback.province;

  let rawDist = fullTuple?.[2]?.trim() || '';
  if (!rawDist) {
    const distMatch = text.match(/(?:^|[\s,(])(อ\.|อำเภอ)\s*([ก-๙]+(?:-[ก-๙]+)?)/);
    if (distMatch) {
      const cand = distMatch[2].trim();
      if (
        !isCounterPrefixMatch(text, distMatch, 'อำเภอ') ||
        matchAreaByThaiNames(effProv, cand)
      ) {
        rawDist = cand;
      }
    }
  }

  const explicitDistNorm = rawDist
    ? matchAreaByThaiNames(effProv, rawDist)?.district || rawDist
    : '';
  const inheritedDist = changedProv ? '' : fallback.district;
  const changedDist = Boolean(
    explicitDistNorm && inheritedDist && explicitDistNorm !== inheritedDist
  );
  const effDist = explicitDistNorm || inheritedDist;

  let rawSub = fullTuple?.[1]?.trim() || '';
  if (!rawSub) {
    const subMatch = text.match(/(?:^|[\s,(])(ต\.|ตำบล)\s*([ก-๙]+)/);
    if (subMatch) {
      const cand = subMatch[2].trim();
      if (
        !isCounterPrefixMatch(text, subMatch, 'ตำบล') ||
        matchAreaByThaiNames(effProv, effDist, cand)
      ) {
        rawSub = cand;
      }
    }
  }

  if (!rawSub) {
    const obtMatch = text.match(/(?:^|[\s,(])(?:อบต\.|ทต\.|เทศบาลตำบล)\s*([ก-๙]{2,})/);
    if (obtMatch) {
      const obtCandidate = obtMatch[1].trim();
      const obtArea = matchAreaByThaiNames(effProv, effDist, obtCandidate);
      if (obtArea) {
        rawSub = obtArea.subdistrict;
      }
    }
  }

  const effSub = rawSub || (changedProv || changedDist ? '' : fallback.subdistrict);

  if (!effProv && !effDist && !effSub) {
    return { province: '', district: '', subdistrict: '', areaMatched: false };
  }

  const exact = matchAreaByThaiNames(effProv, effDist, effSub);
  if (exact) {
    return {
      province: exact.province,
      district: exact.district,
      subdistrict: exact.subdistrict,
      areaMatched: true,
    };
  }

  if (effSub) {
    const distOnly = matchAreaByThaiNames(effProv, effDist);
    if (distOnly) {
      return {
        province: distOnly.province,
        district: distOnly.district,
        subdistrict: effSub,
        areaMatched: true,
      };
    }
  }

  return {
    province: effProv,
    district: effDist,
    subdistrict: effSub,
    areaMatched: false,
  };
}

function hasBalancedParens(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function extractTrailingCasualties(text: string): { body: string; casualtiesSummary: string } {
  const casRegex =
    /(ไม่มีผู้(?:ได้รับ)?บาดเจ็บ(?:(?:หรือ|และ)(?:ผู้)?เสียชีวิต)?|(?:(?:มี)?(?:ผู้|ประชาชน|ราษฎร|ชาวบ้าน|เจ้าหน้าที่|จนท\.|ตำรวจ|ตร\.|ทหารพราน|ทหาร|ทพ\.|อส\.|ชรบ\.)\s*(?:ได้รับ)?(?:บาดเจ็บ|เสียชีวิต)|ได้รับบาดเจ็บ|เสียชีวิต)(?:(?!พิกัด).)*?)(?=\s*พิกัด|$)/;
  const match = text.match(casRegex);
  if (!match || match.index === undefined) {
    return { body: text, casualtiesSummary: '' };
  }

  const candidate = match[1].trim();
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);

  if (
    !hasBalancedParens(before) ||
    EVENT_COUNT_UNIT_RE.test(candidate) ||
    EVENT_COUNT_UNIT_RE.test(after)
  ) {
    return { body: text, casualtiesSummary: '' };
  }

  return {
    body: before.trim(),
    casualtiesSummary: candidate,
  };
}

function hasDistinctMultipleDistricts(text: string): boolean {
  const matches = Array.from(
    text.matchAll(/(?:^|[\s,(])(?:อ\.|อำเภอ)\s*([ก-๙]+(?:-[ก-๙]+)?)/g)
  ).map((m) => m[1].trim());
  return new Set(matches).size >= 2;
}

function buildLeafDraft(
  occurredAt: string,
  category: string,
  area: ResolvedArea,
  blockArea: ResolvedArea,
  blockCoord: ParsedCoordinate | null,
  clauseCoord: ParsedCoordinate | null,
  eventCount: number,
  detailsText: string,
  damageSummary: string,
  casualtiesSummary: string,
  contextNotes: string
): Omit<MultiAreaDraftItem, 'id'> {
  const sameAreaAsBlock =
    area.province === blockArea.province &&
    area.district === blockArea.district &&
    area.subdistrict === blockArea.subdistrict;
  const effectiveCoord = clauseCoord || (sameAreaAsBlock ? blockCoord : null);
  const center =
    !effectiveCoord && area.province
      ? getCenterOfArea(
          area.province,
          area.district || undefined,
          area.subdistrict || undefined
        )
      : null;

  return {
    occurredAt,
    category,
    province: area.province,
    district: area.district,
    subdistrict: area.subdistrict,
    lat: effectiveCoord ? effectiveCoord.lat : center ? center.lat : null,
    lng: effectiveCoord ? effectiveCoord.lng : center ? center.lng : null,
    eventCount: Math.max(1, eventCount),
    details: contextNotes ? `${detailsText} (${contextNotes})` : detailsText,
    damageSummary,
    casualtiesSummary,
    coordMatched: Boolean(effectiveCoord),
    areaMatched: area.areaMatched,
  };
}

function expandCountedClause(
  clause: ParsedCountedClause,
  ctx: {
    occurredAt: string;
    blockArea: ResolvedArea;
    blockCoord: ParsedCoordinate | null;
    contextNotes: string;
    damageSummary: string;
    casualtiesSummary: string;
    headerCategory?: string;
    blockDefaultCategory?: string;
    parentLabel?: string;
    fallbackCat: string;
    availableCategories: string[];
    warnings: string[];
  }
): Array<Omit<MultiAreaDraftItem, 'id'>> {
  const {
    occurredAt,
    blockArea,
    blockCoord,
    contextNotes,
    damageSummary,
    casualtiesSummary,
    headerCategory,
    blockDefaultCategory,
    parentLabel,
    fallbackCat,
    availableCategories,
    warnings,
  } = ctx;

  if (clause.trailingParen) {
    // Case A: Nested counted sub-clauses inside parentheses
    const subClauses = parseCountedClauses(clause.trailingParen);
    if (
      subClauses.length >= 2 ||
      (subClauses.length === 1 && subClauses[0].count === clause.count)
    ) {
      const subSum = subClauses.reduce((s, c) => s + c.count, 0);
      if (subSum !== clause.count) {
        warnings.push(
          `หัวข้อย่อย "${clause.label}" ระบุ ${clause.count} แต่ผลรวมในวงเล็บได้ ${subSum} — กรุณาตรวจสอบ`
        );
      }
      const results: Array<Omit<MultiAreaDraftItem, 'id'>> = [];
      for (const sub of subClauses) {
        results.push(
          ...expandCountedClause(sub, {
            ...ctx,
            parentLabel: clause.label,
          })
        );
      }
      return results;
    }

    // Case B: Named target list matching clause.count >= 2
    if (clause.count >= 2) {
      const segments = splitTopLevelNamedItems(clause.trailingParen);
      if (segments.length === clause.count) {
        const leadingMatch = segments[0].match(NAMED_LEADING_ACTION_RE);
        const leadingAction = leadingMatch ? leadingMatch[1].trim() : '';
        const clauseCat = classifyCategoryFromText(clause.label, availableCategories);
        const parenCat = classifyCategoryFromText(clause.trailingParen, availableCategories);

        return segments.map((seg) => {
          const segHasAction = NAMED_LEADING_ACTION_RE.test(seg);
          const segOwnCat = classifyCategoryFromText(seg, availableCategories);
          let segText = seg;
          if (!segHasAction && !segOwnCat && leadingAction) {
            segText = `${leadingAction} ${seg}`;
          } else if (!segOwnCat && clauseCat) {
            segText = `${clause.label}: ${seg}`;
          }

          const segArea = extractAreaFromText(seg, blockArea);
          const segCoord = parseCoordinateInput(seg);
          const category =
            classifyCategoryFromText(segText, availableCategories) ||
            clauseCat ||
            parenCat ||
            (parentLabel
              ? classifyCategoryFromText(parentLabel, availableCategories)
              : undefined) ||
            blockDefaultCategory ||
            headerCategory ||
            fallbackCat;

          return buildLeafDraft(
            occurredAt,
            category,
            segArea,
            blockArea,
            blockCoord,
            segCoord,
            1,
            segText,
            damageSummary,
            casualtiesSummary,
            contextNotes
          );
        });
      }
    }
  }

  // Case C: Single leaf clause
  const detailsText = clause.trailingParen
    ? `${clause.rawClause} (${clause.trailingParen})`
    : clause.rawClause;
  const areaSource =
    clause.trailingParen && !hasDistinctMultipleDistricts(clause.trailingParen)
      ? `${clause.label} ${clause.trailingParen}`
      : clause.label;
  const leafArea = extractAreaFromText(areaSource, blockArea);
  const leafCoord = parseCoordinateInput(detailsText);
  const category =
    classifyCategoryFromText(clause.label, availableCategories) ||
    (clause.trailingParen
      ? classifyCategoryFromText(clause.trailingParen, availableCategories)
      : undefined) ||
    (parentLabel ? classifyCategoryFromText(parentLabel, availableCategories) : undefined) ||
    blockDefaultCategory ||
    headerCategory ||
    fallbackCat;

  return [
    buildLeafDraft(
      occurredAt,
      category,
      leafArea,
      blockArea,
      blockCoord,
      leafCoord,
      clause.count,
      detailsText,
      damageSummary,
      casualtiesSummary,
      contextNotes
    ),
  ];
}

/**
 * Parse a multi-area Thai Paper report (e.g. 1.1 header + 1.1.1 / 1.1.2 province/district sub-items,
 * including wrapped lines, `แยกเป็น...`, nested parenthetical breakdowns, and named `อบต.` target lists)
 * into editable draft rows.
 */
export function extractMultiAreaPaper(
  rawText: string,
  availableCategories: string[]
): MultiAreaParseResult {
  const matchedHints: string[] = [];
  const warnings: string[] = [];
  const normalized = fromThaiDigits(rawText).replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return { items: [], matchedHints, warnings };
  }

  const lines = normalized
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const { headerLines, rawBlocks } = splitMultiAreaBlocks(lines);
  const headerText = headerLines.join(' ');
  const headerMeta = extractPaperMetadata(headerText || normalized, availableCategories);

  const baseOccurredAt = headerMeta.occurredAt || '';
  const headerProvince = headerMeta.province || '';
  const headerCategory = headerText
    ? classifyCategoryFromText(headerText, availableCategories)
    : undefined;
  if (headerMeta.matchedHints.length > 0) {
    matchedHints.push(...headerMeta.matchedHints.filter((h) => !h.startsWith('ประเภท:')));
  }

  const totalMatch = headerText.match(
    /จำนวน\s*(\d+)\s*(?:จุด|แห่ง|พื้นที่|เหตุการณ์|รายการ)/
  );
  const headerReportedTotalCount = totalMatch ? Number(totalMatch[1]) : undefined;
  if (headerReportedTotalCount) {
    matchedHints.push(`ยอดรวมตามหัวข้อข่าว: ${headerReportedTotalCount} เหตุการณ์/จุด`);
  }

  const fallbackCat = availableCategories[0] || 'อื่น ๆ';
  const items: MultiAreaDraftItem[] = [];
  const blockReportedCounts: number[] = [];
  let activeItemBlocks = 0;
  const singleParagraphFallback = rawBlocks.length === 0 && Boolean(headerText);
  const blocksToParse = singleParagraphFallback ? [headerText] : rawBlocks;

  for (const rawBlock of blocksToParse) {
    const cleanBlock = rawBlock.replace(/^(?:\d+(?:\.\d+)*[.)]?|[-•*])\s*/, '').trim();
    if (!cleanBlock) continue;

    activeItemBlocks++;
    const coord = parseCoordinateInput(cleanBlock);

    // Optional per-item clock override
    const itemClock = extractExplicitClock(cleanBlock);
    const itemOccurredAt =
      itemClock && baseOccurredAt.includes('T')
        ? `${baseOccurredAt.split('T')[0]}T${itemClock}`
        : baseOccurredAt;

    // Casualties & Damage clauses
    const { body: beforeCas, casualtiesSummary } = extractTrailingCasualties(cleanBlock);
    const { masked: maskedBeforeCas, parens: casParens } = maskTopLevelParens(beforeCas);
    const dmgMatch = maskedBeforeCas.match(
      /(?:ทำให้|ส่งผลให้|เบื้องต้นพบความเสียหาย|ได้รับความเสียหาย)(.+)$/
    );
    const damageSummary = dmgMatch
      ? restoreMaskedParens(dmgMatch[1], casParens).replace(/^(?:เป็น|มี)\s*/, '').trim()
      : '';
    const beforeDamage =
      dmgMatch && dmgMatch.index !== undefined
        ? restoreMaskedParens(maskedBeforeCas.slice(0, dmgMatch.index), casParens).trim()
        : beforeCas;

    // Detect breakdown ("แยกเป็น ..." / "ประกอบด้วย ...") or direct parenthetical expansion
    const { masked: maskedBeforeDamage, parens: bdParens } = maskTopLevelParens(beforeDamage);
    const breakdownMatch = maskedBeforeDamage.match(/^(.*?)\s*(?:แยกเป็น|ประกอบด้วย)\s*(.+)$/);

    let blockHeaderText = '';
    let clausesToExpand: ParsedCountedClause[] = [];
    let isBreakdownBlock = false;

    if (breakdownMatch) {
      blockHeaderText = restoreMaskedParens(breakdownMatch[1], bdParens).trim();
      const breakdownBody = restoreMaskedParens(breakdownMatch[2], bdParens).trim();
      clausesToExpand = parseCountedClauses(breakdownBody);
      isBreakdownBlock = clausesToExpand.length > 0;
    } else {
      const firstParenIdx = beforeDamage.indexOf('(');
      blockHeaderText = (
        firstParenIdx >= 0 ? beforeDamage.slice(0, firstParenIdx) : beforeDamage
      ).trim();
      const directClauses = parseCountedClauses(beforeDamage);
      if (directClauses.some((c) => Boolean(c.trailingParen))) {
        clausesToExpand = directClauses;
      }
    }

    const blockArea = extractAreaFromText(blockHeaderText || beforeDamage, {
      province: headerProvince,
      district: '',
      subdistrict: '',
    });

    const blockCountMatch = (blockHeaderText || beforeDamage).match(
      /จำนวน\s*(\d+)\s*(?:เหตุการณ์|จุด|ครั้ง|เหตุ|ราย|แห่ง)/
    );
    const blockReportedCount = blockCountMatch ? Number(blockCountMatch[1]) : undefined;
    if (blockReportedCount && !singleParagraphFallback) {
      blockReportedCounts.push(blockReportedCount);
    }

    const blockAreaLabel =
      [
        blockArea.subdistrict && `ต.${blockArea.subdistrict}`,
        blockArea.district && `อ.${blockArea.district}`,
        blockArea.province && `จว.${blockArea.province}`,
      ]
        .filter(Boolean)
        .join(' ') || 'พื้นที่ย่อย';

    if (clausesToExpand.length > 0) {
      const isNegatedCas = /^ไม่มี/.test(casualtiesSummary);
      const contextNotes = [
        damageSummary ? `ความเสียหายรวม: ${damageSummary}` : '',
        casualtiesSummary
          ? isNegatedCas
            ? casualtiesSummary
            : `ภาพรวมพื้นที่: ${casualtiesSummary}`
          : '',
      ]
        .filter(Boolean)
        .join(' | ');

      const blockDefaultCategory = blockHeaderText
        ? classifyCategoryFromText(blockHeaderText, availableCategories)
        : undefined;

      const expandedDrafts: Array<Omit<MultiAreaDraftItem, 'id'>> = [];
      for (const clause of clausesToExpand) {
        expandedDrafts.push(
          ...expandCountedClause(clause, {
            occurredAt: itemOccurredAt,
            blockArea,
            blockCoord: coord,
            contextNotes,
            damageSummary,
            casualtiesSummary,
            headerCategory,
            blockDefaultCategory,
            fallbackCat,
            availableCategories,
            warnings,
          })
        );
      }

      if (
        expandedDrafts.length >= 2 ||
        (!singleParagraphFallback && isBreakdownBlock && expandedDrafts.length >= 1)
      ) {
        if (casualtiesSummary && !isNegatedCas) {
          matchedHints.push(
            `หมายเหตุผู้บาดเจ็บ/เสียชีวิต (${blockAreaLabel}): ${casualtiesSummary}`
          );
        }

        const blockEmittedCount = expandedDrafts.reduce((sum, d) => sum + d.eventCount, 0);
        if (blockReportedCount && blockEmittedCount !== blockReportedCount) {
          warnings.push(
            `พื้นที่ ${blockAreaLabel} ระบุ ${blockReportedCount} เหตุการณ์ แต่แยกย่อยได้ ${blockEmittedCount} เหตุการณ์ — กรุณาตรวจสอบ`
          );
        }

        for (const draft of expandedDrafts) {
          items.push({
            id: `draft-${items.length + 1}`,
            ...draft,
          });
        }
        continue;
      }
    }

    if (singleParagraphFallback) continue;

    // Fallback: single-item block
    const center =
      !coord && blockArea.province
        ? getCenterOfArea(
            blockArea.province,
            blockArea.district || undefined,
            blockArea.subdistrict || undefined
          )
        : null;
    const eventCount = blockReportedCount ? Math.max(1, blockReportedCount) : 1;
    const category =
      classifyCategoryFromText(cleanBlock, availableCategories) ||
      headerCategory ||
      fallbackCat;

    items.push({
      id: `draft-${items.length + 1}`,
      occurredAt: itemOccurredAt,
      category,
      province: blockArea.province,
      district: blockArea.district,
      subdistrict: blockArea.subdistrict,
      lat: coord ? coord.lat : center ? center.lat : null,
      lng: coord ? coord.lng : center ? center.lng : null,
      eventCount,
      details: cleanBlock,
      damageSummary,
      casualtiesSummary,
      coordMatched: Boolean(coord),
      areaMatched: blockArea.areaMatched,
    });
  }

  let reportedTotalCount = headerReportedTotalCount;
  if (
    reportedTotalCount === undefined &&
    blockReportedCounts.length >= 2 &&
    blockReportedCounts.length === activeItemBlocks
  ) {
    reportedTotalCount = blockReportedCounts.reduce((sum, n) => sum + n, 0);
    matchedHints.push(`ยอดรวมจากแต่ละพื้นที่: ${reportedTotalCount} เหตุการณ์/จุด`);
  }

  const provinceTotals = new Map<string, number>();
  for (const item of items) {
    if (!item.province) continue;
    provinceTotals.set(
      item.province,
      (provinceTotals.get(item.province) || 0) + item.eventCount
    );
  }
  if (provinceTotals.size >= 2) {
    const summaryParts = Array.from(provinceTotals.entries()).map(
      ([prov, cnt]) => `จว.${prov} ${cnt}`
    );
    matchedHints.push(`สรุปรายจังหวัด: ${summaryParts.join(' • ')}`);
  }

  const parsedTotalCount = items.reduce((sum, item) => sum + item.eventCount, 0);
  if (reportedTotalCount && items.length > 0) {
    if (parsedTotalCount === reportedTotalCount) {
      matchedHints.push(
        `ตรวจนับรวม ${parsedTotalCount} เหตุการณ์ (ตรงตามหัวข้อข่าว ${reportedTotalCount} จุด)`
      );
    } else {
      warnings.push(
        `หัวข้อข่าวระบุ ${reportedTotalCount} จุด แต่แยกย่อยได้ ${parsedTotalCount} เหตุการณ์ — กรุณาตรวจสอบจำนวนในรายการย่อย`
      );
    }
  }

  const fallbackCoordCount = items.filter((i) => !i.coordMatched && i.lat !== null).length;
  if (fallbackCoordCount > 0) {
    warnings.push(
      `พบ ${fallbackCoordCount} รายการที่ไม่มีพิกัดในข้อความ จึงวางหมุดที่กึ่งกลางพื้นที่ (จังหวัด/อำเภอ/ตำบล) ให้อัตโนมัติ (คลิกหมุดบนแผนที่เพื่อปักจุดแม่นยำได้)`
    );
  }

  const missingCoordCount = items.filter((i) => i.lat === null || i.lng === null).length;
  if (missingCoordCount > 0) {
    warnings.push(
      `มี ${missingCoordCount} รายการที่ยังไม่พบพิกัด กรุณาเลือกอำเภอหรือคลิกบนแผนที่เพื่อกำหนดพิกัด`
    );
  }

  return {
    occurredAt: baseOccurredAt || undefined,
    province: headerProvince || items.find((i) => i.province)?.province || undefined,
    reportedTotalCount,
    items,
    matchedHints,
    warnings,
  };
}

/** Determine whether a watch alert is currently active, upcoming, or expired relative to `todayYmd`. */
export function isWatchAlertActive(
  alert: Pick<WatchAlertRecord, 'watchStart' | 'watchEnd'>,
  todayYmd?: string
): 'active' | 'upcoming' | 'expired' {
  const today = todayYmd || getCurrentLocalDateTimeInput().slice(0, 10);
  const start = (alert.watchStart || alert.watchEnd || '').slice(0, 10);
  const end = (alert.watchEnd || alert.watchStart || '').slice(0, 10);
  if (start && today < start) return 'upcoming';
  if (end && today > end) return 'expired';
  return 'active';
}

/**
 * Determine whether a watch alert overlaps the recent `days`-day window ending at `anchorYmd`
 * (defaults to today). If `capFuture` is true, alerts starting after `anchorYmd` are excluded.
 */
export function isWatchAlertWithinRecentDays(
  alert: Pick<WatchAlertRecord, 'watchStart' | 'watchEnd' | 'reportedAt' | 'createdAt'>,
  days = 30,
  anchorYmd?: string,
  capFuture = false
): boolean {
  const anchor =
    anchorYmd && /^\d{4}-\d{2}-\d{2}$/.test(anchorYmd)
      ? anchorYmd
      : getCurrentLocalDateTimeInput().slice(0, 10);

  const [ay, am, ad] = anchor.split('-').map(Number);
  const cutoffDate = new Date(ay, am - 1, ad - Math.max(0, days));
  const pad = (n: number) => String(n).padStart(2, '0');
  const cutoffYmd = `${cutoffDate.getFullYear()}-${pad(cutoffDate.getMonth() + 1)}-${pad(cutoffDate.getDate())}`;

  const start = (
    alert.watchStart ||
    alert.reportedAt ||
    alert.watchEnd ||
    alert.createdAt ||
    ''
  ).slice(0, 10);
  const end = (
    alert.watchEnd ||
    alert.watchStart ||
    alert.reportedAt ||
    alert.createdAt ||
    ''
  ).slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end < cutoffYmd) {
    return false;
  }
  if (capFuture && /^\d{4}-\d{2}-\d{2}$/.test(start) && start > anchor) {
    return false;
  }
  return true;
}

/**
 * Format watched target areas into a compact Thai summary grouped by province
 * (e.g. `อ.ยี่งอ, อ.ตากใบ จว.นราธิวาส` or `อ.ยะรัง จว.ปัตตานี / อ.รามัน จว.ยะลา`).
 */
export function formatWatchAreasSummary(
  areas: WatchAreaTarget[],
  maxItems?: number
): string {
  if (!areas || areas.length === 0) return '';

  const seen = new Set<string>();
  const unique: WatchAreaTarget[] = [];
  for (const a of areas) {
    const province = (a.province || '').trim();
    const district = (a.district || '').trim();
    const subdistrict = (a.subdistrict || '').trim();
    if (!province && !district && !subdistrict) continue;
    const key = `${province}|${district}|${subdistrict}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({ province, district, ...(subdistrict ? { subdistrict } : {}) });
    }
  }
  if (unique.length === 0) return '';

  const limit = maxItems && maxItems > 0 ? maxItems : unique.length;
  const shown = unique.slice(0, limit);
  const remaining = Math.max(0, unique.length - shown.length);

  const byProvince = new Map<string, string[]>();
  for (const a of shown) {
    const prov = a.province || '';
    if (!byProvince.has(prov)) {
      byProvince.set(prov, []);
    }
    const label = [
      a.subdistrict ? `ต.${a.subdistrict}` : '',
      a.district ? `อ.${a.district}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (label) {
      byProvince.get(prov)!.push(label);
    }
  }

  const parts: string[] = [];
  for (const [prov, items] of byProvince.entries()) {
    if (items.length > 0) {
      parts.push(`${items.join(', ')}${prov ? ` จว.${prov}` : ''}`);
    } else if (prov) {
      parts.push(`จว.${prov}`);
    }
  }

  const summary = parts.join(' / ');
  return remaining > 0 ? `${summary} +อีก ${remaining} พื้นที่` : summary;
}

/**
 * Parse Thai intelligence watch advisories containing multi-district target lists,
 * watch date windows (same-month or cross-month), and threat type.
 */
export function extractWatchAdvisory(rawText: string): WatchAdvisoryParseResult {
  const matchedHints: string[] = [];
  const normalized = fromThaiDigits(rawText).replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return {
      areas: [],
      threatType: 'ความเคลื่อนไหวกลุ่มผู้ก่อเหตุรุนแรง',
      alertLevel: 'medium',
      matchedHints,
    };
  }

  // 1. Report date ("เมื่อ ...")
  const headerMeta = extractPaperMetadata(normalized, []);
  const reportedAt = headerMeta.occurredAt?.slice(0, 10);
  if (reportedAt) {
    matchedHints.push(`วันที่ข่าว: ${formatThaiDateTime(reportedAt, { includeTime: false })}`);
  }

  // 2. Watch window ("ห้วงเฝ้าระวัง [ตั้งแต่] 5 - 16 มี.ค.68" or "25 ก.พ. - 10 มี.ค.68")
  let watchStart: string | undefined;
  let watchEnd: string | undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  const windowPattern = new RegExp(
    `(?:ห้วงเฝ้าระวัง(?:ตั้งแต่)?|ห้วงเวลา|ระยะเวลา)\\s*(\\d{1,2})(?:\\s*(${THAI_MONTH_TOKEN})(?:\\s*(\\d{2,4}))?)?\\s*(?:-|–|ถึง)\\s*(\\d{1,2})\\s*(${THAI_MONTH_TOKEN})\\s*,?\\s*(\\d{2,4})`
  );
  const windowMatch = normalized.match(windowPattern);
  if (windowMatch) {
    const endDay = Number(windowMatch[4]);
    const endMonth = matchThaiMonth(windowMatch[5]);
    let endBe = Number(windowMatch[6]);
    if (endBe < 100) endBe += 2500;
    const endAd = endBe - 543;

    const startDay = Number(windowMatch[1]);
    const startMonth = windowMatch[2] ? matchThaiMonth(windowMatch[2]) : endMonth;
    let startAd = endAd;
    if (windowMatch[3]) {
      let sBe = Number(windowMatch[3]);
      if (sBe < 100) sBe += 2500;
      startAd = sBe - 543;
    } else if (startMonth && endMonth && startMonth > endMonth) {
      startAd = endAd - 1;
    }

    if (startMonth && endMonth && startDay >= 1 && startDay <= 31 && endDay >= 1 && endDay <= 31) {
      watchStart = `${startAd}-${pad(startMonth)}-${pad(startDay)}`;
      watchEnd = `${endAd}-${pad(endMonth)}-${pad(endDay)}`;
      matchedHints.push(
        `ห้วงเฝ้าระวัง: ${formatThaiDateTime(watchStart, { includeTime: false })} – ${formatThaiDateTime(watchEnd, { includeTime: false })}`
      );
    }
  } else if (reportedAt) {
    watchStart = reportedAt;
    watchEnd = reportedAt;
  }

  // 3. Extract all watched districts (prefer text after "พื้นที่เฝ้าระวัง/พื้นที่เพ่งเล็ง/เตรียมก่อเหตุ")
  const anchorIdx = normalized.search(
    /พื้นที่เฝ้าระวัง|พื้นที่เพ่งเล็ง|เตรียมการก่อเหตุ|เตรียมก่อเหตุ/
  );
  const collectAreasFromSlice = (sliceText: string): WatchAreaTarget[] => {
    const provMatches = Array.from(
      sliceText.matchAll(/(?:จว\.|จ\.|จังหวัด)\s*([ก-๙]+(?:\.[ก-๙]*)?)/g)
    ).map((m) => ({ idx: m.index ?? 0, name: m[1].replace(/ฯ+$/, '').trim() }));
    const fallbackProv =
      provMatches[0]?.name ||
      normalized.match(/(?:จว\.|จ\.|จังหวัด)\s*([ก-๙]+)/)?.[1]?.replace(/ฯ+$/, '').trim() ||
      '';

    const distRegex = /(?:^|[\s,(])(?:อ\.|อำเภอ|อ,)\s*([ก-๙]+(?:-[ก-๙]+)?)/g;
    const found: WatchAreaTarget[] = [];
    const seen = new Set<string>();

    for (const m of sliceText.matchAll(distRegex)) {
      const token = m[1].replace(/ฯ+$/, '').trim();
      if (!token) continue;
      const mIdx = m.index ?? 0;
      const upcomingProv = provMatches.find((p) => p.idx >= mIdx)?.name || fallbackProv;
      const matched =
        matchAreaByThaiNames(upcomingProv, token) ||
        (upcomingProv ? matchAreaByThaiNames('', token) : null);
      if (matched) {
        const key = `${matched.province}|${matched.district}`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push({ province: matched.province, district: matched.district });
        }
      }
    }
    return found;
  };

  let areas = anchorIdx >= 0 ? collectAreasFromSlice(normalized.slice(anchorIdx)) : [];
  if (areas.length === 0) {
    areas = collectAreasFromSlice(normalized);
  }
  if (areas.length > 0) {
    matchedHints.push(`พื้นที่เฝ้าระวัง: ${areas.length} อำเภอ`);
  }

  // 4. Infer threat type & watch alert level
  let threatType = 'ความเคลื่อนไหวกลุ่มผู้ก่อเหตุรุนแรง';
  let alertLevel: WatchAlertLevel = 'medium';

  if (/คาร์บอมบ์|Car\s*Bomb|จยย\.?\s*บอมบ์|จักรยานยนต์บอมบ์|Motorcycle\s*Bomb/i.test(normalized)) {
    threatType = 'คาร์บอมบ์ / จยย.บอมบ์';
    alertLevel = 'critical';
  } else if (/ลอบวางระเบิด|วัตถุระเบิด|ระเบิดแสวงเครื่อง|ไปป์บอมบ์|ระเบิด/.test(normalized)) {
    threatType = /ซุ่มยิง|ซุ่มโจมตี|ลอบยิง/.test(normalized)
      ? 'ลอบวางระเบิด / ซุ่มโจมตี'
      : 'ลอบวางระเบิดแสวงเครื่อง';
    alertLevel = 'critical';
  } else if (/ซุ่มยิง|ซุ่มโจมตี|ลอบยิง|กราดยิง/.test(normalized)) {
    threatType = 'ลอบยิง / ซุ่มโจมตี';
    alertLevel = 'high';
  } else if (/วางเพลิง|ลอบเผา|เผายาง|เผากล้อง|ก่อกวน|พ่นสี/.test(normalized)) {
    threatType = 'ก่อกวน / วางเพลิง';
    alertLevel = 'high';
  }

  matchedHints.push(`รูปแบบ: ${threatType}`);

  return {
    reportedAt,
    watchStart,
    watchEnd,
    areas,
    threatType,
    alertLevel,
    matchedHints,
  };
}
