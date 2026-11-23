import { Fragment, useMemo, useState } from 'react';
import {
  Check,
  ClipboardCopy,
  CloudDownload,
  Database,
  Download,
  Edit3,
  Globe,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { AppSettings, IncidentRecord, SyncStatus } from '../types/incident';
import { getCategoryColor } from '../utils/categoryColors';
import {
  exportIncidentsToCsv,
  exportIncidentsToKml,
  formatIncidentForLine,
  formatIncidentForPaper,
} from '../utils/exportUtils';
import type { GasPullResult } from '../utils/gasSync';
import {
  getDistrictsByProvince,
  getSubdistrictsByDistrict,
  getTargetProvinces,
} from '../utils/geoLookup';
import { classifyCategoryFromText, formatThaiDateTime } from '../utils/thaiDate';
import { LeafletMap } from './LeafletMap';

interface MapAndListPageProps {
  incidents: IncidentRecord[];
  settings: AppSettings;
  onEditIncident: (record: IncidentRecord) => void;
  onDeleteIncident: (id: string) => Promise<void>;
  onRetrySyncOne: (record: IncidentRecord) => Promise<void>;
  onRetrySyncAll: () => Promise<void>;
  onLoadSamples: () => Promise<void>;
  onClearAll: () => Promise<void>;
  onPullFromGas?: () => Promise<GasPullResult>;
  onQuickUpdateIncident?: (record: IncidentRecord) => Promise<IncidentRecord>;
  onQuickUpdateBatch?: (records: IncidentRecord[]) => Promise<IncidentRecord[]>;
}

interface QuickDraftState {
  category: string;
  eventCount: number;
  province: string;
  district: string;
  subdistrict: string;
  details: string;
}

const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  synced: 'ส่งสำเร็จ',
  pending: 'รอส่ง',
  failed: 'ส่งไม่สำเร็จ',
};

