import { describe, expect, it } from 'vitest';
import type { CuratedNewsItem } from '../../types/news';
import {
  buildIntelBrief5W1H,
  buildNiaProseSummary,
  cleanHeadlineForIntel,
  extractWhoActors,
  formatIntelBrief5W1HText,
  formatNiaSummaryForCopy,
  getSourceReliabilityCode,
  normalizeThaiToNiaStyle,
} from '../intelBrief5w1h';

describe('5W1H Intelligence Brief Formatter (NIA Style)', () => {
  it('maps source tiers to Admiralty reliability codes B2 / C2 / C3', () => {
    expect(getSourceReliabilityCode('official-public').code).toBe('B2');
    expect(getSourceReliabilityCode('mainstream-credible').code).toBe('C2');
    expect(getSourceReliabilityCode('local-neutral').code).toBe('C3');
  });

  it('de-sensationalizes clickbait prefixes, TV show tails, and tabloid verbs', () => {
    expect(
      cleanHeadlineForIntel(
        'รวบแล้ว! จนท.บุกคุมตัวผู้ต้องสงสัย เอี่ยวบึ้มป่วนเมืองสตูล'
      )
    ).toBe('จับกุมแล้ว จนท.เข้าควบคุมตัวผู้ต้องสงสัย เอี่ยวเหตุระเบิดก่อเหตุความไม่สงบในเขตเมืองสตูล');

    expect(
      cleanHeadlineForIntel(
        'ฝนฟ้าอากาศเช้านี้ 26 พ.ย.69 ผวาฝนตกหนัก จ.พัทลุง| เที่ยงทันข่าว | 26 พ.ย. 69'
      )
    ).toBe('ฝนตกหนัก จ.พัทลุง');
  });

  it('extracts actors accurately without duplicating generic staff tags', () => {
    expect(
      extractWhoActors(
        'สนธิกำลัง 3 ฝ่าย รวบ 2 หญิงไทยคาท่าเรือมูโนะ จ.นราธิวาส',
        'narcotics'
      )
    ).toBe('กำลังผสม 3 ฝ่าย');

    expect(
      extractWhoActors(
        'กอ.รมน.สตูล ผนึกชุดพญาเสือ-ปทส. ทลายรุกป่าเขาบรรทัด',
        'security'
      )
    ).toBe('กอ.รมน.สตูล / ชุดพญาเสือ / บก.ปทส.');

    expect(
      extractWhoActors(
        'รองโฆษก กอ.รมน.ภาค 4 สน. แถลงผลการปฏิบัติของ ฉก.อโณทัย ในพื้นที่',
        'security'
      )
    ).toBe('รองโฆษก กอ.รมน.ภาค 4 สน. / หน่วยเฉพาะกิจอโณทัย');
  });

  it('builds a complete 5-line 5W1H brief differentiating inner AOR vs border AOR', () => {
    const innerSecurity: CuratedNewsItem = {
      id: 'NEWS-TEST-1',
      category: 'security',
      title: 'รวบแล้ว 2 ราย! จนท.บุกคุมตัวผู้ต้องสงสัย เอี่ยวบึ้มป่วนเมืองสตูล เร่งขยายผล',
      summary: 'รวบแล้ว 2 ราย! จนท.บุกคุมตัวผู้ต้องสงสัย เอี่ยวบึ้มป่วนเมืองสตูล เร่งขยายผล',
      link: 'https://example.com/sec-1',
      sourceName: 'แนวหน้า',
      sourceTier: 'mainstream-credible',
      publishedAt: '2026-11-27T04:00:00.000Z',
      provinces: ['สตูล'],
      score: 8,
    };

    const brief1 = buildIntelBrief5W1H(innerSecurity);
    expect(brief1.sourceCode).toBe('C2');
    expect(brief1.what).toContain('เหตุระเบิด');
    expect(brief1.who).toContain('ผู้ต้องสงสัย');
    expect(brief1.whereWhen).toContain('จว.สตูล');
    expect(brief1.whereWhen).toContain('27 พ.ย.69');
    expect(brief1.whyHow).toContain('เร่งขยายผล');
    expect(brief1.assessment).toContain('พื้นที่ชั้นใน');
    expect(brief1.assessment).toContain('แนวหน้า (C2)');

    const formatted = formatIntelBrief5W1HText(innerSecurity, brief1);
    const lines = formatted.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^1\) WHAT:/);
    expect(lines[1]).toMatch(/^2\) WHO:/);
    expect(lines[2]).toMatch(/^3\) WHERE\/WHEN:/);
    expect(lines[3]).toMatch(/^4\) WHY\/HOW:/);
    expect(lines[4]).toMatch(/^5\) ประเมินข่าวกรอง:/);

    const borderNarcotics: CuratedNewsItem = {
      id: 'NEWS-TEST-2',
      category: 'narcotics',
      title: 'สนธิกำลัง 3 ฝ่าย รวบ 2 หญิงไทยคาท่าเรือมูโนะ พร้อมของกลาง "ช่อดอกกัญชา" 50 กก. เตรียมลอบส่งออกข้ามแดน จ.นราธิวาส',
      summary: 'สนธิกำลัง 3 ฝ่าย รวบ 2 หญิงไทยคาท่าเรือมูโนะ พร้อมของกลาง "ช่อดอกกัญชา" 50 กก. เตรียมลอบส่งออกข้ามแดน จ.นราธิวาส',
      link: 'https://example.com/narc-1',
      sourceName: 'สวพ.FM91',
      sourceTier: 'official-public',
      publishedAt: '2026-11-25T17:45:00.000Z',
      provinces: ['นราธิวาส'],
      districtHint: 'สุไหงโก-ลก',
      score: 12,
    };

    const brief2 = buildIntelBrief5W1H(borderNarcotics);
    expect(brief2.sourceCode).toBe('B2');
    expect(brief2.whereWhen).toContain('ท่าเรือมูโนะ');
    expect(brief2.whereWhen).toContain('อ.สุไหงโก-ลก');
    expect(brief2.whyHow).toContain('พร้อมของกลาง');
    expect(brief2.assessment).toContain('ชายแดนใต้');
    expect(brief2.assessment).toContain('สวพ.FM91 (B2)');
  });

  it('normalizes Thai dates and prefixes into NIA compact prose style', () => {
    expect(
      normalizeThaiToNiaStyle(
        'เมื่อวันที่ 26 พฤศจิกายน 2569 ในพื้นที่ อำเภอหาดใหญ่ จังหวัดสงขลา #ข่าวด่วน https://example.com'
      )
    ).toBe('เมื่อวันที่ 26 พ.ย.69 ในพื้นที่ อ.หาดใหญ่ จ.สงขลา');

    expect(
      normalizeThaiToNiaStyle('เหตุการณ์ระหว่าง 10 – 11 พฤศจิกายน 2569 ตำบลแม่หวาด')
    ).toBe('เหตุการณ์ระหว่าง 10–11 พ.ย.69 ต.แม่หวาด');
  });

  it('builds a single cohesive 4-5 line NIA prose summary for both rich ISOC articles and short headlines', () => {
    const longIsocArticle: CuratedNewsItem = {
      id: 'NEWS-NIA-1',
      category: 'security',
      title: 'กอ.รมน.ภาค 4 สน.บังคับใช้กฎหมายควบคุมตัวผู้ต้องสงสัยเกี่ยวข้องกับเหตุลอบวางระเบิดในพื้นที่ จ.สตูล จำนวน 2 ราย',
      summary:
        'จากกรณีหน่วยงานด้านความมั่นคงได้ตรวจสอบและยืนยันความเคลื่อนไหวของบุคคลต้องสงสัยที่อาจมีความเชื่อมโยงกับเหตุลอบวางระเบิดในพื้นที่จังหวัดสตูล เมื่อวันที่ 10 – 11 พฤศจิกายน 2569 ที่ผ่านมา จึงได้วางแผนเข้าบังคับใช้กฎหมายพร้อมกัน 2 จุด ส่งผลให้สามารถควบคุมตัวบุคคลต้องสงสัยได้จำนวน 2 ราย เพื่อดำเนินการซักถามและขยายผลเครือข่าย ' +
        'ทั้งนี้ เจ้าหน้าที่ได้นำตัวส่งศูนย์ซักถามเพื่อตรวจสอบพยานหลักฐานเพิ่มเติมและยกระดับมาตรการรักษาความปลอดภัยในพื้นที่อย่างต่อเนื่อง ' +
        'รายละเอียดเพิ่มเติมในส่วนของการปฏิบัติการทางยุทธวิธีและรายชื่อพยานบุคคลอยู่ระหว่างการรวบรวมของชุดสืบสวนสอบสวนในพื้นที่และจะรายงานความคืบหน้าต่อไปตามลำดับขั้น',
      link: 'https://www.southpeace.go.th/?p=192435',
      sourceName: 'กอ.รมน.ภาค 4 สน.',
      sourceTier: 'official-public',
      publishedAt: '2026-11-27T04:51:17.000Z',
      provinces: ['สตูล', 'สงขลา'],
      score: 18,
    };

    const niaLong = buildNiaProseSummary(longIsocArticle);
    expect(niaLong.sourceCode).toBe('B2');
    expect(niaLong.publishedLabel).toContain('27 พ.ย.69');
    expect(niaLong.paragraph.startsWith('ศูนย์ประชาสัมพันธ์ กอ.รมน.ภาค 4 สน. รายงานเมื่อ 27 พ.ย.69 ว่า')).toBe(true);
    expect(niaLong.paragraph).toContain('ทั้งนี้');
    expect(niaLong.paragraph.length).toBeLessThanOrEqual(485);

    const shortHeadlineItem: CuratedNewsItem = {
      id: 'NEWS-NIA-2',
      category: 'economy',
      title: 'ผู้ว่าราชการจังหวัดตรัง ประชุมคณะกรรมการร่วมภาครัฐและเอกชนเพื่อแก้ไขปัญหาทางเศรษฐกิจจังหวัดตรัง',
      summary: 'ผู้ว่าราชการจังหวัดตรัง ประชุมคณะกรรมการร่วมภาครัฐและเอกชนเพื่อแก้ไขปัญหาทางเศรษฐกิจจังหวัดตรัง',
      link: 'https://example.com/trang-econ',
      sourceName: 'NBT CONNEXT',
      sourceTier: 'official-public',
      publishedAt: '2026-11-26T07:04:53.000Z',
      provinces: ['ตรัง'],
      score: 12,
    };

    const niaShort = buildNiaProseSummary(shortHeadlineItem);
    expect(niaShort.paragraph.startsWith('สนข. NBT CONNEXT รายงานเมื่อ 26 พ.ย.69 ว่า')).toBe(true);
    expect(niaShort.paragraph).toContain('ทั้งนี้');

    const copyText = formatNiaSummaryForCopy(shortHeadlineItem, niaShort);
    const lines = copyText.split('\n');
    expect(lines[1]).toContain('เผยแพร่เมื่อ :');
    expect(lines[3]).toBe('ที่มา : https://example.com/trang-econ');
  });

  it('generates NIA prose summaries for weather and migrant categories', () => {
    const weatherItem: CuratedNewsItem = {
      id: 'NEWS-WEATHER-1',
      category: 'weather',
      title: 'กรมอุตุฯ เตือน 5 อำเภอ จ.พัทลุง เฝ้าระวังฝนตกหนักและน้ำท่วมฉับพลัน',
      summary: 'กรมอุตุฯ เตือน 5 อำเภอ จ.พัทลุง เฝ้าระวังฝนตกหนักและน้ำท่วมฉับพลัน',
      link: 'https://example.com/w1',
      sourceName: 'Thai PBS',
      sourceTier: 'official-public',
      publishedAt: '2026-11-27T01:00:00.000Z',
      provinces: ['พัทลุง'],
      score: 14,
    };
    const niaWeather = buildNiaProseSummary(weatherItem);
    expect(niaWeather.paragraph).toContain('ทั้งนี้');
    expect(niaWeather.paragraph).toContain('บรรเทาสาธารณภัย');

    const migrantItem: CuratedNewsItem = {
      id: 'NEWS-MIGRANT-1',
      category: 'migrant',
      title: 'ตม.สงขลา จับกุมแรงงานต่างด้าวหลบหนีเข้าเมืองผิดกฎหมายพื้นที่ชายแดน',
      summary: 'ตม.สงขลา จับกุมแรงงานต่างด้าวหลบหนีเข้าเมืองผิดกฎหมายพื้นที่ชายแดน',
      link: 'https://example.com/m1',
      sourceName: 'สยามรัฐ',
      sourceTier: 'mainstream-credible',
      publishedAt: '2026-11-27T02:00:00.000Z',
      provinces: ['สงขลา'],
      score: 15,
    };
    const niaMigrant = buildNiaProseSummary(migrantItem);
    expect(niaMigrant.paragraph).toContain('ตม.');
    expect(niaMigrant.paragraph).toContain('ชายแดน');
  });
});
