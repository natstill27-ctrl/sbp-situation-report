import type {
  MultiAreaDraftItem,
  MultiAreaParseResult,
  PaperParseResult,
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
    .replace(/\(ความเสียหายรวม:[^)]*\)/g, '')
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
    /^(?:(?:\d+(?:\.\d+)*[.)]?|[-•*])\s*(?=(?:ต\.|ตำบล|อ\.|อำเภอ|จว\.|จ\.|จังหวัด)\s*[ก-๙]+)|(?:ต\.|ตำบล|อ\.|อำเภอ)\s*[ก-๙]+)/;

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

/**
 * Parse a multi-area Thai Paper report (e.g. 1.1 header + 1.1.1 / 1.1.2 district sub-items,
 * including wrapped lines and `แยกเป็น...` mixed-category breakdowns) into editable draft rows.
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
  if (headerMeta.matchedHints.length > 0) {
    matchedHints.push(...headerMeta.matchedHints.filter((h) => !h.startsWith('ประเภท:')));
  }

  const totalMatch = headerText.match(/จำนวน\s*(\d+)\s*(?:จุด|แห่ง|พื้นที่|เหตุการณ์|รายการ)/);
  const reportedTotalCount = totalMatch ? Number(totalMatch[1]) : undefined;
  if (reportedTotalCount) {
    matchedHints.push(`ยอดรวมตามหัวข้อข่าว: ${reportedTotalCount} เหตุการณ์/จุด`);
  }

  const fallbackCat = (availableCategories[0] || 'อื่น ๆ');
  const items: MultiAreaDraftItem[] = [];

  for (const rawBlock of rawBlocks) {
    const cleanBlock = rawBlock.replace(/^(?:\d+(?:\.\d+)*[.)]?|[-•*])\s*/, '').trim();
    if (!cleanBlock) continue;

    // Area extraction with province inheritance
    const fullTuple = cleanBlock.match(
      /(?:ต\.|ตำบล)\s*([ก-๙]+)\s+(?:อ\.|อำเภอ)\s*([ก-๙]+)\s+(?:จว\.|จ\.|จังหวัด)\s*([ก-๙]+)/
    );
    const subMatch = cleanBlock.match(/(?:^|\s)(?:ต\.|ตำบล)\s*([ก-๙]+)/);
    const distMatch = cleanBlock.match(/(?:^|\s)(?:อ\.|อำเภอ)\s*([ก-๙]+)/);
    const provMatch = cleanBlock.match(/(?:^|\s)(?:จว\.|จ\.|จังหวัด)\s*([ก-๙]+)/);

    const rawSub = fullTuple?.[1]?.trim() || subMatch?.[1]?.trim() || '';
    const rawDist = fullTuple?.[2]?.trim() || distMatch?.[1]?.trim() || '';
    const rawProv = fullTuple?.[3]?.trim() || provMatch?.[1]?.trim() || headerProvince;

    const areaMatch = matchAreaByThaiNames(rawProv, rawDist, rawSub);
    const province = areaMatch?.province || rawProv || headerProvince || '';
    const district = areaMatch?.district || rawDist || '';
    const subdistrict = areaMatch?.subdistrict || rawSub || '';
    const areaMatched = Boolean(areaMatch);

    // Coordinates (explicit in sub-item, or district centroid fallback)
    const coord = parseCoordinateInput(cleanBlock);
    const center =
      !coord && province
        ? getCenterOfArea(province, district || undefined, subdistrict || undefined)
        : null;
    const lat = coord ? coord.lat : center ? center.lat : null;
    const lng = coord ? coord.lng : center ? center.lng : null;

    // Optional per-item clock override
    const itemClock = extractExplicitClock(cleanBlock);
    const itemOccurredAt =
      itemClock && baseOccurredAt.includes('T')
        ? `${baseOccurredAt.split('T')[0]}T${itemClock}`
        : baseOccurredAt;

    // Casualties & Damage clauses
    const casMatch = cleanBlock.match(
      /(ไม่มีผู้(?:ได้รับ)?บาดเจ็บ(?:หรือ|และ)?(?:เสียชีวิต)?|มีผู้(?:ได้รับ)?บาดเจ็บ[^,.\n]*|ผู้(?:ได้รับ)?บาดเจ็บ\s*\d+[^,.\n]*|เสียชีวิต\s*\d+[^,.\n]*)/
    );
    const casualtiesSummary = casMatch ? casMatch[1].trim() : '';

    const beforeCas = casualtiesSummary
      ? cleanBlock.slice(0, cleanBlock.indexOf(casualtiesSummary)).trim()
      : cleanBlock;
    const dmgMatch = beforeCas.match(
      /(?:ทำให้|ส่งผลให้|เบื้องต้นพบความเสียหาย|ได้รับความเสียหาย)(.+)$/
    );
    const damageSummary = dmgMatch ? dmgMatch[1].replace(/^(?:เป็น|มี)\s*/, '').trim() : '';

    // Check for mixed-category breakdown ("แยกเป็น ...")
    const breakdownMatch = beforeCas.match(
      /แยกเป็น\s*(.+?)(?=\s*(?:ทำให้|ส่งผลให้|เบื้องต้น|ได้รับความเสียหาย|$))/
    );

    if (breakdownMatch) {
      const rawClauses = breakdownMatch[1]
        .split(/\s*[,;]\s*(?:และ\s*)?|(?<=(?:เหตุการณ์|จุด|ครั้ง|เหตุ|ราย))\s+และ\s*/)
        .map((c) => c.trim())
        .filter(Boolean);

      const parsedClauses = rawClauses.map((clause) => {
        const cntMatch = clause.match(/(\d+)\s*(?:เหตุการณ์|จุด|ครั้ง|เหตุ|ราย)/);
        return {
          clause,
          count: cntMatch ? Math.max(1, Number(cntMatch[1])) : 1,
          hasExplicitCount: Boolean(cntMatch),
          category: (classifyCategoryFromText(clause, availableCategories) ||
            classifyCategoryFromText(cleanBlock, availableCategories) ||
            fallbackCat),
        };
      });

      if (
        parsedClauses.length >= 2 &&
        parsedClauses.filter((c) => c.hasExplicitCount).length >= 2
      ) {
        const contextNotes = [
          damageSummary ? `ความเสียหายรวม: ${damageSummary}` : '',
          casualtiesSummary,
        ]
          .filter(Boolean)
          .join(' | ');

        for (const sub of parsedClauses) {
          items.push({
            id: `draft-${items.length + 1}`,
            occurredAt: itemOccurredAt,
            category: sub.category,
            province,
            district,
            subdistrict,
            lat,
            lng,
            eventCount: sub.count,
            details: contextNotes ? `${sub.clause} (${contextNotes})` : sub.clause,
            damageSummary,
            casualtiesSummary,
            coordMatched: Boolean(coord),
            areaMatched,
          });
        }
        continue;
      }
    }

    const countMatch = cleanBlock.match(/จำนวน\s*(\d+)\s*(?:เหตุการณ์|จุด|ครั้ง|เหตุ|ราย)/);
    const eventCount = countMatch ? Math.max(1, Number(countMatch[1])) : 1;
    const category = (classifyCategoryFromText(cleanBlock, availableCategories) ||
      classifyCategoryFromText(headerText, availableCategories) ||
      fallbackCat);

    items.push({
      id: `draft-${items.length + 1}`,
      occurredAt: itemOccurredAt,
      category,
      province,
      district,
      subdistrict,
      lat,
      lng,
      eventCount,
      details: cleanBlock,
      damageSummary,
      casualtiesSummary,
      coordMatched: Boolean(coord),
      areaMatched,
    });
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
      `พบ ${fallbackCoordCount} รายการที่ไม่มีพิกัดในข้อความ จึงวางหมุดที่กึ่งกลางอำเภอให้อัตโนมัติ (คลิกหมุดบนแผนที่เพื่อปักจุดแม่นยำได้)`
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
