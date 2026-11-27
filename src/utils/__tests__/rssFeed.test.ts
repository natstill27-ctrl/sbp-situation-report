import { describe, expect, it } from 'vitest';
import type { DailyNewsFeed } from '../../types/news';
import { buildDailyNewsRssXml, escapeXml, formatRfc822Date } from '../rssFeed';

describe('rssFeed (DGA RSS 2.0 compliance)', () => {
  it('escapes XML special characters and removes invalid control characters', () => {
    const raw = `ข่าวทดสอบ & ความเคลื่อนไหว <ด่วน> "พื้นที่" 'ใต้'\u0007`;
    const escaped = escapeXml(raw);
    expect(escaped).toBe('ข่าวทดสอบ &amp; ความเคลื่อนไหว &lt;ด่วน&gt; &quot;พื้นที่&quot; &apos;ใต้&apos;');
    expect(escaped).not.toContain('\u0007');
  });

  it('formats valid RFC-822 dates and safely handles invalid dates', () => {
    const valid = formatRfc822Date('2026-11-27T06:30:00.000Z');
    expect(valid).toContain('GMT');
    expect(valid).toContain('2026');

    const fallback = formatRfc822Date('not-a-date', '2026-11-26T00:00:00.000Z');
    expect(fallback).toContain('2026');
  });

  it('generates valid RSS 2.0 XML containing curated categories and NIA prose summaries', () => {
    const syntheticFeed: DailyNewsFeed = {
      generatedAt: '2026-11-27T06:30:00.000Z',
      windowHours: 168,
      stats: {
        totalChecked: 10,
        acceptedCount: 2,
        excludedDramaCount: 0,
        excludedSourceCount: 0,
        excludedStaleCount: 0,
        excludedOutOfAreaCount: 0,
        excludedDuplicateCount: 0,
      },
      items: [
        {
          id: 'syn-news-001',
          category: 'weather',
          title: 'กรมอุตุฯ เตือนฝนตกหนัก & ลมแรงพื้นที่ จว.สงขลา และ จว.พัทลุง',
          summary: 'ศูนย์อุตุนิยมวิทยาภาคใต้ฝั่งตะวันออกแจ้งเตือนเฝ้าระวังฝนตกหนักช่วงปลายสัปดาห์',
          link: 'https://example.com/news/1?a=1&b=2',
          sourceName: 'Thai PBS',
          sourceTier: 'official-public',
          publishedAt: '2026-11-27T04:00:00.000Z',
          provinces: ['สงขลา', 'พัทลุง'],
          score: 12,
        },
        {
          id: 'syn-news-002',
          category: 'migrant',
          title: 'ฝ่ายปกครองตรวจยึดแรงงานต่างด้าวหลบหนีเข้าเมืองพื้นที่ จว.ตรัง',
          summary: 'เจ้าหน้าที่สนธิกำลังตรวจสอบกลุ่มแรงงานลักลอบเข้าเมืองเพื่อดำเนินการตามกฎหมาย',
          link: 'https://example.com/news/2',
          sourceName: 'ไทยโพสต์',
          sourceTier: 'mainstream-credible',
          publishedAt: '2026-11-26T15:00:00.000Z',
          provinces: ['ตรัง'],
          score: 10,
        },
      ],
    };

    const xml = buildDailyNewsRssXml(syntheticFeed, 'https://example.org/wing56-intel');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('<channel>');
    expect(xml).toContain('<language>th</language>');
    expect(xml).toContain('https://example.org/wing56-intel/daily-news.xml');
    expect(xml).toContain('<category>พยากรณ์อากาศ/เฝ้าระวังภัยพิบัติ</category>');
    expect(xml).toContain('<category>แรงงานต่างด้าว/หลบหนีเข้าเมืองผิดกฎหมาย</category>');
    expect(xml).toContain('<guid isPermaLink="false">syn-news-001</guid>');
    expect(xml).toContain('https://example.com/news/1?a=1&amp;b=2');
    expect(xml).toContain('ฝนตกหนัก &amp; ลมแรง');
    expect(xml).toContain('สนข. Thai PBS รายงานเมื่อ');
    expect(xml).toContain('[B2]');
    expect(xml).toContain('[C2]');
    expect(xml.trimEnd().endsWith('</rss>')).toBe(true);
  });
});
