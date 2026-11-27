import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FilePlus2,
  Filter,
  Newspaper,
  RefreshCw,
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
  NEWS_CATEGORIES,
  NEWS_CATEGORY_MAP,
  SOURCE_TIER_LABELS,
  mapNewsCategoryToIncidentCategory,
} from '../utils/newsCurator';
import { fetchDailyNewsFeed, getVettedSourcesSummary } from '../utils/newsFeedClient';
import { formatThaiDateTime } from '../utils/thaiDate';

interface NewsHubPageProps {
  settings: AppSettings;
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

export function NewsHubPage({ settings, onImportToIncident }: NewsHubPageProps) {
  const [feed, setFeed] = useState<DailyNewsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [categoryFilter, setCategoryFilter] = useState<'all' | NewsCategoryId>('all');
  const [provinceFilter, setProvinceFilter] = useState('');
  const [freshnessHours, setFreshnessHours] = useState<24 | 48 | 72>(72);
  const [tierFilter, setTierFilter] = useState<'' | SourceTier>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showTransparency, setShowTransparency] = useState(false);

  const provinces = useMemo(() => getTargetProvinces(), []);
  const vettedSources = useMemo(() => getVettedSourcesSummary(), []);
  const hasGasUrl = Boolean((settings.gasFetchUrl || settings.gasWebhookUrl).trim());

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
    };
    for (const item of itemsInWindow) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }
    return counts;
  }, [itemsInWindow]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return itemsInWindow.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
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
  }, [itemsInWindow, categoryFilter, provinceFilter, tierFilter, searchQuery]);

  const handleImport = (item: CuratedNewsItem) => {
    const matchedProvince =
      item.provinces.find((p) => provinces.includes(p)) || '';
    const mappedIncidentCategory = mapNewsCategoryToIncidentCategory(item, settings.categories);
    onImportToIncident({
      newsId: item.id,
      title: item.title,
      summary: item.summary,
      link: item.link,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      newsCategory: item.category,
      mappedIncidentCategory,
      province: matchedProvince,
      district: item.districtHint || '',
    });
  };

  const generatedLabel = feed?.generatedAt
    ? formatThaiDateTime(new Date(new Date(feed.generatedAt).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16), {
        shortMonth: true,
      })
    : '-';

  return (
    <section aria-labelledby="news-hub-heading" className="page-section">
      {/* Editorial Header Banner */}
      <div className="gov-card news-hub-hero">
        <div className="news-hub-hero-top">
          <div>
            <div className="news-editorial-pill">
              <ShieldCheck size={15} aria-hidden="true" />
              <span>คัดกรองเฉพาะสื่อหลักที่ตรงไปตรงมา &amp; สื่อท้องถิ่นเป็นกลาง • ตัดข่าวชาวบ้าน/ดราม่า</span>
            </div>
            <h2 id="news-hub-heading" className="section-title" style={{ marginTop: '0.5rem' }}>
              ศูนย์ข่าวกรองรายวัน 7 จังหวัดภาคใต้ตอนล่าง
            </h2>
            <p className="section-subtitle">
              ติดตามความเคลื่อนไหวรายวันครอบคลุมพื้นที่รับผิดชอบ ผขว.บก.บน.56 (ตรัง พัทลุง สตูล สงขลา ปัตตานี ยะลา นราธิวาส) แยกตาม 5 หมวดข่าวหลัก
            </p>
          </div>
          <div className="news-hub-actions">
            <span className="news-updated-badge">
              <Clock size={14} aria-hidden="true" />
              <span>อัปเดตล่าสุด: {generatedLabel}</span>
            </span>
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

        {/* 5-Category KPI Selector Cards */}
        <div className="news-kpi-grid" role="group" aria-label="ตัวกรอง 5 หมวดข่าวกรอง">
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
              onChange={(e) => setFreshnessHours(Number(e.target.value) as 24 | 48 | 72)}
            >
              <option value={24}>24 ชั่วโมงล่าสุด (วันนี้)</option>
              <option value={48}>48 ชั่วโมงล่าสุด</option>
              <option value={72}>3 วันล่าสุด (72 ชม.)</option>
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
          {(categoryFilter !== 'all' || provinceFilter || tierFilter || searchQuery || freshnessHours !== 72) && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setCategoryFilter('all');
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
            const bkkIso = new Date(new Date(item.publishedAt).getTime() + 7 * 60 * 60 * 1000)
              .toISOString()
              .slice(0, 16);
            return (
              <article key={item.id} className="gov-card news-item-card">
                <div className="news-card-meta-top">
                  <span
                    className="news-cat-badge"
                    style={{ color: meta.color, backgroundColor: meta.bgColor }}
                  >
                    {meta.label}
                  </span>
                  <span className="news-age-text" title={formatThaiDateTime(bkkIso)}>
                    {formatRelativeAge(item.publishedAt, nowMs)} • {formatThaiDateTime(bkkIso)}
                  </span>
                </div>

                <h3 className="news-card-title">{item.title}</h3>
                {item.summary && item.summary !== item.title && (
                  <p className="news-card-summary">{item.summary}</p>
                )}

                <div className="news-card-tags">
                  {item.provinces.map((p) => (
                    <span key={p} className="news-prov-chip">
                      จว.{p}
                    </span>
                  ))}
                  {item.districtHint && (
                    <span className="news-dist-chip">อ.{item.districtHint}</span>
                  )}
                  <span className={`news-tier-badge tier-${item.sourceTier}`}>
                    {item.sourceName} ({SOURCE_TIER_LABELS[item.sourceTier]})
                  </span>
                </div>

                <div className="news-card-footer">
                  {item.link ? (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm btn-outline"
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      <span>อ่านข่าวต้นฉบับ</span>
                    </a>
                  ) : (
                    <span />
                  )}
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
              เกณฑ์คัดกรองและสถิติแหล่งข่าวรอบล่าสุด
              {feed
                ? ` (ตรวจ ${feed.stats.totalChecked} • ผ่าน ${feed.stats.acceptedCount} • ตัดดราม่า/ข่าวชาวบ้าน ${feed.stats.excludedDramaCount} • ตัดแหล่งข่าวไม่ผ่านเกณฑ์ ${feed.stats.excludedSourceCount})`
                : ''}
            </span>
          </span>
          {showTransparency ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {showTransparency && (
          <div className="news-transparency-body">
            <div className="news-sources-grid">
              <div>
                <h4>1. สื่อสาธารณะ / หน่วยงานราชการ</h4>
                <p>{vettedSources.official.join(', ')}</p>
              </div>
              <div>
                <h4>2. สื่อหลักระดับประเทศที่รายงานตรงไปตรงมา</h4>
                <p>{vettedSources.mainstream.join(', ')}</p>
              </div>
              <div>
                <h4>3. สื่อท้องถิ่นภาคใต้ที่เป็นกลาง</h4>
                <p>{vettedSources.local.join(', ')}</p>
              </div>
            </div>
            <p className="field-hint" style={{ marginTop: '0.65rem' }}>
              ระบบตัดข่าวจากโซเชียลมีเดียไม่มีบรรณาธิการ, ข่าวดราม่าครอบครัว/เพื่อนบ้าน, ข่าวบันเทิง-กีฬา-หวย-ความเชื่อ และจำกัดเฉพาะพื้นที่ 7 จังหวัดภาคใต้ตอนล่างโดยอัตโนมัติ
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
