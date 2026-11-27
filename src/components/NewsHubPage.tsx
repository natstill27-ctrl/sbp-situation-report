import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Clock,
  ExternalLink,
  FilePlus2,
  Filter,
  ListChecks,
  Newspaper,
  RefreshCw,
  Rss,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { AppSettings } from '../types/incident';
import type {
  CuratedNewsItem,
  DailyNewsFeed,
  NewsCategoryId,
  NewsToIncidentDraft,
  SourceTier,
} from '../types/news';
import { getTargetProvinces } from '../utils/geoLookup';
import {
  buildIntelBrief5W1H,
  buildNiaProseSummary,
  formatIntelBrief5W1HText,
  formatNiaSummaryForCopy,
  getSourceReliabilityCode,
} from '../utils/intelBrief5w1h';
import {
  NEWS_CATEGORIES,
  NEWS_CATEGORY_MAP,
  SOURCE_TIER_LABELS,
  mapNewsCategoryToIncidentCategory,
} from '../utils/newsCurator';
import { fetchDailyNewsFeed, getVettedSourcesSummary } from '../utils/newsFeedClient';
import { formatThaiDateTime } from '../utils/thaiDate';

interface NewsHubPageProps {
  settings: AppSettings;
  requestedCategory?: 'all' | NewsCategoryId | null;
  onConsumeRequestedCategory?: () => void;
  onImportToIncident: (draft: NewsToIncidentDraft) => void;
}

function formatRelativeAge(isoString: string, nowMs: number): string {
  const pubMs = new Date(isoString).getTime();
  if (Number.isNaN(pubMs)) return '-';
  const diffMin = Math.max(0, Math.floor((nowMs - pubMs) / 60000));
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ชม. ที่แล้ว`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} วันที่แล้ว`;
}

