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

/** Return YYYY-MM-DD in Asia/Bangkok (UTC+7), or empty string if date is invalid. */
export function getBangkokYmd(date: Date = new Date()): string {
  const ms = date.getTime();
  if (Number.isNaN(ms)) return '';
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Convert an ISO/date string to Asia/Bangkok YYYY-MM-DDTHH:mm, or empty string if invalid. */
export function toBangkokIso16(isoInput?: string): string {
  if (!isoInput || !isoInput.trim()) return '';
  const ms = new Date(isoInput).getTime();
  if (Number.isNaN(ms)) return '';
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 16);
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
