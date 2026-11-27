import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RULES_PATH = path.join(ROOT, 'src', 'data', 'newsRules.json');
const OUTPUT_PATH = path.join(ROOT, 'public', 'daily-news.json');
const RSS_OUTPUT_PATH = path.join(ROOT, 'public', 'daily-news.xml');

const WINDOW_HOURS = 168;

const SOUTHPEACE_ENDPOINTS = [
  {
    label: 'กอ.รมน.ภาค 4 สน. (ข่าวชี้แจงเหตุการณ์)',
    url: 'https://www.southpeace.go.th/index.php?rest_route=/wp/v2/posts&categories=24&per_page=15',
    hintCategory: 'security',
  },
  {
    label: 'กอ.รมน.ภาค 4 สน. (ข่าวประชาสัมพันธ์)',
    url: 'https://www.southpeace.go.th/index.php?rest_route=/wp/v2/posts&categories=23&categories_exclude=27,28,29,30&per_page=20',
  },
];

const QUERIES = [
  {
    hintCategory: 'politics',
    q: '(การเมือง OR ผู้ว่า OR เลือกตั้ง OR กกต OR อบจ OR เทศบาล OR ครม OR รัฐมนตรี) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:3d',
  },
  {
    hintCategory: 'economy',
    q: '(เศรษฐกิจ OR การค้าชายแดน OR ยางพารา OR ปาล์มน้ำมัน OR ท่องเที่ยว OR ลงทุน OR ศุลกากร OR ด่านสะเดา OR สนามบินหาดใหญ่) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:3d',
  },
  {
    hintCategory: 'social',
    q: '(สาธารณสุข OR โรคระบาด OR การศึกษา OR ประชาคม OR ชุมชน OR พัฒนาสังคม OR องค์กรภาคประชาชน) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:3d',
  },
  {
    hintCategory: 'weather',
    q: '(พยากรณ์อากาศ OR กรมอุตุนิยมวิทยา OR น้ำท่วม OR อุทกภัย OR ฝนตกหนัก OR วาตภัย OR ดินถล่ม OR คลื่นลมแรง OR เฝ้าระวังภัยพิบัติ) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:3d',
  },
  {
    hintCategory: 'migrant',
    q: '(แรงงานต่างด้าว OR หลบหนีเข้าเมือง OR ลักลอบเข้าเมือง OR เข้าเมืองผิดกฎหมาย OR ตม. OR ต่างด้าวทำงานต้องห้าม OR ค้ามนุษย์) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:7d',
  },
  {
    hintCategory: 'narcotics',
    q: '(ยาเสพติด OR ยาบ้า OR ไอซ์ OR ป.ป.ส. OR กัญชา OR กระท่อม OR เครือข่ายยาเสพติด) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:7d',
  },
  {
    hintCategory: 'security',
    q: '(ความมั่นคง OR กอ.รมน. OR ระเบิด OR ลอบยิง OR ปะทะ OR ก่อเหตุรุนแรง OR ฝ่ายความมั่นคง OR EOD OR ปิดล้อม) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:7d',
  },
];

