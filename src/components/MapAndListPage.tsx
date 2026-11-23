import { useMemo, useState } from 'react';
import {
  ClipboardCopy,
  CloudDownload,
  Database,
  Download,
  Edit3,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type { AppSettings, IncidentRecord, SyncStatus } from '../types/incident';
import { getCategoryColor } from '../utils/categoryColors';
import {
  exportIncidentsToCsv,
  formatIncidentForLine,
  formatIncidentForPaper,
} from '../utils/exportUtils';
import type { GasPullResult } from '../utils/gasSync';
import { getTargetProvinces } from '../utils/geoLookup';
import { formatThaiDateTime } from '../utils/thaiDate';
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
}: MapAndListPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [provinceFilter, setProvinceFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [syncFilter, setSyncFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [useMilSymbol, setUseMilSymbol] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullStatus, setPullStatus] = useState<{ ok: boolean; message: string } | null>(null);

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

  return (
    <section aria-labelledby="map-list-heading" className="page-section">
      <div className="section-header-row">
        <div>
          <h2 id="map-list-heading" className="section-title">
            แผนที่รวมและรายการเหตุการณ์ที่บันทึก
          </h2>
          <p className="section-subtitle">
            ดูตำแหน่งหมุดรวมทั้งหมด ตรวจสอบสถานะการส่งเข้าระบบเดิม (ส่งซ้ำได้) และส่งออกไฟล์ CSV / ข้อความรายงาน
          </p>
        </div>

        <div className="header-action-group">
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

      {/* Overview Map */}
      <div className="gov-card map-card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-header-row">
          <div>
            <h3 className="card-title">แผนที่รวมตำแหน่งเหตุการณ์ ({filtered.length} รายการ)</h3>
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

      {/* Incidents Table */}
      <div className="gov-card table-card">
        <div className="card-header-row">
          <h3 className="card-title">รายการเหตุการณ์ทั้งหมด ({filtered.length} รายการ)</h3>
        </div>

        {filtered.length === 0 ? (
          <p className="empty-table-note">ไม่พบรายการเหตุการณ์ตามเงื่อนไขที่เลือก</p>
        ) : (
          <div className="table-scroll">
            <table className="gov-table">
              <thead>
                <tr>
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

                  return (
                    <tr
                      key={item.id}
                      className={isSelected ? 'selected-row' : ''}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <td className="nowrap">
                        <div className="cell-primary">{formatThaiDateTime(item.occurredAt)}</div>
                        <div className="cell-sub">{item.id}</div>
                        {item.sourceSheet === 'legacy' && (
                          <span className="badge badge-info" style={{ marginTop: 3 }}>
                            ชีต1 เดิม
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className="cat-pill"
                          style={{
                            borderColor: catColor,
                            color: catColor,
                          }}
                        >
                          {item.category}
                        </span>
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
                            title="แก้ไขรายการนี้"
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
