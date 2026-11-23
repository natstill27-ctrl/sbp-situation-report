import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  ClipboardCopy,
  CloudDownload,
  Clock,
  Database,
  Download,
  Filter,
  ImageDown,
  Maximize2,
  Minimize2,
  Moon,
  Printer,
  RotateCcw,
  Shield,
  ShieldAlert,
  Sun,
} from 'lucide-react';
import type { AppSettings, IncidentRecord, WatchAlertRecord } from '../types/incident';
import {
  exportHorizontalBarsToPng,
  exportIpbMatrixToCsv,
  exportSvgElementToPng,
} from '../utils/exportUtils';
import type { GasPullResult } from '../utils/gasSync';
import { getTargetProvinces } from '../utils/geoLookup';
import {
  SEVERITY_LEVELS,
  type SeverityLevel,
  buildAreaSeverityStats,
  buildDailyTrendBuckets,
  classifyIncidentSeverity,
  getIncidentWeight,
} from '../utils/severity';
import {
  THAI_MONTHS_LONG,
  THAI_MONTHS_SHORT,
  extractWatchAdvisory,
  formatThaiDateTime,
  getCurrentLocalDateTimeInput,
  isWatchAdvisoryCategory,
  isWatchAlertActive,
  isWatchAlertWithinRecentDays,
  toThaiDigits,
} from '../utils/thaiDate';
import { LeafletMap } from './LeafletMap';

interface IpbDashboardPageProps {
  incidents: IncidentRecord[];
  watchAlerts?: WatchAlertRecord[];
  categories: string[];
  settings?: AppSettings;
  lastPulledAt?: string | null;
  onLoadSamples: () => Promise<void>;
  hasGasUrl?: boolean;
  onPullFromGas?: () => Promise<GasPullResult>;
}

const C2_CATEGORY_PALETTE = [
  '#0ea5e9',
  '#2563eb',
  '#f97316',
  '#a855f7',
  '#ef4444',
  '#22c55e',
  '#eab308',
  '#ec4899',
];

