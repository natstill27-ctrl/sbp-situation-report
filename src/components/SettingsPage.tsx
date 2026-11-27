import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CloudDownload,
  Plus,
  RotateCcw,
  Save,
  Share2,
  TestTube2,
  Trash2,
  XCircle,
} from 'lucide-react';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../data/defaults';
import type { AppSettings, GasFieldMapping } from '../types/incident';
import { copyTextToClipboard } from '../utils/clipboard';
import { encodeConfigHash } from '../utils/configShare';
import { pullDailyLogsFromGas, testDailyLogGasConnection } from '../utils/dailyLogGasSync';
import { testGasConnection, type GasPullResult } from '../utils/gasSync';

interface SettingsPageProps {
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => Promise<void>;
  onPullFromGas?: (overrideSettings?: AppSettings) => Promise<GasPullResult>;
  onPullDailyLogs?: (overrideSettings?: AppSettings) => Promise<{ ok: boolean; message: string }>;
}

const FIELD_MAPPING_LABELS: Array<{ key: keyof GasFieldMapping; label: string }> = [
  { key: 'id', label: 'รหัสเหตุการณ์ (ID)' },
  { key: 'occurredAt', label: 'วัน-เวลาเกิดเหตุ (ISO)' },
  { key: 'occurredAtBE', label: 'วัน-เวลาเกิดเหตุ (พ.ศ.)' },
  { key: 'category', label: 'ประเภทเหตุการณ์' },
  { key: 'province', label: 'จังหวัด' },
  { key: 'district', label: 'อำเภอ' },
  { key: 'subdistrict', label: 'ตำบล' },
  { key: 'inTargetArea', label: 'สถานะพื้นที่รับผิดชอบ' },
  { key: 'lat', label: 'ละติจูด (Lat)' },
  { key: 'lng', label: 'ลองจิจูด (Lng)' },
  { key: 'mgrs', label: 'พิกัด MGRS' },
  { key: 'utm', label: 'พิกัด UTM' },
  { key: 'coordinateRaw', label: 'พิกัดที่กรอกต้นฉบับ' },
  { key: 'details', label: 'รายละเอียดเหตุการณ์' },
  { key: 'reporter', label: 'ผู้บันทึกเหตุการณ์' },
  { key: 'createdAt', label: 'เวลาที่บันทึกเข้าระบบ' },
];

