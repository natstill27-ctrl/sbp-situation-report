import type {
  CuratedNewsItem,
  IntelBrief5W1H,
  NewsCategoryId,
  SourceTier,
} from '../types/news';
import { formatThaiDateTime } from './thaiDate';

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
  [/กอ\.รมน\.ภาค\s*4\s*สน\.?/, 'กอ.รมน.ภาค 4 สน.'],
  [/กอ\.รมน\.([ก-๙]+)/, 'กอ.รมน.$1'],
  [/สนธิกำลัง\s*3\s*ฝ่าย/, 'กำลังผสม 3 ฝ่าย'],
  [/ชุดพญาเสือ/, 'ชุดพญาเสือ'],
  [/ปทส\.?/, 'บก.ปทส.'],
  [/ชุด\s*EOD|EOD/i, 'ชุดเก็บกู้วัตถุระเบิด (EOD)'],
  [/ตำรวจตรวจคนเข้าเมือง|ตม\.([ก-๙]*)/, 'ตำรวจตรวจคนเข้าเมือง (ตม.)'],
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
  [/ทหารพราน/, 'หน่วยเฉพาะกิจทหารพราน'],
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
  social: 'หน่วยงานบรรเทาสาธารณภัย / ส่วนราชการในพื้นที่',
  narcotics: 'เจ้าหน้าที่ปราบปรามยาเสพติด / ผู้เกี่ยวข้องในเครือข่าย',
  security: 'เจ้าหน้าที่ฝ่ายความมั่นคง / ผู้เกี่ยวข้องในพื้นที่',
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
    if (label === 'เจ้าหน้าที่ปฏิบัติการ' && found.some((f) => f.includes('กอ.รมน') || f.includes('3 ฝ่าย') || f.includes('ตำรวจ'))) {
      continue;
    }
    if (!found.includes(label)) {
      found.push(label);
    }
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
    social: 'ติดตามผลกระทบต่อประชาชน การบริหารจัดการภัยพิบัติ และความสงบเรียบร้อย',
    narcotics: 'สกัดกั้นการลักลอบลำเลียงและขยายผลเครือข่ายยาเสพติดในพื้นที่ภาคใต้ตอนล่าง',
    security: 'เฝ้าระวังและขยายผลความเชื่อมโยงด้านความมั่นคงของหน่วยงานในพื้นที่',
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
  } else {
    assessment = /(น้ำท่วม|อุทกภัย|สถานการณ์น้ำ|ฝนตก|ภัยพิบัติ)/.test(text)
      ? 'สถานการณ์อุทกภัย/สภาพอากาศ: กระทบการสัญจร เส้นทางภาคพื้น และแผนเตรียมพร้อมช่วยเหลือ ปชช.'
      : 'สังคมและประชาคม: ติดตามผลกระทบต่อสาธารณสุข แรงงาน และความเป็นอยู่ประชาชนในพื้นที่';
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
