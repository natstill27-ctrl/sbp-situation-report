import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../../data/defaults';
import {
  classifyNewsCategory,
  curateRawNewsItems,
  evaluateNewsSource,
  extractWing56Provinces,
  isTabloidOrDramaNews,
  mapNewsCategoryToIncidentCategory,
} from '../newsCurator';

describe('News Source & Editorial Quality Gate', () => {
  it('accepts official/public, credible mainstream, and neutral local sources', () => {
    expect(evaluateNewsSource('Thai PBS')).toEqual({
      accepted: true,
      tier: 'official-public',
      normalizedName: 'Thai PBS',
    });
    expect(evaluateNewsSource('กรุงเทพธุรกิจ')).toEqual({
      accepted: true,
      tier: 'mainstream-credible',
      normalizedName: 'กรุงเทพธุรกิจ',
    });
    expect(evaluateNewsSource('HATYAI FOCUS')).toEqual({
      accepted: true,
      tier: 'local-neutral',
      normalizedName: 'HATYAI FOCUS',
    });
  });

  it('rejects social media, aggregators, partisan tabloids, and unvetted outlets', () => {
    for (const outlet of [
      'Facebook',
      'Vietnam.vn',
      'Head Topics',
      'LINE TODAY',
      'www.topnews.co.th',
      'Tnews - ทีนิวส์',
      'อมรินทร์ทีวี ช่อง 34',
      'บล็อกข่าวลือท้องถิ่น',
    ]) {
      expect(evaluateNewsSource(outlet).accepted).toBe(false);
    }
  });

  it('rejects village drama, superstition/lottery, celebrity, and promo items', () => {
    expect(isTabloidOrDramaNews('ชาวเน็ตจวกยับ ดราม่าโซเชียลผัวเมียทะเลาะหน้าตลาดหาดใหญ่')).toBe(
      true
    );
    expect(isTabloidOrDramaNews('แห่ส่องเลขเด็ดงวดนี้ ต้นตะเคียนคู่ จ.พัทลุง')).toBe(true);
    expect(isTabloidOrDramaNews('กู้ภัยจับงูเหลือมยักษ์เข้าบ้านชาวบ้าน จ.ตรัง')).toBe(true);
    expect(
      isTabloidOrDramaNews('กอ.รมน.ภาค 4 สน. แถลงผลการตรวจยึดอาวุธและขยายผลด้านความมั่นคงในพื้นที่')
    ).toBe(false);
  });
});

describe('Wing 56 7-Province Detection & 5-Category Classification', () => {
  it('extracts all 7 provinces directly and via district/landmark aliases', () => {
    expect(
      extractWing56Provinces('ประชุมความร่วมมือเศรษฐกิจด่านสะเดา สงขลา เชื่อมโยงท่าเรือกันตัง ตรัง')
    ).toEqual(['สงขลา', 'ตรัง']);
    expect(extractWing56Provinces('ฝนตกหนัก อ.ควนขนุน และ อ.ละงู')).toEqual(['พัทลุง', 'สตูล']);
    expect(extractWing56Provinces('หน่วยเฉพาะกิจปฏิบัติภารกิจใน อ.เบตง และ อ.สุไหงโก-ลก')).toEqual([
      'ยะลา',
      'นราธิวาส',
    ]);
  });

  it('classifies the 5 intelligence categories accurately and prevents flood/governor misrouting', () => {
    expect(
      classifyNewsCategory(
        'ผู้ว่าฯ สงขลา ประชุมติดตามสถานการณ์น้ำท่วมและแผนอพยพผู้ประสบภัย',
        ''
      ).category
    ).toBe('social');

    expect(
      classifyNewsCategory(
        'สนธิกำลังจับกุมเครือข่ายยาบ้าและช่อดอกกัญชาลักลอบข้ามแดน',
        ''
      ).category
    ).toBe('narcotics');

    expect(
      classifyNewsCategory(
        'ด่านศุลกากรสะเดาเร่งผลักดันการค้าชายแดนและส่งออกยางพารา',
        ''
      ).category
    ).toBe('economy');

    expect(
      classifyNewsCategory(
        'กกต.จังหวัดปัตตานีเตรียมความพร้อมเลือกตั้งท้องถิ่นและตรวจสอบการซื้อเสียง',
        ''
      ).category
    ).toBe('politics');

    expect(
      classifyNewsCategory(
        'กอ.รมน.ภาค 4 สน. ปิดล้อมตรวจค้นและชุด EOD เข้าตรวจสอบวัตถุต้องสงสัย',
        ''
      ).category
    ).toBe('security');
  });

  it('curates candidates with freshness window and deduplication favoring higher-tier sources', () => {
    const now = new Date('2026-11-27T12:00:00Z').getTime();
    const result = curateRawNewsItems(
      [
        {
          title: 'การค้าชายแดนด่านสะเดา จ.สงขลา ขยายตัวต่อเนื่องรับนโยบายเศรษฐกิจภาคใต้',
          link: 'https://example.com/1',
          sourceName: 'HATYAI FOCUS',
          publishedAt: '2026-11-27T08:00:00Z',
        },
        {
          title: 'การค้าชายแดนด่านสะเดา จ.สงขลา ขยายตัวต่อเนื่องรับนโยบายเศรษฐกิจภาคใต้',
          link: 'https://example.com/2',
          sourceName: 'Thai PBS',
          publishedAt: '2026-11-27T09:00:00Z',
        },
        {
          title: 'ดราม่าโซเชียลคู่รักทะเลาะกลางตลาด จ.สงขลา',
          link: 'https://example.com/3',
          sourceName: 'มติชน',
          publishedAt: '2026-11-27T07:00:00Z',
        },
        {
          title: 'ข่าวเก่าเกินกรอบเวลา การเลือกตั้งท้องถิ่น จ.ตรัง',
          link: 'https://example.com/4',
          sourceName: 'สยามรัฐ',
          publishedAt: '2026-11-20T07:00:00Z',
        },
        {
          title: 'ข่าวนอกพื้นที่การค้าชายแดน จ.เชียงราย',
          link: 'https://example.com/5',
          sourceName: 'กรุงเทพธุรกิจ',
          publishedAt: '2026-11-27T07:00:00Z',
        },
      ],
      { nowMs: now, windowHours: 72 }
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceName).toBe('Thai PBS');
    expect(result.items[0].category).toBe('economy');
    expect(result.stats.excludedDramaCount).toBe(1);
    expect(result.stats.excludedStaleCount).toBe(1);
    expect(result.stats.excludedOutOfAreaCount).toBe(1);
    expect(result.stats.excludedDuplicateCount).toBe(1);

    const mappedCat = mapNewsCategoryToIncidentCategory(result.items[0], DEFAULT_CATEGORIES);
    expect(mappedCat).toBe('ข่าวสารความเคลื่อนไหว/เฝ้าระวัง');
  });
});