export function NewsHubPage({
  settings,
  requestedCategory,
  onConsumeRequestedCategory,
  onImportToIncident,
}: NewsHubPageProps) {
  const [feed, setFeed] = useState<DailyNewsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [briefView, setBriefView] = useState<'nia' | '5w1h'>('nia');
  const [copiedNewsId, setCopiedNewsId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | NewsCategoryId>('all');
  const [isocOnly, setIsocOnly] = useState(false);
  const [provinceFilter, setProvinceFilter] = useState('');
  const [freshnessHours, setFreshnessHours] = useState<24 | 48 | 72 | 168>(72);
  const [tierFilter, setTierFilter] = useState<'' | SourceTier>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showTransparency, setShowTransparency] = useState(false);

  const provinces = useMemo(() => getTargetProvinces(), []);
  const vettedSources = useMemo(() => getVettedSourcesSummary(), []);
  const hasGasUrl = Boolean((settings.gasFetchUrl || settings.gasWebhookUrl).trim());

  useEffect(() => {
    if (requestedCategory) {
      setCategoryFilter(requestedCategory);
      onConsumeRequestedCategory?.();
    }
  }, [requestedCategory, onConsumeRequestedCategory]);

  const loadNews = async (opts: { preferLiveGas?: boolean; bustCache?: boolean } = {}) => {
    setLoadError('');
    const result = await fetchDailyNewsFeed(settings, opts);
    setFeed(result.feed);
    if (result.error) {
      setLoadError(result.error);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const result = await fetchDailyNewsFeed(settings, { preferLiveGas: hasGasUrl });
      if (!active) return;
      setFeed(result.feed);
      if (result.error) setLoadError(result.error);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [hasGasUrl]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadNews({ preferLiveGas: hasGasUrl, bustCache: true });
    } finally {
      setRefreshing(false);
    }
  };

  const nowMs = Date.now();

  const itemsInWindow = useMemo(() => {
    if (!feed) return [];
    const cutoff = nowMs - freshnessHours * 60 * 60 * 1000;
    return feed.items.filter((item) => {
      const t = new Date(item.publishedAt).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    });
  }, [feed, freshnessHours, nowMs]);

  const categoryCounts = useMemo(() => {
    const counts: Record<NewsCategoryId, number> = {
      politics: 0,
      economy: 0,
      social: 0,
      narcotics: 0,
      security: 0,
      weather: 0,
      migrant: 0,
    };
    for (const item of itemsInWindow) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }
    return counts;
  }, [itemsInWindow]);

  const isocCount = useMemo(
    () =>
      itemsInWindow.filter(
        (item) => item.sourceName.includes('กอ.รมน') || item.sourceName.includes('southpeace')
      ).length,
    [itemsInWindow]
  );

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return itemsInWindow.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (isocOnly && !item.sourceName.includes('กอ.รมน') && !item.sourceName.includes('southpeace')) {
        return false;
      }
      if (provinceFilter && !item.provinces.includes(provinceFilter)) return false;
      if (tierFilter && item.sourceTier !== tierFilter) return false;
      if (q) {
        const hay = `${item.title} ${item.summary} ${item.sourceName} ${item.provinces.join(' ')} ${
          item.districtHint || ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [itemsInWindow, categoryFilter, isocOnly, provinceFilter, tierFilter, searchQuery]);

  const handleImport = (item: CuratedNewsItem) => {
    const matchedProvince = item.provinces.find((p) => provinces.includes(p)) || '';
    const mappedIncidentCategory = mapNewsCategoryToIncidentCategory(item, settings.categories);
    const nia = buildNiaProseSummary(item);
    onImportToIncident({
      newsId: item.id,
      title: nia.headline,
      summary: nia.paragraph,
      link: item.link,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      newsCategory: item.category,
      mappedIncidentCategory,
      province: matchedProvince,
      district: item.districtHint || '',
    });
  };

  const handleCopyBrief = async (item: CuratedNewsItem) => {
    const text =
      briefView === 'nia' ? formatNiaSummaryForCopy(item) : formatIntelBrief5W1HText(item);
    await navigator.clipboard.writeText(text);
    setCopiedNewsId(item.id);
    window.setTimeout(() => {
      setCopiedNewsId((prev) => (prev === item.id ? null : prev));
    }, 2000);
  };

  const generatedLabel = feed?.generatedAt
    ? formatThaiDateTime(
        new Date(new Date(feed.generatedAt).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16),
        { shortMonth: true }
      )
    : '-';

  return (
    <section aria-labelledby="news-hub-heading" className="page-section">
      {/* Editorial Header Banner */}
      <div className="gov-card news-hub-hero">
        <div className="news-hub-hero-top">
          <div>
            <div className="news-editorial-pill">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>
                สรุปข่าวกรองแบบ สขช. (4–5 บรรทัด ครบหลัก 5W1H) • คัดสื่อตรงไปตรงมา &amp; ตัดข่าวดราม่า
              </span>
            </div>
            <h2 id="news-hub-heading" className="section-title" style={{ marginTop: '0.5rem' }}>
              ศูนย์ข่าวกรองรายวัน 7 จังหวัดภาคใต้ตอนล่าง (7 หมวดข่าวกรอง)
            </h2>
            <p className="section-subtitle">
              สรุปเนื้อหาข่าวให้เข้าใจครบภายใน 1 ย่อหน้า (4–5 บรรทัด) ตามรูปแบบสำนักข่าวกรองแห่งชาติ ครอบคลุมพื้นที่ ผขว.บก.บน.56 ทั้งด้านการเมือง เศรษฐกิจ สังคม ยาเสพติด ความมั่นคง อากาศ/ภัยพิบัติ และแรงงานต่างด้าว
            </p>
          </div>
          <div className="news-hub-actions">
            <button
              type="button"
              className={`btn btn-outline news-view-toggle ${briefView === 'nia' ? 'active' : ''}`}
              onClick={() => setBriefView((v) => (v === 'nia' ? '5w1h' : 'nia'))}
              aria-pressed={briefView === 'nia'}
            >
              <ListChecks size={16} aria-hidden="true" />
              <span>{briefView === 'nia' ? 'มุมมองสรุปแบบ สขช.' : 'มุมมองแยกช่อง 5W1H'}</span>
            </button>
            <span className="news-updated-badge">
              <Clock size={14} aria-hidden="true" />
              <span>อัปเดตล่าสุด: {generatedLabel}</span>
            </span>
            <a
              href="./daily-news.xml"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline"
              aria-label="เปิดฟีดข่าวมาตรฐาน RSS 2.0 (XML)"
              title="ฟีดข่าวมาตรฐาน RSS 2.0 (มสพร. 11-2566)"
            >
              <Rss size={16} aria-hidden="true" />
              <span>RSS 2.0</span>
            </a>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleRefresh}
              disabled={refreshing || loading}
            >
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} aria-hidden="true" />
              <span>{refreshing ? 'กำลังอัปเดต...' : 'อัปเดตข่าวล่าสุด'}</span>
            </button>
          </div>
        </div>

        {/* 7-Category KPI Selector Cards */}
        <div className="news-kpi-grid" role="group" aria-label="ตัวกรอง 7 หมวดข่าวกรอง">
          {NEWS_CATEGORIES.map((cat) => {
            const active = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                className={`news-kpi-card ${active ? 'active' : ''}`}
                style={{ '--cat-color': cat.color, '--cat-bg': cat.bgColor } as React.CSSProperties}
                onClick={() => setCategoryFilter(active ? 'all' : cat.id)}
                aria-pressed={active}
              >
                <div className="news-kpi-top">
                  <span className="news-kpi-label">{cat.label}</span>
                  <span className="news-kpi-count">{categoryCounts[cat.id]}</span>
                </div>
                <p className="news-kpi-desc">{cat.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="gov-card news-filter-bar">
        <div className="news-cat-pills" role="tablist" aria-label="เลือกหมวดข่าว">
          <button
            type="button"
            role="tab"
            aria-selected={categoryFilter === 'all'}
            className={`news-cat-pill ${categoryFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            <span>ทั้งหมด</span>
            <span className="news-pill-count">{itemsInWindow.length}</span>
          </button>
          {NEWS_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={categoryFilter === cat.id}
              className={`news-cat-pill ${categoryFilter === cat.id ? 'active' : ''}`}
              onClick={() => setCategoryFilter(cat.id)}
            >
              <span>{cat.shortLabel}</span>
              <span className="news-pill-count">{categoryCounts[cat.id]}</span>
            </button>
          ))}
          <button
            type="button"
            className={`news-cat-pill ${isocOnly ? 'active' : ''}`}
            aria-pressed={isocOnly}
            onClick={() => {
              const next = !isocOnly;
              setIsocOnly(next);
              if (next && freshnessHours < 168) {
                setFreshnessHours(168);
              }
            }}
            title="กรองเฉพาะข่าวทางการจากศูนย์ประชาสัมพันธ์ กอ.รมน.ภาค 4 สน. (southpeace.go.th)"
          >
            <span>เฉพาะ กอ.รมน.ภาค 4 สน.</span>
            <span className="news-pill-count">{isocCount}</span>
          </button>
        </div>

        <div className="news-filter-controls">
          <div className="search-box-wrap">
            <label htmlFor="news-search" className="sub-label">
              ค้นหาหัวข้อข่าว / อำเภอ / แหล่งข่าว
            </label>
            <div className="input-with-icon">
              <Search size={16} aria-hidden="true" />
              <input
                id="news-search"
                type="text"
                className="form-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="เช่น กอ.รมน., หาดใหญ่, ยางพารา, ยาบ้า..."
              />
            </div>
          </div>

          <div>
            <label htmlFor="news-province-filter" className="sub-label">
              จังหวัดพื้นที่รับผิดชอบ
            </label>
            <select
              id="news-province-filter"
              className="form-select"
              value={provinceFilter}
              onChange={(e) => setProvinceFilter(e.target.value)}
            >
              <option value="">ทุกจังหวัด (7 จังหวัด)</option>
              {provinces.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="ภาคใต้ตอนล่าง">ภาพรวมภาคใต้ตอนล่าง</option>
            </select>
          </div>

          <div>
            <label htmlFor="news-freshness-filter" className="sub-label">
              ความสดใหม่ของข่าว
            </label>
            <select
              id="news-freshness-filter"
              className="form-select"
              value={freshnessHours}
              onChange={(e) => setFreshnessHours(Number(e.target.value) as 24 | 48 | 72 | 168)}
            >
              <option value={24}>24 ชั่วโมงล่าสุด (วันนี้)</option>
              <option value={48}>48 ชั่วโมงล่าสุด</option>
              <option value={72}>3 วันล่าสุด (72 ชม.)</option>
              <option value={168}>7 วันล่าสุด (รวมข่าวชี้แจง กอ.รมน.)</option>
            </select>
          </div>

          <div>
            <label htmlFor="news-tier-filter" className="sub-label">
              ระดับแหล่งข่าว
            </label>
            <select
              id="news-tier-filter"
              className="form-select"
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value as '' | SourceTier)}
            >
              <option value="">ทุกแหล่งข่าวที่ผ่านเกณฑ์</option>
              <option value="official-public">{SOURCE_TIER_LABELS['official-public']}</option>
              <option value="mainstream-credible">{SOURCE_TIER_LABELS['mainstream-credible']}</option>
              <option value="local-neutral">{SOURCE_TIER_LABELS['local-neutral']}</option>
            </select>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="inline-alert warn" role="alert">
          <span>{loadError}</span>
        </div>
      )}

      {/* News Feed List */}
      {loading ? (
        <div className="gov-card loading-card" role="status">
          กำลังโหลดและคัดกรองข่าวสารรายวัน...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="gov-card empty-state-card">
          <Newspaper size={36} aria-hidden="true" />
          <h3>ไม่พบข่าวที่ตรงตามตัวกรอง</h3>
          <p>
            ลองขยายกรอบเวลาเป็น 72 ชม. หรือเลือกดูทุกจังหวัด / ทุกหมวดข่าว (ระบบคัดกรองเฉพาะข่าวที่มีเนื้อหาสาระจากสื่อที่ผ่านเกณฑ์เท่านั้น)
          </p>
          {(categoryFilter !== 'all' || isocOnly || provinceFilter || tierFilter || searchQuery || freshnessHours !== 72) && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setCategoryFilter('all');
                setIsocOnly(false);
                setProvinceFilter('');
                setTierFilter('');
                setSearchQuery('');
                setFreshnessHours(72);
              }}
            >
              <Filter size={15} aria-hidden="true" />
              <span>ล้างตัวกรองทั้งหมด</span>
            </button>
          )}
        </div>
      ) : (
        <div className="news-cards-grid">
          {filteredItems.map((item) => {
            const meta = NEWS_CATEGORY_MAP[item.category];
            const nia = buildNiaProseSummary(item);
            const brief = buildIntelBrief5W1H(item);
            const reliability = getSourceReliabilityCode(item.sourceTier);
            return (
              <article key={item.id} className="gov-card news-item-card">
                <div className="news-card-meta-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.38rem', flexWrap: 'wrap' }}>
                    <span
                      className="news-cat-badge"
                      style={{ color: meta.color, backgroundColor: meta.bgColor }}
                    >
                      {meta.label}
                    </span>
                    {item.provinces.map((p) => (
                      <span key={p} className="news-prov-chip">
                        จ.{p}
                      </span>
                    ))}
                    <span className="news-reliability-code" title={reliability.label}>
                      รหัส {reliability.code}
                    </span>
                  </div>
                  <span className="news-age-text">{formatRelativeAge(item.publishedAt, nowMs)}</span>
                </div>

                {briefView === 'nia' ? (
                  <div className="news-nia-body">
                    <h3 className="news-card-title">{nia.headline}</h3>
                    <p className="news-nia-meta">
                      เผยแพร่เมื่อ : {nia.publishedLabel} | แหล่งข่าว : {item.sourceName}
                    </p>
                    <p className="news-nia-prose">{nia.paragraph}</p>
                  </div>
                ) : (
                  <div className="news-5w1h-list" aria-label="แยกโครงสร้างข่าวกรอง 5W1H">
                    <div className="news-5w1h-row">
                      <span className="news-5w1h-tag tag-what">WHAT</span>
                      <span className="news-5w1h-text strong">{brief.what}</span>
                    </div>
                    <div className="news-5w1h-row">
                      <span className="news-5w1h-tag tag-who">WHO</span>
                      <span className="news-5w1h-text">{brief.who}</span>
                    </div>
                    <div className="news-5w1h-row">
                      <span className="news-5w1h-tag tag-where">WHERE/WHEN</span>
                      <span className="news-5w1h-text">{brief.whereWhen}</span>
                    </div>
                    <div className="news-5w1h-row">
                      <span className="news-5w1h-tag tag-why">WHY/HOW</span>
                      <span className="news-5w1h-text">{brief.whyHow}</span>
                    </div>
                    <div className="news-5w1h-row row-assess">
                      <span className="news-5w1h-tag tag-assess">นัยข่าวกรอง</span>
                      <span className="news-5w1h-text">{brief.assessment}</span>
                    </div>
                  </div>
                )}

                <div className="news-card-footer">
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {item.link && (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-sm btn-outline"
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                        <span>ต้นฉบับ</span>
                      </a>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => handleCopyBrief(item)}
                      title="คัดลอกสรุปข่าวตามรูปแบบ สขช."
                    >
                      {copiedNewsId === item.id ? (
                        <Check size={14} aria-hidden="true" />
                      ) : (
                        <ClipboardCopy size={14} aria-hidden="true" />
                      )}
                      <span>{copiedNewsId === item.id ? 'คัดลอกแล้ว' : 'คัดลอกสรุปข่าว'}</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => handleImport(item)}
                  >
                    <FilePlus2 size={14} aria-hidden="true" />
                    <span>นำเข้าบันทึกเหตุการณ์</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Editorial Transparency Panel */}
      <div className="gov-card news-transparency-card">
        <button
          type="button"
          className="news-transparency-toggle"
          aria-expanded={showTransparency}
          onClick={() => setShowTransparency((prev) => !prev)}
        >
          <span className="news-transparency-title">
            <Sparkles size={16} aria-hidden="true" />
            <span>
              หลักการสรุป 5W1H (แนวทาง สขช.) และสถิติคัดกรองแหล่งข่าวรอบล่าสุด
              {feed
                ? ` (ตรวจ ${feed.stats.totalChecked} • ผ่าน ${feed.stats.acceptedCount} • ตัดดราม่า/ข่าวชาวบ้าน ${feed.stats.excludedDramaCount} • ตัดแหล่งข่าวไม่ผ่านเกณฑ์ ${feed.stats.excludedSourceCount})`
                : ''}
            </span>
          </span>
          {showTransparency ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {showTransparency && (
          <div className="news-transparency-body">
            <div className="news-5w1h-doctrine-note">
              <strong>มาตรฐานการสรุปข่าวกรอง 5 บรรทัด (อ้างอิงหลัก BLUF + 5W1H ของสำนักข่าวกรองแห่งชาติ):</strong>{' '}
              บรรทัดที่ 1 <code>WHAT</code> ระบุข้อเท็จจริงหลักแบบไร้คำพาดหัวหวือหวา • บรรทัดที่ 2{' '}
              <code>WHO</code> ระบุหน่วย/บุคคลที่เกี่ยวข้อง • บรรทัดที่ 3 <code>WHERE/WHEN</code>{' '}
              ระบุพื้นที่และห้วงเวลา พ.ศ. • บรรทัดที่ 4 <code>WHY/HOW</code> ระบุสาเหตุ/วิธีการ/ผลปฏิบัติ • บรรทัดที่ 5{' '}
              <code>นัยข่าวกรอง</code> ประเมินผลกระทบต่อพื้นที่รับผิดชอบ บก.บน.56 พร้อมรหัสความน่าเชื่อถือ{' '}
              <code>B2</code> (สื่อรัฐ/สาธารณะ), <code>C2</code> (สื่อหลักระดับประเทศ), <code>C3</code> (สื่อท้องถิ่นเป็นกลาง)
            </div>
            <div className="news-sources-grid">
              <div>
                <h4>1. สื่อสาธารณะ / หน่วยงานราชการ (รหัส B2)</h4>
                <p>{vettedSources.official.join(', ')}</p>
              </div>
              <div>
                <h4>2. สื่อหลักระดับประเทศที่รายงานตรงไปตรงมา (รหัส C2)</h4>
                <p>{vettedSources.mainstream.join(', ')}</p>
              </div>
              <div>
                <h4>3. สื่อท้องถิ่นภาคใต้ที่เป็นกลาง (รหัส C3)</h4>
                <p>{vettedSources.local.join(', ')}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
