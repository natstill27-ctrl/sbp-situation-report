import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  Crosshair,
  Download,
  ExternalLink,
  NotebookPen,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import type { AppSettings } from '../types/incident';
import type { DailyLogDraft, DailyLogOrigin, DailyLogRecord, NewsCategoryId } from '../types/news';
import { parseCoordinateInput } from '../utils/coordinates';
import {
  DAILY_LOG_CATEGORY_TABS,
  DEFAULT_DAILY_LOG_MASTER_SHEET,
} from '../utils/dailyLogGasSync';
import { triggerCsvDownload } from '../utils/exportUtils';
import {
  getCenterOfArea,
  getDistrictsByProvince,
  getSubdistrictsByDistrict,
  getTargetProvinces,
  lookupAreaByLatLng,
} from '../utils/geoLookup';
import { NEWS_CATEGORIES, NEWS_CATEGORY_MAP } from '../utils/newsCurator';
import { sanitizeHttpUrl } from '../utils/safeHtml';
import {
  formatThaiDateTime,
  getBangkokYmd,
  getCurrentLocalDateTimeInput,
} from '../utils/thaiDateFormat';
import { LeafletMap } from './LeafletMap';

interface DailyLogPageProps {
  settings: AppSettings;
  dailyLogs: DailyLogRecord[];
  staffPin: string;
  draft: DailyLogDraft | null;
  onClearDraft: () => void;
  onSaveDailyLog: (record: DailyLogRecord) => Promise<DailyLogRecord>;
  onDeleteDailyLog: (record: DailyLogRecord) => Promise<void>;
  onRetrySyncDailyLog: (record: DailyLogRecord) => Promise<void>;
  onPullDailyLogs: () => Promise<{ ok: boolean; message: string }>;
}

