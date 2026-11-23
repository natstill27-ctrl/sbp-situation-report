import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCopy,
  CloudDownload,
  Code2,
  Plus,
  RotateCcw,
  Save,
  TestTube2,
  Trash2,
  XCircle,
} from 'lucide-react';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../data/defaults';
import type { AppSettings, GasFieldMapping } from '../types/incident';
import {
  generateGasReceiverCode,
  testGasConnection,
  type GasPullResult,
} from '../utils/gasSync';

interface SettingsPageProps {
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => Promise<void>;
  onPullFromGas?: (overrideSettings?: AppSettings) => Promise<GasPullResult>;
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

export function SettingsPage({ settings, onSaveSettings, onPullFromGas }: SettingsPageProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [newCategory, setNewCategory] = useState('');
  const [saveBanner, setSaveBanner] = useState('');
  const [testing, setTesting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const generatedCode = useMemo(() => generateGasReceiverCode(draft), [draft]);

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

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(generatedCode);
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <section aria-labelledby="settings-heading" className="page-section">
      <div className="section-header-row">
        <div>
          <h2 id="settings-heading" className="section-title">
            ตั้งค่าระบบและเชื่อมต่อ Google Apps Script เดิม
          </h2>
          <p className="section-subtitle">
            กำหนด Webhook URL, จับคู่ชื่อคอลัมน์ให้ตรงกับชีตเดิม, แก้ไขชื่อหน่วยงาน และคัดลอกโค้ดฝั่งรับข้อมูล (Code.gs)
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="settings-stack">
        {/* 1. GAS Webhook Configuration */}
        <div className="gov-card">
          <h3 className="card-title">1. เชื่อมต่อ Google Apps Script Webhook (ระบบเดิม)</h3>
          <p className="card-subtitle">
            ส่งข้อมูลแบบ JSON ผ่าน <code>Content-Type: text/plain</code> เพื่อหลีกเลี่ยงปัญหา CORS ของ Google Apps Script
          </p>

          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label htmlFor="gas-webhook-url" className="form-label">
              Google Apps Script Web App URL (/exec)
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

        {/* 2. Agency & Branding */}
        <div className="gov-card">
          <h3 className="card-title">2. ข้อมูลหน่วยงานและส่วนหัวเว็บไซต์ภาครัฐ</h3>
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

        {/* 3. Incident Categories */}
        <div className="gov-card">
          <div className="card-header-row">
            <div>
              <h3 className="card-title">3. จัดการหมวดหมู่ประเภทเหตุการณ์</h3>
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

        {/* 4. Field Mapping */}
        <div className="gov-card">
          <div className="card-header-row">
            <div>
              <h3 className="card-title">4. จับคู่ชื่อฟิลด์ / คอลัมน์ที่จะส่งเข้า Google Sheets</h3>
              <p className="card-subtitle">
                สามารถแก้ชื่อคีย์ JSON ให้ตรงกับชื่อคอลัมน์หรือสคริปต์เดิมของคุณได้ทันที (เมื่อได้โครงสร้างจากระบบเดิมแล้ว)
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
        </div>

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

      {/* 5. Ready-to-Paste GAS Bridge Code */}
      <div className="gov-card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header-row">
          <div>
            <h3 className="card-title">
              <Code2 size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} aria-hidden="true" />
              โค้ด Google Apps Script ฝั่งเชื่อมต่อ (SbpBridge.gs) พร้อมใช้งาน
            </h3>
            <p className="card-subtitle">
              สร้างไฟล์สคริปต์ชื่อ <code>SbpBridge.gs</code> ในโปรเจกต์ GAS เดิม แล้วเพิ่ม 3 บรรทัด{' '}
              <code>if (page == &quot;json&quot;) return exportSbpJson(e);</code> ใน <code>doGet(e)</code> เดิม จากนั้น Deploy เป็นเวอร์ชันใหม่
            </p>
          </div>
          <button type="button" className="btn btn-outline" onClick={handleCopyCode}>
            <ClipboardCopy size={16} aria-hidden="true" />
            <span>{copiedCode ? 'คัดลอกโค้ดแล้ว!' : 'คัดลอกโค้ด SbpBridge.gs'}</span>
          </button>
        </div>
        <pre className="code-block">
          <code>{generatedCode}</code>
        </pre>
      </div>
    </section>
  );
}
