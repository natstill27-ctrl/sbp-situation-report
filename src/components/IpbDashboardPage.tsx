import { useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  ClipboardCopy,
  CloudDownload,
  Database,
  Download,
  Filter,
  ImageDown,
  Printer,
  RotateCcw,
} from 'lucide-react';
import type { IncidentRecord } from '../types/incident';
import { getCategoryColor } from '../utils/categoryColors';
import {
  exportHorizontalBarsToPng,
  exportIpbMatrixToCsv,
  exportSvgElementToPng,
} from '../utils/exportUtils';
import type { GasPullResult } from '../utils/gasSync';
import { getTargetProvinces } from '../utils/geoLookup';
import { THAI_MONTHS_SHORT, formatThaiDateTime, toThaiDigits } from '../utils/thaiDate';

interface IpbDashboardPageProps {
  incidents: IncidentRecord[];
  categories: string[];
  onLoadSamples: () => Promise<void>;
  hasGasUrl?: boolean;
  onPullFromGas?: () => Promise<GasPullResult>;
}

export function IpbDashboardPage({
  incidents,
  categories,
  onLoadSamples,
  hasGasUrl = false,
  onPullFromGas,
}: IpbDashboardPageProps) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [provinceFilter, setProvinceFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const monthlySvgRef = useRef<SVGSVGElement | null>(null);

  const provinces = useMemo(() => getTargetProvinces(), []);

  const filtered = useMemo(() => {
    return incidents.filter((item) => {
      const itemDate = (item.occurredAt || '').slice(0, 10);
      if (dateFrom && itemDate < dateFrom) return false;
      if (dateTo && itemDate > dateTo) return false;
      if (provinceFilter && item.province !== provinceFilter) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      return true;
    });
  }, [incidents, dateFrom, dateTo, provinceFilter, categoryFilter]);

  const getEventCount = (item: IncidentRecord) =>
    item.eventCount && item.eventCount > 0 ? item.eventCount : 1;

  const totalEventCount = useMemo(
    () => filtered.reduce((acc, item) => acc + getEventCount(item), 0),
    [filtered]
  );

  const targetAreaEventCount = useMemo(
    () =>
      filtered.reduce((acc, item) => acc + (item.inTargetArea ? getEventCount(item) : 0), 0),
    [filtered]
  );

  // 1. Province counts
  const provinceStats = useMemo(() => {
    const counts: Record<string, number> = {
      ปัตตานี: 0,
      ยะลา: 0,
      นราธิวาส: 0,
      สงขลา: 0,
      อื่นๆ: 0,
    };
    for (const item of filtered) {
      const weight = getEventCount(item);
      if (item.province in counts) {
        counts[item.province] += weight;
      } else {
        counts['อื่นๆ'] += weight;
      }
    }
    return [
      { key: 'ปัตตานี', label: 'จว.ปัตตานี', count: counts['ปัตตานี'], color: '#0f4c81' },
      { key: 'ยะลา', label: 'จว.ยะลา', count: counts['ยะลา'], color: '#1d4ed8' },
      { key: 'นราธิวาส', label: 'จว.นราธิวาส', count: counts['นราธิวาส'], color: '#0f766e' },
      { key: 'สงขลา', label: '4 อ. จว.สงขลา', count: counts['สงขลา'], color: '#b45309' },
      ...(counts['อื่นๆ'] > 0
        ? [{ key: 'อื่นๆ', label: 'นอกเขต/อื่นๆ', count: counts['อื่นๆ'], color: '#64748b' }]
        : []),
    ];
  }, [filtered]);

  // 2. Top districts
  const topDistricts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of filtered) {
      const label = item.district
        ? `อ.${item.district}${item.province ? ` (${item.province})` : ''}`
        : item.province || 'ไม่ระบุพื้นที่';
      map.set(label, (map.get(label) || 0) + getEventCount(item));
    }
    return Array.from(map.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 7);
  }, [filtered]);

  // 3. Monthly trend (YYYY-MM)
  const monthlyStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of filtered) {
      const ym = (item.occurredAt || item.createdAt || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(ym)) {
        map.set(ym, (map.get(ym) || 0) + getEventCount(item));
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, count]) => {
        const [yStr, mStr] = ym.split('-');
        const beShort = String(Number(yStr) + 543).slice(-2);
        const mName = THAI_MONTHS_SHORT[Number(mStr) - 1] || mStr;
        return { ym, label: `${mName}${beShort}`, count };
      });
  }, [filtered]);

  // 4. Category stats
  const categoryStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of filtered) {
      map.set(item.category, (map.get(item.category) || 0) + getEventCount(item));
    }
    return Array.from(map.entries())
      .map(([category, count], idx) => ({
        category,
        count,
        pct: totalEventCount ? Math.round((count / totalEventCount) * 100) : 0,
        color: getCategoryColor(category, idx),
      }))
      .sort((a, b) => b.count - a.count);
  }, [filtered, totalEventCount]);

  // 5. IPB Area × Category Matrix (by Province and District)
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
      const weight = getEventCount(item);
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
  const topCategory = categoryStats[0];

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
      .map((c) => `- ${c.category}: ${c.count} ครั้ง (${c.pct}%)`)
      .join('\n');

    const text = toThaiDigits(
      `สรุปสถิติสถานการณ์เพื่อประกอบการวิเคราะห์ IPB (${rangeLabel})\n` +
        `รวมเหตุการณ์ทั้งหมด: ${totalEventCount} ครั้ง\n` +
        `จำแนกรายจังหวัด: ${provLines || '-'}\n` +
        `พื้นที่เกิดเหตุสูงสุด: ${topDistrict ? `${topDistrict.label} (${topDistrict.count} ครั้ง)` : '-'}\n` +
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

  const maxMonthly = Math.max(1, ...monthlyStats.map((m) => m.count));
  const maxProvince = Math.max(1, ...provinceStats.map((p) => p.count));
  const maxCategory = Math.max(1, ...categoryStats.map((c) => c.count));

  return (
    <section aria-labelledby="ipb-heading" className="page-section">
      <div className="section-header-row">
        <div>
          <h2 id="ipb-heading" className="section-title">
            แดชบอร์ดเหตุการณ์และสถิติ (สำหรับวิเคราะห์ IPB และจัดทำ Paper / สไลด์)
          </h2>
          <p className="section-subtitle">
            แสดงตัวเลขสถิติบนกราฟโดยตรง พร้อมตารางเมทริกซ์พื้นที่ × ประเภทเหตุการณ์ เพื่อนำไปอ้างอิงทำ IPB ได้ทันที
          </p>
        </div>
        <div className="header-action-group no-print">
          {onPullFromGas && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={handlePull}
              disabled={pulling || !hasGasUrl}
              title={
                hasGasUrl
                  ? 'ดึงข้อมูลสถานการณ์ 3 จชต. ย้อนหลังจาก Google Apps Script (?page=json)'
                  : 'กรุณาตั้งค่า Webhook URL ในหน้าตั้งค่าก่อน'
              }
            >
              <CloudDownload size={16} aria-hidden="true" />
              <span>{pulling ? 'กำลังดึงข้อมูล...' : 'ดึงข้อมูลจาก GAS เดิม'}</span>
            </button>
          )}
          {incidents.length === 0 && (
            <button type="button" className="btn btn-outline" onClick={onLoadSamples}>
              <Database size={16} aria-hidden="true" />
              <span>โหลดข้อมูลตัวอย่างทดสอบ</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleCopyIpbSummaryText}
            disabled={filtered.length === 0}
          >
            <ClipboardCopy size={16} aria-hidden="true" />
            <span>{copiedSummary ? 'คัดลอกสรุปแล้ว!' : 'คัดลอกสรุปสถิติ (เลขไทย)'}</span>
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => exportIpbMatrixToCsv(matrixRows, activeCategories)}
            disabled={filtered.length === 0}
          >
            <Download size={16} aria-hidden="true" />
            <span>Export ตาราง IPB (CSV)</span>
          </button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" />
            <span>พิมพ์ / PDF</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      {pullStatus && (
        <div
          className={`inline-alert ${pullStatus.ok ? 'info' : 'danger'} no-print`}
          style={{ marginBottom: '1rem' }}
          role="status"
        >
          <span>{pullStatus.message}</span>
        </div>
      )}
      <div className="gov-card filter-card no-print">
        <div className="filter-grid">
          <div>
            <label htmlFor="ipb-date-from" className="sub-label">
              ตั้งแต่วันที่
            </label>
            <input
              id="ipb-date-from"
              type="date"
              className="form-input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            {dateFrom && (
              <div className="cell-sub">
                {formatThaiDateTime(dateFrom, { includeTime: false })}
              </div>
            )}
          </div>
          <div>
            <label htmlFor="ipb-date-to" className="sub-label">
              ถึงวันที่
            </label>
            <input
              id="ipb-date-to"
              type="date"
              className="form-input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
            {dateTo && (
              <div className="cell-sub">
                {formatThaiDateTime(dateTo, { includeTime: false })}
              </div>
            )}
          </div>
          <div>
            <label htmlFor="ipb-prov-filter" className="sub-label">
              จังหวัด / พื้นที่
            </label>
            <select
              id="ipb-prov-filter"
              className="form-select"
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
            <label htmlFor="ipb-cat-filter" className="sub-label">
              ประเภทเหตุการณ์
            </label>
            <select
              id="ipb-cat-filter"
              className="form-select"
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
          <div className="filter-reset-cell">
            <button type="button" className="btn btn-outline" onClick={resetFilters}>
              <RotateCcw size={15} aria-hidden="true" />
              <span>ล้างตัวกรอง</span>
            </button>
          </div>
        </div>
        <div className="preset-btn-row" role="group" aria-label="เลือกช่วงเวลาด่วน">
          <span className="sub-label" style={{ margin: 0 }}>
            ช่วงเวลาด่วน:
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
              className="btn-xs btn-outline preset-btn"
              onClick={() => applyDatePreset(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="gov-card empty-state-card">
          <BarChart3 size={40} className="text-muted" aria-hidden="true" />
          <h3>ยังไม่มีข้อมูลเหตุการณ์สำหรับแสดงสถิติ IPB</h3>
          <p>
            กรุณาบันทึกเหตุการณ์ในหน้า &ldquo;บันทึกเหตุการณ์&rdquo; หรือกดปุ่มด้านล่างเพื่อโหลดชุดข้อมูลตัวอย่างทดสอบ
            (ข้อมูลสมมติเพื่อดูตัวอย่างกราฟ IPB)
          </p>
          <button type="button" className="btn btn-primary" onClick={onLoadSamples}>
            <Database size={16} aria-hidden="true" />
            <span>โหลดข้อมูลตัวอย่างทดสอบ</span>
          </button>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="kpi-grid">
            <div className="gov-card kpi-card kpi-primary">
              <span className="kpi-label">เหตุการณ์ทั้งหมด (ตามตัวกรอง)</span>
              <strong className="kpi-value">{totalEventCount}</strong>
              <span className="kpi-sub">
                ในเขตพื้นที่หลัก {targetAreaEventCount} เหตุการณ์
              </span>
            </div>

            <div className="gov-card kpi-card">
              <span className="kpi-label">แยกตาม 3 จว. + 4 อ.สงขลา</span>
              <div className="kpi-prov-pills">
                {provinceStats.map((p) => (
                  <div key={p.key} className="kpi-mini-row">
                    <span>{p.label}</span>
                    <strong>{p.count}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="gov-card kpi-card">
              <span className="kpi-label">อำเภอที่เกิดเหตุสูงสุด (Hotspot)</span>
              <strong className="kpi-value-text">{topDistrict ? topDistrict.label : '-'}</strong>
              <span className="kpi-sub">
                {topDistrict ? `จำนวน ${topDistrict.count} เหตุการณ์` : ''}
              </span>
            </div>

            <div className="gov-card kpi-card">
              <span className="kpi-label">ประเภทเหตุการณ์สูงสุด</span>
              <strong className="kpi-value-text">{topCategory ? topCategory.category : '-'}</strong>
              <span className="kpi-sub">
                {topCategory ? `${topCategory.count} เหตุการณ์ (${topCategory.pct}%)` : ''}
              </span>
            </div>
          </div>

          {/* Charts Grid */}
          <div className="charts-grid">
            {/* 1. Monthly Trend */}
            <div className="gov-card chart-card">
              <div className="chart-header">
                <h3>1. แนวโน้มเหตุการณ์รายเดือน (Time Trend - IPB)</h3>
                <div className="chart-header-actions">
                  <span className="badge badge-info">{monthlyStats.length} เดือน</span>
                  <button
                    type="button"
                    className="btn-xs btn-outline no-print"
                    onClick={() => {
                      if (monthlySvgRef.current) {
                        void exportSvgElementToPng(
                          monthlySvgRef.current,
                          `ipb-monthly-trend-${new Date().toISOString().slice(0, 10)}.png`,
                          'แนวโน้มเหตุการณ์รายเดือน (IPB)'
                        );
                      }
                    }}
                    title="บันทึกรูปกราฟเป็น PNG สำหรับสไลด์/Paper"
                  >
                    <ImageDown size={13} aria-hidden="true" /> PNG
                  </button>
                </div>
              </div>
              <div className="svg-chart-wrap">
                <svg
                  ref={monthlySvgRef}
                  viewBox={`0 0 ${Math.max(420, monthlyStats.length * 78)} 230`}
                  className="svg-chart"
                  role="img"
                  aria-label="กราฟแนวโน้มเหตุการณ์รายเดือน"
                >
                  {/* Baseline & grid */}
                  <line x1="36" y1="180" x2={Math.max(400, monthlyStats.length * 78 - 20)} y2="180" stroke="#cbd5e1" strokeWidth="1.5" />
                  <line x1="36" y1="110" x2={Math.max(400, monthlyStats.length * 78 - 20)} y2="110" stroke="#e2e8f0" strokeDasharray="4 4" />
                  <line x1="36" y1="40" x2={Math.max(400, monthlyStats.length * 78 - 20)} y2="40" stroke="#e2e8f0" strokeDasharray="4 4" />

                  {monthlyStats.map((m, idx) => {
                    const slotWidth = Math.max(64, (Math.max(360, monthlyStats.length * 78 - 60)) / Math.max(1, monthlyStats.length));
                    const x = 44 + idx * slotWidth + slotWidth / 2;
                    const barW = Math.min(42, slotWidth * 0.56);
                    const barH = Math.max(4, (m.count / maxMonthly) * 135);
                    const y = 180 - barH;
                    return (
                      <g key={m.ym}>
                        <rect
                          x={x - barW / 2}
                          y={y}
                          width={barW}
                          height={barH}
                          rx="4"
                          fill="var(--info)"
                        />
                        <text
                          x={x}
                          y={y - 7}
                          textAnchor="middle"
                          fontSize="13"
                          fontWeight="700"
                          fill="var(--text-main)"
                        >
                          {m.count}
                        </text>
                        <text x={x} y="202" textAnchor="middle" fontSize="12" fill="var(--text-muted)">
                          {m.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* 2. Province Comparison */}
            <div className="gov-card chart-card">
              <div className="chart-header">
                <h3>2. เปรียบเทียบจำนวนเหตุการณ์รายจังหวัด / พื้นที่</h3>
                <div className="chart-header-actions">
                  <span className="badge badge-info">รวม {filtered.length}</span>
                  <button
                    type="button"
                    className="btn-xs btn-outline no-print"
                    onClick={() =>
                      exportHorizontalBarsToPng(
                        'เปรียบเทียบจำนวนเหตุการณ์รายจังหวัด / พื้นที่',
                        provinceStats.map((p) => {
                          const pct = filtered.length
                            ? Math.round((p.count / filtered.length) * 100)
                            : 0;
                          return {
                            label: p.label,
                            value: p.count,
                            subtitle: `${p.count} ครั้ง (${pct}%)`,
                            color: p.color,
                          };
                        }),
                        `ipb-provinces-${new Date().toISOString().slice(0, 10)}.png`
                      )
                    }
                    title="บันทึกรูปกราฟเป็น PNG สำหรับสไลด์/Paper"
                  >
                    <ImageDown size={13} aria-hidden="true" /> PNG
                  </button>
                </div>
              </div>
              <div className="hbar-list">
                {provinceStats.map((p) => {
                  const pct = filtered.length ? Math.round((p.count / filtered.length) * 100) : 0;
                  const widthPct = Math.round((p.count / maxProvince) * 100);
                  return (
                    <div key={p.key} className="hbar-row">
                      <div className="hbar-label-col">
                        <span>{p.label}</span>
                        <strong>
                          {p.count} ครั้ง ({pct}%)
                        </strong>
                      </div>
                      <div className="hbar-track" aria-hidden="true">
                        <div
                          className="hbar-fill"
                          style={{ width: `${Math.max(p.count > 0 ? 4 : 0, widthPct)}%`, backgroundColor: p.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <h4 className="sub-chart-title">อันดับอำเภอที่เกิดเหตุสูงสุด (Top Districts)</h4>
              <div className="hbar-list compact">
                {topDistricts.map((d) => {
                  const topMax = Math.max(1, topDistricts[0]?.count || 1);
                  const w = Math.round((d.count / topMax) * 100);
                  return (
                    <div key={d.label} className="hbar-row">
                      <div className="hbar-label-col">
                        <span>{d.label}</span>
                        <strong>{d.count}</strong>
                      </div>
                      <div className="hbar-track" aria-hidden="true">
                        <div className="hbar-fill" style={{ width: `${w}%`, backgroundColor: '#1e40af' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Event Category Breakdown */}
            <div className="gov-card chart-card full-span">
              <div className="chart-header">
                <h3>3. สถิติจำแนกตามประเภทเหตุการณ์ (Event Pattern - IPB)</h3>
                <div className="chart-header-actions">
                  <span className="badge badge-info">{categoryStats.length} ประเภท</span>
                  <button
                    type="button"
                    className="btn-xs btn-outline no-print"
                    onClick={() =>
                      exportHorizontalBarsToPng(
                        'สถิติจำแนกตามประเภทเหตุการณ์ (Event Pattern - IPB)',
                        categoryStats.map((c) => ({
                          label: c.category,
                          value: c.count,
                          subtitle: `${c.count} เหตุการณ์ (${c.pct}%)`,
                          color: c.color,
                        })),
                        `ipb-categories-${new Date().toISOString().slice(0, 10)}.png`
                      )
                    }
                    title="บันทึกรูปกราฟเป็น PNG สำหรับสไลด์/Paper"
                  >
                    <ImageDown size={13} aria-hidden="true" /> PNG
                  </button>
                </div>
              </div>
              <div className="category-bars-grid">
                {categoryStats.map((c) => {
                  const w = Math.round((c.count / maxCategory) * 100);
                  return (
                    <div key={c.category} className="hbar-row">
                      <div className="hbar-label-col">
                        <span className="cat-dot-label">
                          <span className="cat-dot" style={{ backgroundColor: c.color }} />
                          {c.category}
                        </span>
                        <strong>
                          {c.count} เหตุการณ์ ({c.pct}%)
                        </strong>
                      </div>
                      <div className="hbar-track" aria-hidden="true">
                        <div className="hbar-fill" style={{ width: `${w}%`, backgroundColor: c.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 4. IPB Cross-Tab Matrix Table */}
          <div className="gov-card table-card">
            <div className="chart-header">
              <div>
                <h3>4. ตารางเมทริกซ์พื้นที่ × ประเภทเหตุการณ์ (สำหรับนำไปประกอบตาราง IPB / สไลด์)</h3>
                <p className="card-subtitle">แสดงจำนวนเหตุการณ์แยกตามจังหวัด/อำเภอ และประเภทเหตุการณ์</p>
              </div>
              <div className="no-print">
                <Filter size={16} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 6 }} />
                <span>แสดง {matrixRows.length} พื้นที่</span>
              </div>
            </div>
            <div className="table-scroll">
              <table className="gov-table">
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
