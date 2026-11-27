import { describe, expect, it } from 'vitest';
import type { CuratedNewsItem } from '../../types/news';
import {
  buildIntelBrief5W1H,
  cleanHeadlineForIntel,
  extractWhoActors,
  formatIntelBrief5W1HText,
  getSourceReliabilityCode,
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
});
