import type { PaperParseResult } from '../types/incident';

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

/**
 * Extract date, administrative area hints, and event category hints from a Thai Paper report paragraph.
 * Example supported: "เมื่อ ๙ พ.ย.๖๙ ... ต.แม่หวาด อ.ธารโต จว.ยะลา ... เกิดการปะทะ"
 */
export function extractPaperMetadata(rawText: string, availableCategories: string[]): PaperParseResult {
  const normalized = fromThaiDigits(rawText).replace(/\s+/g, ' ').trim();
  const result: PaperParseResult = { matchedHints: [] };

  // 1. Extract Thai date e.g. "9 พ.ย.69" or "9 พฤศจิกายน 2569"
  const monthNamesPattern = [...THAI_MONTHS_LONG, ...THAI_MONTHS_SHORT]
    .map((m) => m.replace(/\./g, '\\.?'))
    .join('|');
  const dateRegex = new RegExp(`(?:^|\\s)(\\d{1,2})\\s*(${monthNamesPattern})\\s*(\\d{2,4})`, 'i');
  const dateMatch = normalized.match(dateRegex);
  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = matchThaiMonth(dateMatch[2]);
    let yearBE = Number(dateMatch[3]);
    if (yearBE < 100) yearBE += 2500;
    const yearAD = yearBE - 543;
    if (month && day >= 1 && day <= 31 && yearAD >= 1990 && yearAD <= 2100) {
      // Optional time e.g. 08.30 น. or 08:30
      const timeMatch = normalized.match(/(?:เวลา\s*)?(\d{1,2})[.:](\d{2})\s*น\.?/);
      const hh = timeMatch ? String(Math.min(23, Number(timeMatch[1]))).padStart(2, '0') : '08';
      const mm = timeMatch ? String(Math.min(59, Number(timeMatch[2]))).padStart(2, '0') : '00';
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
  const keywordCategoryMap: Array<[RegExp, string[]]> = [
    [/ปะทะ|ปิดล้อม|ตรวจค้น|ยิงตอบโต้/, ['ปะทะ/ปิดล้อมตรวจค้น', 'ปะทะ']],
    [/ลอบวางระเบิด|วางระเบิด|ระเบิด|I\.?E\.?D\.?|ไปป์บอมบ์/i, ['ระเบิด', 'ลอบวางระเบิด']],
    [/ซุ่มยิง|ลอบยิง|ใช้อาวุธปืน|กราดยิง|ถูกยิง/, ['ใช้อาวุธปืน/ลอบยิง', 'ซุ่มยิง']],
    [/วางเพลิง|ลอบเผา|เผาทำลาย/, ['วางเพลิง']],
    [/ตรวจยึด|จับกุม|ควบคุมตัว|ยึดอาวุธ/, ['ตรวจยึด/จับกุม']],
    [/โปรยตะปู|เผายาง|พ่นสี|ป้ายผ้า|ก่อกวน/, ['ก่อกวน/โปรยตะปูเรือใบ-เผายาง', 'ก่อกวน']],
    [/อุบัติเหตุ|น้ำท่วม|วาตภัย|ดินถล่ม|เพลิงไหม้/, ['อุบัติเหตุ/ภัยพิบัติ']],
  ];

  for (const [pattern, candidates] of keywordCategoryMap) {
    if (pattern.test(normalized)) {
      const matchedCat = availableCategories.find((cat) =>
        candidates.some((c) => cat.includes(c) || c.includes(cat))
      );
      if (matchedCat) {
        result.category = matchedCat;
        result.matchedHints.push(`ประเภท: ${matchedCat}`);
        break;
      }
    }
  }

  return result;
}