export function MapAndListPage({
  incidents,
  settings,
  onEditIncident,
  onDeleteIncident,
  onRetrySyncOne,
  onRetrySyncAll,
  onLoadSamples,
  onClearAll,
  onPullFromGas,
  onQuickUpdateIncident,
  onQuickUpdateBatch,
}: MapAndListPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [provinceFilter, setProvinceFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [syncFilter, setSyncFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [useMilSymbol, setUseMilSymbol] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkCategory, setBulkCategory] = useState(settings.categories[0] || '');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState('');
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set());
  const [quickEditId, setQuickEditId] = useState<string | null>(null);
  const [quickDraft, setQuickDraft] = useState<QuickDraftState | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);

  const provinces = useMemo(() => getTargetProvinces(), []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return incidents.filter((item) => {
      if (provinceFilter && item.province !== provinceFilter) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (syncFilter && item.syncStatus !== syncFilter) return false;
      if (q) {
        const hay = [
          item.id,
          item.province,
          item.district,
          item.subdistrict,
          item.category,
          item.details,
          item.reporter,
          item.mgrs,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [incidents, searchQuery, provinceFilter, categoryFilter, syncFilter]);

  const unsyncedCount = useMemo(
    () => incidents.filter((i) => i.syncStatus !== 'synced').length,
    [incidents]
  );

  const totalFilteredEvents = useMemo(
    () =>
      filtered.reduce(
        (acc, item) => acc + (item.eventCount && item.eventCount > 0 ? item.eventCount : 1),
        0
      ),
    [filtered]
  );

  const handleCopy = async (record: IncidentRecord, mode: 'line' | 'paper') => {
    const text =
      mode === 'line' ? formatIncidentForLine(record) : formatIncidentForPaper(record, true);
    await navigator.clipboard.writeText(text);
    setCopiedId(`${record.id}-${mode}`);
    window.setTimeout(() => setCopiedId(null), 1800);
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    try {
      await onRetrySyncAll();
    } finally {
      setSyncingAll(false);
    }
  };

  const hasGasUrl = Boolean((settings.gasFetchUrl || settings.gasWebhookUrl).trim());

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

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));

  const toggleSelectAll = () => {
    setBulkNotice('');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach((item) => next.delete(item.id));
      } else {
        filtered.forEach((item) => next.add(item.id));
      }
      return next;
    });
  };

  const toggleSelectOne = (id: string) => {
    setBulkNotice('');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleInlineCategoryChange = async (item: IncidentRecord, nextCategory: string) => {
    if (!onQuickUpdateIncident || !nextCategory || nextCategory === item.category) return;
    setBulkNotice('');
    setUpdatingIds((prev) => new Set(prev).add(item.id));
    if (quickEditId === item.id && quickDraft) {
      setQuickDraft({ ...quickDraft, category: nextCategory });
    }
    try {
      await onQuickUpdateIncident({ ...item, category: nextCategory });
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleToggleQuickEdit = (item: IncidentRecord) => {
    if (quickEditId === item.id) {
      setQuickEditId(null);
      setQuickDraft(null);
      return;
    }
    setQuickEditId(item.id);
    setQuickDraft({
      category: item.category,
      eventCount: item.eventCount && item.eventCount > 0 ? item.eventCount : 1,
      province: item.province,
      district: item.district,
      subdistrict: item.subdistrict,
      details: item.details,
    });
  };

  const handleSaveQuickEdit = async (item: IncidentRecord) => {
    if (!onQuickUpdateIncident || !quickDraft) return;
    const trimmedDetails = quickDraft.details.trim();
    if (!trimmedDetails) return;

    const normalizedCount = quickDraft.eventCount > 0 ? Math.round(quickDraft.eventCount) : 1;
    const nextRecord: IncidentRecord = {
      ...item,
      category: quickDraft.category,
      province: quickDraft.province.trim(),
      district: quickDraft.district.trim(),
      subdistrict: quickDraft.subdistrict.trim(),
      details: trimmedDetails,
      inTargetArea: item.inTargetArea || Boolean(quickDraft.province.trim()),
      ...(normalizedCount > 1 ? { eventCount: normalizedCount } : { eventCount: undefined }),
    };

    setQuickSaving(true);
    setUpdatingIds((prev) => new Set(prev).add(item.id));
    try {
      const saved = await onQuickUpdateIncident(nextRecord);
      setQuickEditId(null);
      setQuickDraft(null);
      setBulkNotice(
        saved.syncStatus === 'synced'
          ? `อัปเดต ${item.id} และซิงก์เข้าระบบเดิมเรียบร้อย`
          : `บันทึกรายการ ${item.id} ลงเครื่องเรียบร้อย (${saved.syncError || 'รอซิงก์'})`
      );
    } finally {
      setQuickSaving(false);
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const runBatchUpdate = async (toUpdate: IncidentRecord[], verbLabel: string) => {
    if (toUpdate.length === 0) return;
    setBulkBusy(true);
    setBulkNotice('');
    try {
      let updated: IncidentRecord[];
      if (onQuickUpdateBatch) {
        updated = await onQuickUpdateBatch(toUpdate);
      } else if (onQuickUpdateIncident) {
        updated = [];
        for (const rec of toUpdate) {
          updated.push(await onQuickUpdateIncident(rec));
        }
      } else {
        return;
      }
      const syncedCount = updated.filter((r) => r.syncStatus === 'synced').length;
      const syncText =
        settings.autoSyncOnSave && settings.gasWebhookUrl.trim()
          ? ` (ซิงก์สำเร็จ ${syncedCount}/${updated.length} รายการ)`
          : ' (บันทึกลงเครื่องเรียบร้อย)';
      setBulkNotice(`${verbLabel} ${updated.length} รายการ${syncText}`);
      setSelectedIds(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  const handleApplyBulkCategory = async () => {
    const targetCat = bulkCategory || settings.categories[0] || '';
    if (!targetCat) return;
    const toUpdate = incidents
      .filter((item) => selectedIds.has(item.id) && item.category !== targetCat)
      .map((item) => ({ ...item, category: targetCat }));
    if (toUpdate.length === 0) {
      setBulkNotice('รายการที่เลือกทั้งหมดใช้ประเภทนี้อยู่แล้ว');
      return;
    }
    await runBatchUpdate(toUpdate, `เปลี่ยนประเภทเป็น "${targetCat}" จำนวน`);
  };

  const handleAutoReclassifySelected = async () => {
    const selectedList = incidents.filter((item) => selectedIds.has(item.id));
    const changed: IncidentRecord[] = [];
    for (const item of selectedList) {
      const detected = classifyCategoryFromText(item.details, settings.categories);
      if (detected && detected !== item.category) {
        changed.push({ ...item, category: detected });
      }
    }
    if (changed.length === 0) {
      setBulkNotice('จัดประเภทอัตโนมัติ: ไม่พบรายการที่ประเภทเปลี่ยนไปจากข้อความ');
      return;
    }
    await runBatchUpdate(
      changed,
      `จัดประเภทใหม่อัตโนมัติจากข้อความ (${changed.length}/${selectedList.length} รายการ) จำนวน`
    );
  };

  return (
    <section aria-labelledby="map-list-heading" className="page-section">
      <div className="section-header-row">
        <div>
          <h2 id="map-list-heading" className="section-title">
            คลังรายการเหตุการณ์และจัดการข้อมูล
          </h2>
          <p className="section-subtitle">
            ค้นหา แก้ไข ลบ ตรวจสอบสถานะการซิงก์ระบบเดิม คัดลอกรายงาน LINE/Paper และส่งออก CSV / KML (ดูแผนที่รวมหลักได้ที่หน้าแดชบอร์ด &amp; แผนที่ IPB หรือกดเปิดแผนที่ตรวจสอบ)
          </p>
        </div>

        <div className="header-action-group">
          <button
            type="button"
            className={`btn ${showMap ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setShowMap((v) => !v)}
          >
            <MapPin size={16} aria-hidden="true" />
            <span>{showMap ? 'ซ่อนแผนที่ตรวจสอบ' : 'เปิดแผนที่ตรวจสอบ'}</span>
          </button>
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
          {unsyncedCount > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSyncAll}
              disabled={syncingAll || !settings.gasWebhookUrl}
              title={
                settings.gasWebhookUrl
                  ? 'ส่งรายการที่ยังค้างอยู่เข้าระบบ Google Apps Script ทั้งหมด'
                  : 'กรุณาตั้งค่า Webhook URL ในหน้าตั้งค่าก่อน'
              }
            >
              <RefreshCw size={16} className={syncingAll ? 'spin' : ''} aria-hidden="true" />
              <span>ส่งซ้ำทั้งหมด ({unsyncedCount})</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => exportIncidentsToCsv(filtered)}
            disabled={filtered.length === 0}
          >
            <Download size={16} aria-hidden="true" />
            <span>Export CSV ({filtered.length})</span>
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => exportIncidentsToKml(filtered)}
            disabled={!filtered.some((r) => r.lat !== null && r.lng !== null)}
            title="ส่งออกจุดพิกัดเป็นไฟล์ .kml สำหรับเปิดใน Google Earth Pro"
          >
            <Globe size={16} aria-hidden="true" />
            <span>Export KML</span>
          </button>
          <button type="button" className="btn btn-outline" onClick={onLoadSamples}>
            <Database size={16} aria-hidden="true" />
            <span>เพิ่มข้อมูลตัวอย่าง</span>
          </button>
          {incidents.length > 0 && (
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={() => {
                if (window.confirm('ต้องการล้างข้อมูลเหตุการณ์ทั้งหมดในเครื่องใช่หรือไม่?')) {
                  void onClearAll();
                }
              }}
            >
              <Trash2 size={16} aria-hidden="true" />
              <span>ล้างข้อมูลทั้งหมด</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      {pullStatus && (
        <div
          className={`inline-alert ${pullStatus.ok ? 'info' : 'danger'}`}
          style={{ marginBottom: '1rem' }}
          role="status"
        >
          <span>{pullStatus.message}</span>
        </div>
      )}
      <div className="gov-card filter-card">
        <div className="list-filter-grid">
          <div className="search-box-wrap">
            <label htmlFor="list-search" className="sub-label">
              ค้นหารายละเอียด / ตำบล / ผู้บันทึก / MGRS
            </label>
            <div className="input-with-icon">
              <Search size={16} aria-hidden="true" />
              <input
                id="list-search"
                type="text"
                className="form-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="เช่น แม่หวาด, ธารโต, ปะทะ, ชื่อผู้บันทึก..."
              />
            </div>
          </div>

          <div>
            <label htmlFor="list-prov" className="sub-label">
              จังหวัด
            </label>
            <select
              id="list-prov"
              className="form-select"
              value={provinceFilter}
              onChange={(e) => setProvinceFilter(e.target.value)}
            >
              <option value="">ทุกจังหวัด</option>
              {provinces.map((p) => (
                <option key={p} value={p}>
                  {p === 'สงขลา' ? 'สงขลา (4 อำเภอ)' : p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="list-cat" className="sub-label">
              ประเภทเหตุการณ์
            </label>
            <select
              id="list-cat"
              className="form-select"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">ทุกประเภท</option>
              {settings.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="list-sync" className="sub-label">
              สถานะซิงก์ระบบเดิม
            </label>
            <select
              id="list-sync"
              className="form-select"
              value={syncFilter}
              onChange={(e) => setSyncFilter(e.target.value)}
            >
              <option value="">ทุกสถานะ</option>
              <option value="synced">ส่งสำเร็จ</option>
              <option value="pending">รอส่ง</option>
              <option value="failed">ส่งไม่สำเร็จ</option>
            </select>
          </div>
        </div>
      </div>

      {/* Collapsible Overview Map (Collapsed by default to avoid duplicating Dashboard map) */}
      {showMap && (
        <div className="gov-card map-card" style={{ marginBottom: '1.25rem' }}>
          <div className="card-header-row">
            <div>
              <h3 className="card-title">
                แผนที่ตรวจสอบตำแหน่งเหตุการณ์ ({filtered.length} รายการ
                {totalFilteredEvents > filtered.length ? ` • รวม ${totalFilteredEvents} เหตุการณ์` : ''})
              </h3>
              <p className="card-subtitle">คลิกหมุดบนแผนที่เพื่อดูรายละเอียด หรือคลิกแถวในตารางเพื่อโฟกัสตำแหน่ง</p>
            </div>
            <div className="checkbox-row" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={showBoundaries}
                  onChange={(e) => setShowBoundaries(e.target.checked)}
                />
                <span>แสดงเส้นเขตตำบล</span>
              </label>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={useMilSymbol}
                  onChange={(e) => setUseMilSymbol(e.target.checked)}
                />
                <span>สัญลักษณ์ทางทหาร (MIL-STD-2525)</span>
              </label>
            </div>
          </div>
          <LeafletMap
            mode="overview"
            incidents={filtered}
            categories={settings.categories}
            selectedId={selectedId}
            onSelectIncident={(id) => setSelectedId(id)}
            showBoundaries={showBoundaries}
            markerStyle={useMilSymbol ? 'milsymbol' : 'pin'}
            offlinePmtilesUrl={settings.offlinePmtilesUrl}
            height="390px"
          />
        </div>
      )}

      {/* Incidents Table */}
      <div className="gov-card table-card">
        <div className="card-header-row">
          <h3 className="card-title">
            รายการเหตุการณ์ทั้งหมด ({filtered.length} รายการ
            {totalFilteredEvents > filtered.length ? ` • รวม ${totalFilteredEvents} เหตุการณ์` : ''})
          </h3>
          {onQuickUpdateIncident && (
            <span className="cell-sub">
              เปลี่ยนประเภทเหตุได้ทันทีจากช่องเลือกในตาราง หรือเลือกหลายแถวเพื่อจัดประเภทพร้อมกัน
            </span>
          )}
        </div>

        {bulkNotice && (
          <div className="inline-alert info" style={{ marginBottom: '0.75rem' }} role="status">
            <span>{bulkNotice}</span>
          </div>
        )}

        {selectedIds.size > 0 && (onQuickUpdateBatch || onQuickUpdateIncident) && (
          <div className="bulk-action-bar" role="region" aria-label="เครื่องมือจัดการหลายรายการพร้อมกัน">
            <strong>เลือกอยู่ {selectedIds.size} รายการ</strong>
            <select
              aria-label="เลือกประเภทใหม่สำหรับรายการที่เลือก"
              className="form-select bulk-cat-select"
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
              disabled={bulkBusy}
            >
              {settings.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void handleApplyBulkCategory()}
              disabled={bulkBusy}
            >
              <Check size={14} aria-hidden="true" />
              <span>{bulkBusy ? 'กำลังอัปเดต...' : `เปลี่ยนประเภทที่เลือก (${selectedIds.size})`}</span>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => void handleAutoReclassifySelected()}
              disabled={bulkBusy}
              title="วิเคราะห์รายละเอียดข้อความใหม่ด้วยตัวคัดแยกอัตโนมัติ"
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>จัดประเภทใหม่อัตโนมัติจากข้อความ</span>
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkBusy}
            >
              <X size={14} aria-hidden="true" />
              <span>ยกเลิกการเลือก</span>
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <p className="empty-table-note">ไม่พบรายการเหตุการณ์ตามเงื่อนไขที่เลือก</p>
        ) : (
          <div className="table-scroll">
            <table className="gov-table">
              <thead>
                <tr>
                  <th style={{ width: 34, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      aria-label="เลือก/ยกเลิกทุกรายการที่แสดง"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>วัน-เวลา (พ.ศ.)</th>
                  <th>ประเภท / พื้นที่</th>
                  <th>พิกัด (Lat/Lng &amp; MGRS)</th>
                  <th>รายละเอียดเหตุการณ์</th>
                  <th>ผู้บันทึก</th>
                  <th>ซิงก์ระบบเดิม</th>
                  <th>เครื่องมือ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const catIdx = settings.categories.indexOf(item.category);
                  const catColor = getCategoryColor(item.category, catIdx >= 0 ? catIdx : 0);
                  const area = [
                    item.subdistrict && `ต.${item.subdistrict}`,
                    item.district && `อ.${item.district}`,
                    item.province && `จว.${item.province}`,
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const isSelected = selectedId === item.id;
                  const isUpdating = updatingIds.has(item.id);
                  const isQuickEditing = quickEditId === item.id && quickDraft !== null;
                  const catOptions = settings.categories.includes(item.category)
                    ? settings.categories
                    : [item.category, ...settings.categories];

                  return (
                    <Fragment key={item.id}>
                      <tr
                        className={isSelected ? 'selected-row' : ''}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <td
                          style={{ textAlign: 'center', verticalAlign: 'top' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`เลือกรายการ ${item.id}`}
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleSelectOne(item.id)}
                          />
                        </td>
                        <td className="nowrap">
                          <div className="cell-primary">{formatThaiDateTime(item.occurredAt)}</div>
                          <div className="cell-sub">{item.id}</div>
                          {item.sourceSheet === 'legacy' && (
                            <span className="badge badge-info" style={{ marginTop: 3 }}>
                              ชีต1 เดิม
                            </span>
                          )}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {onQuickUpdateIncident ? (
                            <select
                              aria-label={`ประเภทเหตุการณ์ ${item.id}`}
                              className="inline-cat-select"
                              style={{ borderLeftColor: catColor, color: catColor }}
                              value={item.category}
                              disabled={isUpdating}
                              onChange={(e) =>
                                void handleInlineCategoryChange(item, e.target.value)
                              }
                            >
                              {catOptions.map((cat) => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className="cat-pill"
                              style={{
                                borderColor: catColor,
                                color: catColor,
                              }}
                            >
                              {item.category}
                            </span>
                          )}
                          {isUpdating && (
                            <div className="cell-sub" style={{ color: 'var(--info)' }}>
                              กำลังบันทึกและซิงก์...
                            </div>
                          )}
                          {item.eventCount && item.eventCount > 1 && (
                            <span className="badge badge-warn" style={{ marginLeft: 4 }}>
                              ×{item.eventCount} เหตุการณ์
                            </span>
                          )}
                          <div className="cell-area">{area || 'ไม่ระบุพื้นที่'}</div>
                          {!item.inTargetArea && (
                            <span className="badge badge-warn">นอกเขต 3 จว.+4 อ.</span>
                          )}
                        </td>
                        <td className="nowrap">
                          {item.lat !== null && item.lng !== null ? (
                            <>
                              <div className="cell-primary">
                                {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
                              </div>
                              <div className="cell-sub">{item.mgrs}</div>
                            </>
                          ) : (
                            <span className="cell-sub">{item.coordinateRaw || '-'}</span>
                          )}
                        </td>
                        <td className="details-cell">
                          <div className="details-clamp" title={item.details}>
                            {item.details}
                          </div>
                        </td>
                        <td>{item.reporter || '-'}</td>
                        <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                          <span
                            className={`badge ${
                              item.syncStatus === 'synced'
                                ? 'badge-success'
                                : item.syncStatus === 'failed'
                                  ? 'badge-danger'
                                  : 'badge-warn'
                            }`}
                          >
                            {SYNC_STATUS_LABEL[item.syncStatus]}
                          </span>
                          {item.syncError && (
                            <div className="cell-error" title={item.syncError}>
                              {item.syncError}
                            </div>
                          )}
                          {item.syncStatus !== 'synced' && (
                            <div style={{ marginTop: 4 }}>
                              <button
                                type="button"
                                className="btn-xs btn-outline"
                                onClick={() => void onRetrySyncOne(item)}
                                disabled={!settings.gasWebhookUrl}
                              >
                                <RefreshCw size={12} aria-hidden="true" /> ส่งซ้ำ
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="row-actions">
                            {onQuickUpdateIncident && (
                              <button
                                type="button"
                                className={`btn-xs ${isQuickEditing ? 'btn-primary' : 'btn-outline'}`}
                                onClick={() => handleToggleQuickEdit(item)}
                                title="แก้ประเภท พื้นที่ หรือรายละเอียดในแถวนี้ทันที"
                              >
                                <Edit3 size={12} aria-hidden="true" /> แก้ด่วน
                              </button>
                            )}
                            {item.lat !== null && item.lng !== null && (
                              <button
                                type="button"
                                className="btn-xs btn-outline"
                                onClick={() => {
                                  setSelectedId(item.id);
                                  setShowMap(true);
                                }}
                                title="เปิดแผนที่และโฟกัสพิกัดรายการนี้"
                              >
                                <MapPin size={12} aria-hidden="true" /> พิกัด
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn-xs btn-outline"
                              onClick={() => void handleCopy(item, 'line')}
                              title="คัดลอกรูปแบบส่ง LINE"
                            >
                              <ClipboardCopy size={12} aria-hidden="true" />{' '}
                              {copiedId === `${item.id}-line` ? 'คัดลอกแล้ว' : 'LINE'}
                            </button>
                            <button
                              type="button"
                              className="btn-xs btn-outline"
                              onClick={() => void handleCopy(item, 'paper')}
                              title="คัดลอกรูปแบบ Paper (เลขไทย)"
                            >
                              <ClipboardCopy size={12} aria-hidden="true" />{' '}
                              {copiedId === `${item.id}-paper` ? 'คัดลอกแล้ว' : 'Paper'}
                            </button>
                            <button
                              type="button"
                              className="btn-xs btn-outline"
                              onClick={() => onEditIncident(item)}
                              title="แก้ไขเต็มฟอร์มและปักหมุดแผนที่"
                            >
                              <Edit3 size={12} aria-hidden="true" /> แก้ไข
                            </button>
                            <button
                              type="button"
                              className="btn-xs btn-outline-danger"
                              onClick={() => {
                                if (window.confirm(`ต้องการลบรายการ ${item.id} ใช่หรือไม่?`)) {
                                  void onDeleteIncident(item.id);
                                }
                              }}
                              title="ลบรายการนี้"
                            >
                              <Trash2 size={12} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isQuickEditing && quickDraft && (
                        <tr className="quick-edit-row" onClick={(e) => e.stopPropagation()}>
                          <td colSpan={8}>
                            <div className="quick-edit-box">
                              <div className="quick-edit-grid">
                                <div>
                                  <label className="sub-label">ประเภทเหตุการณ์</label>
                                  <select
                                    className="form-select"
                                    value={quickDraft.category}
                                    onChange={(e) =>
                                      setQuickDraft({ ...quickDraft, category: e.target.value })
                                    }
                                  >
                                    {(settings.categories.includes(quickDraft.category)
                                      ? settings.categories
                                      : [quickDraft.category, ...settings.categories]
                                    ).map((c) => (
                                      <option key={c} value={c}>
                                        {c}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="sub-label">จำนวนเหตุการณ์</label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={99}
                                    className="form-input"
                                    value={quickDraft.eventCount}
                                    onChange={(e) =>
                                      setQuickDraft({
                                        ...quickDraft,
                                        eventCount: Math.max(1, Number(e.target.value) || 1),
                                      })
                                    }
                                  />
                                </div>
                                <div>
                                  <label className="sub-label">จังหวัด</label>
                                  <select
                                    className="form-select"
                                    value={
                                      provinces.includes(quickDraft.province)
                                        ? quickDraft.province
                                        : ''
                                    }
                                    onChange={(e) =>
                                      setQuickDraft({
                                        ...quickDraft,
                                        province: e.target.value,
                                        district: '',
                                        subdistrict: '',
                                      })
                                    }
                                  >
                                    <option value="">-- จังหวัด --</option>
                                    {provinces.map((p) => (
                                      <option key={p} value={p}>
                                        {p === 'สงขลา' ? 'สงขลา (4 อำเภอ)' : p}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="sub-label">อำเภอ</label>
                                  {getDistrictsByProvince(quickDraft.province).length > 0 ? (
                                    <select
                                      className="form-select"
                                      value={quickDraft.district}
                                      onChange={(e) =>
                                        setQuickDraft({
                                          ...quickDraft,
                                          district: e.target.value,
                                          subdistrict: '',
                                        })
                                      }
                                    >
                                      <option value="">-- อำเภอ --</option>
                                      {getDistrictsByProvince(quickDraft.province).map((d) => (
                                        <option key={d} value={d}>
                                          {d}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      type="text"
                                      className="form-input"
                                      value={quickDraft.district}
                                      onChange={(e) =>
                                        setQuickDraft({ ...quickDraft, district: e.target.value })
                                      }
                                    />
                                  )}
                                </div>
                                <div>
                                  <label className="sub-label">ตำบล</label>
                                  {getSubdistrictsByDistrict(quickDraft.province, quickDraft.district)
                                    .length > 0 ? (
                                    <select
                                      className="form-select"
                                      value={quickDraft.subdistrict}
                                      onChange={(e) =>
                                        setQuickDraft({
                                          ...quickDraft,
                                          subdistrict: e.target.value,
                                        })
                                      }
                                    >
                                      <option value="">-- ตำบล --</option>
                                      {getSubdistrictsByDistrict(
                                        quickDraft.province,
                                        quickDraft.district
                                      ).map((s) => (
                                        <option key={s} value={s}>
                                          {s}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input
                                      type="text"
                                      className="form-input"
                                      value={quickDraft.subdistrict}
                                      onChange={(e) =>
                                        setQuickDraft({
                                          ...quickDraft,
                                          subdistrict: e.target.value,
                                        })
                                      }
                                    />
                                  )}
                                </div>
                              </div>

                              <div style={{ marginTop: '0.55rem' }}>
                                <label className="sub-label">รายละเอียดเหตุการณ์</label>
                                <textarea
                                  className="form-textarea"
                                  rows={3}
                                  value={quickDraft.details}
                                  onChange={(e) =>
                                    setQuickDraft({ ...quickDraft, details: e.target.value })
                                  }
                                />
                              </div>

                              <div className="form-actions" style={{ marginTop: '0.6rem' }}>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  disabled={quickSaving || !quickDraft.details.trim()}
                                  onClick={() => void handleSaveQuickEdit(item)}
                                >
                                  <Check size={14} aria-hidden="true" />
                                  <span>
                                    {quickSaving
                                      ? 'กำลังบันทึกและซิงก์...'
                                      : 'บันทึกและซิงก์ทับแถวเดิม'}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  disabled={quickSaving}
                                  onClick={() => {
                                    setQuickEditId(null);
                                    setQuickDraft(null);
                                  }}
                                >
                                  ยกเลิก
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
