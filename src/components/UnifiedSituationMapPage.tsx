import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Crosshair,
  Layers,
  MapPin,
  NotebookPen,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import type { AppSettings, IncidentRecord, WatchAlertRecord } from '../types/incident';
import type { CuratedNewsItem, DailyLogRecord, NewsCategoryId } from '../types/news';
import { getCategoryColor } from '../utils/categoryColors';
import {
  getCenterOfArea,
  getDistrictBoundariesGeoJson,
  getTargetProvinces,
  getWatchZonePolygonsGeoJson,
} from '../utils/geoLookup';
import { buildNiaProseSummary, getSourceReliabilityCode } from '../utils/intelBrief5w1h';
import { NEWS_CATEGORIES, NEWS_CATEGORY_MAP } from '../utils/newsCurator';
import { fetchDailyNewsFeed } from '../utils/newsFeedClient';
import { createPmtilesRasterLayer } from '../utils/pmtilesLayer';
import { escapeHtml, sanitizeHttpUrl } from '../utils/safeHtml';
import { formatThaiDateTime, isWatchAlertActive } from '../utils/thaiDate';
import type { BasemapType } from './LeafletMap';

interface UnifiedSituationMapPageProps {
  settings: AppSettings;
  dailyLogs: DailyLogRecord[];
  incidents: IncidentRecord[];
  watchAlerts: WatchAlertRecord[];
  staffUnlocked: boolean;
  onRefreshDailyLogs?: () => Promise<void>;
  onOpenDailyLogForm?: () => void;
}

type UnifiedPinSource = 'news' | 'daily-log' | 'ipb';

interface UnifiedBriefingPin {
  uid: string;
  sourceType: UnifiedPinSource;
  title: string;
  summary: string;
  occurredAt: string;
  categoryLabel: string;
  newsCategoryId?: NewsCategoryId;
  color: string;
  province: string;
  district: string;
  subdistrict: string;
  sourceName: string;
  reliabilityCode: string;
  link?: string;
  analystNote?: string;
  lat: number | null;
  lng: number | null;
  coordIsApprox: boolean;
}

const DEFAULT_CENTER: [number, number] = [6.95, 100.55];
const DEFAULT_ZOOM = 8;

function createBasemapLayer(
  offlinePmtilesUrl?: string,
  basemap: BasemapType = 'osm'
): L.GridLayer {
  const pmtilesUrl = (offlinePmtilesUrl || '').trim();
  if (pmtilesUrl) {
    return createPmtilesRasterLayer(pmtilesUrl);
  }
  if (basemap === 'satellite') {
    return L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles &copy; Esri', maxZoom: 18 }
    );
  }
  if (basemap === 'topo') {
    return L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenTopoMap',
      maxZoom: 17,
    });
  }
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  });
}

function createUnifiedDivIcon(sourceType: UnifiedPinSource, color: string): L.DivIcon {
  if (sourceType === 'daily-log') {
    // Diamond/Shield pin with gold border for Department Daily Logs
    return L.divIcon({
      className: 'custom-map-pin',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
      html: `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <polygon points="14,2 26,14 14,26 2,14" fill="${color}" stroke="#facc15" stroke-width="2.4"/>
        <circle cx="14" cy="14" r="3.8" fill="#ffffff"/>
      </svg>`,
    });
  }
  if (sourceType === 'ipb') {
    // Classic teardrop pin for IPB incidents
    return L.divIcon({
      className: 'custom-map-pin',
      iconSize: [26, 26],
      iconAnchor: [13, 26],
      popupAnchor: [0, -22],
      html: `<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="${color}" stroke="#0f172a" stroke-width="1.8"/>
        <circle cx="12" cy="9" r="2.8" fill="#ffffff"/>
      </svg>`,
    });
  }
  // Crisp circle badge for Daily Curated News
  return L.divIcon({
    className: 'custom-map-pin',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -10],
    html: `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" fill="${color}" stroke="#ffffff" stroke-width="2.2"/>
    </svg>`,
  });
}

