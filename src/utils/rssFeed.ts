import type { CuratedNewsItem, DailyNewsFeed } from '../types/news';
import { buildNiaProseSummary, getSourceReliabilityCode } from './intelBrief5w1h';
import { NEWS_CATEGORY_MAP } from './newsCurator';

/** Escape special characters for safe XML 1.0 text and strip invalid control chars. */
export function escapeXml(input: string): string {
  return String(input ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Format an ISO timestamp as a valid RFC-822 date string in GMT. */
export function formatRfc822Date(isoString: string, fallbackIso?: string): string {
  const parsed = new Date(isoString);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toUTCString();
  }
  const fallback = fallbackIso ? new Date(fallbackIso) : new Date();
  return Number.isNaN(fallback.getTime()) ? new Date(0).toUTCString() : fallback.toUTCString();
}

function buildItemXml(item: CuratedNewsItem, fallbackIso: string): string {
  const meta = NEWS_CATEGORY_MAP[item.category];
  const nia = buildNiaProseSummary(item);
  const reliability = getSourceReliabilityCode(item.sourceTier);
  const provinceText = item.provinces.map((p) => `จ.${p}`).join(', ');
  const descriptionBody = `${nia.paragraph} (แหล่งข่าว: ${item.sourceName} [${reliability.code}] | พื้นที่: ${provinceText})`;

  return [
    '    <item>',
    `      <title>${escapeXml(nia.headline)}</title>`,
    `      <link>${escapeXml(item.link)}</link>`,
    `      <guid isPermaLink="false">${escapeXml(item.id)}</guid>`,
    `      <pubDate>${escapeXml(formatRfc822Date(item.publishedAt, fallbackIso))}</pubDate>`,
    `      <category>${escapeXml(meta?.label || item.category)}</category>`,
    `      <description>${escapeXml(descriptionBody)}</description>`,
    '    </item>',
  ].join('\n');
}

/** Generate a W3C-compliant RSS 2.0 XML feed for the Wing 56 Intelligence News HUB. */
export function buildDailyNewsRssXml(
  feed: DailyNewsFeed,
  siteUrl = 'https://wing56-intel.local/'
): string {
  const normalizedUrl = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
  const lastBuild = formatRfc822Date(feed.generatedAt);
  const itemsXml = feed.items.map((item) => buildItemXml(item, feed.generatedAt)).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>ศูนย์ข่าวกรองรายวัน ผขว.บก.บน.56 (7 จังหวัดภาคใต้ตอนล่าง)</title>',
    `    <link>${escapeXml(normalizedUrl)}</link>`,
    `    <atom:link href="${escapeXml(`${normalizedUrl}daily-news.xml`)}" rel="self" type="application/rss+xml" />`,
    '    <description>ฟีดข่าวกรองสาธารณะคัดกรอง 7 หมวดข่าว ครอบคลุมพื้นที่รับผิดชอบ กองบิน 56 สรุปความแบบ สขช. 5W1H ตามมาตรฐานเว็บไซต์ภาครัฐ มสพร. 11-2566</description>',
    '    <language>th</language>',
    `    <lastBuildDate>${escapeXml(lastBuild)}</lastBuildDate>`,
    '    <generator>Wing 56 Intelligence Service Center RSS 2.0 Generator</generator>',
    itemsXml,
    '  </channel>',
    '</rss>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