export function IpbDashboardPage({
  incidents,
  watchAlerts = [],
  categories,
  settings,
  lastPulledAt,
  onLoadSamples,
  hasGasUrl = false,
  onPullFromGas,
}: IpbDashboardPageProps) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [provinceFilter, setProvinceFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'' | SeverityLevel>('');
  const [excludeWatchFromStats, setExcludeWatchFromStats] = useState(true);
  const [showWatchZones, setShowWatchZones] = useState(true);
  const [watchScope, setWatchScope] = useState<'30d' | 'active' | 'all'>('30d');
  const [c2Theme, setC2Theme] = useState<'dark' | 'light'>('dark');
  const [mapColorMode, setMapColorMode] = useState<'severity' | 'category'>('severity');
  const [useMilSymbol, setUseMilSymbol] = useState(false);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());

  const [copiedSummary, setCopiedSummary] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const dashboardRef = useRef<HTMLElement | null>(null);
  const donutSvgRef = useRef<SVGSVGElement | null>(null);
  const dailySvgRef = useRef<SVGSVGElement | null>(null);
  const monthlySvgRef = useRef<SVGSVGElement | null>(null);
  const hotspotSvgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 1000);
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement && dashboardRef.current?.requestFullscreen) {
      await dashboardRef.current.requestFullscreen();
    } else if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  };

  const provinces = useMemo(() => getTargetProvinces(), []);

  const categoryColorMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((cat, idx) => {
      map.set(cat, C2_CATEGORY_PALETTE[idx % C2_CATEGORY_PALETTE.length]);
    });
    return map;
  }, [categories]);

  const getC2CatColor = (cat: string, fallbackIdx = 0): string =>
    categoryColorMap.get(cat) || C2_CATEGORY_PALETTE[fallbackIdx % C2_CATEGORY_PALETTE.length];

  const advisoryIncidentsCount = useMemo(
    () => incidents.filter((item) => isWatchAdvisoryCategory(item.category)).length,
    [incidents]
  );

  const combinedWatchAlerts = useMemo<WatchAlertRecord[]>(() => {
    const list: WatchAlertRecord[] = [...watchAlerts];
    for (const item of incidents) {
      if (!isWatchAdvisoryCategory(item.category)) continue;
      const parsed = extractWatchAdvisory(item.details);
      const areas =
        parsed.areas.length > 0
          ? parsed.areas
          : item.province && item.district
            ? [{ province: item.province, district: item.district }]
            : [];
      if (areas.length === 0) continue;
      const dateStr = (item.occurredAt || item.createdAt || '').slice(0, 10);
      list.push({
        id: `HIST-${item.id}`,
        reportedAt: parsed.reportedAt || dateStr,
        watchStart: parsed.watchStart || parsed.reportedAt || dateStr,
        watchEnd: parsed.watchEnd || parsed.reportedAt || dateStr,
        areas,
        threatType: parsed.threatType,
        alertLevel: parsed.alertLevel,
        details: item.details,
        reporter: item.reporter || '-',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        syncStatus: item.syncStatus,
      });
    }
    return list;
  }, [watchAlerts, incidents]);

  const displayedWatchAlerts = useMemo(() => {
    const todayYmd = getCurrentLocalDateTimeInput().slice(0, 10);
    const isHistoricalAnchor = Boolean(dateTo && dateTo < todayYmd);
    const anchorYmd = isHistoricalAnchor ? dateTo : todayYmd;

    return combinedWatchAlerts.filter((w) => {
      if (watchScope === '30d' && !isWatchAlertWithinRecentDays(w, 30, anchorYmd, isHistoricalAnchor)) {
        return false;
      }
      if (watchScope === 'active' && isWatchAlertActive(w, todayYmd) !== 'active') {
        return false;
      }
      if (provinceFilter && !w.areas.some((a) => a.province === provinceFilter)) return false;
      return true;
    });
  }, [combinedWatchAlerts, watchScope, provinceFilter, dateTo]);

  const activeWatchAlerts = useMemo(
    () => combinedWatchAlerts.filter((w) => isWatchAlertActive(w) === 'active'),
    [combinedWatchAlerts]
  );

  const activeWatchDistrictCount = useMemo(() => {
    const set = new Set<string>();
    for (const w of activeWatchAlerts) {
      for (const a of w.areas) {
        set.add(`${a.province}|${a.district}`);
      }
    }
    return set.size;
  }, [activeWatchAlerts]);

  const filtered = useMemo(() => {
    return incidents.filter((item) => {
      if (excludeWatchFromStats && isWatchAdvisoryCategory(item.category)) return false;
      const itemDate = (item.occurredAt || '').slice(0, 10);
      if (dateFrom && itemDate < dateFrom) return false;
      if (dateTo && itemDate > dateTo) return false;
      if (provinceFilter && item.province !== provinceFilter) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (severityFilter) {
        const sev = classifyIncidentSeverity(item.category, item.details);
        if (sev.level !== severityFilter) return false;
      }
      return true;
    });
  }, [
    incidents,
    excludeWatchFromStats,
    dateFrom,
    dateTo,
    provinceFilter,
    categoryFilter,
    severityFilter,
  ]);

  const totalEventCount = useMemo(
    () => filtered.reduce((acc, item) => acc + getIncidentWeight(item), 0),
    [filtered]
  );

  const targetAreaEventCount = useMemo(
    () =>
      filtered.reduce((acc, item) => acc + (item.inTargetArea ? getIncidentWeight(item) : 0), 0),
    [filtered]
  );

  const kpiStats = useMemo(() => {
    let pending = 0;
    let synced = 0;
    let critical = 0;
    let ied = 0;
    let mapped = 0;
    const districtSet = new Set<string>();

    for (const item of filtered) {
      const w = getIncidentWeight(item);
      if (item.syncStatus === 'synced') synced += w;
      else pending += w;

      if (classifyIncidentSeverity(item.category, item.details).level === 'critical') {
        critical += w;
      }
      if (/ระเบิด/.test(item.category)) {
        ied += w;
      }
      if (item.lat !== null && item.lng !== null) {
        mapped += w;
      }
      if (item.district) {
        districtSet.add(`${item.province}|${item.district}`);
      }
    }

    const gaugePct = totalEventCount
      ? ((hasGasUrl ? synced : mapped) / totalEventCount) * 100
      : 0;

    return {
      pending,
      synced,
      critical,
      ied,
      activeDistricts: districtSet.size,
      gaugePct,
    };
  }, [filtered, totalEventCount, hasGasUrl]);

  // Severity distribution
  const severityStats = useMemo(() => {
    const counts: Record<SeverityLevel, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const item of filtered) {
      const sev = classifyIncidentSeverity(item.category, item.details);
      counts[sev.level] += getIncidentWeight(item);
    }
    return SEVERITY_LEVELS.map((meta) => ({
      ...meta,
      count: counts[meta.level],
    }));
  }, [filtered]);

  // Province comparison
  const provinceStats = useMemo(() => {
    const counts: Record<string, number> = {
      นราธิวาส: 0,
      ปัตตานี: 0,
      ยะลา: 0,
      สงขลา: 0,
      อื่นๆ: 0,
    };
    for (const item of filtered) {
      const w = getIncidentWeight(item);
      if (item.province in counts) counts[item.province] += w;
      else counts['อื่นๆ'] += w;
    }
    return [
      { key: 'นราธิวาส', label: 'จว.นราธิวาส', count: counts['นราธิวาส'], color: '#0ea5e9' },
      { key: 'ปัตตานี', label: 'จว.ปัตตานี', count: counts['ปัตตานี'], color: '#2563eb' },
      { key: 'ยะลา', label: 'จว.ยะลา', count: counts['ยะลา'], color: '#a855f7' },
      { key: 'สงขลา', label: '4 อ. จว.สงขลา', count: counts['สงขลา'], color: '#f97316' },
      ...(counts['อื่นๆ'] > 0
        ? [{ key: 'อื่นๆ', label: 'นอกเขต/อื่นๆ', count: counts['อื่นๆ'], color: '#64748b' }]
        : []),
    ];
  }, [filtered]);

  // Top hotspot districts
  const topDistricts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of filtered) {
      const label = item.district ? `อ.${item.district}` : item.province || 'ไม่ระบุ';
      map.set(label, (map.get(label) || 0) + getIncidentWeight(item));
    }
    return Array.from(map.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [filtered]);

  // 30-day daily trend line buckets
  const dailyTrend = useMemo(
    () => buildDailyTrendBuckets(filtered, 30, dateTo || undefined),
    [filtered, dateTo]
  );

  // Category breakdown (for Donut + Legend)
  const categoryStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of filtered) {
      map.set(item.category, (map.get(item.category) || 0) + getIncidentWeight(item));
    }
    return Array.from(map.entries())
      .map(([category, count], idx) => ({
        category,
        count,
        pct: totalEventCount ? Math.round((count / totalEventCount) * 1000) / 10 : 0,
        color: getC2CatColor(category, idx),
      }))
      .sort((a, b) => b.count - a.count);
  }, [filtered, totalEventCount, categoryColorMap]);

  // Monthly stacked vertical bars (chronological YYYY-MM, latest 8 months)
  const monthlyStacked = useMemo(() => {
    const monthMap = new Map<string, Record<string, number>>();
    for (const item of filtered) {
      const ym = (item.occurredAt || item.createdAt || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      const bucket = monthMap.get(ym) || {};
      bucket[item.category] = (bucket[item.category] || 0) + getIncidentWeight(item);
      monthMap.set(ym, bucket);
    }

    const sortedMonths = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8);

    const legendCats = categoryStats.slice(0, 4).map((c) => c.category);
    const months = sortedMonths.map(([ym, catCounts]) => {
      const [yStr, mStr] = ym.split('-');
      const beShort = String(Number(yStr) + 543).slice(-2);
      const mName = THAI_MONTHS_SHORT[Number(mStr) - 1] || mStr;
      let total = 0;
      const segments: Array<{ category: string; count: number; color: string }> = [];
      // Stack major categories + group tail as other
      for (const c of categoryStats) {
        const val = catCounts[c.category] || 0;
        if (val > 0) {
          total += val;
          segments.push({ category: c.category, count: val, color: c.color });
        }
      }
      return { ym, label: `${mName}${beShort}`, total, segments };
    });

    return { months, legendCats };
  }, [filtered, categoryStats]);

  // Area × Severity 100%-stacked horizontal bars
  const areaSeverityRows = useMemo(() => buildAreaSeverityStats(filtered), [filtered]);

  // Matrix rows for bottom IPB cross-tab table
  const activeCategories = useMemo(() => {
    const used = new Set(filtered.map((i) => i.category));
    const list = categories.filter((c) => used.has(c));
    for (const u of used) {
      if (!list.includes(u)) list.push(u);
    }
    return list;
  }, [filtered, categories]);

  const matrixRows = useMemo(() => {
    const map = new Map<string, { area: string; counts: Record<string, number>; total: number }>();
    for (const item of filtered) {
      const weight = getIncidentWeight(item);
      const areaKey = item.province
        ? `${item.province === 'สงขลา' ? '4 อ.สงขลา' : `จว.${item.province}`}${item.district ? ` / อ.${item.district}` : ''}`
        : 'ไม่ระบุพื้นที่';
      const existing = map.get(areaKey) || { area: areaKey, counts: {}, total: 0 };
      existing.counts[item.category] = (existing.counts[item.category] || 0) + weight;
      existing.total += weight;
      map.set(areaKey, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const topDistrict = topDistricts[0];

  const handleCopyIpbSummaryText = async () => {
    const rangeLabel =
      dateFrom || dateTo
        ? `ห้วง ${dateFrom ? formatThaiDateTime(dateFrom, { includeTime: false }) : 'เริ่มต้น'} ถึง ${dateTo ? formatThaiDateTime(dateTo, { includeTime: false }) : 'ปัจจุบัน'}`
        : 'ทั้งหมดในระบบ';

    const provLines = provinceStats
      .filter((p) => p.count > 0)
      .map((p) => `${p.label} ${p.count} ครั้ง`)
      .join(', ');
    const catLines = categoryStats
      .slice(0, 5)
      .map((c) => `- ${c.category}: ${c.count} ครั้ง (${Math.round(c.pct)}%)`)
      .join('\n');

    const text = toThaiDigits(
      `สรุปสถิติสถานการณ์เพื่อประกอบการวิเคราะห์ IPB (${rangeLabel})\n` +
        `รวมเหตุการณ์ทั้งหมด: ${totalEventCount} ครั้ง (ในเขตหลัก ${targetAreaEventCount} ครั้ง)\n` +
        `เหตุระดับสูงสุด: ${kpiStats.critical} ครั้ง\n` +
        `จำแนกรายจังหวัด: ${provLines || '-'}\n` +
        `อำเภอเกิดเหตุสูงสุด: ${topDistrict ? `${topDistrict.label} (${topDistrict.count} ครั้ง)` : '-'}\n` +
        `จำแนกตามประเภทเหตุการณ์:\n${catLines || '-'}`
    );

    await navigator.clipboard.writeText(text);
    setCopiedSummary(true);
    window.setTimeout(() => setCopiedSummary(false), 2000);
  };

  const resetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setProvinceFilter('');
    setCategoryFilter('');
    setSeverityFilter('');
  };

  const applyDatePreset = (preset: '7d' | '30d' | '90d' | 'fy' | 'all') => {
    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
      return;
    }
    const today = new Date();
    const toYmd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayStr = toYmd(today);

    if (preset === 'fy') {
      const fyStartYear = today.getMonth() >= 9 ? today.getFullYear() : today.getFullYear() - 1;
      setDateFrom(`${fyStartYear}-10-01`);
      setDateTo(todayStr);
      return;
    }

    const days = preset === '7d' ? 6 : preset === '30d' ? 29 : 89;
    const start = new Date(today);
    start.setDate(today.getDate() - days);
    setDateFrom(toYmd(start));
    setDateTo(todayStr);
  };

  const handlePull = async () => {
    if (!onPullFromGas) return;
    setPulling(true);
    setPullStatus(null);
    try {
      const res = await onPullFromGas();
      setPullStatus({ ok: res.ok, message: res.message });
    } finally {
      setPulling(false);
    }
  };

  const isDark = c2Theme === 'dark';
  const liveThaiDate = `${clockNow.getDate()} ${THAI_MONTHS_LONG[clockNow.getMonth()]} ${
    clockNow.getFullYear() + 543
  }`;
  const liveClock = `${String(clockNow.getHours()).padStart(2, '0')}:${String(
    clockNow.getMinutes()
  ).padStart(2, '0')}:${String(clockNow.getSeconds()).padStart(2, '0')}`;

  const maxSeverity = Math.max(1, ...severityStats.map((s) => s.count));
  const maxDaily = Math.max(1, ...dailyTrend.map((d) => d.count));
  const maxMonthlyStack = Math.max(1, ...monthlyStacked.months.map((m) => m.total));
  const maxHotspot = Math.max(1, ...topDistricts.map((d) => d.count));

  // Precompute daily SVG polyline points
  const dailyPoints = dailyTrend.map((pt, idx) => {
    const x = 34 + (idx / Math.max(1, dailyTrend.length - 1)) * 310;
    const y = 140 - (pt.count / maxDaily) * 114;
    return { x, y, count: pt.count, label: pt.label };
  });
  const dailyLineAttr = dailyPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const dailyAreaPath =
    dailyPoints.length > 0
      ? `M ${dailyPoints[0].x.toFixed(1)},140 L ${dailyPoints
          .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
          .join(' L ')} L ${dailyPoints[dailyPoints.length - 1].x.toFixed(1)},140 Z`
      : '';

  // Semi-circle gauge target 90% coordinates on arc (center 100,104 radius 76)
  const targetAngle = Math.PI * (1 - 0.9);
  const targetX1 = 100 + 64 * Math.cos(targetAngle);
  const targetY1 = 104 - 64 * Math.sin(targetAngle);
  const targetX2 = 100 + 89 * Math.cos(targetAngle);
  const targetY2 = 104 - 89 * Math.sin(targetAngle);

  let donutOffset = 0;

  return (
    <section
      ref={dashboardRef}
      aria-labelledby="ipb-heading"
      className={`ipb-c2-shell ${isDark ? 'c2-dark' : 'c2-light'}`}
    >
      {/* Tactical Command Center Header */}
      <header className="c2-header">
        <div className="c2-brand">
          <div className="c2-crest" aria-hidden="true">
            <Shield size={28} strokeWidth={2.2} />
          </div>
          <div>
            <h2 id="ipb-heading" className="c2-title">
              {settings?.systemTitle?.trim() || 'ประเมินสถานการณ์พื้นที่จังหวัดชายแดนภาคใต้'}
            </h2>
            <p className="c2-subtitle-en">Intelligence Preparation Of The Battlefield</p>
            <p className="c2-subtitle-th">
              {settings?.agencyName ||
                'ศูนย์ข้อมูลสถานการณ์และสถิติเพื่อการวิเคราะห์ IPB (3 จว. + 4 อ. จว.สงขลา)'}
            </p>
          </div>
        </div>

        <div className="c2-header-right">
          <div className="c2-clock-block">
            <div className="c2-date-text">{liveThaiDate}</div>
            <div className="c2-clock-row">
              <Clock size={14} aria-hidden="true" />
              <span>อัปเดต {lastPulledAt ? `${lastPulledAt} น.` : liveClock}</span>
              <span className="c2-live-clock">{liveClock}</span>
            </div>
          </div>

          <div className="c2-action-toolbar no-print">
            {onPullFromGas && (
              <button
                type="button"
                className="c2-btn"
                onClick={handlePull}
                disabled={pulling || !hasGasUrl}
                title={
                  hasGasUrl
                    ? 'ดึงข้อมูลสถานการณ์ล่าสุดจาก Google Apps Script'
                    : 'กรุณาตั้งค่า Webhook URL ในหน้าตั้งค่าก่อน'
                }
              >
                <CloudDownload size={15} aria-hidden="true" />
                <span>{pulling ? 'กำลังดึง...' : 'ดึงข้อมูล GAS'}</span>
              </button>
            )}
            {incidents.length === 0 && (
              <button type="button" className="c2-btn" onClick={onLoadSamples}>
                <Database size={15} aria-hidden="true" />
                <span>ข้อมูลทดสอบ</span>
              </button>
            )}
            <button
              type="button"
              className="c2-btn"
              onClick={handleCopyIpbSummaryText}
              disabled={filtered.length === 0}
              title="คัดลอกสรุปสถิติเลขไทยสำหรับ Paper"
            >
              <ClipboardCopy size={15} aria-hidden="true" />
              <span>{copiedSummary ? 'คัดลอกแล้ว' : 'สรุป IPB'}</span>
            </button>
            <button
              type="button"
              className="c2-btn"
              onClick={() => exportIpbMatrixToCsv(matrixRows, activeCategories)}
              disabled={filtered.length === 0}
              title="ส่งออกตารางเมทริกซ์ IPB เป็น CSV"
            >
              <Download size={15} aria-hidden="true" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              className="c2-btn"
              onClick={() => setShowFilters((v) => !v)}
              title="ซ่อน/แสดงแถบตัวกรองข้อมูล"
            >
              <Filter size={15} aria-hidden="true" />
              <span>ตัวกรอง</span>
            </button>
            <button
              type="button"
              className="c2-btn"
              onClick={() => setC2Theme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title="สลับระหว่างโหมดห้องยุทธการ (Dark C2) และโหมดเอกสาร (Light)"
            >
              {isDark ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
              <span>{isDark ? 'โหมดเอกสาร' : 'โหมดยุทธการ'}</span>
            </button>
            <button
              type="button"
              className="c2-btn"
              onClick={toggleFullscreen}
              title="เปิด/ปิดโหมดแสดงผลเต็มหน้าจอ"
            >
              {isFullscreen ? (
                <Minimize2 size={15} aria-hidden="true" />
              ) : (
                <Maximize2 size={15} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="c2-btn c2-btn-primary"
              onClick={() => window.print()}
              title="พิมพ์รายงาน / บันทึกเป็น PDF"
            >
              <Printer size={15} aria-hidden="true" />
              <span>พิมพ์</span>
            </button>
          </div>
        </div>
      </header>

      {pullStatus && (
        <div
          className={`inline-alert ${pullStatus.ok ? 'info' : 'danger'} no-print`}
          style={{ marginBottom: '0.75rem' }}
          role="status"
        >
          <span>{pullStatus.message}</span>
        </div>
      )}

      {/* Collapsible Filter Strip */}
      {showFilters && (
        <div className="c2-filter-strip no-print">
          <div className="c2-filter-grid">
            <div>
              <label htmlFor="ipb-date-from" className="c2-filter-label">
                ตั้งแต่วันที่
              </label>
              <input
                id="ipb-date-from"
                type="date"
                className="c2-input"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="ipb-date-to" className="c2-filter-label">
                ถึงวันที่
              </label>
              <input
                id="ipb-date-to"
                type="date"
                className="c2-input"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="ipb-prov-filter" className="c2-filter-label">
                จังหวัด / พื้นที่
              </label>
              <select
                id="ipb-prov-filter"
                className="c2-select"
                value={provinceFilter}
                onChange={(e) => setProvinceFilter(e.target.value)}
              >
                <option value="">ทุกจังหวัด (3 จว. + 4 อ.สงขลา)</option>
                {provinces.map((p) => (
                  <option key={p} value={p}>
                    {p === 'สงขลา' ? 'สงขลา (4 อำเภอ)' : p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ipb-cat-filter" className="c2-filter-label">
                ประเภทเหตุการณ์
              </label>
              <select
                id="ipb-cat-filter"
                className="c2-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">ทุกประเภทเหตุการณ์</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ipb-sev-filter" className="c2-filter-label">
                ระดับความรุนแรง
              </label>
              <select
                id="ipb-sev-filter"
                className="c2-select"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as '' | SeverityLevel)}
              >
                <option value="">ทุกระดับ</option>
                {SEVERITY_LEVELS.map((s) => (
                  <option key={s.level} value={s.level}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <button type="button" className="c2-btn" onClick={resetFilters}>
                <RotateCcw size={14} aria-hidden="true" />
                <span>ล้างตัวกรอง</span>
              </button>
            </div>
          </div>

          <div className="c2-preset-row" role="group" aria-label="เลือกช่วงเวลาด่วน">
            <span className="c2-filter-label" style={{ margin: 0 }}>
              ช่วงเวลา:
            </span>
            {(
              [
                ['7d', '7 วันล่าสุด'],
                ['30d', '30 วันล่าสุด'],
                ['90d', '90 วันล่าสุด'],
                ['fy', 'ปีงบประมาณนี้'],
                ['all', 'ทั้งหมด'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="c2-chip-btn"
                onClick={() => applyDatePreset(key)}
              >
                {label}
              </button>
            ))}
            {(severityFilter || categoryFilter || provinceFilter) && (
              <span className="c2-active-filter-note">
                กำลังกรอง:{' '}
                {[
                  provinceFilter && `จว.${provinceFilter}`,
                  categoryFilter,
                  severityFilter &&
                    `ความรุนแรง: ${SEVERITY_LEVELS.find((s) => s.level === severityFilter)?.label}`,
                ]
                  .filter(Boolean)
                  .join(' • ')}
              </span>
            )}
            <label className="c2-xs-check" style={{ marginLeft: 'auto' }}>
              <input
                type="checkbox"
                checked={excludeWatchFromStats}
                onChange={(e) => setExcludeWatchFromStats(e.target.checked)}
              />
              <span>
                แยกข่าวความเคลื่อนไหว/เฝ้าระวังออกจากสถิติเหตุจริง
                {advisoryIncidentsCount > 0 ? ` (${advisoryIncidentsCount} ข่าว)` : ''}
              </span>
            </label>
          </div>
        </div>
      )}

      {incidents.length === 0 && combinedWatchAlerts.length === 0 ? (
        <div className="c2-panel c2-panel-blue c2-empty-state">
          <BarChart3 size={42} aria-hidden="true" />
          <h3>ยังไม่มีข้อมูลเหตุการณ์สำหรับแสดงผล Command Center</h3>
          <p>
            บันทึกเหตุการณ์ในหน้า &ldquo;บันทึกเหตุการณ์&rdquo; ดึงข้อมูลจาก GAS เดิม หรือกดปุ่มด้านล่างเพื่อโหลดชุดข้อมูลตัวอย่างทดสอบ
          </p>
          <button type="button" className="c2-btn c2-btn-primary" onClick={onLoadSamples}>
            <Database size={16} aria-hidden="true" />
            <span>โหลดข้อมูลตัวอย่างทดสอบ</span>
          </button>
        </div>
      ) : (
        <>
          {activeWatchAlerts.length > 0 && (
            <div className="c2-watch-banner" role="region" aria-label="แจ้งเตือนพื้นที่เฝ้าระวัง">
              <div className="c2-watch-banner-left">
                <ShieldAlert size={20} aria-hidden="true" />
                <div>
                  <strong>
                    พื้นที่เฝ้าระวังที่อยู่ในห้วงเวลา ({activeWatchAlerts.length} ข่าวกรอง •{' '}
                    {activeWatchDistrictCount} อำเภอ)
                  </strong>
                  <div className="c2-watch-banner-meta">
                    {activeWatchAlerts.slice(0, 3).map((w) => {
                      const win =
                        w.watchStart && w.watchEnd && w.watchStart !== w.watchEnd
                          ? `${formatThaiDateTime(w.watchStart, { includeTime: false })} – ${formatThaiDateTime(w.watchEnd, { includeTime: false })}`
                          : formatThaiDateTime(w.watchStart || w.reportedAt, { includeTime: false });
                      return (
                        <span key={w.id} className="c2-watch-pill">
                          {w.threatType} ({w.areas.length} อ. | {win})
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="c2-xs-btn"
                onClick={() => setShowWatchZones((v) => !v)}
              >
                {showWatchZones ? 'ซ่อนเขตเฝ้าระวัง' : 'แสดงเขตเฝ้าระวังบนแผนที่'}
              </button>
            </div>
          )}

          {/* Row 1: 5 Color-Coded Tactical KPI Tiles */}
          <div className="c2-kpi-grid">
            <div className="c2-kpi-tile c2-kpi-blue">
              <strong className="c2-kpi-num">{totalEventCount}</strong>
              <span className="c2-kpi-title">เหตุทั้งหมด</span>
              <span className="c2-kpi-sub">{filtered.length} รายการบันทึก</span>
            </div>

            <div className="c2-kpi-tile c2-kpi-amber">
              <strong className="c2-kpi-num">{kpiStats.pending}</strong>
              <span className="c2-kpi-title">รอซิงก์ / ดำเนินการ</span>
              <span className="c2-kpi-sub">ค้างส่งระบบเดิม</span>
            </div>

            <div className="c2-kpi-tile c2-kpi-green">
              <strong className="c2-kpi-num">{kpiStats.synced}</strong>
              <span className="c2-kpi-title">ซิงก์สำเร็จ / เสร็จสิ้น</span>
              <span className="c2-kpi-sub">บันทึกเข้าระบบหลักแล้ว</span>
            </div>

            <button
              type="button"
              className={`c2-kpi-tile c2-kpi-red c2-kpi-clickable ${
                severityFilter === 'critical' ? 'c2-kpi-selected' : ''
              }`}
              onClick={() =>
                setSeverityFilter((prev) => (prev === 'critical' ? '' : 'critical'))
              }
              title="คลิกเพื่อกรองเฉพาะเหตุระดับสูงสุด"
            >
              <strong className="c2-kpi-num">{kpiStats.critical}</strong>
              <span className="c2-kpi-title">เหตุระดับสูงสุด</span>
              <span className="c2-kpi-sub">คลิกเพื่อกรอง / ดูทั้งหมด</span>
            </button>

            <div className="c2-kpi-tile c2-kpi-purple">
              <strong className="c2-kpi-num">{kpiStats.activeDistricts}</strong>
              <span className="c2-kpi-title">อำเภอที่เกิดเหตุ</span>
              <span className="c2-kpi-sub">เหตุระเบิด {kpiStats.ied} ครั้ง</span>
            </div>
          </div>

          {/* Row 2: Operational Map + Donut + Severity Bars & Semi-Circle Gauge */}
          <div className="c2-mid-grid">
            {/* Map Panel */}
            <div className="c2-panel c2-panel-blue c2-map-panel">
              <div className="c2-panel-header">
                <div className="c2-panel-title-wrap">
                  <h3 className="c2-panel-title">แผนที่เหตุการณ์ (Real-time)</h3>
                  <div className="c2-sev-legend" aria-label="ระดับความรุนแรง">
                    <span>ระดับความรุนแรง:</span>
                    {[...SEVERITY_LEVELS].reverse().map((s) => (
                      <span key={s.level} className="c2-dot-label">
                        <i style={{ backgroundColor: s.color }} />
                        {s.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="c2-panel-tools no-print">
                  <label className="c2-xs-check">
                    <input
                      type="checkbox"
                      checked={showWatchZones}
                      onChange={(e) => setShowWatchZones(e.target.checked)}
                    />
                    <span>เขตเฝ้าระวัง ({displayedWatchAlerts.length})</span>
                  </label>
                  {showWatchZones && combinedWatchAlerts.length > 0 && (
                    <select
                      className="c2-xs-btn"
                      aria-label="ขอบเขตเวลาพื้นที่เฝ้าระวัง"
                      value={watchScope}
                      onChange={(e) => setWatchScope(e.target.value as '30d' | 'active' | 'all')}
                    >
                      <option value="30d">30 วันล่าสุด</option>
                      <option value="active">เฉพาะในห้วง</option>
                      <option value="all">ทั้งหมด ({combinedWatchAlerts.length})</option>
                    </select>
                  )}
                  <button
                    type="button"
                    className="c2-xs-btn"
                    onClick={() =>
                      setMapColorMode((m) => (m === 'severity' ? 'category' : 'severity'))
                    }
                  >
                    สี: {mapColorMode === 'severity' ? 'ความรุนแรง' : 'ประเภท'}
                  </button>
                  <label className="c2-xs-check">
                    <input
                      type="checkbox"
                      checked={useMilSymbol}
                      onChange={(e) => setUseMilSymbol(e.target.checked)}
                    />
                    <span>2525</span>
                  </label>
                </div>
              </div>
              <LeafletMap
                mode="overview"
                incidents={filtered}
                categories={categories}
                selectedId={selectedMapId}
                onSelectIncident={setSelectedMapId}
                colorMode={mapColorMode}
                markerStyle={useMilSymbol ? 'milsymbol' : 'pin'}
                watchAlerts={displayedWatchAlerts}
                showWatchZones={showWatchZones}
                offlinePmtilesUrl={settings?.offlinePmtilesUrl}
                height="348px"
              />
            </div>

            {/* Donut Panel: ประเภทเหตุ */}
            <div className="c2-panel c2-panel-blue">
              <div className="c2-panel-header">
                <h3 className="c2-panel-title">ประเภทเหตุ</h3>
                <button
                  type="button"
                  className="c2-xs-btn no-print"
                  onClick={() => {
                    if (donutSvgRef.current) {
                      void exportSvgElementToPng(
                        donutSvgRef.current,
                        `ipb-categories-donut-${new Date().toISOString().slice(0, 10)}.png`,
                        'สัดส่วนประเภทเหตุการณ์',
                        isDark
                      );
                    }
                  }}
                >
                  <ImageDown size={13} aria-hidden="true" /> PNG
                </button>
              </div>
              <div className="c2-donut-layout">
                <svg
                  ref={donutSvgRef}
                  viewBox="0 0 180 180"
                  className="c2-donut-svg"
                  role="img"
                  aria-label="กราฟสัดส่วนประเภทเหตุการณ์"
                >
                  <circle
                    cx="90"
                    cy="90"
                    r="56"
                    fill="none"
                    stroke="var(--c2-grid)"
                    strokeWidth="24"
                  />
                  {totalEventCount > 0 &&
                    categoryStats.map((slice) => {
                      const pct = (slice.count / totalEventCount) * 100;
                      const offset = donutOffset;
                      donutOffset += pct;
                      return (
                        <circle
                          key={slice.category}
                          cx="90"
                          cy="90"
                          r="56"
                          fill="none"
                          stroke={slice.color}
                          strokeWidth="24"
                          pathLength={100}
                          strokeDasharray={`${pct} ${Math.max(0, 100 - pct)}`}
                          strokeDashoffset={-offset}
                          transform="rotate(-90 90 90)"
                          className="c2-clickable-slice"
                          onClick={() =>
                            setCategoryFilter((prev) =>
                              prev === slice.category ? '' : slice.category
                            )
                          }
                        >
                          <title>{`${slice.category}: ${slice.count} (${slice.pct}%)`}</title>
                        </circle>
                      );
                    })}
                  <text
                    x="90"
                    y="87"
                    textAnchor="middle"
                    fontSize="24"
                    fontWeight="800"
                    fill="var(--c2-text)"
                  >
                    {totalEventCount}
                  </text>
                  <text x="90" y="106" textAnchor="middle" fontSize="11" fill="var(--c2-muted)">
                    เหตุการณ์รวม
                  </text>
                </svg>

                <ul className="c2-donut-legend">
                  {categoryStats.map((c) => {
                    const active = categoryFilter === c.category;
                    return (
                      <li key={c.category}>
                        <button
                          type="button"
                          className={`c2-legend-btn ${active ? 'active' : ''}`}
                          onClick={() =>
                            setCategoryFilter((prev) => (prev === c.category ? '' : c.category))
                          }
                        >
                          <span className="c2-legend-dot" style={{ backgroundColor: c.color }} />
                          <span className="c2-legend-name" title={c.category}>
                            {c.category}
                          </span>
                          <strong className="c2-legend-val">
                            {c.count} ({Math.round(c.pct)}%)
                          </strong>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* Right Stack: Severity Horizontal Bars + Semi-Circle Gauge */}
            <div className="c2-right-stack">
              {/* Top Right (Red Frame): ระดับความรุนแรง */}
              <div className="c2-panel c2-panel-red">
                <div className="c2-panel-header">
                  <div>
                    <h3 className="c2-panel-title">ระดับความรุนแรง</h3>
                    <div className="c2-mini-dots">
                      {[...SEVERITY_LEVELS].reverse().map((s) => (
                        <span key={s.level} className="c2-dot-label">
                          <i style={{ backgroundColor: s.color }} />
                          {s.rank}:{s.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="c2-xs-btn no-print"
                    onClick={() =>
                      exportHorizontalBarsToPng(
                        'ระดับความรุนแรงของเหตุการณ์',
                        severityStats.map((s) => ({
                          label: s.label,
                          value: s.count,
                          subtitle: `${s.count} เหตุการณ์`,
                          color: s.color,
                        })),
                        `ipb-severity-${new Date().toISOString().slice(0, 10)}.png`
                      )
                    }
                  >
                    <ImageDown size={13} aria-hidden="true" />
                  </button>
                </div>

                <div className="c2-sev-bars">
                  {severityStats.map((s) => {
                    const widthPct = maxSeverity ? (s.count / maxSeverity) * 100 : 0;
                    const active = severityFilter === s.level;
                    return (
                      <button
                        key={s.level}
                        type="button"
                        className={`c2-sev-row ${active ? 'active' : ''}`}
                        onClick={() =>
                          setSeverityFilter((prev) => (prev === s.level ? '' : s.level))
                        }
                      >
                        <span className="c2-sev-label">{s.label}</span>
                        <span className="c2-sev-track">
                          <span
                            className="c2-sev-fill"
                            style={{
                              width: `${s.count > 0 ? Math.max(4, widthPct) : 0}%`,
                              backgroundColor: s.color,
                            }}
                          />
                        </span>
                        <strong className="c2-sev-count">{s.count}</strong>
                      </button>
                    );
                  })}
                  <div className="c2-axis-row">
                    <span>0</span>
                    <span>{Math.ceil(maxSeverity / 2)}</span>
                    <span>{maxSeverity}</span>
                  </div>
                </div>
              </div>

              {/* Bottom Right (Green Frame): Semi-Circle Gauge */}
              <div className="c2-panel c2-panel-green">
                <div className="c2-panel-header">
                  <h3 className="c2-panel-title">
                    {hasGasUrl ? 'สถานะปิด/ซิงก์เหตุ (%)' : 'ความครบถ้วนพิกัด (%)'}
                  </h3>
                  <span className="c2-badge-green">เป้า 90%</span>
                </div>
                <div className="c2-gauge-wrap">
                  <svg
                    viewBox="0 0 200 124"
                    className="c2-gauge-svg"
                    role="img"
                    aria-label="มาตรวัดร้อยละความครบถ้วน"
                  >
                    <path
                      d="M 24 104 A 76 76 0 0 1 176 104"
                      fill="none"
                      stroke="var(--c2-grid)"
                      strokeWidth="22"
                      pathLength={100}
                    />
                    <path
                      d="M 24 104 A 76 76 0 0 1 176 104"
                      fill="none"
                      stroke={
                        kpiStats.gaugePct >= 90
                          ? '#22c55e'
                          : kpiStats.gaugePct >= 60
                            ? '#38bdf8'
                            : '#f97316'
                      }
                      strokeWidth="22"
                      pathLength={100}
                      strokeDasharray={`${Math.min(100, Math.max(0, kpiStats.gaugePct))} 100`}
                    />
                    <line
                      x1={targetX1}
                      y1={targetY1}
                      x2={targetX2}
                      y2={targetY2}
                      stroke="#ef4444"
                      strokeWidth="2.5"
                    />
                    <text x="184" y="84" fontSize="10" fontWeight="700" fill="var(--c2-muted)">
                      90
                    </text>
                    <text x="16" y="118" fontSize="11" fill="var(--c2-muted)">
                      0
                    </text>
                    <text x="172" y="118" fontSize="11" fill="var(--c2-muted)">
                      100
                    </text>
                    <text
                      x="100"
                      y="96"
                      textAnchor="middle"
                      fontSize="26"
                      fontWeight="800"
                      fill="var(--c2-text)"
                    >
                      {kpiStats.gaugePct.toFixed(2)}
                    </text>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: 4-Column Bottom Analytics Strip */}
          <div className="c2-bottom-grid">
            {/* 1. 30-Day Line Trend */}
            <div className="c2-panel c2-panel-blue">
              <div className="c2-panel-header">
                <h3 className="c2-panel-title">แนวโน้มเหตุการณ์ 30 วันย้อนหลัง</h3>
                <button
                  type="button"
                  className="c2-xs-btn no-print"
                  onClick={() => {
                    if (dailySvgRef.current) {
                      void exportSvgElementToPng(
                        dailySvgRef.current,
                        `ipb-30d-trend-${new Date().toISOString().slice(0, 10)}.png`,
                        'แนวโน้มเหตุการณ์ 30 วันย้อนหลัง',
                        isDark
                      );
                    }
                  }}
                >
                  <ImageDown size={13} aria-hidden="true" />
                </button>
              </div>
              <svg
                ref={dailySvgRef}
                viewBox="0 0 360 170"
                className="c2-chart-svg"
                role="img"
                aria-label="กราฟเส้นแนวโน้มเหตุการณ์ 30 วันย้อนหลัง"
              >
                <defs>
                  <linearGradient id="c2TrendAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.32" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <line x1="34" y1="140" x2="346" y2="140" stroke="var(--c2-grid)" strokeWidth="1.2" />
                <line
                  x1="34"
                  y1="83"
                  x2="346"
                  y2="83"
                  stroke="var(--c2-grid)"
                  strokeDasharray="3 3"
                />
                <line
                  x1="34"
                  y1="26"
                  x2="346"
                  y2="26"
                  stroke="var(--c2-grid)"
                  strokeDasharray="3 3"
                />
                <text x="28" y="143" textAnchor="end" fontSize="10" fill="var(--c2-muted)">
                  0
                </text>
                <text x="28" y="86" textAnchor="end" fontSize="10" fill="var(--c2-muted)">
                  {Math.ceil(maxDaily / 2)}
                </text>
                <text x="28" y="29" textAnchor="end" fontSize="10" fill="var(--c2-muted)">
                  {maxDaily}
                </text>

                {dailyAreaPath && <path d={dailyAreaPath} fill="url(#c2TrendAreaGrad)" />}
                {dailyLineAttr && (
                  <polyline
                    fill="none"
                    stroke="var(--c2-accent)"
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                    points={dailyLineAttr}
                  />
                )}
                {dailyPoints.map(
                  (p, i) =>
                    p.count > 0 && (
                      <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--c2-accent)">
                        <title>{`${p.label}: ${p.count} เหตุการณ์`}</title>
                      </circle>
                    )
                )}

                {dailyTrend.length > 0 && (
                  <>
                    <text x="34" y="158" fontSize="10" fill="var(--c2-muted)">
                      {dailyTrend[0].label}
                    </text>
                    <text
                      x="190"
                      y="158"
                      textAnchor="middle"
                      fontSize="10"
                      fill="var(--c2-muted)"
                    >
                      {dailyTrend[Math.floor(dailyTrend.length / 2)].label}
                    </text>
                    <text x="346" y="158" textAnchor="end" fontSize="10" fill="var(--c2-muted)">
                      {dailyTrend[dailyTrend.length - 1].label}
                    </text>
                  </>
                )}
              </svg>
            </div>

            {/* 2. Monthly Stacked Vertical Bar Chart */}
            <div className="c2-panel c2-panel-blue">
              <div className="c2-panel-header">
                <h3 className="c2-panel-title">เหตุการณ์รายเดือน</h3>
                <button
                  type="button"
                  className="c2-xs-btn no-print"
                  onClick={() => {
                    if (monthlySvgRef.current) {
                      void exportSvgElementToPng(
                        monthlySvgRef.current,
                        `ipb-monthly-stacked-${new Date().toISOString().slice(0, 10)}.png`,
                        'สถิติเหตุการณ์รายเดือนแยกตามประเภท',
                        isDark
                      );
                    }
                  }}
                >
                  <ImageDown size={13} aria-hidden="true" />
                </button>
              </div>
              <div className="c2-mini-dots" style={{ marginBottom: 4 }}>
                {monthlyStacked.legendCats.map((cat) => (
                  <span key={cat} className="c2-dot-label" title={cat}>
                    <i style={{ backgroundColor: getC2CatColor(cat) }} />
                    {cat.length > 14 ? `${cat.slice(0, 13)}…` : cat}
                  </span>
                ))}
              </div>
              <svg
                ref={monthlySvgRef}
                viewBox="0 0 360 156"
                className="c2-chart-svg"
                role="img"
                aria-label="กราฟแท่งเหตุการณ์รายเดือน"
              >
                <line x1="30" y1="128" x2="348" y2="128" stroke="var(--c2-grid)" strokeWidth="1.2" />
                <line
                  x1="30"
                  y1="76"
                  x2="348"
                  y2="76"
                  stroke="var(--c2-grid)"
                  strokeDasharray="3 3"
                />
                <line
                  x1="30"
                  y1="24"
                  x2="348"
                  y2="24"
                  stroke="var(--c2-grid)"
                  strokeDasharray="3 3"
                />
                <text x="25" y="131" textAnchor="end" fontSize="10" fill="var(--c2-muted)">
                  0
                </text>
                <text x="25" y="27" textAnchor="end" fontSize="10" fill="var(--c2-muted)">
                  {maxMonthlyStack}
                </text>

                {monthlyStacked.months.map((m, idx) => {
                  const slot = 312 / Math.max(1, monthlyStacked.months.length);
                  const x = 34 + idx * slot + slot / 2;
                  const barW = Math.min(28, slot * 0.58);
                  let curY = 128;
                  return (
                    <g key={m.ym}>
                      {m.segments.map((seg) => {
                        const segH = (seg.count / maxMonthlyStack) * 100;
                        curY -= segH;
                        return (
                          <rect
                            key={seg.category}
                            x={x - barW / 2}
                            y={curY}
                            width={barW}
                            height={Math.max(1.5, segH)}
                            fill={seg.color}
                          >
                            <title>{`${m.label} • ${seg.category}: ${seg.count}`}</title>
                          </rect>
                        );
                      })}
                      <text
                        x={x}
                        y={Math.max(13, curY - 4)}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="700"
                        fill="var(--c2-text)"
                      >
                        {m.total}
                      </text>
                      <text x={x} y="144" textAnchor="middle" fontSize="10" fill="var(--c2-muted)">
                        {m.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* 3. Top Hotspot Districts */}
            <div className="c2-panel c2-panel-blue">
              <div className="c2-panel-header">
                <h3 className="c2-panel-title">อำเภอเกิดเหตุสูงสุด (Hotspot)</h3>
                <button
                  type="button"
                  className="c2-xs-btn no-print"
                  onClick={() => {
                    if (hotspotSvgRef.current) {
                      void exportSvgElementToPng(
                        hotspotSvgRef.current,
                        `ipb-hotspot-districts-${new Date().toISOString().slice(0, 10)}.png`,
                        'อันดับอำเภอที่เกิดเหตุสูงสุด',
                        isDark
                      );
                    }
                  }}
                >
                  <ImageDown size={13} aria-hidden="true" />
                </button>
              </div>
              <svg
                ref={hotspotSvgRef}
                viewBox="0 0 360 170"
                className="c2-chart-svg"
                role="img"
                aria-label="กราฟอำเภอเกิดเหตุสูงสุด"
              >
                <line x1="28" y1="136" x2="348" y2="136" stroke="var(--c2-grid)" strokeWidth="1.2" />
                <line
                  x1="28"
                  y1="80"
                  x2="348"
                  y2="80"
                  stroke="var(--c2-grid)"
                  strokeDasharray="3 3"
                />
                <line
                  x1="28"
                  y1="24"
                  x2="348"
                  y2="24"
                  stroke="var(--c2-grid)"
                  strokeDasharray="3 3"
                />
                <text x="23" y="139" textAnchor="end" fontSize="10" fill="var(--c2-muted)">
                  0
                </text>
                <text x="23" y="27" textAnchor="end" fontSize="10" fill="var(--c2-muted)">
                  {maxHotspot}
                </text>

                {topDistricts.map((d, idx) => {
                  const slot = 316 / Math.max(1, topDistricts.length);
                  const x = 30 + idx * slot + slot / 2;
                  const barW = Math.min(28, slot * 0.56);
                  const barH = Math.max(4, (d.count / maxHotspot) * 108);
                  const y = 136 - barH;
                  const shortLabel = d.label.length > 9 ? `${d.label.slice(0, 8)}…` : d.label;
                  return (
                    <g key={d.label}>
                      <rect
                        x={x - barW / 2}
                        y={y}
                        width={barW}
                        height={barH}
                        rx="3"
                        fill="#0ea5e9"
                      >
                        <title>{`${d.label}: ${d.count} เหตุการณ์`}</title>
                      </rect>
                      <text
                        x={x}
                        y={y - 5}
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="700"
                        fill="var(--c2-text)"
                      >
                        {d.count}
                      </text>
                      <text x={x} y="153" textAnchor="middle" fontSize="9.5" fill="var(--c2-muted)">
                        {shortLabel}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* 4. 100%-Stacked Area Severity Mix */}
            <div className="c2-panel c2-panel-blue">
              <div className="c2-panel-header">
                <h3 className="c2-panel-title">ระดับความรุนแรงในแต่ละพื้นที่</h3>
              </div>
              <div className="c2-mini-dots" style={{ marginBottom: 8 }}>
                {[...SEVERITY_LEVELS].reverse().map((s) => (
                  <span key={s.level} className="c2-dot-label">
                    <i style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
              <div className="c2-area-sev-list">
                {areaSeverityRows.map((row) => (
                  <div
                    key={row.key}
                    className="c2-area-sev-row"
                    title={`${row.label} (${row.total} เหตุการณ์): สูงสุด ${row.counts.critical}, สูง ${row.counts.high}, ปานกลาง ${row.counts.medium}, ต่ำ ${row.counts.low}`}
                  >
                    <span className="c2-area-sev-name">{row.label}</span>
                    <span className="c2-area-sev-track">
                      {([...SEVERITY_LEVELS].reverse()).map((sev) => {
                        const pct = row.pcts[sev.level];
                        if (!pct) return null;
                        return (
                          <span
                            key={sev.level}
                            className="c2-area-sev-seg"
                            style={{ width: `${pct}%`, backgroundColor: sev.color }}
                          />
                        );
                      })}
                    </span>
                    <span className="c2-area-sev-tot">{row.total}</span>
                  </div>
                ))}
                <div className="c2-axis-row" style={{ marginTop: 6 }}>
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 4: Preserved Full IPB Area × Category Matrix Table */}
          <div className="c2-panel c2-panel-blue c2-matrix-panel">
            <div className="c2-panel-header">
              <div>
                <h3 className="c2-panel-title">
                  ตารางเมทริกซ์พื้นที่ × ประเภทเหตุการณ์ (สำหรับประกอบรายงาน IPB / สไลด์)
                </h3>
                <p className="c2-subtitle-th" style={{ marginTop: 2 }}>
                  แสดงจำนวนเหตุการณ์ถ่วงน้ำหนักตามพื้นที่และประเภทเหตุการณ์ ({matrixRows.length} พื้นที่)
                </p>
              </div>
              <button
                type="button"
                className="c2-xs-btn no-print"
                onClick={() => exportIpbMatrixToCsv(matrixRows, activeCategories)}
              >
                <Download size={13} aria-hidden="true" /> Export CSV
              </button>
            </div>
            <div className="table-scroll">
              <table className="gov-table c2-table">
                <thead>
                  <tr>
                    <th>พื้นที่ (จังหวัด / อำเภอ)</th>
                    {activeCategories.map((cat) => (
                      <th key={cat} className="num-col">
                        {cat}
                      </th>
                    ))}
                    <th className="num-col">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map((row) => (
                    <tr key={row.area}>
                      <td>
                        <strong>{row.area}</strong>
                      </td>
                      {activeCategories.map((cat) => (
                        <td key={cat} className="num-col">
                          {row.counts[cat] || 0}
                        </td>
                      ))}
                      <td className="num-col">
                        <strong>{row.total}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>รวมทั้งหมด</th>
                    {activeCategories.map((cat) => (
                      <th key={cat} className="num-col">
                        {matrixRows.reduce((acc, r) => acc + (r.counts[cat] || 0), 0)}
                      </th>
                    ))}
                    <th className="num-col">{totalEventCount}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