export function SettingsPage({
  settings,
  onSaveSettings,
  onPullFromGas,
  onPullDailyLogs,
}: SettingsPageProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [newCategory, setNewCategory] = useState('');
  const [saveBanner, setSaveBanner] = useState('');
  const [testing, setTesting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingDaily, setTestingDaily] = useState(false);
  const [pullingDaily, setPullingDaily] = useState(false);
  const [dailyTestResult, setDailyTestResult] = useState<{ ok: boolean; message: string } | null>(
    null
  );
  const [copiedShareLink, setCopiedShareLink] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleTestDailyLog = async () => {
    setTestingDaily(true);
    setDailyTestResult(null);
    try {
      const res = await testDailyLogGasConnection(draft);
      setDailyTestResult({ ok: res.ok, message: res.message });
    } finally {
      setTestingDaily(false);
    }
  };

  const handlePullDaily = async () => {
    setPullingDaily(true);
    setDailyTestResult(null);
    try {
      const res = onPullDailyLogs
        ? await onPullDailyLogs(draft)
        : await pullDailyLogsFromGas(draft);
      setDailyTestResult({ ok: res.ok, message: res.message });
    } finally {
      setPullingDaily(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings(draft);
    setSaveBanner('บันทึกการตั้งค่าเรียบร้อยแล้ว');
    window.setTimeout(() => setSaveBanner(''), 2500);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testGasConnection(draft);
      setTestResult({ ok: res.ok, message: res.message });
    } finally {
      setTesting(false);
    }
  };

  const handlePull = async () => {
    if (!onPullFromGas) return;
    setPulling(true);
    setTestResult(null);
    try {
      const res = await onPullFromGas(draft);
      setTestResult({ ok: res.ok, message: res.message });
    } finally {
      setPulling(false);
    }
  };

  const handleAddCategory = () => {
    const clean = newCategory.trim();
    if (!clean || draft.categories.includes(clean)) return;
    setDraft((prev) => ({ ...prev, categories: [...prev.categories, clean] }));
    setNewCategory('');
  };

  const handleRemoveCategory = (cat: string) => {
    if (draft.categories.length <= 1) return;
    setDraft((prev) => ({
      ...prev,
      categories: prev.categories.filter((c) => c !== cat),
    }));
  };

  const handleCopyShareLink = async () => {
    const url = encodeConfigHash(draft);
    const ok = await copyTextToClipboard(url);
    if (ok) {
      setCopiedShareLink(true);
      window.setTimeout(() => setCopiedShareLink(false), 2500);
    }
  };

  return (
    <section aria-labelledby="settings-heading" className="page-section">
      <div className="section-header-row">
        <div>
          <h2 id="settings-heading" className="section-title">
            ตั้งค่าระบบและเชื่อมต่อฐานข้อมูลแผนก
          </h2>
          <p className="section-subtitle">
            เชื่อมต่อลิงก์ Google Sheet ของแผนก แก้ไขชื่อหน่วยงาน และจัดการหมวดหมู่เหตุการณ์
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="settings-stack">
        {/* 1. Department Daily Log Google Sheet (7 Categories + Master Tab) */}
        <div className="gov-card">
          <h3 className="card-title">
            1. เชื่อมต่อชีทบันทึกเหตุการณ์ประจำวันของแผนก (แยก 7 หมวดอัตโนมัติ)
          </h3>
          <p className="card-subtitle">
            ใช้ Google Sheet เฉพาะของแผนก ผขว.บก.บน.56 เพื่อเก็บบันทึกประจำวันและดึงขึ้นแสดงบนแผนที่สรุปสถานการณ์รวม
          </p>

          <div className="form-group" style={{ marginTop: '0.9rem' }}>
            <label htmlFor="daily-log-gas-url" className="form-label">
              ลิงก์เชื่อมต่อชีทบันทึกประจำวัน (Web App URL ลงท้าย /exec)
            </label>
            <div className="webhook-input-row">
              <input
                id="daily-log-gas-url"
                type="url"
                className="form-input"
                value={draft.dailyLogGasUrl || ''}
                onChange={(e) => setDraft({ ...draft, dailyLogGasUrl: e.target.value })}
                placeholder="https://script.google.com/macros/s/.../exec"
              />
              <button
                type="button"
                className="btn btn-outline"
                onClick={handleTestDailyLog}
                disabled={testingDaily || !(draft.dailyLogGasUrl || '').trim()}
              >
                <TestTube2 size={16} aria-hidden="true" />
                <span>{testingDaily ? 'กำลังทดสอบ...' : 'ทดสอบชีทแผนก'}</span>
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={handlePullDaily}
                disabled={pullingDaily || !(draft.dailyLogGasUrl || '').trim()}
              >
                <CloudDownload size={16} aria-hidden="true" />
                <span>{pullingDaily ? 'กำลังดึง...' : 'ดึงบันทึกแผนก'}</span>
              </button>
            </div>
          </div>

          <div className="form-group" style={{ maxWidth: 420 }}>
            <label htmlFor="daily-log-master-sheet" className="sub-label">
              ชื่อแท็บรวมทั้งหมด (อีก 7 แท็บแยกตามหมวดจะสร้างให้อัตโนมัติ)
            </label>
            <input
              id="daily-log-master-sheet"
              type="text"
              className="form-input"
              value={draft.dailyLogMasterSheetName ?? 'รวมข่าวกรองประจำวัน'}
              onChange={(e) => setDraft({ ...draft, dailyLogMasterSheetName: e.target.value })}
            />
          </div>

          {dailyTestResult && (
            <div
              className={`inline-alert ${dailyTestResult.ok ? 'info' : 'danger'}`}
              style={{ marginTop: '0.65rem' }}
              role="alert"
            >
              {dailyTestResult.ok ? (
                <CheckCircle2 size={16} aria-hidden="true" />
              ) : (
                <XCircle size={16} aria-hidden="true" />
              )}
              <span>{dailyTestResult.message}</span>
            </div>
          )}
        </div>

        {/* 2. IPB System Connection */}
        <div className="gov-card">
          <h3 className="card-title">2. เชื่อมต่อฐานข้อมูลเหตุการณ์ IPB (ระบบเดิม)</h3>
          <p className="card-subtitle">
            ใช้ส่งและดึงข้อมูลเหตุการณ์ IPB จาก Google Sheets ของหน่วยงานอย่างปลอดภัย
          </p>

          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label htmlFor="gas-webhook-url" className="form-label">
              ลิงก์เชื่อมต่อระบบฐานข้อมูล IPB (/exec)
            </label>
            <div className="webhook-input-row">
              <input
                id="gas-webhook-url"
                type="url"
                className="form-input"
                value={draft.gasWebhookUrl}
                onChange={(e) => setDraft({ ...draft, gasWebhookUrl: e.target.value })}
                placeholder="https://script.google.com/macros/s/.../exec"
              />
              <button
                type="button"
                className="btn btn-outline"
                onClick={handleTest}
                disabled={testing || !draft.gasWebhookUrl.trim()}
              >
                <TestTube2 size={16} aria-hidden="true" />
                <span>{testing ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}</span>
              </button>
              {onPullFromGas && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handlePull}
                  disabled={pulling || !(draft.gasFetchUrl || draft.gasWebhookUrl).trim()}
                >
                  <CloudDownload size={16} aria-hidden="true" />
                  <span>{pulling ? 'กำลังดึงข้อมูล...' : 'ดึงข้อมูลย้อนหลัง (?page=json)'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="gas-fetch-url" className="form-label">
              URL สำหรับดึงข้อมูลย้อนหลัง (ทางเลือก)
            </label>
            <input
              id="gas-fetch-url"
              type="url"
              className="form-input"
              value={draft.gasFetchUrl}
              onChange={(e) => setDraft({ ...draft, gasFetchUrl: e.target.value })}
              placeholder="ปล่อยว่างเพื่อใช้ Web App URL ด้านบนร่วมกัน (สำหรับ ?page=json)"
            />
          </div>

          <div className="coord-readout" style={{ marginTop: '0.75rem', marginBottom: '0.75rem' }}>
            <label className="checkbox-inline" style={{ fontWeight: 700, marginBottom: '0.5rem' }}>
              <input
                type="checkbox"
                checked={draft.legacyDualWrite}
                onChange={(e) => setDraft({ ...draft, legacyDualWrite: e.target.checked })}
              />
              <span>บันทึกคู่ขนาน (Dual-Write) ลงชีตเดิม (10 คอลัมน์) + แท็บ IPB แยก</span>
            </label>

            <div className="area-select-grid" style={{ marginTop: '0.5rem' }}>
              <div>
                <label htmlFor="ipb-sheet-name" className="sub-label">
                  ชื่อแท็บ IPB ใหม่
                </label>
                <input
                  id="ipb-sheet-name"
                  type="text"
                  className="form-input"
                  value={draft.ipbSheetName}
                  onChange={(e) => setDraft({ ...draft, ipbSheetName: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="watch-sheet-name" className="sub-label">
                  ชื่อแท็บพื้นที่เฝ้าระวัง (แยกแท็บ)
                </label>
                <input
                  id="watch-sheet-name"
                  type="text"
                  className="form-input"
                  value={draft.watchSheetName ?? 'พื้นที่เฝ้าระวัง_IPB'}
                  onChange={(e) => setDraft({ ...draft, watchSheetName: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="legacy-sheet-name" className="sub-label">
                  ชื่อชีตระบบเดิม (10 คอลัมน์)
                </label>
                <input
                  id="legacy-sheet-name"
                  type="text"
                  className="form-input"
                  value={draft.legacySheetName}
                  onChange={(e) => setDraft({ ...draft, legacySheetName: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="legacy-incident-type" className="sub-label">
                  ค่าคอลัมน์ B (ประเภทเหตุในชีตเดิม)
                </label>
                <input
                  id="legacy-incident-type"
                  type="text"
                  className="form-input"
                  value={draft.legacyIncidentType}
                  onChange={(e) => setDraft({ ...draft, legacyIncidentType: e.target.value })}
                />
              </div>
            </div>

            <label className="checkbox-inline" style={{ marginTop: '0.65rem' }}>
              <input
                type="checkbox"
                checked={draft.legacySendLine}
                onChange={(e) => setDraft({ ...draft, legacySendLine: e.target.checked })}
              />
              <span>สั่งเรียก sendLine() เดิมเพื่อแจ้งเตือนเข้า LINE อัตโนมัติเมื่อบันทึกจากระบบเดี่ยว</span>
            </label>
          </div>

          <label className="checkbox-inline" style={{ marginTop: '0.5rem' }}>
            <input
              type="checkbox"
              checked={draft.autoSyncOnSave}
              onChange={(e) => setDraft({ ...draft, autoSyncOnSave: e.target.checked })}
            />
            <span>ส่งข้อมูลไปยัง Google Apps Script อัตโนมัติทันทีที่กดบันทึกเหตุการณ์</span>
          </label>

          <label className="checkbox-inline" style={{ marginTop: '0.4rem', display: 'flex' }}>
            <input
              type="checkbox"
              checked={draft.autoPullOnLoad}
              onChange={(e) => setDraft({ ...draft, autoPullOnLoad: e.target.checked })}
            />
            <span>ดึงข้อมูลล่าสุดจาก GAS อัตโนมัติทุกครั้งที่เปิดหน้าเว็บ</span>
          </label>

          <div className="share-config-bar">
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={handleCopyShareLink}
              disabled={!draft.gasWebhookUrl.trim() && !(draft.dailyLogGasUrl || '').trim()}
            >
              <Share2 size={14} aria-hidden="true" />
              <span>
                {copiedShareLink
                  ? 'คัดลอกลิงก์ตั้งค่าด่วนแล้ว!'
                  : 'คัดลอกลิงก์ตั้งค่าด่วน (สำหรับเครื่องแผนก — ไม่รวม PIN)'}
              </span>
            </button>
            <span className="field-hint" style={{ margin: 0 }}>
              ค่าตั้งค่าจะแนบอยู่ในส่วน #config= ฝั่งเบราว์เซอร์เท่านั้น ไม่ถูกส่งเข้าเซิร์ฟเวอร์ GitHub
            </span>
          </div>

          {testResult && (
            <div
              className={`inline-alert ${testResult.ok ? 'info' : 'danger'}`}
              style={{ marginTop: '0.75rem' }}
              role="alert"
            >
              {testResult.ok ? (
                <CheckCircle2 size={16} aria-hidden="true" />
              ) : (
                <XCircle size={16} aria-hidden="true" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        {/* 3. Agency & Branding */}
        <div className="gov-card">
          <h3 className="card-title">3. ข้อมูลหน่วยงานและส่วนหัวเว็บไซต์</h3>
          <div className="two-col-row" style={{ marginTop: '0.75rem' }}>
            <div className="form-group">
              <label htmlFor="sys-title" className="form-label">
                ชื่อระบบ (Header Title)
              </label>
              <input
                id="sys-title"
                type="text"
                className="form-input"
                value={draft.systemTitle}
                onChange={(e) => setDraft({ ...draft, systemTitle: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="agency-name" className="form-label">
                ชื่อหน่วยงาน / ศูนย์ปฏิบัติการ
              </label>
              <input
                id="agency-name"
                type="text"
                className="form-input"
                value={draft.agencyName}
                onChange={(e) => setDraft({ ...draft, agencyName: e.target.value })}
              />
            </div>
          </div>

          <div className="two-col-row">
            <div className="form-group">
              <label htmlFor="agency-sub" className="form-label">
                คำอธิบายพื้นที่รับผิดชอบ (Subtitle)
              </label>
              <input
                id="agency-sub"
                type="text"
                className="form-input"
                value={draft.agencySubtitle}
                onChange={(e) => setDraft({ ...draft, agencySubtitle: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="default-reporter" className="form-label">
                ชื่อผู้บันทึกเริ่มต้น (กรอกอัตโนมัติในฟอร์ม)
              </label>
              <input
                id="default-reporter"
                type="text"
                className="form-input"
                value={draft.defaultReporter}
                onChange={(e) => setDraft({ ...draft, defaultReporter: e.target.value })}
                placeholder="เช่น ฝ่ายข่าว/ศปก."
              />
            </div>
          </div>

          <div className="form-group" style={{ marginTop: '0.5rem' }}>
            <label htmlFor="offline-pmtiles-url" className="form-label">
              ไฟล์แผนที่ออฟไลน์ PMTiles (ทางเลือก — ปล่อยว่างเพื่อใช้ OpenStreetMap)
            </label>
            <input
              id="offline-pmtiles-url"
              type="text"
              className="form-input"
              value={draft.offlinePmtilesUrl ?? ''}
              onChange={(e) => setDraft({ ...draft, offlinePmtilesUrl: e.target.value })}
              placeholder="/maps/south-thailand.pmtiles"
            />
            <p className="card-subtitle" style={{ marginTop: '0.35rem' }}>
              รองรับไฟล์แผนที่ภาพแบบออฟไลน์ (.pmtiles ที่สร้างด้วยเครื่องมือ pmtiles) สำหรับใช้งานในพื้นที่ไม่มีอินเทอร์เน็ต
            </p>
          </div>
        </div>

        {/* 4. Incident Categories */}
        <div className="gov-card">
          <div className="card-header-row">
            <div>
              <h3 className="card-title">4. จัดการหมวดหมู่ประเภทเหตุการณ์</h3>
              <p className="card-subtitle">ใช้ในตัวเลือกฟอร์มและตารางวิเคราะห์สถิติ IPB</p>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => setDraft({ ...draft, categories: [...DEFAULT_CATEGORIES] })}
            >
              <RotateCcw size={14} aria-hidden="true" />
              <span>คืนค่าหมวดหมู่มาตรฐาน</span>
            </button>
          </div>

          <div className="cat-chips-wrap">
            {draft.categories.map((cat) => (
              <span key={cat} className="cat-edit-chip">
                <span>{cat}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveCategory(cat)}
                  aria-label={`ลบหมวดหมู่ ${cat}`}
                  disabled={draft.categories.length <= 1}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>

          <div className="webhook-input-row" style={{ marginTop: '0.75rem', maxWidth: 460 }}>
            <input
              type="text"
              className="form-input"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="เพิ่มประเภทเหตุการณ์ใหม่..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCategory();
                }
              }}
            />
            <button type="button" className="btn btn-outline" onClick={handleAddCategory}>
              <Plus size={16} aria-hidden="true" />
              <span>เพิ่ม</span>
            </button>
          </div>
        </div>

        {/* 5. Advanced Field Mapping (Collapsed by default for everyday users) */}
        <details className="gov-card gov-advanced-details">
          <summary className="gov-advanced-summary">
            <span>5. ตั้งค่าขั้นสูง: จับคู่ชื่อคอลัมน์ใน Google Sheets (สำหรับผู้ดูแลระบบ)</span>
            <span className="field-hint" style={{ margin: 0 }}>
              คลิกเพื่อเปิด/ปิด
            </span>
          </summary>

          <div className="card-header-row" style={{ marginTop: '0.85rem' }}>
            <div>
              <p className="card-subtitle">
                สามารถแก้ชื่อคอลัมน์ให้ตรงกับชีตเดิมของหน่วยงานได้ทันที
              </p>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => setDraft({ ...draft, fieldMapping: { ...DEFAULT_SETTINGS.fieldMapping } })}
            >
              <RotateCcw size={14} aria-hidden="true" />
              <span>คืนค่าชื่อฟิลด์เริ่มต้น</span>
            </button>
          </div>

          <div className="mapping-grid">
            {FIELD_MAPPING_LABELS.map(({ key, label }) => (
              <div key={key} className="mapping-row">
                <label htmlFor={`map-${key}`} className="sub-label">
                  {label}
                </label>
                <input
                  id={`map-${key}`}
                  type="text"
                  className="form-input"
                  value={draft.fieldMapping[key]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      fieldMapping: { ...draft.fieldMapping, [key]: e.target.value },
                    })
                  }
                />
              </div>
            ))}
          </div>
        </details>

        {saveBanner && (
          <div className="inline-alert info" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>{saveBanner}</span>
          </div>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            <Save size={17} aria-hidden="true" />
            <span>บันทึกการตั้งค่าทั้งหมด</span>
          </button>
        </div>
      </form>
    </section>
  );
}
