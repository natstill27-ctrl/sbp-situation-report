import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RULES_PATH = path.join(ROOT, 'src', 'data', 'newsRules.json');
const OUTPUT_PATH = path.join(ROOT, 'public', 'daily-news.json');

const WINDOW_HOURS = 72;

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
    q: '(น้ำท่วม OR อุทกภัย OR สาธารณสุข OR การศึกษา OR ประชาคม OR ชุมชน OR แรงงานต่างด้าว) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:3d',
  },
  {
    hintCategory: 'narcotics',
    q: '(ยาเสพติด OR ยาบ้า OR ไอซ์ OR ป.ป.ส. OR กัญชา OR กระท่อม OR เครือข่ายยาเสพติด) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:3d',
  },
  {
    hintCategory: 'security',
    q: '(ความมั่นคง OR กอ.รมน. OR ระเบิด OR ลอบยิง OR ปะทะ OR ก่อเหตุรุนแรง OR ฝ่ายความมั่นคง OR EOD OR ปิดล้อม) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:3d',
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
    .replace(/&#8230;/g, '…')
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
  const scores = { politics: 0, economy: 0, social: 0, narcotics: 0, security: 0 };
  for (const [catId, pairs] of Object.entries(rules.categoryKeywords)) {
    for (const [kw, weight] of pairs) {
      if (title.includes(kw)) scores[catId] += weight * 2;
      else if (summary.includes(kw)) scores[catId] += weight;
    }
  }
  if (
    scores.social >= 6 &&
    /(น้ำท่วม|อุทกภัย|สถานการณ์น้ำ|ระดับน้ำ|ระบายน้ำ|ผู้ประสบภัย|ฝนตกหนัก|สาธารณสุข|โรคระบาด|กรมควบคุมโรค)/.test(
      title
    )
  ) {
    scores.social += 6;
  }
  let bestCat = hintCategory || 'social';
  let bestScore = 0;
  for (const catId of ['narcotics', 'security', 'economy', 'politics', 'social']) {
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

async function main() {
  const rules = JSON.parse(await fs.readFile(RULES_PATH, 'utf8'));
  const dramaRegexes = rules.dramaRejectionPatterns.map((p) => new RegExp(p, 'i'));
  const tierPriority = { 'official-public': 3, 'mainstream-credible': 2, 'local-neutral': 1 };

  const allCandidates = [];
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

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date(nowMs).toISOString(),
        windowHours: WINDOW_HOURS,
        items: accepted,
        stats,
        sourceMode: 'static',
      },
      null,
      2
    ),
    'utf8'
  );

  console.log('Curated daily news summary:', stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
