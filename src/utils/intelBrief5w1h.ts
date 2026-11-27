import type {
  CuratedNewsItem,
  IntelBrief5W1H,
  NewsCategoryId,
  NiaBriefSummary,
  SourceTier,
} from '../types/news';
import { THAI_MONTHS_LONG, THAI_MONTHS_SHORT, formatThaiDateTime } from './thaiDate';

const INNER_AOR_PROVINCES = new Set(['สงขลา', 'พัทลุง', 'ตรัง', 'สตูล']);
const BORDER_AOR_PROVINCES = new Set(['ปัตตานี', 'ยะลา', 'นราธิวาส']);

export function getSourceReliabilityCode(tier: SourceTier): { code: string; label: string } {
  if (tier === 'official-public') {
    return { code: 'B2', label: 'สื่อสาธารณะ/หน่วยงานรัฐ' };
  }
  if (tier === 'mainstream-credible') {
    return { code: 'C2', label: 'สื่อหลักระดับประเทศ' };
  }
  return { code: 'C3', label: 'สื่อท้องถิ่นเป็นกลาง' };
}

function clampLine(text: string, maxLen = 135): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  const sliced = clean.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > maxLen * 0.55 ? sliced.slice(0, lastSpace) : sliced).trim()}…`;
}

/**
 * Strip clickbait/TV prefixes and neutralize sensational Thai verbs into factual intelligence phrasing.
 */
export function cleanHeadlineForIntel(title: string): string {
  let clean = (title || '')
    .replace(/\s+/g, ' ')
    .replace(/^ฝนฟ้าอากาศ(?:เช้านี้|วันนี้)?\s*\d{1,2}\s*[ก-๙.]+\s*\d{2,4}\s*(?:\|\s*)?/i, '')
    .replace(/^(?:ด่วน!|ช็อก!|ผวา!?|ระทึก!?|จับตา!)\s*/gi, '')
    .replace(/\|[^|]*(?:เที่ยงทันข่าว|ข่าวภาคค่ำ|เรื่องเด่นเย็นนี้|เช้านี้ที่หมอชิต)[^|]*(?:\|.*)?$/i, '')
    .replace(/\s*\|\s*(?:จ\.|จว\.)?[ก-๙]+\s*$/i, '')
    .replace(/^(?:สงขลา|พัทลุง|ตรัง|สตูล|ปัตตานี|ยะลา|นราธิวาส)\s*\|\s*/i, '')
    .replace(/^(?:ผวา!?|ระทึก!?)\s*/gi, '')
    .replace(/!+/g, '')
    .replace(/\.{3,}/g, ' ')
    .trim();

  const neutralReplacements: Array<[RegExp, string]> = [
    [/รวบแล้ว\s*/g, 'จับกุมแล้ว '],
    [/บุกคุมตัว/g, 'เข้าควบคุมตัว'],
    [/บุกรวบ/g, 'เข้าจับกุม'],
    [/รวบ\s*/g, 'จับกุม '],
    [/บึ้ม/g, 'เหตุระเบิด'],
    [/ฮือประท้วง/g, 'รวมตัวประท้วง'],
    [/บุกยื่นหนังสือ/g, 'ยื่นหนังสือ'],
    [/จี้ความเป็นธรรม/g, 'เรียกร้องความเป็นธรรม'],
    [/โจรใต้/g, 'กลุ่มผู้ก่อเหตุรุนแรง'],
    [/ป่วนเมือง/g, 'ก่อเหตุความไม่สงบในเขตเมือง'],
    [/ป่วน/g, 'ก่อเหตุความไม่สงบ'],
    [/ทลาย/g, 'เข้าตรวจยึดและจับกุม'],
  ];

  for (const [rx, rep] of neutralReplacements) {
    clean = clean.replace(rx, rep);
  }

  return clampLine(clean.replace(/\s+/g, ' ').trim(), 135);
}

const ACTOR_PATTERNS: Array<[RegExp, string]> = [
  [/รองโฆษก\s*กอ\.รมน\.ภาค\s*4\s*สน\.?/, 'รองโฆษก กอ.รมน.ภาค 4 สน.'],
  [/โฆษก\s*กอ\.รมน\.ภาค\s*4\s*สน\.?/, 'โฆษก กอ.รมน.ภาค 4 สน.'],
  [/กอ\.รมน\.ภาค\s*4\s*สน\.?/, 'กอ.รมน.ภาค 4 สน.'],
  [/กอ\.รมน\.([ก-๙]+)/, 'กอ.รมน.$1'],
  [/ผู้ช่วยผู้บัญชาการทหารบก/, 'ผู้ช่วยผู้บัญชาการทหารบก'],
  [/แม่ทัพภาคที่\s*4/, 'แม่ทัพภาคที่ 4'],
  [/กองทัพภาคที่\s*4/, 'กองทัพภาคที่ 4'],
  [/หน่วยเฉพาะกิจ([ก-๙]+)|ฉก\.([ก-๙]+)/, 'หน่วยเฉพาะกิจ$1$2'],
  [/สนธิกำลัง\s*3\s*ฝ่าย/, 'กำลังผสม 3 ฝ่าย'],
  [/ชุดพญาเสือ/, 'ชุดพญาเสือ'],
  [/ปทส\.?/, 'บก.ปทส.'],
  [/ชุด\s*EOD|EOD/i, 'ชุดเก็บกู้วัตถุระเบิด (EOD)'],
  [/ตำรวจตรวจคนเข้าเมือง|ตม\.([ก-๙]*)/, 'ตำรวจตรวจคนเข้าเมือง (ตม.)'],
  [/ศาลอุทธรณ์ภาค\s*9|ศาลจังหวัด([ก-๙]+)/, 'ศาลอุทธรณ์ภาค 9'],
  [/ป\.ป\.ส\.?/, 'สำนักงาน ป.ป.ส.'],
  [/ป\.ป\.ช\.?/, 'สำนักงาน ป.ป.ช.'],
  [/ผอ\.สนง\.กกต\.([ก-๙.]*)|กกต\.?/, 'สำนักงาน กกต.'],
  [/ผู้ว่าราชการจังหวัด([ก-๙]+)|ผู้ว่าฯ\s*([ก-๙]+)/, 'ผู้ว่าราชการจังหวัด$1$2'],
  [/นายกเทศมนตรี([ก-๙.\s]{2,20})/, 'นายกเทศมนตรี$1'],
  [/คณะกรรมการร่วมภาครัฐและเอกชน|กรอ\.จังหวัด([ก-๙]+)/, 'คณะกรรมการ กรอ.จังหวัด'],
  [/กรมควบคุมโรค/, 'กรมควบคุมโรค'],
  [/กรมอุตุนิยมวิทยา/, 'กรมอุตุนิยมวิทยา'],
  [/กรมโยธาธิการและผังเมือง/, 'กรมโยธาธิการและผังเมือง'],
  [/ด่านศุลกากร|ศุลกากร/, 'กรมศุลกากร'],
  [/ทหารพราน(?:\s*\d+)?/, 'หน่วยเฉพาะกิจกรมทหารพราน'],
  [/ตำรวจ/, 'เจ้าหน้าที่ตำรวจ'],
  [/จนท\.|เจ้าหน้าที่/, 'เจ้าหน้าที่ปฏิบัติการ'],
  [/ผู้ต้องสงสัย/, 'ผู้ต้องสงสัย'],
  [/ผู้ต้องหา/, 'ผู้ต้องหา'],
  [/ครู[^,\s]{0,18}/, 'กลุ่มครูและบุคลากรทางการศึกษา'],
  [/ต่างด้าว|แรงงานต่างด้าว/, 'แรงงานต่างด้าว'],
];

const ACTOR_FALLBACK: Record<NewsCategoryId, string> = {
  politics: 'หน่วยงานปกครอง / องค์กรที่เกี่ยวข้องในพื้นที่',
  economy: 'หน่วยงานเศรษฐกิจภาครัฐ / ผู้ประกอบการในพื้นที่',
  social: 'หน่วยงานสาธารณสุข / การศึกษา / ส่วนราชการในพื้นที่',
  narcotics: 'เจ้าหน้าที่ปราบปรามยาเสพติด / ผู้เกี่ยวข้องในเครือข่าย',
  security: 'เจ้าหน้าที่ฝ่ายความมั่นคง / ผู้เกี่ยวข้องในพื้นที่',
  weather: 'กรมอุตุนิยมวิทยา / หน่วยงานบรรเทาสาธารณภัย (ปภ.)',
  migrant: 'ตำรวจตรวจคนเข้าเมือง (ตม.) / ฝ่ายปกครอง / แรงงานต่างด้าว',
};

/**
 * Extract structured actor/agency names from headline and summary without fabricating entities.
 */
export function extractWhoActors(text: string, category: NewsCategoryId): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  const found: string[] = [];

  for (const [rx, template] of ACTOR_PATTERNS) {
    const m = clean.match(rx);
    if (!m) continue;
    let label = template
      .replace('$1', (m[1] || '').trim())
      .replace('$2', (m[2] || '').trim())
      .replace(/\s+/g, ' ')
      .trim();
    if (
      label === 'เจ้าหน้าที่ปฏิบัติการ' &&
      found.some((f) => f.includes('กอ.รมน') || f.includes('3 ฝ่าย') || f.includes('ตำรวจ'))
    ) {
      continue;
    }
    if (found.some((f) => f === label || f.includes(label) || label.includes(f))) {
      continue;
    }
    found.push(label);
    if (found.length >= 3) break;
  }

  if (found.length === 0) {
    return ACTOR_FALLBACK[category];
  }
  return clampLine(found.join(' / '), 115);
}

function extractSpecificPlace(text: string): string {
  const patterns = [
    /((?:ท่าเรือ|ด่านศุลกากร|ด่าน|ประตูระบายน้ำ|สนามบิน|สนามโรงพิธี|เขา|เทศบาลนคร|เทศบาลเมือง|ทต\.|ร\.ร\.|โรงเรียน|โรงพยาบาล|วัด)[ก-๙A-Za-z0-9.\-]{2,24})/,
    /((?:ต\.|ตำบล)\s*[ก-๙]{2,20})/,
  ];
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m && m[1]) {
      return m[1].replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

/**
 * Build line 3 (WHERE + WHEN) with Bangkok BE date-time.
 */
export function buildWhereWhenLine(item: CuratedNewsItem): string {
  const combined = `${item.title} ${item.summary}`;
  const specificPlace = extractSpecificPlace(combined);

  const areaParts: string[] = [];
  if (specificPlace && !item.provinces.some((p) => specificPlace === `จ.${p}` || specificPlace === p)) {
    areaParts.push(specificPlace);
  }
  if (item.districtHint && !specificPlace.includes(item.districtHint)) {
    areaParts.push(`อ.${item.districtHint}`);
  }
  const provText = item.provinces
    .map((p) => (p === 'ภาคใต้ตอนล่าง' ? 'ภาพรวมภาคใต้ตอนล่าง' : `จว.${p}`))
    .join(', ');
  if (provText && !areaParts.some((part) => part.includes(item.provinces[0] || ''))) {
    areaParts.push(provText);
  } else if (provText && areaParts.length === 1 && !areaParts[0].includes('จว.')) {
    areaParts.push(provText);
  }

  const bkkIso = new Date(new Date(item.publishedAt).getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
  const whenText = formatThaiDateTime(bkkIso, { shortMonth: true });
  return clampLine(`${areaParts.join(' ')} • ${whenText}`, 125);
}

/**
 * Extract cause, motive, or operational method clauses for line 4 (WHY / HOW).
 */
export function extractWhyHowLine(item: CuratedNewsItem): string {
  const combined = cleanHeadlineForIntel(`${item.title} ${item.summary !== item.title ? item.summary : ''}`);
  const clauses: string[] = [];

  const whyMatch = combined.match(
    /(?:หลัง|เนื่องจาก|เพราะ|กรณี|ค้าน|เอี่ยว|เพื่อ|รับมือ|เตรียม|แก้ไขปัญหา|ยกระดับ)[^•|]{6,75}/
  );
  if (whyMatch) {
    clauses.push(whyMatch[0].trim());
  }

  const howMatch = combined.match(
    /(?:พร้อมของกลาง[^,;|]{3,45}|ยึด[^,;|]{4,45}|ยื่น\s*\d+\s*ข้อเรียกร้อง[^,;|]{0,30}|ประกาศ\s*\d+\s*อำเภอ[^,;|]{0,30}|เร่ง(?:ขยายผล|ระบาย|ตรวจสอบ|ผลักดัน)[^,;|]{0,35}|ส่งเข้าศูนย์ซักถาม[^,;|]{0,30}|ควบคุมตัว[^,;|]{3,35})/
  );
  if (howMatch) {
    const howText = howMatch[0].trim();
    if (!clauses.some((c) => c.includes(howText) || howText.includes(c))) {
      clauses.push(howText);
    }
  }

  if (clauses.length > 0) {
    return clampLine(clauses.join(' / '), 130);
  }

  const fallbackByCategory: Record<NewsCategoryId, string> = {
    politics: 'ติดตามความเคลื่อนไหวเชิงนโยบาย/การบริหารราชการส่วนท้องถิ่นในพื้นที่',
    economy: 'ติดตามผลกระทบต่อเศรษฐกิจ การค้าชายแดน และรายได้ภาคเกษตร/ท่องเที่ยว',
    social: 'ติดตามผลกระทบต่อสาธารณสุข การศึกษา และคุณภาพชีวิตประชาชนในพื้นที่',
    narcotics: 'สกัดกั้นการลักลอบลำเลียงและขยายผลเครือข่ายยาเสพติดในพื้นที่ภาคใต้ตอนล่าง',
    security: 'เฝ้าระวังและขยายผลความเชื่อมโยงด้านความมั่นคงของหน่วยงานในพื้นที่',
    weather: 'เฝ้าระวังสภาพอากาศ ปริมาณฝน และเตรียมพร้อมแผนช่วยเหลือผู้ประสบภัยพิบัติ',
    migrant: 'ตรวจสอบและสกัดกั้นการลักลอบเข้าเมืองผิดกฎหมายและการทำงานโดยไม่ได้รับอนุญาต',
  };
  return fallbackByCategory[item.category];
}

/**
 * Build line 5 (Intelligence Assessment + Wing 56 AOR implication + Admiralty reliability code).
 */
export function buildIntelAssessmentLine(item: CuratedNewsItem): string {
  const { code } = getSourceReliabilityCode(item.sourceTier);
  const text = `${item.title} ${item.summary}`;
  const hasInner = item.provinces.some((p) => INNER_AOR_PROVINCES.has(p));
  const hasBorder = item.provinces.some((p) => BORDER_AOR_PROVINCES.has(p));

  let assessment = '';
  if (item.category === 'security') {
    assessment = hasInner
      ? 'ความมั่นคงพื้นที่ชั้นใน (ใกล้ บก.บน.56): เฝ้าระวังการขยายพื้นที่ก่อเหตุและคัดกรองบุคคล'
      : 'สถานการณ์ความมั่นคง จชต.: ติดตามการบังคับใช้กฎหมายและแนวโน้มการตอบโต้ในพื้นที่';
  } else if (item.category === 'narcotics') {
    assessment = hasBorder
      ? 'เส้นทางลำเลียงชายแดนใต้: เฝ้าระวังเครือข่ายค้ายาเสพติดข้ามแดนและพื้นที่พักคอย'
      : 'เครือข่ายยาเสพติดพื้นที่ตอนใน: ติดตามเส้นทางลำเลียงหลักและจุดกระจายสินค้า';
  } else if (item.category === 'economy') {
    assessment = /(เถื่อน|หนีภาษี|ศุลกากร)/.test(text)
      ? 'ภัยคุกคามทางเศรษฐกิจ/ชายแดน: กระทบการจัดเก็บรายได้และเครือข่ายลักลอบข้ามแดน'
      : 'เศรษฐกิจภูมิภาค: ประเมินแนวโน้มการค้าชายแดน เกษตรกรรม และความต่อเนื่องคมนาคม/การบิน';
  } else if (item.category === 'politics') {
    assessment = /(ประท้วง|ยื่นหนังสือ|ค้าน|ซื้อเสียง|ป\.ป\.ช\.)/.test(text)
      ? 'ความเคลื่อนไหวมวลชน/การเมืองท้องถิ่น: ติดตามระดับแรงกดดันและท่าทีหน่วยงานรับผิดชอบ'
      : 'การบริหารราชการ/การเมืองพื้นที่: ติดตามนโยบายและเสถียรภาพการปกครองส่วนภูมิภาค';
  } else if (item.category === 'weather') {
    assessment =
      'เฝ้าระวังอากาศ/ภัยพิบัติ: กระทบทัศนวิสัยการบิน เส้นทางภาคพื้น และความพร้อมบรรเทาสาธารณภัย บก.บน.56';
  } else if (item.category === 'migrant') {
    assessment =
      'แรงงานต่างด้าว/เข้าเมืองผิดกฎหมาย: เฝ้าระวังเส้นทางลักลอบข้ามแดน ด่านตรวจ และผลกระทบต่อความมั่นคงพื้นที่';
  } else {
    assessment =
      'สังคมและประชาคม: ติดตามผลกระทบต่อสาธารณสุข การศึกษา และความเป็นอยู่ประชาชนในพื้นที่';
  }

  return clampLine(`${assessment} • แหล่งข่าว: ${item.sourceName} (${code})`, 145);
}

/**
 * Construct a 5-line 5W1H + BLUF Intelligence Brief following NIA summary principles.
 */
export function buildIntelBrief5W1H(item: CuratedNewsItem): IntelBrief5W1H {
  const { code } = getSourceReliabilityCode(item.sourceTier);
  return {
    what: cleanHeadlineForIntel(item.title),
    who: extractWhoActors(`${item.title} ${item.summary}`, item.category),
    whereWhen: buildWhereWhenLine(item),
    whyHow: extractWhyHowLine(item),
    assessment: buildIntelAssessmentLine(item),
    sourceCode: code,
  };
}

/**
 * Format a 5-line 5W1H brief as plain text for briefings or LINE/report sharing.
 */
export function formatIntelBrief5W1HText(
  item: CuratedNewsItem,
  existingBrief?: IntelBrief5W1H
): string {
  const b = existingBrief || buildIntelBrief5W1H(item);
  return [
    `1) WHAT: ${b.what}`,
    `2) WHO: ${b.who}`,
    `3) WHERE/WHEN: ${b.whereWhen}`,
    `4) WHY/HOW: ${b.whyHow}`,
    `5) ประเมินข่าวกรอง: ${b.assessment}`,
  ].join('\n');
}

const THAI_LONG_TO_SHORT_MONTH = new Map(
  THAI_MONTHS_LONG.map((longName, idx) => [longName, THAI_MONTHS_SHORT[idx]])
);

const LONG_MONTH_PATTERN = THAI_MONTHS_LONG.join('|');

function toBangkokIso16(isoString: string): string {
  const ms = new Date(isoString).getTime();
  if (Number.isNaN(ms)) return '';
  return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

/**
 * Format ISO timestamp into NIA short BE date (e.g. "26 พ.ย.69") in Asia/Bangkok.
 */
export function formatNiaShortDate(isoString: string): string {
  const bkkIso = toBangkokIso16(isoString);
  if (!bkkIso) return '-';
  return formatThaiDateTime(bkkIso, { shortMonth: true, includeTime: false });
}

/**
 * Normalize formal Thai bureaucratic text into crisp NIA intelligence prose style:
 * - Short BE dates (26 พฤศจิกายน 2569 -> 26 พ.ย.69)
 * - Compact area prefixes (จังหวัด -> จ., อำเภอ -> อ., ตำบล -> ต.)
 * - Strip URLs, hashtags, photo credits, and trailing read-more tags
 */
export function normalizeThaiToNiaStyle(text: string): string {
  let clean = (text || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/#[^\s#]+/g, '')
    .replace(/อ่าน(?:ข่าวต่อ|เพิ่มเติม)[^ ]*/g, '')
    .replace(/\[…\]|\[\.\.\.\]/g, '')
    .replace(/[–—]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Convert date ranges: "10 – 11 พฤศจิกายน 2569" -> "10–11 พ.ย.69"
  const rangeRx = new RegExp(
    `(\\d{1,2})\\s*[–\\-]\\s*(\\d{1,2})\\s*(${LONG_MONTH_PATTERN})\\s*(?:พ\\.ศ\\.?\\s*)?(25\\d{2}|\\d{2})`,
    'g'
  );
  clean = clean.replace(rangeRx, (_m, d1, d2, monthLong, yr) => {
    const shortM = THAI_LONG_TO_SHORT_MONTH.get(monthLong) || monthLong;
    const shortY = String(yr).slice(-2);
    return `${d1}–${d2} ${shortM}${shortY}`;
  });

  // Convert full Thai date: "26 พฤศจิกายน 2569" -> "26 พ.ย.69"
  const fullDateRx = new RegExp(
    `(\\d{1,2})\\s*(${LONG_MONTH_PATTERN})\\s*(?:พ\\.ศ\\.?\\s*)?(25\\d{2}|\\d{2})`,
    'g'
  );
  clean = clean.replace(fullDateRx, (_m, day, monthLong, yr) => {
    const shortM = THAI_LONG_TO_SHORT_MONTH.get(monthLong) || monthLong;
    const shortY = String(yr).slice(-2);
    return `${day} ${shortM}${shortY}`;
  });

  clean = clean
    .replace(/(^|\s)จังหวัด\s*/g, '$1จ.')
    .replace(/(^|\s)อำเภอ\s*/g, '$1อ.')
    .replace(/(^|\s)ตำบล\s*/g, '$1ต.')
    .replace(/(^|\s)หมู่ที่\s*/g, '$1ม.')
    .replace(/!+/g, '')
    .replace(/\.{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return clean;
}

export function buildNiaAttributionPrefix(sourceName: string): string {
  const clean = (sourceName || '').trim();
  if (!clean) return 'แหล่งข่าว';
  if (clean.includes('กอ.รมน.ภาค 4 สน.')) return 'ศูนย์ประชาสัมพันธ์ กอ.รมน.ภาค 4 สน.';
  if (clean === 'สำนักงานคณะกรรมการการเลือกตั้ง') return 'สำนักงาน กกต.';
  if (clean.startsWith('สำนักงาน') || clean.startsWith('กรม') || clean.startsWith('ศูนย์')) {
    return clean;
  }
  return `สนข. ${clean}`;
}

function sliceOnWordBoundary(text: string, maxLen: number): { head: string; tail: string } {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return { head: clean, tail: '' };
  const window = clean.slice(0, maxLen);
  const splitAt = window.lastIndexOf(' ');
  const idx = splitAt > maxLen * 0.55 ? splitAt : maxLen;
  return {
    head: clean.slice(0, idx).trim(),
    tail: clean.slice(idx).trim(),
  };
}

function buildNiaClosingContext(item: CuratedNewsItem): string {
  const text = `${item.title} ${item.summary}`;
  const hasInner = item.provinces.some((p) => INNER_AOR_PROVINCES.has(p));

  if (item.category === 'security') {
    if (/(จับกุม|ควบคุมตัว|รวบ|ปิดล้อม|ซักถาม)/.test(text)) {
      return hasInner
        ? 'ทั้งนี้ เจ้าหน้าที่อยู่ระหว่างการซักถามและขยายผลเครือข่ายผู้ร่วมขบวนการ พร้อมเฝ้าระวังพื้นที่ชั้นในใกล้เคียง บก.บน.56 อย่างต่อเนื่อง'
        : 'ทั้งนี้ เจ้าหน้าที่อยู่ระหว่างขยายผลเครือข่ายผู้เกี่ยวข้องและเพิ่มความเข้มงวดในการควบคุมพื้นที่ตามแนวทาง กอ.รมน.ภาค 4 สน.';
    }
    return hasInner
      ? 'ทั้งนี้ หน่วยงานความมั่นคงในพื้นที่ชั้นในอยู่ระหว่างติดตามสถานการณ์และเฝ้าระวังความเชื่อมโยงด้านการข่าวอย่างใกล้ชิด'
      : 'ทั้งนี้ หน่วยงานความมั่นคงในพื้นที่ จชต. อยู่ระหว่างประเมินสถานการณ์และติดตามความเคลื่อนไหวอย่างใกล้ชิด';
  }
  if (item.category === 'narcotics') {
    return 'ทั้งนี้ เจ้าหน้าที่ได้ยึดของกลางและอยู่ระหว่างขยายผลถึงเครือข่ายผู้สั่งการ รวมถึงเส้นทางลำเลียงยาเสพติดในพื้นที่ภาคใต้ตอนล่าง';
  }
  if (item.category === 'economy') {
    return /(เถื่อน|หนีภาษี|ศุลกากร|บุหรี่ไฟฟ้า)/.test(text)
      ? 'ทั้งนี้ เจ้าหน้าที่ได้ตรวจยึดของกลางดำเนินคดีตามกฎหมาย และเฝ้าระวังเส้นทางลักลอบขนส่งสินค้าผิดกฎหมายในพื้นที่ชายแดนและตอนใน'
      : 'ทั้งนี้ หน่วยงานภาครัฐและภาคเอกชนในพื้นที่อยู่ระหว่างขับเคลื่อนมาตรการดังกล่าวเพื่อรักษาเสถียรภาพทางเศรษฐกิจและการค้าในภาคใต้ตอนล่าง';
  }
  if (item.category === 'politics') {
    return /(ประท้วง|ยื่นหนังสือ|ค้าน|ป\.ป\.ช\.|ซื้อเสียง)/.test(text)
      ? 'ทั้งนี้ หน่วยงานที่เกี่ยวข้องอยู่ระหว่างรับเรื่องตรวจสอบข้อเท็จจริงและประเมินท่าทีความเคลื่อนไหวของกลุ่มมวลชนในพื้นที่'
      : 'ทั้งนี้ เป็นความเคลื่อนไหวด้านการบริหารราชการและการเมืองท้องถิ่นในพื้นที่รับผิดชอบของ บก.บน.56 ที่ต้องติดตามความต่อเนื่อง';
  }
  if (item.category === 'weather') {
    return 'ทั้งนี้ หน่วยงานบรรเทาสาธารณภัยและฝ่ายปกครองได้แจ้งเตือนประชาชนในพื้นที่เสี่ยง เตรียมพร้อมเส้นทางสัญจร การปฏิบัติการภาคอากาศ/ภาคพื้น และแผนช่วยเหลือเร่งด่วน';
  }
  if (item.category === 'migrant') {
    return 'ทั้งนี้ เจ้าหน้าที่ ตม. และฝ่ายความมั่นคงได้ดำเนินการตามกฎหมาย ขยายผลถึงนายหน้า/ผู้นำพา และเพิ่มความเข้มงวดตามแนวชายแดนและเส้นทางธรรมชาติ';
  }
  if (/(น้ำท่วม|อุทกภัย|สถานการณ์น้ำ|ระดับน้ำ|ฝนตก|ภัยพิบัติ)/.test(text)) {
    return 'ทั้งนี้ หน่วยงานบรรเทาสาธารณภัยและฝ่ายปกครองได้แจ้งเตือนประชาชนในพื้นที่เสี่ยง เตรียมพร้อมเส้นทางสัญจรและแผนช่วยเหลือเร่งด่วน';
  }
  return 'ทั้งนี้ หน่วยงานที่เกี่ยวข้องในพื้นที่ได้ติดตามสถานการณ์อย่างใกล้ชิดเพื่อลดผลกระทบต่อประชาชนและรักษาความสงบเรียบร้อยในพื้นที่';
}

function extractSecondaryClause(tailText: string): string {
  if (!tailText) return '';
  const match = tailText.match(
    /(?:ทั้งนี้|เบื้องต้น|ขณะนี้|อย่างไรก็ตาม|จากการประเมิน(?:สถานการณ์)?|นอกจากนี้|ส่งผลให้)\s+[^•|]{20,175}/
  );
  if (!match) return '';
  const { head } = sliceOnWordBoundary(match[0], 165);
  const normalized = head.replace(
    /^(?:เบื้องต้น|ขณะนี้|อย่างไรก็ตาม|จากการประเมิน(?:สถานการณ์)?|นอกจากนี้|ส่งผลให้)\s+/,
    'ทั้งนี้ '
  );
  return normalized.startsWith('ทั้งนี้') ? normalized : `ทั้งนี้ ${normalized}`;
}

/**
 * Build a cohesive 4-5 line executive intelligence summary following NIA (nia.go.th) style.
 */
export function buildNiaProseSummary(item: CuratedNewsItem): NiaBriefSummary {
  const { code } = getSourceReliabilityCode(item.sourceTier);
  const headline = cleanHeadlineForIntel(item.title);
  const bkkIso = toBangkokIso16(item.publishedAt);
  const publishedLabel = bkkIso ? formatThaiDateTime(bkkIso, { shortMonth: true }) : '-';
  const shortDate = formatNiaShortDate(item.publishedAt);
  const attribution = buildNiaAttributionPrefix(item.sourceName);

  const rawSummary = (item.summary || '').replace(/\s+/g, ' ').trim();
  const hasRichBody = rawSummary.length > item.title.trim().length + 30;

  let bodyLead = '';
  let closingClause = '';

  if (hasRichBody) {
    let cleanedBody = rawSummary
      .replace(
        /^(?:วันนี้\s*)?\(?(?:เมื่อ)?วันที่\s*\d{1,2}\s*[ก-๙.]+\s*(?:พ\.ศ\.?\s*)?\d{2,4}\)?\s*(?:เวลา(?:ประมาณ)?\s*[\d.:]+\s*น\.?)?\s*/i,
        ''
      )
      .replace(/^จากกรณี/i, 'กรณี')
      .trim();
    cleanedBody = normalizeThaiToNiaStyle(cleanedBody);
    const { head, tail } = sliceOnWordBoundary(cleanedBody, 255);
    bodyLead = head;
    closingClause = extractSecondaryClause(tail);
  } else {
    let leadCore = normalizeThaiToNiaStyle(headline);
    // Avoid awkward "รายงานเมื่อ ... ว่า จ.พัทลุง ..." -> make location natural
    if (/^(?:จ\.|จว\.)[ก-๙]+\s+/.test(leadCore) && !leadCore.startsWith('จ.')) {
      leadCore = leadCore.replace(/^จว\./, 'จ.');
    }
    const hasAreaInLead = item.provinces.some((p) => leadCore.includes(p));
    const provTag = item.provinces
      .filter((p) => p !== 'ภาคใต้ตอนล่าง')
      .map((p) => `จ.${p}`)
      .join(', ');
    const areaSuffix =
      !hasAreaInLead && provTag ? ` ในพื้นที่ ${item.districtHint ? `อ.${item.districtHint} ` : ''}${provTag}` : '';
    bodyLead = `${leadCore}${areaSuffix}`;
  }

  if (!closingClause) {
    closingClause = buildNiaClosingContext(item);
  }

  // Prevent trailing "ทั้งนี้" duplication if bodyLead already ended inside a clause
  const combined = `${attribution} รายงานเมื่อ ${shortDate} ว่า ${bodyLead} ${closingClause}`
    .replace(/\s+/g, ' ')
    .replace(/ทั้งนี้\s+ทั้งนี้/g, 'ทั้งนี้')
    .trim();

  return {
    headline,
    publishedLabel,
    paragraph: sliceOnWordBoundary(combined, 480).head,
    sourceCode: code,
  };
}

/**
 * Format NIA-style summary as plain text matching the NIA website layout.
 */
export function formatNiaSummaryForCopy(
  item: CuratedNewsItem,
  existing?: NiaBriefSummary
): string {
  const nia = existing || buildNiaProseSummary(item);
  const lines = [
    nia.headline,
    `เผยแพร่เมื่อ : ${nia.publishedLabel} | แหล่งข่าว : ${item.sourceName} (รหัส ${nia.sourceCode})`,
    nia.paragraph,
  ];
  if (item.link) {
    lines.push(`ที่มา : ${item.link}`);
  }
  return lines.join('\n');
}