const SUPPLEMENTARY_FEEDS = [
  { sourceName: 'ประชาชาติธุรกิจ', url: 'https://www.prachachat.net/feed' },
  { sourceName: 'Matichon Online', url: 'https://www.matichon.co.th/feed' },
  { sourceName: 'ไทยโพสต์', url: 'https://www.thaipost.net/feed/' },
];

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8216;/g, '‘')
    .replace(/&#8217;/g, '’')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8230;|&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block, tagName) {
  const m = block.match(new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return m ? decodeHtmlEntities(m[1]) : '';
}

function stripTrailingSource(text, sourceName) {
  let clean = (text || '').trim();
  if (!clean || !sourceName) return clean;
  const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  clean = clean
    .replace(new RegExp(`\\s*-\\s*${escaped}\\s*$`, 'i'), '')
    .replace(new RegExp(`\\s+${escaped}\\s*$`, 'i'), '')
    .replace(/\s+The post .* appeared first on .*$/i, '')
    .trim();
  return clean;
}

function evaluateNewsSource(rawSourceName, rules) {
  const clean = (rawSourceName || '').trim();
  if (!clean) return { accepted: false, normalizedName: '' };
  const lower = clean.toLowerCase();
  for (const blocked of rules.sourceBlocklist) {
    if (lower.includes(blocked.toLowerCase())) {
      return { accepted: false, normalizedName: clean };
    }
  }
  for (const tier of ['official-public', 'mainstream-credible', 'local-neutral']) {
    for (const allowed of rules.sources[tier] || []) {
      const aLower = allowed.toLowerCase();
      if (lower === aLower || lower.includes(aLower) || aLower.includes(lower)) {
        return { accepted: true, tier, normalizedName: clean };
      }
    }
  }
  return { accepted: false, normalizedName: clean };
}

function isTabloidOrDramaNews(title, summary, dramaRegexes) {
  const combined = `${title || ''} ${summary || ''}`.replace(/\s+/g, ' ').trim();
  return dramaRegexes.some((rx) => rx.test(combined));
}

function extractWing56Provinces(text, rules) {
  const found = new Set();
  for (const prov of rules.provinces) {
    if (text.includes(prov)) found.add(prov);
  }
  for (const [alias, prov] of Object.entries(rules.provinceAliases)) {
    if (text.includes(alias)) found.add(prov);
  }
  return rules.provinces.filter((p) => found.has(p));
}

function extractDistrictHint(text, rules) {
  for (const alias of Object.keys(rules.provinceAliases)) {
    if (alias === 'กองบิน 56' && text.includes(alias)) return 'คลองหอยโข่ง';
    if ((alias === 'ปาดังเบซาร์' || alias === 'ด่านนอก') && text.includes(alias)) return 'สะเดา';
    if (alias === 'ปากบารา' && text.includes(alias)) return 'ละงู';
    if ((alias === 'มูโนะ' || alias === 'สุไหงโกลก') && text.includes(alias)) return 'สุไหงโก-ลก';
    if (text.includes(alias)) return alias;
  }
  return '';
}

function classifyCategory(title, summary, hintCategory, rules) {
  const scores = {
    politics: 0,
    economy: 0,
    social: 0,
    narcotics: 0,
    security: 0,
    weather: 0,
    migrant: 0,
  };
  for (const [catId, pairs] of Object.entries(rules.categoryKeywords)) {
    for (const [kw, weight] of pairs) {
      if (title.includes(kw)) scores[catId] += weight * 2;
      else if (summary.includes(kw)) scores[catId] += weight;
    }
  }
  if (
    scores.weather >= 6 &&
    /(น้ำท่วม|อุทกภัย|สถานการณ์น้ำ|ระดับน้ำ|ระบายน้ำ|ผู้ประสบภัย|ฝนตกหนัก|กรมอุตุ|พยากรณ์อากาศ|มรสุม|คลื่นลม)/.test(
      title
    )
  ) {
    scores.weather += 6;
  }
  if (scores.migrant >= 6 && /(ต่างด้าว|หลบหนีเข้าเมือง|ลักลอบเข้าเมือง|ตม\.)/.test(title)) {
    scores.migrant += 4;
  }
  if (scores.social >= 6 && /(สาธารณสุข|โรคระบาด|กรมควบคุมโรค|วัคซีน)/.test(title)) {
    scores.social += 6;
  }
  let bestCat = hintCategory || 'social';
  let bestScore = 0;
  for (const catId of ['narcotics', 'migrant', 'weather', 'security', 'economy', 'politics', 'social']) {
    if (scores[catId] > bestScore) {
      bestScore = scores[catId];
      bestCat = catId;
    }
  }
  return { category: bestCat, score: bestScore };
}

function normalizeTitleForDedup(title) {
  return title
    .toLowerCase()
    .replace(/["'“”‘’()[\]{}:;.,!?-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNearDuplicate(a, b) {
  const na = normalizeTitleForDedup(a);
  const nb = normalizeTitleForDedup(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 24 && nb.length >= 24) {
    if (na.includes(nb.slice(0, 28)) || nb.includes(na.slice(0, 28))) return true;
  }
  const wa = new Set(na.split(' ').filter((w) => w.length >= 2));
  const wb = new Set(nb.split(' ').filter((w) => w.length >= 2));
  if (wa.size < 3 || wb.size < 3) return false;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.min(wa.size, wb.size) >= 0.72;
}

function buildNewsId(title, publishedAt) {
  const seed = `${publishedAt.slice(0, 10)}|${normalizeTitleForDedup(title).slice(0, 64)}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `NEWS-${(hash >>> 0).toString(36).toUpperCase()}`;
}

async function fetchRssQuery({ hintCategory, q }) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=th&gl=TH&ceid=TH:th`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    throw new Error(`RSS HTTP ${res.status} for ${hintCategory}`);
  }
  const xml = await res.text();
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  return blocks.map((m) => {
    const itemXml = m[1];
    const sourceName = extractTag(itemXml, 'source');
    const rawTitle = extractTag(itemXml, 'title');
    const title = stripTrailingSource(rawTitle, sourceName);
    const link = extractTag(itemXml, 'link');
    const pubDate = extractTag(itemXml, 'pubDate');
    const desc = extractTag(itemXml, 'description');
    const cleanDesc = stripTrailingSource(desc, sourceName);
    return {
      title,
      summary: cleanDesc && cleanDesc !== title ? cleanDesc : title,
      link,
      sourceName,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      queryHintCategory: hintCategory,
    };
  });
}

async function fetchDirectRss({ sourceName, url }) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  return blocks.map((m) => {
    const itemXml = m[1];
    const title = stripTrailingSource(extractTag(itemXml, 'title'), sourceName);
    const link = extractTag(itemXml, 'link');
    const pubDate = extractTag(itemXml, 'pubDate');
    const desc = stripTrailingSource(extractTag(itemXml, 'description'), sourceName);
    return {
      title,
      summary: desc && desc !== title ? desc : title,
      link,
      sourceName,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
    };
  });
}

async function fetchSouthpeaceOfficial({ label, url, hintCategory }) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${label}`);
  }
  const posts = await res.json();
  if (!Array.isArray(posts)) return [];
  return posts.map((p) => {
    const title = decodeHtmlEntities(p?.title?.rendered || '');
    const fullContent = decodeHtmlEntities(p?.content?.rendered || '');
    const excerpt = decodeHtmlEntities(p?.excerpt?.rendered || '')
      .replace(/\[…\]|\[\.\.\.\]/g, '')
      .trim();
    const rawLead = (fullContent.length > excerpt.length ? fullContent : excerpt).slice(0, 900).trim();
    const rawDate = String(p?.date_gmt || p?.date || '');
    const isoDate = rawDate
      ? new Date(rawDate.endsWith('Z') ? rawDate : `${rawDate}Z`).toISOString()
      : new Date().toISOString();
    return {
      title,
      summary: rawLead && rawLead !== title ? rawLead : title,
      link: String(p?.link || '').trim(),
      sourceName: 'กอ.รมน.ภาค 4 สน.',
      publishedAt: isoDate,
      ...(hintCategory ? { queryHintCategory: hintCategory } : {}),
    };
  });
}

async function main() {
  const rules = JSON.parse(await fs.readFile(RULES_PATH, 'utf8'));
  const dramaRegexes = rules.dramaRejectionPatterns.map((p) => new RegExp(p, 'i'));
  const tierPriority = { 'official-public': 3, 'mainstream-credible': 2, 'local-neutral': 1 };

  const allCandidates = [];
  for (const spDef of SOUTHPEACE_ENDPOINTS) {
    try {
      const items = await fetchSouthpeaceOfficial(spDef);
      allCandidates.push(...items);
      console.log(`Fetched ${items.length} official items from [${spDef.label}]`);
    } catch (err) {
      console.warn(`Warning fetching [${spDef.label}]:`, err.message);
    }
  }

  for (const queryDef of QUERIES) {
    try {
      const items = await fetchRssQuery(queryDef);
      allCandidates.push(...items);
      console.log(`Fetched ${items.length} raw items for [${queryDef.hintCategory}]`);
    } catch (err) {
      console.warn(`Warning fetching [${queryDef.hintCategory}]:`, err.message);
    }
  }

  for (const feedDef of SUPPLEMENTARY_FEEDS) {
    try {
      const items = await fetchDirectRss(feedDef);
      allCandidates.push(...items);
      console.log(`Fetched ${items.length} supplementary items from [${feedDef.sourceName}]`);
    } catch (err) {
      console.warn(`Warning supplementary [${feedDef.sourceName}]:`, err.message);
    }
  }

  const nowMs = Date.now();
  const minMs = nowMs - WINDOW_HOURS * 60 * 60 * 1000;
  const stats = {
    totalChecked: allCandidates.length,
    acceptedCount: 0,
    excludedDramaCount: 0,
    excludedSourceCount: 0,
    excludedStaleCount: 0,
    excludedOutOfAreaCount: 0,
    excludedDuplicateCount: 0,
  };

  const accepted = [];
  for (const raw of allCandidates) {
    const title = (raw.title || '').replace(/\s+/g, ' ').trim();
    const summary = (raw.summary || '').replace(/\s+/g, ' ').trim();
    if (!title) continue;

    const src = evaluateNewsSource(raw.sourceName, rules);
    if (!src.accepted || !src.tier) {
      stats.excludedSourceCount++;
      continue;
    }
    if (isTabloidOrDramaNews(title, summary, dramaRegexes)) {
      stats.excludedDramaCount++;
      continue;
    }
    const pubMs = new Date(raw.publishedAt).getTime();
    if (Number.isNaN(pubMs) || pubMs < minMs || pubMs > nowMs + 12 * 60 * 60 * 1000) {
      stats.excludedStaleCount++;
      continue;
    }
    const combined = `${title} ${summary}`;
    const provinces = extractWing56Provinces(combined, rules);
    const hasRegion = rules.generalRegionTerms.some((t) => combined.includes(t));
    if (provinces.length === 0 && !hasRegion) {
      stats.excludedOutOfAreaCount++;
      continue;
    }

    const { category, score } = classifyCategory(title, summary, raw.queryHintCategory, rules);
    if (score < 4) {
      stats.excludedDramaCount++;
      continue;
    }
    const districtHint = extractDistrictHint(combined, rules);

    const item = {
      id: buildNewsId(title, raw.publishedAt),
      category,
      title,
      summary: summary && summary !== title ? summary : title,
      link: raw.link,
      sourceName: src.normalizedName,
      sourceTier: src.tier,
      publishedAt: new Date(pubMs).toISOString(),
      provinces: provinces.length > 0 ? provinces : ['ภาคใต้ตอนล่าง'],
      ...(districtHint ? { districtHint } : {}),
      score: score + tierPriority[src.tier],
    };

    const dupIdx = accepted.findIndex((ex) => isNearDuplicate(ex.title, item.title));
    if (dupIdx >= 0) {
      stats.excludedDuplicateCount++;
      const ex = accepted[dupIdx];
      if (
        tierPriority[item.sourceTier] * 100 + item.score >
        tierPriority[ex.sourceTier] * 100 + ex.score
      ) {
        accepted[dupIdx] = item;
      }
      continue;
    }
    accepted.push(item);
  }

  accepted.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  stats.acceptedCount = accepted.length;

  const feedPayload = {
    generatedAt: new Date(nowMs).toISOString(),
    windowHours: WINDOW_HOURS,
    items: accepted,
    stats,
    sourceMode: 'static',
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(feedPayload, null, 2), 'utf8');
  await fs.writeFile(RSS_OUTPUT_PATH, buildRss2Xml(feedPayload), 'utf8');

  console.log('Curated daily news summary:', stats);
  console.log(`Generated RSS 2.0 XML feed (${accepted.length} items): ${RSS_OUTPUT_PATH}`);
}

const RSS_CATEGORY_LABELS = {
  politics: 'การเมือง',
  economy: 'เศรษฐกิจ',
  social: 'สังคมและประชาคม',
  narcotics: 'ยาเสพติด',
  security: 'ความมั่นคงและเหตุรุนแรง',
  weather: 'พยากรณ์อากาศ/เฝ้าระวังภัยพิบัติ',
  migrant: 'แรงงานต่างด้าว/หลบหนีเข้าเมืองผิดกฎหมาย',
};

function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanRssExcerpt(text, maxLen = 360) {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  const slice = cleaned.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(' ');
  const cutoff = lastSpace > Math.floor(maxLen * 0.6) ? lastSpace : maxLen;
  return `${slice.slice(0, cutoff).trim()}…`;
}

function buildRss2Xml(feed) {
  const rawSiteUrl = process.env.SITE_URL || 'https://natstill27-ctrl.github.io/sbp-situation-report/';
  const siteUrl = rawSiteUrl.endsWith('/') ? rawSiteUrl : `${rawSiteUrl}/`;
  const buildDate = new Date(feed.generatedAt || Date.now()).toUTCString();
  const itemsXml = (feed.items || [])
    .map((item) => {
      const catLabel = RSS_CATEGORY_LABELS[item.category] || item.category || 'ข่าวกรอง';
      const provText = Array.isArray(item.provinces)
        ? item.provinces.map((p) => `จ.${p}`).join(', ')
        : 'ภาคใต้ตอนล่าง';
      const pubDate = Number.isNaN(new Date(item.publishedAt).getTime())
        ? buildDate
        : new Date(item.publishedAt).toUTCString();
      const excerpt = cleanRssExcerpt(item.summary || item.title);
      const desc = `${excerpt} (แหล่งข่าว: ${item.sourceName} | พื้นที่: ${provText})`;
      return [
        '    <item>',
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(item.link)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(item.id)}</guid>`,
        `      <pubDate>${escapeXml(pubDate)}</pubDate>`,
        `      <category>${escapeXml(catLabel)}</category>`,
        `      <description>${escapeXml(desc)}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?xml-stylesheet type="text/xsl" href="./daily-news.xsl"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>ศูนย์ข่าวกรองรายวัน ผขว.บก.บน.56 (7 จังหวัดภาคใต้ตอนล่าง)</title>',
    `    <link>${escapeXml(siteUrl)}</link>`,
    `    <atom:link href="${escapeXml(`${siteUrl}daily-news.xml`)}" rel="self" type="application/rss+xml" />`,
    '    <description>ฟีดข่าวกรองสาธารณะคัดกรอง 7 หมวดข่าว ครอบคลุมพื้นที่รับผิดชอบ กองบิน 56 ตามมาตรฐานเว็บไซต์ภาครัฐ มสพร. 11-2566</description>',
    '    <language>th</language>',
    `    <lastBuildDate>${escapeXml(buildDate)}</lastBuildDate>`,
    '    <generator>Wing 56 Intelligence Service Center RSS 2.0 Generator</generator>',
    itemsXml,
    '  </channel>',
    '</rss>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