const RELIABILITY_OPTIONS = [
  { value: 'A1', label: 'A1 — เชื่อถือได้อย่างสมบูรณ์ / ยืนยันแล้ว' },
  { value: 'B2', label: 'B2 — แหล่งข่าวราชการ / น่าเชื่อถือ' },
  { value: 'C2', label: 'C2 — สื่อหลัก / รายงานตรงไปตรงมา' },
  { value: 'C3', label: 'C3 — แหล่งข่าวทางข้าง / รอตรวจยืนยันเพิ่มเติม' },
];

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? '')
    .replace(/[\r\n\u2028\u2029\v]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function DailyLogPage({
  settings,
  dailyLogs,
  staffPin,
  draft,
  onClearDraft,
  onSaveDailyLog,
  onDeleteDailyLog,
  onRetrySyncDailyLog,
  onPullDailyLogs,
}: DailyLogPageProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [category, setCategory] = useState<NewsCategoryId>('security');
  const [occurredAt, setOccurredAt] = useState(getCurrentLocalDateTimeInput);
  const [entryOrigin, setEntryOrigin] = useState<DailyLogOrigin>('manual');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');
  const [subdistrict, setSubdistrict] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [coordRaw, setCoordRaw] = useState('');
  const [coordError, setCoordError] = useState('');
  const [sourceName, setSourceName] = useState('แหล่งข่าวทางข้าง / แผนก ผขว.');
  const [sourceLink, setSourceLink] = useState('');
  const [reliabilityCode, setReliabilityCode] = useState('B2');
  const [analystNote, setAnalystNote] = useState('');
  const [reporter, setReporter] = useState(settings.defaultReporter || '');
  const [linkedNewsId, setLinkedNewsId] = useState<string | undefined>(undefined);

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [formError, setFormError] = useState('');
  const [statusBanner, setStatusBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const [listCatFilter, setListCatFilter] = useState<'all' | NewsCategoryId>('all');
  const [listSearch, setListSearch] = useState('');

  const provinces = useMemo(() => getTargetProvinces(), []);
  const districts = useMemo(() => (province ? getDistrictsByProvince(province) : []), [province]);
  const subdistricts = useMemo(
    () => (province && district ? getSubdistrictsByDistrict(province, district) : []),
    [province, district]
  );

  // Prefill from News HUB 1-click curation
  useEffect(() => {
    if (!draft) return;
    setEditingId(null);
    setCategory(draft.category);
    const bkk = new Date(new Date(draft.occurredAt).getTime() + 7 * 60 * 60 * 1000);
    if (!Number.isNaN(bkk.getTime())) {
      setOccurredAt(bkk.toISOString().slice(0, 16));
    }
    setEntryOrigin(draft.entryOrigin);
    setTitle(draft.title);
    setSummary(draft.summary);
    setProvince(draft.province);
    setDistrict(draft.district);
    setSubdistrict('');
    setSourceName(draft.sourceName);
    setSourceLink(draft.sourceLink || '');
    setReliabilityCode(draft.reliabilityCode || 'C2');
    setAnalystNote('');
    setLinkedNewsId(draft.newsId);
    setSubmitAttempted(false);
    setFormError('');

    if (draft.province) {
      const center =
        getCenterOfArea(draft.province, draft.district || undefined) ||
        getCenterOfArea(draft.province);
      if (center) {
        setLat(center.lat);
        setLng(center.lng);
        setCoordRaw(`${center.lat}, ${center.lng}`);
      } else {
        setLat(null);
        setLng(null);
        setCoordRaw('');
      }
    } else {
      setLat(null);
      setLng(null);
      setCoordRaw('');
    }
    onClearDraft();
  }, [draft, onClearDraft]);

  const masterSheetName =
    (settings.dailyLogMasterSheetName || '').trim() || DEFAULT_DAILY_LOG_MASTER_SHEET;
  const targetCategoryTab = DAILY_LOG_CATEGORY_TABS[category] || 'ความมั่นคงและเหตุรุนแรง';

  const handleCoordInput = (val: string) => {
    setCoordRaw(val);
    if (!val.trim()) {
      setCoordError('');
      setLat(null);
      setLng(null);
      return;
    }
    const parsed = parseCoordinateInput(val);
    if (!parsed) {
      setCoordError('รูปแบบพิกัดไม่ถูกต้อง (รองรับ Lat/Lng, MGRS, UTM, ลิงก์ Google Maps)');
      return;
    }
    setCoordError('');
    setLat(parsed.lat);
    setLng(parsed.lng);
    const area = lookupAreaByLatLng(parsed.lat, parsed.lng);
    if (area.inTargetArea) {
      setProvince(area.province);
      setDistrict(area.district);
      setSubdistrict(area.subdistrict);
    }
  };

  const handlePickMap = (pickedLat: number, pickedLng: number) => {
    setLat(pickedLat);
    setLng(pickedLng);
    setCoordRaw(`${pickedLat}, ${pickedLng}`);
    setCoordError('');
    const area = lookupAreaByLatLng(pickedLat, pickedLng);
    if (area.inTargetArea) {
      setProvince(area.province);
      setDistrict(area.district);
      setSubdistrict(area.subdistrict);
    }
  };

  const handleJumpAreaPin = () => {
    if (!province) return;
    const center =
      getCenterOfArea(province, district || undefined, subdistrict || undefined) ||
      getCenterOfArea(province);
    if (center) {
      setLat(center.lat);
      setLng(center.lng);
      setCoordRaw(`${center.lat}, ${center.lng}`);
      setCoordError('');
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setSummary('');
    setProvince('');
    setDistrict('');
    setSubdistrict('');
    setLat(null);
    setLng(null);
    setCoordRaw('');
    setCoordError('');
    setEntryOrigin('manual');
    setSourceName('แหล่งข่าวทางข้าง / แผนก ผขว.');
    setSourceLink('');
    setReliabilityCode('B2');
    setAnalystNote('');
    setLinkedNewsId(undefined);
    setOccurredAt(getCurrentLocalDateTimeInput());
    setSubmitAttempted(false);
    setFormError('');
  };

  const handleEdit = (rec: DailyLogRecord) => {
    setEditingId(rec.id);
    setCategory(rec.category);
    setOccurredAt(rec.occurredAt || getCurrentLocalDateTimeInput());
    setEntryOrigin(rec.entryOrigin);
    setTitle(rec.title);
    setSummary(rec.summary);
    setProvince(rec.province);
    setDistrict(rec.district);
    setSubdistrict(rec.subdistrict);
    setLat(rec.lat);
    setLng(rec.lng);
    setCoordRaw(rec.lat !== null && rec.lng !== null ? `${rec.lat}, ${rec.lng}` : '');
    setCoordError('');
    setSourceName(rec.sourceName);
    setSourceLink(rec.sourceLink || '');
    setReliabilityCode(rec.reliabilityCode || 'B2');
    setAnalystNote(rec.analystNote || '');
    setReporter(rec.reporter || settings.defaultReporter || '');
    setLinkedNewsId(rec.newsId);
    setSubmitAttempted(false);
    setFormError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setStatusBanner(null);
    setSubmitAttempted(true);

    if (!title.trim()) {
      setFormError('กรุณากรอกหัวข้อข่าวหรือเหตุการณ์ประจำวัน');
      return;
    }
    if (!summary.trim()) {
      setFormError('กรุณากรอกสรุปเนื้อหาข่าว/เหตุการณ์');
      return;
    }
    if (!reporter.trim()) {
      setFormError('กรุณาระบุชื่อ/ตำแหน่งผู้บันทึก');
      return;
    }
    setSubmitAttempted(false);

    const nowIso = new Date().toISOString();
    const existing = editingId ? dailyLogs.find((d) => d.id === editingId) : undefined;
    const beYear = new Date().getFullYear() + 543;
    const record: DailyLogRecord = {
      id: editingId || `DLOG-${beYear}-${String(Date.now()).slice(-6)}`,
      occurredAt,
      category,
      title: title.trim(),
      summary: summary.trim(),
      province: province.trim(),
      district: district.trim(),
      subdistrict: subdistrict.trim(),
      lat,
      lng,
      sourceName: sourceName.trim() || 'บันทึกแผนก ผขว.',
      sourceLink: sourceLink.trim() || undefined,
      reliabilityCode,
      entryOrigin,
      analystNote: analystNote.trim() || undefined,
      reporter: reporter.trim(),
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      syncStatus: 'pending',
      ...(linkedNewsId ? { newsId: linkedNewsId } : {}),
    };

    setSaving(true);
    try {
      const saved = await onSaveDailyLog(record);
      if (saved.syncStatus === 'synced') {
        setStatusBanner({
          ok: true,
          text: `บันทึกรายการ ${saved.id} ลงแท็บ "${targetCategoryTab}" และ "${masterSheetName}" ใน Google Sheet แผนกเรียบร้อยแล้ว`,
        });
      } else {
        setStatusBanner({
          ok: false,
          text: `บันทึกลงเครื่องแล้ว (${saved.syncError || 'รอเชื่อมต่อระบบชีทแผนก'})`,
        });
      }
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    setStatusBanner(null);
    try {
      const res = await onPullDailyLogs();
      setStatusBanner({ ok: res.ok, text: res.message });
    } finally {
      setPulling(false);
    }
  };

  const countsByCategory = useMemo(() => {
    const map: Record<NewsCategoryId, number> = {
      politics: 0,
      economy: 0,
      social: 0,
      narcotics: 0,
      security: 0,
      weather: 0,
      migrant: 0,
    };
    for (const item of dailyLogs) {
      map[item.category] = (map[item.category] || 0) + 1;
    }
    return map;
  }, [dailyLogs]);

  const filteredLogs = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return dailyLogs.filter((item) => {
      if (listCatFilter !== 'all' && item.category !== listCatFilter) return false;
      if (q) {
        const hay = `${item.title} ${item.summary} ${item.province} ${item.district} ${item.sourceName} ${item.analystNote || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [dailyLogs, listCatFilter, listSearch]);

  const handleExportCsv = () => {
    const headers = [
      'รหัส',
      'วัน-เวลา',
      'หมวดข่าว',
      'หัวข้อ',
      'สรุปเนื้อหา',
      'จังหวัด',
      'อำเภอ',
      'ตำบล',
      'Lat',
      'Lng',
      'แหล่งข่าว',
      'ความน่าเชื่อถือ',
      'ความเห็น ผขว.',
      'ผู้บันทึก',
    ];
    const rows = filteredLogs.map((r) => [
      r.id,
      formatThaiDateTime(r.occurredAt, { shortMonth: true }),
      DAILY_LOG_CATEGORY_TABS[r.category],
      r.title,
      r.summary,
      r.province,
      r.district,
      r.subdistrict,
      r.lat ?? '',
      r.lng ?? '',
      r.sourceName,
      r.reliabilityCode,
      r.analystNote || '',
      r.reporter,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
    triggerCsvDownload(`wing56-daily-log-${getBangkokYmd()}.csv`, csv);
  };

  return (
    <section aria-labelledby="daily-log-heading" className="page-section">
      <div className="section-header-row">
        <div>
          <h2 id="daily-log-heading" className="section-title">
            {editingId
              ? `แก้ไขบันทึกประจำวัน (${editingId})`
              : 'บันทึกเหตุการณ์ประจำวันของแผนก (ซิงก์ชีทแยก 7 หมวดอัตโนมัติ)'}
          </h2>
          <p className="section-subtitle">
            คัดกรองข่าวรายวันหรือบันทึกเหตุการณ์จากแหล่งข่าวทางข้าง ระบบจะจัดส่งลงทั้งแท็บรวม{' '}
            <code>{masterSheetName}</code> และแท็บเฉพาะหมวด <code>{targetCategoryTab}</code> ให้อัตโนมัติ
          </p>
        </div>
        <div className="header-action-group">
          <button
            type="button"
            className="btn btn-outline"
            onClick={handlePull}
            disabled={pulling || !(settings.dailyLogGasUrl || '').trim()}
          >
            <CloudDownload size={16} aria-hidden="true" />
            <span>{pulling ? 'กำลังดึงจากชีทแผนก...' : 'ดึงข้อมูลจากชีทแผนก'}</span>
          </button>
        </div>
      </div>

      {!settings.dailyLogGasUrl?.trim() && (
        <div className="inline-alert warn" style={{ marginBottom: '1rem' }} role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            ยังไม่ได้ตั้งค่าลิงก์ชีทบันทึกประจำวันแผนกในหน้า &ldquo;ตั้งค่า &amp; เชื่อมระบบ&rdquo; — รายการที่บันทึกจะเก็บไว้ในเครื่องก่อน
          </span>
        </div>
      )}

      {!staffPin.trim() && Boolean(settings.dailyLogGasUrl?.trim()) && (
        <div className="inline-alert warn" style={{ marginBottom: '1rem' }} role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>ไม่พบ PIN เจ้าหน้าที่ในเซสชันนี้ — กรุณาล็อกและปลดล็อกโหมดเจ้าหน้าที่ใหม่เพื่อซิงก์ขึ้น Google Sheet</span>
        </div>
      )}

      {statusBanner && (
        <div
          className={`inline-alert ${statusBanner.ok ? 'info' : 'warn'}`}
          style={{ marginBottom: '1rem' }}
          role="status"
        >
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>{statusBanner.text}</span>
        </div>
      )}

      <div className="entry-grid" style={{ marginBottom: '1.25rem' }}>
        <form onSubmit={handleSubmit} className="gov-card form-card" noValidate>
          <div className="two-col-row">
            <div className="form-group">
              <label htmlFor="dlog-category" className="form-label required">
                1. หมวดข่าว / แท็บชีทปลายทาง
              </label>
              <select
                id="dlog-category"
                className="form-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as NewsCategoryId)}
              >
                {NEWS_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                แท็บชีทปลายทาง: <strong>{targetCategoryTab}</strong> + <strong>{masterSheetName}</strong>
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="dlog-occurred" className="form-label required">
                2. วัน-เวลาเหตุการณ์ / ข่าว
              </label>
              <input
                id="dlog-occurred"
                type="datetime-local"
                className="form-input"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                required
              />
              <p className="field-hint">
                พ.ศ.: <strong>{formatThaiDateTime(occurredAt, { shortMonth: false })}</strong>
              </p>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="dlog-title" className="form-label required">
              3. หัวข้อข่าว / เหตุการณ์ประจำวัน
            </label>
            <input
              id="dlog-title"
              type="text"
              className={`form-input ${submitAttempted && !title.trim() ? 'is-error' : ''}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="สรุปพาดหัวให้กระชับ ชัดเจน"
              aria-invalid={submitAttempted && !title.trim()}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="dlog-summary" className="form-label required">
              4. สรุปเนื้อหาข่าวกรอง (1 ย่อหน้า 4–5 บรรทัด)
            </label>
            <textarea
              id="dlog-summary"
              className={`form-textarea ${submitAttempted && !summary.trim() ? 'is-error' : ''}`}
              rows={5}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="ใคร ทำอะไร ที่ไหน เมื่อใด อย่างไร และผลกระทบต่อพื้นที่ บน.56..."
              aria-invalid={submitAttempted && !summary.trim()}
              required
            />
          </div>

          <div className="form-group">
            <div className="label-row">
              <span className="form-label">5. พื้นที่และพิกัด (สำหรับขึ้นแผนที่สรุปการประชุม บน.56)</span>
              {province && (
                <button
                  type="button"
                  className="btn-link-inline"
                  onClick={handleJumpAreaPin}
                >
                  <Crosshair size={14} aria-hidden="true" />
                  <span>ปักหมุดกึ่งกลางพื้นที่</span>
                </button>
              )}
            </div>
            <div className="area-select-grid" style={{ marginBottom: '0.6rem' }}>
              <div>
                <label htmlFor="dlog-prov" className="sub-label">
                  จังหวัด
                </label>
                <select
                  id="dlog-prov"
                  className="form-select"
                  value={province}
                  onChange={(e) => {
                    setProvince(e.target.value);
                    setDistrict('');
                    setSubdistrict('');
                  }}
                >
                  <option value="">-- โปรดเลือกจังหวัด --</option>
                  {provinces.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  <option value="ภาคใต้ตอนล่าง">ภาพรวมภาคใต้ตอนล่าง</option>
                </select>
              </div>
              <div>
                <label htmlFor="dlog-dist" className="sub-label">
                  อำเภอ
                </label>
                {districts.length > 0 ? (
                  <select
                    id="dlog-dist"
                    className="form-select"
                    value={district}
                    onChange={(e) => {
                      setDistrict(e.target.value);
                      setSubdistrict('');
                    }}
                  >
                    <option value="">-- โปรดเลือกอำเภอ --</option>
                    {districts.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="dlog-dist"
                    type="text"
                    className="form-input"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    placeholder="อำเภอ (ถ้ามี)"
                  />
                )}
              </div>
              <div>
                <label htmlFor="dlog-sub" className="sub-label">
                  ตำบล
                </label>
                {subdistricts.length > 0 ? (
                  <select
                    id="dlog-sub"
                    className="form-select"
                    value={subdistrict}
                    onChange={(e) => setSubdistrict(e.target.value)}
                  >
                    <option value="">-- โปรดเลือกตำบล --</option>
                    {subdistricts.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="dlog-sub"
                    type="text"
                    className="form-input"
                    value={subdistrict}
                    onChange={(e) => setSubdistrict(e.target.value)}
                    placeholder="ตำบล (ถ้ามี)"
                  />
                )}
              </div>
            </div>

            <input
              id="dlog-coord"
              type="text"
              className={`form-input ${coordError ? 'is-error' : lat !== null ? 'is-valid' : ''}`}
              value={coordRaw}
              onChange={(e) => handleCoordInput(e.target.value)}
              placeholder="วางพิกัด Lat/Lng, MGRS, UTM หรือคลิกบนแผนที่ด้านขวา (ถ้าไม่ระบุจะใช้กึ่งกลางจังหวัด/อำเภอ)"
              aria-invalid={Boolean(coordError)}
            />
            {coordError && <p className="field-error-text">{coordError}</p>}
          </div>

          <div className="two-col-row">
            <div className="form-group">
              <label htmlFor="dlog-origin" className="form-label">
                6. ที่มาและแหล่งข่าว
              </label>
              <select
                id="dlog-origin"
                className="form-select"
                value={entryOrigin}
                onChange={(e) => setEntryOrigin(e.target.value as DailyLogOrigin)}
                style={{ marginBottom: '0.45rem' }}
              >
                <option value="news">คัดกรองจากศูนย์ข่าวกรองรายวัน</option>
                <option value="manual">บันทึกเอง (แหล่งข่าวทางข้าง / หน่วยข่าว)</option>
              </select>
              <input
                id="dlog-source"
                type="text"
                className="form-input"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="ชื่อแหล่งข่าว เช่น กอ.รมน.ภาค 4 สน. หรือ แหล่งข่าวทางข้าง"
              />
            </div>

            <div className="form-group">
              <label htmlFor="dlog-rel" className="form-label">
                ระดับความน่าเชื่อถือ &amp; ผู้บันทึก
              </label>
              <select
                id="dlog-rel"
                className="form-select"
                value={reliabilityCode}
                onChange={(e) => setReliabilityCode(e.target.value)}
                style={{ marginBottom: '0.45rem' }}
              >
                {RELIABILITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <input
                id="dlog-reporter"
                type="text"
                className={`form-input ${submitAttempted && !reporter.trim() ? 'is-error' : ''}`}
                value={reporter}
                onChange={(e) => setReporter(e.target.value)}
                placeholder="ยศ-ชื่อ / ตำแหน่งผู้บันทึก"
                aria-invalid={submitAttempted && !reporter.trim()}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="dlog-note" className="form-label">
              7. ความเห็น / ข้อสังเกต ผขว.บก.บน.56 (ถ้ามี)
            </label>
            <input
              id="dlog-note"
              type="text"
              className="form-input"
              value={analystNote}
              onChange={(e) => setAnalystNote(e.target.value)}
              placeholder="ผลกระทบต่อ บน.56 หรือแนวทางการเฝ้าระวังต่อเนื่อง..."
            />
          </div>

          {formError && (
            <div className="inline-alert danger" role="alert" style={{ marginBottom: '0.8rem' }}>
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Send size={16} aria-hidden="true" />
              <span>
                {saving
                  ? 'กำลังบันทึกและซิงก์...'
                  : editingId
                    ? `อัปเดตลงแท็บ "${targetCategoryTab}"`
                    : `บันทึกลงแท็บ "${targetCategoryTab}" + แท็บรวม`}
              </span>
            </button>
            <button type="button" className="btn btn-outline" onClick={resetForm}>
              <RotateCcw size={16} aria-hidden="true" />
              <span>{editingId ? 'ยกเลิกการแก้ไข' : 'ล้างฟอร์ม'}</span>
            </button>
          </div>
        </form>

        <div className="entry-side-col">
          <div className="gov-card">
            <div className="card-header-row">
              <div>
                <h3 className="card-title">แผนที่เลือกตำแหน่งปักหมุด (คลิก/ลากหมุดได้)</h3>
                <p className="card-subtitle">
                  จุดนี้จะไปปรากฏบนแผนที่สรุปสถานการณ์รวมของ บน.56 ด้วยหมุดสี่เหลี่ยมขอบทอง
                </p>
              </div>
            </div>
            <LeafletMap
              mode="picker"
              lat={lat}
              lng={lng}
              onPickCoordinate={handlePickMap}
              showBoundaries
              offlinePmtilesUrl={settings.offlinePmtilesUrl}
              height="430px"
            />
          </div>
        </div>
      </div>

      {/* Saved Daily Logs Table */}
      <div className="gov-card">
        <div className="card-header-row">
          <div>
            <h3 className="card-title">
              <NotebookPen size={17} aria-hidden="true" style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              คลังบันทึกเหตุการณ์ประจำวันของแผนก ({filteredLogs.length} รายการ)
            </h3>
          </div>
          <div className="header-action-group">
            <input
              type="text"
              className="form-input"
              style={{ width: 230, padding: '0.35rem 0.6rem' }}
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              placeholder="ค้นหาในบันทึกแผนก..."
              aria-label="ค้นหาในบันทึกประจำวันของแผนก"
            />
            <button type="button" className="btn btn-sm btn-outline" onClick={handleExportCsv}>
              <Download size={14} aria-hidden="true" />
              <span>ส่งออก CSV</span>
            </button>
          </div>
        </div>

        <div className="news-cat-pills" style={{ marginBottom: '0.9rem' }}>
          <button
            type="button"
            className={`news-cat-pill ${listCatFilter === 'all' ? 'active' : ''}`}
            onClick={() => setListCatFilter('all')}
          >
            ทั้งหมด <span className="news-pill-count">{dailyLogs.length}</span>
          </button>
          {NEWS_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`news-cat-pill ${listCatFilter === cat.id ? 'active' : ''}`}
              onClick={() => setListCatFilter(cat.id)}
            >
              {cat.shortLabel}{' '}
              <span className="news-pill-count">{countsByCategory[cat.id]}</span>
            </button>
          ))}
        </div>

        {filteredLogs.length === 0 ? (
          <p className="empty-table-note">
            ยังไม่มีรายการบันทึกประจำวันในหมวดนี้ — สามารถกดปุ่ม &ldquo;สรุปเข้าชีทประจำวัน&rdquo; จากหน้าข่าวรายวัน หรือกรอกบันทึกใหม่ด้านบน
          </p>
        ) : (
          <div className="unified-list">
            {filteredLogs.map((rec) => {
              const meta = NEWS_CATEGORY_MAP[rec.category];
              const area = [
                rec.subdistrict ? `ต.${rec.subdistrict}` : '',
                rec.district ? `อ.${rec.district}` : '',
                rec.province ? `จ.${rec.province}` : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div key={rec.id} className="unified-list-row">
                  <div className="unified-list-main">
                    <div className="unified-list-badges">
                      <span
                        className="news-cat-badge"
                        style={{ color: meta?.color, backgroundColor: meta?.bgColor }}
                      >
                        {DAILY_LOG_CATEGORY_TABS[rec.category]}
                      </span>
                      <span className="news-prov-chip">{area || 'ภาคใต้ตอนล่าง'}</span>
                      <span className="news-reliability-code">รหัส {rec.reliabilityCode}</span>
                      <span
                        className={`badge ${
                          rec.syncStatus === 'synced'
                            ? 'badge-success'
                            : rec.syncStatus === 'failed'
                              ? 'badge-danger'
                              : 'badge-warn'
                        }`}
                      >
                        {rec.syncStatus === 'synced'
                          ? 'ซิงก์ชีทแผนกแล้ว'
                          : rec.syncStatus === 'failed'
                            ? 'ซิงก์ไม่สำเร็จ'
                            : 'รอซิงก์'}
                      </span>
                      <span className="news-age-text">
                        {formatThaiDateTime(rec.occurredAt, { shortMonth: true })}
                      </span>
                    </div>
                    <p className="unified-list-title">{rec.title}</p>
                    <p className="unified-list-summary">{rec.summary}</p>
                    {rec.analystNote && (
                      <p className="field-hint" style={{ marginTop: '0.25rem' }}>
                        <strong>ความเห็น ผขว.:</strong> {rec.analystNote}
                      </p>
                    )}
                  </div>
                  <div className="unified-list-actions" style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {(() => {
                      const safeLink = sanitizeHttpUrl(rec.sourceLink);
                      return safeLink ? (
                        <a
                          href={safeLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-xs btn-outline"
                          aria-label={`เปิดลิงก์ต้นทาง ${rec.title}`}
                        >
                          <ExternalLink size={13} aria-hidden="true" />
                        </a>
                      ) : null;
                    })()}
                    {rec.syncStatus !== 'synced' && (
                      <button
                        type="button"
                        className="btn-xs btn-outline"
                        onClick={() => void onRetrySyncDailyLog(rec)}
                        title="ซิงก์เข้าชีทแผนกอีกครั้ง"
                      >
                        <RefreshCw size={13} aria-hidden="true" />
                        <span>ซิงก์</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-xs btn-outline"
                      onClick={() => handleEdit(rec)}
                      aria-label={`แก้ไข ${rec.id}`}
                    >
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn-xs btn-danger-outline"
                      onClick={() => {
                        if (window.confirm(`ยืนยันลบรายการ "${rec.title}" ?`)) {
                          void onDeleteDailyLog(rec);
                        }
                      }}
                      aria-label={`ลบ ${rec.id}`}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