function spreadCollidingCoordinates(pins: UnifiedBriefingPin[]): UnifiedBriefingPin[] {
  const seenCounts = new Map<string, number>();
  return pins.map((pin) => {
    if (pin.lat === null || pin.lng === null) return pin;
    const key = `${pin.lat.toFixed(3)},${pin.lng.toFixed(3)}`;
    const count = seenCounts.get(key) || 0;
    seenCounts.set(key, count + 1);
    if (count === 0) return pin;

    const angle = count * 2.39996; // Golden angle spread so co-located pins stay clickable
    const radius = 0.011 * Math.sqrt(count);
    return {
      ...pin,
      lat: Number((pin.lat + radius * Math.sin(angle)).toFixed(6)),
      lng: Number((pin.lng + radius * Math.cos(angle)).toFixed(6)),
    };
  });
}

export function UnifiedSituationMapPage({
  settings,
  dailyLogs,
  incidents,
  watchAlerts,
  staffUnlocked,
  onRefreshDailyLogs,
  onOpenDailyLogForm,
}: UnifiedSituationMapPageProps) {
  const [newsItems, setNewsItems] = useState<CuratedNewsItem[]>([]);
  const [loadingNews, setLoadingNews] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showNewsLayer, setShowNewsLayer] = useState(true);
  const [showDailyLogLayer, setShowDailyLogLayer] = useState(true);
  const [showIpbLayer, setShowIpbLayer] = useState(true);
  const [showWatchLayer, setShowWatchLayer] = useState(true);
  const [showBoundaries, setShowBoundaries] = useState(true);

  const [provinceFilter, setProvinceFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | NewsCategoryId>('all');
  const [timeWindowDays, setTimeWindowDays] = useState<7 | 30 | 90 | 0>(30);
  const [searchQuery, setSearchQuery] = useState('');
  const [basemap, setBasemap] = useState<BasemapType>('osm');
  const [visibleCount, setVisibleCount] = useState(20);

  const provinces = useMemo(() => getTargetProvinces(), []);
  const hasGasUrl = Boolean((settings.gasFetchUrl || settings.gasWebhookUrl).trim());
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.GridLayer | null>(null);
  const baseKeyRef = useRef<string>('');
  const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
  const watchLayerRef = useRef<L.LayerGroup | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const markerByUidRef = useRef<Map<string, L.Marker>>(new Map());

  const loadAllNews = async (bustCache = false) => {
    const res = await fetchDailyNewsFeed(settings, {
      preferLiveGas: hasGasUrl,
      bustCache,
    });
    return res.feed.items;
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingNews(true);
      const items = await loadAllNews(false);
      if (active) {
        setNewsItems(items);
        setLoadingNews(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [hasGasUrl]);

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      const [items] = await Promise.all([
        loadAllNews(true),
        onRefreshDailyLogs ? onRefreshDailyLogs() : Promise.resolve(),
      ]);
      setNewsItems(items);
    } finally {
      setRefreshing(false);
    }
  };

  const activeWatchAlerts = useMemo(
    () => watchAlerts.filter((w) => isWatchAlertActive(w) === 'active'),
    [watchAlerts]
  );

  const rawUnifiedPins = useMemo<UnifiedBriefingPin[]>(() => {
    const items: UnifiedBriefingPin[] = [];

    if (showNewsLayer) {
      for (const n of newsItems) {
        const meta = NEWS_CATEGORY_MAP[n.category];
        const nia = buildNiaProseSummary(n);
        const rel = getSourceReliabilityCode(n.sourceTier);
        const primaryProv = n.provinces.find((p) => provinces.includes(p)) || '';
        const center = primaryProv
          ? getCenterOfArea(primaryProv, n.districtHint || undefined) ||
            getCenterOfArea(primaryProv)
          : null;

        items.push({
          uid: `news:${n.id}`,
          sourceType: 'news',
          title: nia.headline,
          summary: nia.paragraph,
          occurredAt: n.publishedAt,
          categoryLabel: meta?.label || n.category,
          newsCategoryId: n.category,
          color: meta?.color || '#1d5bb8',
          province: primaryProv || n.provinces[0] || 'ภาคใต้ตอนล่าง',
          district: n.districtHint || '',
          subdistrict: '',
          sourceName: n.sourceName,
          reliabilityCode: rel.code,
          link: n.link,
          lat: center?.lat ?? null,
          lng: center?.lng ?? null,
          coordIsApprox: true,
        });
      }
    }

    if (showDailyLogLayer) {
      for (const log of dailyLogs) {
        const meta = NEWS_CATEGORY_MAP[log.category];
        const hasExact = log.lat !== null && log.lng !== null;
        const center =
          !hasExact && log.province
            ? getCenterOfArea(
                log.province,
                log.district || undefined,
                log.subdistrict || undefined
              ) || getCenterOfArea(log.province)
            : null;
        items.push({
          uid: `log:${log.id}`,
          sourceType: 'daily-log',
          title: log.title,
          summary: log.summary,
          occurredAt: log.occurredAt,
          categoryLabel: meta?.label || log.category,
          newsCategoryId: log.category,
          color: meta?.color || '#1d5bb8',
          province: log.province,
          district: log.district,
          subdistrict: log.subdistrict,
          sourceName: log.sourceName,
          reliabilityCode: log.reliabilityCode || 'B2',
          link: log.sourceLink,
          analystNote: log.analystNote,
          lat: hasExact ? log.lat : (center?.lat ?? null),
          lng: hasExact ? log.lng : (center?.lng ?? null),
          coordIsApprox: !hasExact,
        });
      }
    }

    if (showIpbLayer) {
      for (const inc of incidents) {
        items.push({
          uid: `ipb:${inc.id}`,
          sourceType: 'ipb',
          title: `[IPB] ${inc.category}`,
          summary: inc.details,
          occurredAt: inc.occurredAt,
          categoryLabel: inc.category,
          color: getCategoryColor(inc.category, settings.categories.indexOf(inc.category)),
          province: inc.province,
          district: inc.district,
          subdistrict: inc.subdistrict,
          sourceName: `ฐานข้อมูล IPB ผขว.${inc.reporter ? ` (${inc.reporter})` : ''}`,
          reliabilityCode: 'A1',
          lat: inc.lat,
          lng: inc.lng,
          coordIsApprox: false,
        });
      }
    }

    return items;
  }, [
    showNewsLayer,
    showDailyLogLayer,
    showIpbLayer,
    newsItems,
    dailyLogs,
    incidents,
    provinces,
    settings.categories,
  ]);

  const filteredPins = useMemo(() => {
    const cutoffMs =
      timeWindowDays > 0 ? Date.now() - timeWindowDays * 24 * 60 * 60 * 1000 : 0;
    const q = searchQuery.trim().toLowerCase();

    const filtered = rawUnifiedPins
      .filter((pin) => {
        if (cutoffMs > 0) {
          const t = new Date(pin.occurredAt).getTime();
          if (!Number.isNaN(t) && t < cutoffMs) return false;
        }
        if (provinceFilter && pin.province !== provinceFilter) return false;
        if (categoryFilter !== 'all') {
          if (pin.sourceType === 'ipb') return false;
          if (pin.newsCategoryId !== categoryFilter) return false;
        }
        if (q) {
          const hay = `${pin.title} ${pin.summary} ${pin.province} ${pin.district} ${pin.sourceName} ${pin.categoryLabel}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort(
        (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
      );

    return spreadCollidingCoordinates(filtered);
  }, [rawUnifiedPins, timeWindowDays, provinceFilter, categoryFilter, searchQuery]);

  const mappablePins = useMemo(
    () => filteredPins.filter((p) => p.lat !== null && p.lng !== null),
    [filteredPins]
  );

  useEffect(() => {
    setVisibleCount(20);
  }, [provinceFilter, categoryFilter, timeWindowDays, searchQuery, showNewsLayer, showDailyLogLayer, showIpbLayer]);

  // Initialize Leaflet map once with ResizeObserver so sidebar toggle never leaves grey strips
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    const base = createBasemapLayer(settings.offlinePmtilesUrl, basemap).addTo(map);
    baseKeyRef.current = `${(settings.offlinePmtilesUrl || '').trim()}|${basemap}`;
    const watchGroup = L.layerGroup().addTo(map);
    const markerGroup = L.layerGroup().addTo(map);

    mapRef.current = map;
    baseLayerRef.current = base;
    watchLayerRef.current = watchGroup;
    markerLayerRef.current = markerGroup;

    const initTimer = window.setTimeout(() => map.invalidateSize(), 150);
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && mapContainerRef.current
        ? new ResizeObserver(() => {
            map.invalidateSize();
          })
        : null;
    if (resizeObserver && mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      window.clearTimeout(initTimer);
      resizeObserver?.disconnect();
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      baseKeyRef.current = '';
      boundaryLayerRef.current = null;
      watchLayerRef.current = null;
      markerLayerRef.current = null;
      markerByUidRef.current.clear();
    };
  }, []);

  // Update basemap or offline PMTiles layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const nextKey = `${(settings.offlinePmtilesUrl || '').trim()}|${basemap}`;
    if (baseKeyRef.current === nextKey) return;
    baseKeyRef.current = nextKey;

    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }
    baseLayerRef.current = createBasemapLayer(settings.offlinePmtilesUrl, basemap).addTo(map);
    baseLayerRef.current.bringToBack();
  }, [basemap, settings.offlinePmtilesUrl]);

  // Toggle district boundaries (77 districts across 7 provinces)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (boundaryLayerRef.current) {
      map.removeLayer(boundaryLayerRef.current);
      boundaryLayerRef.current = null;
    }
    if (showBoundaries) {
      const geojson = getDistrictBoundariesGeoJson();
      const layer = L.geoJSON(geojson as GeoJSON.GeoJsonObject, {
        style: {
          color: '#1d5bb8',
          weight: 1.15,
          opacity: 0.45,
          fillColor: '#1d5bb8',
          fillOpacity: 0.03,
        },
        onEachFeature: (feature, fLayer) => {
          const props = feature.properties as { province?: string; district?: string } | undefined;
          if (props?.district && props?.province) {
            fLayer.bindTooltip(escapeHtml(`อ.${props.district} จ.${props.province}`), {
              sticky: true,
            });
          }
        },
      }).addTo(map);
      boundaryLayerRef.current = layer;
    }
  }, [showBoundaries]);

  // Render active Watch Advisory polygons
  useEffect(() => {
    const watchGroup = watchLayerRef.current;
    if (!watchGroup) return;
    watchGroup.clearLayers();
    if (!showWatchLayer || activeWatchAlerts.length === 0) return;

    const palette: Record<string, string> = {
      critical: '#dc2626',
      high: '#ea580c',
      medium: '#ca8a04',
    };

    for (const alert of activeWatchAlerts) {
      const geo = getWatchZonePolygonsGeoJson(alert.areas);
      const c = palette[alert.alertLevel] || '#ea580c';
      L.geoJSON(geo as GeoJSON.GeoJsonObject, {
        style: {
          color: c,
          weight: 2,
          dashArray: '5 4',
          fillColor: c,
          fillOpacity: 0.16,
        },
        onEachFeature: (feature, fLayer) => {
          const props = feature.properties as
            | { province?: string; district?: string }
            | undefined;
          if (props) {
            fLayer.bindPopup(
              `<strong>เขตเฝ้าระวัง: อ.${escapeHtml(props.district || '-')} จ.${escapeHtml(
                props.province || '-'
              )}</strong><br/>ภัยคุกคาม: ${escapeHtml(alert.threatType || '-')}<br/>ถึง: ${escapeHtml(
                formatThaiDateTime(alert.watchEnd || '', { shortMonth: true, includeTime: false })
              )}`
            );
          }
        },
      }).addTo(watchGroup);
    }
  }, [showWatchLayer, activeWatchAlerts]);

  // Render unified pins
  useEffect(() => {
    const markerGroup = markerLayerRef.current;
    if (!markerGroup) return;
    markerGroup.clearLayers();
    markerByUidRef.current.clear();

    for (const pin of mappablePins) {
      if (pin.lat === null || pin.lng === null) continue;
      const sourceBadgeText =
        pin.sourceType === 'daily-log'
          ? 'บันทึกประจำวันแผนก ผขว.'
          : pin.sourceType === 'ipb'
            ? 'เหตุการณ์ IPB'
            : 'ข่าวรายวันจากสื่อที่คัดกรอง';

      const areaText = [
        pin.subdistrict ? `ต.${pin.subdistrict}` : '',
        pin.district ? `อ.${pin.district}` : '',
        pin.province ? `จ.${pin.province}` : '',
      ]
        .filter(Boolean)
        .join(' ');

      const safeLink = sanitizeHttpUrl(pin.link);
      const linkHtml = safeLink
        ? `<div style="margin-top:6px;"><a href="${escapeHtml(
            safeLink
          )}" target="_blank" rel="noopener noreferrer" style="color:#1d5bb8;font-weight:700;">เปิดข่าวต้นฉบับ ↗</a></div>`
        : '';

      const noteHtml = pin.analystNote
        ? `<div style="margin-top:4px;padding:4px 6px;border-radius:4px;background:rgba(29,91,184,0.08);"><strong>ความเห็น ผขว.:</strong> ${escapeHtml(
            pin.analystNote
          )}</div>`
        : '';

      const approxBadge = pin.coordIsApprox ? ' (พิกัดกึ่งกลางพื้นที่)' : '';

      const popupHtml = `<div style="min-width:230px;max-width:300px;font-size:12.5px;line-height:1.5;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
          <span style="background:${escapeHtml(pin.color)};color:#fff;padding:1px 7px;border-radius:999px;font-weight:700;font-size:11px;">${escapeHtml(
            pin.categoryLabel
          )}</span>
          <span style="background:#e2e8f0;color:#0f172a;padding:1px 7px;border-radius:999px;font-weight:700;font-size:11px;">${escapeHtml(
            sourceBadgeText
          )}</span>
        </div>
        <div style="font-weight:700;margin-bottom:3px;">${escapeHtml(pin.title)}</div>
        <div style="color:#475569;font-size:11.5px;margin-bottom:4px;">${escapeHtml(
          formatThaiDateTime(pin.occurredAt, { shortMonth: true })
        )} • ${escapeHtml(areaText || 'ภาคใต้ตอนล่าง')}${approxBadge}</div>
        <div>${escapeHtml(pin.summary.slice(0, 260))}${pin.summary.length > 260 ? '…' : ''}</div>
        ${noteHtml}
        <div style="margin-top:4px;font-size:11px;color:#64748b;">แหล่งข่าว: ${escapeHtml(
          pin.sourceName
        )} (รหัส ${escapeHtml(pin.reliabilityCode)})</div>
        ${linkHtml}
      </div>`;

      const marker = L.marker([pin.lat, pin.lng], {
        icon: createUnifiedDivIcon(pin.sourceType, pin.color),
        title: pin.title,
        alt: pin.title,
      })
        .bindPopup(popupHtml)
        .addTo(markerGroup);

      markerByUidRef.current.set(pin.uid, marker);
    }
  }, [mappablePins]);

  const handleZoomToPin = (pin: UnifiedBriefingPin) => {
    const map = mapRef.current;
    if (!map || pin.lat === null || pin.lng === null) return;
    map.setView([pin.lat, pin.lng], 12, { animate: true });
    const marker = markerByUidRef.current.get(pin.uid);
    if (marker) marker.openPopup();
    mapContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const countBySource = useMemo(() => {
    let news = 0;
    let logs = 0;
    let ipb = 0;
    for (const p of filteredPins) {
      if (p.sourceType === 'news') news++;
      else if (p.sourceType === 'daily-log') logs++;
      else ipb++;
    }
    return { news, logs, ipb };
  }, [filteredPins]);

  return (
    <section aria-labelledby="unified-map-heading" className="page-section">
      <div className="gov-card news-hub-hero" style={{ marginBottom: '1rem' }}>
        <div className="news-hub-hero-top">
          <div>
            <h2 id="unified-map-heading" className="section-title">
              แผนที่สรุปสถานการณ์รวม 7 จังหวัดภาคใต้ตอนล่าง (สำหรับการประชุม บน.56)
            </h2>
            <p className="section-subtitle">
              บูรณาการข่าวกรองรายวัน บันทึกเหตุการณ์ประจำวันของแผนก ผขว. เหตุการณ์ IPB และพื้นที่เฝ้าระวังไว้ในแผนที่เดียว พร้อมตัวกรองเปิด/ปิดแต่ละชั้นข้อมูล
            </p>
          </div>
          <div className="news-hub-actions">
            {staffUnlocked && onOpenDailyLogForm && (
              <button type="button" className="btn btn-outline" onClick={onOpenDailyLogForm}>
                <NotebookPen size={16} aria-hidden="true" />
                <span>บันทึกประจำวัน (ชีทแผนก)</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleRefreshAll}
              disabled={refreshing || loadingNews}
            >
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} aria-hidden="true" />
              <span>{refreshing ? 'กำลังอัปเดต...' : 'อัปเดตข้อมูลล่าสุด'}</span>
            </button>
          </div>
        </div>

        {/* 4 Briefing KPI Cards */}
        <div className="unified-kpi-grid">
          <div className="unified-kpi-card kpi-blue">
            <span className="unified-kpi-label">ข่าวรายวันจากสื่อที่คัดกรอง</span>
            <strong className="unified-kpi-val">{countBySource.news}</strong>
          </div>
          <div className="unified-kpi-card kpi-gold">
            <span className="unified-kpi-label">บันทึกประจำวันแผนก (7 หมวด)</span>
            <strong className="unified-kpi-val">{countBySource.logs}</strong>
          </div>
          <div className="unified-kpi-card kpi-red">
            <span className="unified-kpi-label">เหตุการณ์ IPB</span>
            <strong className="unified-kpi-val">{countBySource.ipb}</strong>
          </div>
          <div className="unified-kpi-card kpi-amber">
            <span className="unified-kpi-label">เขตเฝ้าระวังปัจจุบัน</span>
            <strong className="unified-kpi-val">{activeWatchAlerts.length}</strong>
          </div>
        </div>
      </div>

      {/* Layer Toggles & Filters */}
      <div className="gov-card" style={{ marginBottom: '1rem' }}>
        <div className="unified-layer-bar" role="group" aria-label="เปิดปิดชั้นข้อมูลบนแผนที่">
          <span className="unified-layer-title">
            <Layers size={15} aria-hidden="true" />
            <span>ชั้นข้อมูลแผนที่:</span>
          </span>
          <button
            type="button"
            className={`news-cat-pill ${showNewsLayer ? 'active' : ''}`}
            aria-pressed={showNewsLayer}
            onClick={() => setShowNewsLayer((v) => !v)}
          >
            <span className="legend-dot news" aria-hidden="true" />
            <span>ข่าวกรองรายวัน ({newsItems.length})</span>
          </button>
          <button
            type="button"
            className={`news-cat-pill ${showDailyLogLayer ? 'active' : ''}`}
            aria-pressed={showDailyLogLayer}
            onClick={() => setShowDailyLogLayer((v) => !v)}
          >
            <span className="legend-dot daily-log" aria-hidden="true" />
            <span>บันทึกประจำวันแผนก ({dailyLogs.length})</span>
          </button>
          <button
            type="button"
            className={`news-cat-pill ${showIpbLayer ? 'active' : ''}`}
            aria-pressed={showIpbLayer}
            onClick={() => setShowIpbLayer((v) => !v)}
          >
            <span className="legend-dot ipb" aria-hidden="true" />
            <span>เหตุการณ์ IPB ({incidents.length})</span>
          </button>
          <button
            type="button"
            className={`news-cat-pill ${showWatchLayer ? 'active' : ''}`}
            aria-pressed={showWatchLayer}
            onClick={() => setShowWatchLayer((v) => !v)}
          >
            <ShieldAlert size={13} aria-hidden="true" />
            <span>เขตเฝ้าระวัง ({activeWatchAlerts.length})</span>
          </button>
          <button
            type="button"
            className={`news-cat-pill ${showBoundaries ? 'active' : ''}`}
            aria-pressed={showBoundaries}
            onClick={() => setShowBoundaries((v) => !v)}
          >
            <span>ขอบเขต 77 อำเภอ</span>
          </button>
        </div>

        <div className="unified-filter-grid">
          <div>
            <label htmlFor="unified-search" className="sub-label">
              ค้นหาบนแผนที่ (หัวข้อ / อำเภอ / แหล่งข่าว)
            </label>
            <div className="input-with-icon">
              <Search size={15} aria-hidden="true" />
              <input
                id="unified-search"
                type="text"
                className="form-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="เช่น สะเดา, กอ.รมน., น้ำท่วม..."
              />
            </div>
          </div>

          <div>
            <label htmlFor="unified-prov" className="sub-label">
              จังหวัด
            </label>
            <select
              id="unified-prov"
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
            </select>
          </div>

          <div>
            <label htmlFor="unified-cat" className="sub-label">
              หมวดข่าวกรอง (7 หมวด)
            </label>
            <select
              id="unified-cat"
              className="form-select"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as 'all' | NewsCategoryId)}
            >
              <option value="all">ทุกหมวด / ทั้งหมด</option>
              {NEWS_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="unified-window" className="sub-label">
              ห้วงเวลา
            </label>
            <select
              id="unified-window"
              className="form-select"
              value={timeWindowDays}
              onChange={(e) => setTimeWindowDays(Number(e.target.value) as 7 | 30 | 90 | 0)}
            >
              <option value={7}>7 วันล่าสุด</option>
              <option value={30}>30 วันล่าสุด</option>
              <option value={90}>90 วันล่าสุด</option>
              <option value={0}>ทั้งหมด</option>
            </select>
          </div>

          <div>
            <label htmlFor="unified-basemap" className="sub-label">
              แผนที่พื้นหลัง
            </label>
            <select
              id="unified-basemap"
              className="form-select"
              value={basemap}
              onChange={(e) => setBasemap(e.target.value as BasemapType)}
            >
              <option value="osm">แผนที่ถนนมาตรฐาน (OSM)</option>
              <option value="satellite">ภาพถ่ายดาวเทียม (Esri)</option>
              <option value="topo">แผนที่ภูมิประเทศ (Topo)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Unified Leaflet Map */}
      <div className="gov-card" style={{ padding: '0.75rem', marginBottom: '1rem' }}>
        <p className="map-usage-hint">
          วิธีใช้แผนที่: กดที่จุดสีบนแผนที่เพื่ออ่านสรุปข่าว • กดปุ่มหมวดด้านบนเพื่อเปิดหรือปิดข้อมูลแต่ละประเภท
        </p>
        <div
          ref={mapContainerRef}
          className="leaflet-map-frame"
          style={{ height: '540px', width: '100%', borderRadius: '10px' }}
          aria-label="แผนที่สรุปสถานการณ์รวม 7 จังหวัดภาคใต้ตอนล่าง"
        />
        <div className="unified-legend-strip">
          <span>
            <span className="legend-dot news" aria-hidden="true" /> วงกลม = ข่าวรายวัน
          </span>
          <span>
            <span className="legend-dot daily-log" aria-hidden="true" /> สี่เหลี่ยมขอบทอง = บันทึกประจำวันแผนก
          </span>
          <span>
            <span className="legend-dot ipb" aria-hidden="true" /> หมุดขอบดำ = เหตุการณ์ IPB
          </span>
          <span className="unified-legend-note">
            แสดงบนแผนที่แล้ว {mappablePins.length} / {filteredPins.length} รายการ
          </span>
        </div>
        <div className="unified-cat-legend" aria-label="ความหมายสีของ 7 หมวดข่าว">
          <span className="unified-cat-legend-title">สีตามหมวดข่าว:</span>
          {NEWS_CATEGORIES.map((cat) => (
            <span key={cat.id} className="unified-cat-legend-item">
              <span
                className="w56-subcat-dot"
                style={{ backgroundColor: cat.color }}
                aria-hidden="true"
              />
              <span>{cat.shortLabel}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Briefing Event Table / List */}
      <div className="gov-card">
        <div className="card-header-row">
          <div>
            <h3 className="card-title">บัญชีเหตุการณ์และข่าวกรองประกอบการประชุม ({filteredPins.length} รายการ)</h3>
            <p className="card-subtitle">
              กด &ldquo;ซูมดูบนแผนที่&rdquo; เพื่อกระโดดไปยังตำแหน่งพิกัดและเปิดคำอธิบายประกอบการบรรยายสรุป
            </p>
          </div>
        </div>

        {filteredPins.length === 0 ? (
          <p className="empty-table-note">
            ไม่พบรายการที่ตรงกับตัวกรองปัจจุบัน ลองเปิดชั้นข้อมูลเพิ่มเติมหรือขยายห้วงเวลา
          </p>
        ) : (
          <>
            <div className="unified-list">
              {filteredPins.slice(0, visibleCount).map((pin) => {
                const sourceTag =
                  pin.sourceType === 'daily-log'
                    ? 'บันทึกแผนก ผขว.'
                    : pin.sourceType === 'ipb'
                      ? 'IPB'
                      : 'ข่าวรายวัน';
                const areaLabel = [
                  pin.subdistrict ? `ต.${pin.subdistrict}` : '',
                  pin.district ? `อ.${pin.district}` : '',
                  pin.province ? `จ.${pin.province}` : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <div key={pin.uid} className="unified-list-row">
                    <div className="unified-list-main">
                      <div className="unified-list-badges">
                        <span
                          className="news-cat-badge"
                          style={{ backgroundColor: pin.color, color: '#ffffff' }}
                        >
                          {pin.categoryLabel}
                        </span>
                        <span className={`unified-source-chip type-${pin.sourceType}`}>
                          {sourceTag}
                        </span>
                        <span className="news-prov-chip">{areaLabel || 'ภาคใต้ตอนล่าง'}</span>
                        <span className="news-age-text">
                          {formatThaiDateTime(pin.occurredAt, { shortMonth: true })}
                        </span>
                      </div>
                      <p className="unified-list-title">{pin.title}</p>
                      <p className="unified-list-summary">{pin.summary}</p>
                    </div>
                    <div className="unified-list-actions">
                      {pin.lat !== null && pin.lng !== null ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => handleZoomToPin(pin)}
                        >
                          <Crosshair size={14} aria-hidden="true" />
                          <span>ซูมดูบนแผนที่</span>
                        </button>
                      ) : (
                        <span className="badge badge-info">
                          <MapPin size={12} aria-hidden="true" /> ไม่มีพิกัดรายจุด
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {filteredPins.length > visibleCount && (
              <div className="news-load-more-bar">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setVisibleCount((c) => c + 20)}
                >
                  ดูรายการเพิ่มเติม (+20 • แสดงแล้ว {Math.min(visibleCount, filteredPins.length)} จาก{' '}
                  {filteredPins.length} รายการ)
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setVisibleCount(filteredPins.length)}
                >
                  แสดงทั้งหมด
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
