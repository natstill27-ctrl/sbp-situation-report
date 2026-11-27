import type { AppSettings } from '../types/incident';
import type { DailyLogOrigin, DailyLogRecord, NewsCategoryId } from '../types/news';
import { fetchWithTimeout } from './fetchTimeout';
import { formatThaiDateTime } from './thaiDateFormat';

export const DEFAULT_DAILY_LOG_MASTER_SHEET = 'รวมข่าวกรองประจำวัน';

export const DAILY_LOG_CATEGORY_TABS: Record<NewsCategoryId, string> = {
  politics: 'การเมือง',
  economy: 'เศรษฐกิจ',
  social: 'สังคมและประชาคม',
  narcotics: 'ยาเสพติด',
  security: 'ความมั่นคงและเหตุรุนแรง',
  weather: 'อากาศและภัยพิบัติ',
  migrant: 'แรงงานต่างด้าว',
};

const VALID_CATEGORIES = new Set<NewsCategoryId>([
  'politics',
  'economy',
  'social',
  'narcotics',
  'security',
  'weather',
  'migrant',
]);

function normalizeCategoryId(raw: unknown): NewsCategoryId {
  const s = String(raw ?? '').trim() as NewsCategoryId;
  if (VALID_CATEGORIES.has(s)) return s;
  for (const [key, label] of Object.entries(DAILY_LOG_CATEGORY_TABS)) {
    if (s === label) return key as NewsCategoryId;
  }
  return 'security';
}

function normalizeOrigin(raw: unknown): DailyLogOrigin {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'news' || s.includes('ข่าวรายวัน')) return 'news';
  return 'manual';
}

function toFiniteNumberOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Verify Staff PIN live against Google Apps Script ScriptProperties (STAFF_PIN). */
export async function verifyStaffPinWithGas(
  gasUrl: string,
  pin: string
): Promise<{ ok: boolean; message: string }> {
  const url = gasUrl.trim();
  if (!url) {
    return { ok: false, message: 'ยังไม่ได้ตั้งค่า Web App URL ของชีทบันทึกประจำวันแผนก' };
  }
  if (!pin.trim()) {
    return { ok: false, message: 'กรุณากรอกรหัสผ่านเจ้าหน้าที่ ผขว.' };
  }

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'verify_staff_pin',
        pin: pin.trim(),
      }),
    });

    if (!res.ok) {
      return { ok: false, message: `ระบบฐานข้อมูลตอบกลับ HTTP ${res.status}` };
    }
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { ok?: boolean; status?: string; message?: string };
      const ok = Boolean(json.ok) || json.status === 'ok';
      return {
        ok,
        message:
          json.message ||
          (ok ? 'ยืนยันตัวตนเจ้าหน้าที่สำเร็จ' : 'รหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง'),
      };
    } catch {
      return {
        ok: false,
        message: 'รูปแบบผลลัพธ์จากระบบชีทแผนกไม่ถูกต้อง กรุณาตรวจสอบการเชื่อมต่อและสิทธิ์การเข้าถึง',
      };
    }
  } catch (err) {
    return {
      ok: false,
      message: `ไม่สามารถติดต่อ GAS เพื่อตรวจสอบสิทธิ์: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

export async function testDailyLogGasConnection(
  settings: AppSettings
): Promise<{ ok: boolean; message: string }> {
  const url = (settings.dailyLogGasUrl || '').trim();
  if (!url) {
    return { ok: false, message: 'กรุณากรอก Web App URL (/exec) ของชีทบันทึกประจำวันแผนกก่อนครับ' };
  }
  try {
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetchWithTimeout(`${url}${sep}action=ping`, { method: 'GET' });
    if (!res.ok) {
      return { ok: false, message: `GAS ตอบกลับสถานะ HTTP ${res.status}` };
    }
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { ok?: boolean; message?: string };
      if (json.ok) {
        return {
          ok: true,
          message: json.message || 'เชื่อมต่อชีทบันทึกเหตุการณ์ประจำวันแผนก (แยก 7 หมวด) สำเร็จ',
        };
      }
      return { ok: false, message: json.message || 'GAS ตอบกลับไม่สำเร็จ' };
    } catch {
      return { ok: false, message: 'GAS ไม่ได้ตอบกลับเป็น JSON กรุณาตรวจสอบสิทธิ์ Web App (Anyone)' };
    }
  } catch (err) {
    return {
      ok: false,
      message: `เชื่อมต่อไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function sendDailyLogToGas(
  record: DailyLogRecord,
  settings: AppSettings,
  staffPin: string
): Promise<{ ok: boolean; message: string; categorySheet?: string }> {
  const url = (settings.dailyLogGasUrl || '').trim();
  if (!url) {
    return {
      ok: false,
      message: 'ยังไม่ได้ตั้งค่า Web App URL ของชีทบันทึกประจำวันแผนก (บันทึกไว้ในเครื่องก่อน)',
    };
  }
  if (!staffPin.trim()) {
    return {
      ok: false,
      message: 'ไม่พบรหัสยืนยันเจ้าหน้าที่ กรุณาปลดล็อกโหมดเจ้าหน้าที่ด้วย PIN ก่อนซิงก์ขึ้นชีท',
    };
  }

  const masterSheetName =
    (settings.dailyLogMasterSheetName || '').trim() || DEFAULT_DAILY_LOG_MASTER_SHEET;
  const categorySheetName = DAILY_LOG_CATEGORY_TABS[record.category] || 'ความมั่นคงและเหตุรุนแรง';

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'save_daily_log',
        pin: staffPin.trim(),
        masterSheetName,
        categorySheetName,
        record: {
          ...record,
          occurredAtBE: formatThaiDateTime(record.occurredAt, { shortMonth: false }),
          categoryLabel: categorySheetName,
        },
      }),
    });

    if (!res.ok) {
      return { ok: false, message: `GAS ตอบกลับ HTTP ${res.status}` };
    }
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { ok?: boolean; status?: string; message?: string };
      const ok = Boolean(json.ok) || json.status === 'ok';
      return {
        ok,
        categorySheet: categorySheetName,
        message:
          json.message ||
          (ok
            ? `บันทึกลงแท็บ "${masterSheetName}" และ "${categorySheetName}" สำเร็จ`
            : 'ซิงก์ไม่สำเร็จ'),
      };
    } catch {
      return { ok: false, message: 'ผลลัพธ์จาก GAS ไม่ใช่ JSON ที่ถูกต้อง' };
    }
  } catch (err) {
    return {
      ok: false,
      message: `ส่งข้อมูลเข้า GAS ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function deleteDailyLogFromGas(
  id: string,
  category: NewsCategoryId,
  settings: AppSettings,
  staffPin: string
): Promise<{ ok: boolean; message: string }> {
  const url = (settings.dailyLogGasUrl || '').trim();
  if (!url) return { ok: true, message: 'ลบจากเครื่องแล้ว' };
  if (!staffPin.trim()) {
    return { ok: false, message: 'ต้องใช้ PIN เจ้าหน้าที่เพื่อลบรายการบน Google Sheet' };
  }

  const masterSheetName =
    (settings.dailyLogMasterSheetName || '').trim() || DEFAULT_DAILY_LOG_MASTER_SHEET;
  const categorySheetName = DAILY_LOG_CATEGORY_TABS[category] || 'ความมั่นคงและเหตุรุนแรง';

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'delete_daily_log',
        pin: staffPin.trim(),
        masterSheetName,
        categorySheetName,
        id,
      }),
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const json = (await res.json()) as { ok?: boolean; message?: string };
    return {
      ok: Boolean(json.ok),
      message: json.message || (json.ok ? 'ลบรายการจากชีทแผนกแล้ว' : 'ลบไม่สำเร็จ'),
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Parse JSON rows pulled from `Wing56DailyLog.gs`.
 * Preserves empty string `""` for missing `district` or `subdistrict` per OPSEC/granularity invariants.
 */
export function parsePulledDailyLogsResponse(raw: unknown): DailyLogRecord[] {
  const container =
    raw && typeof raw === 'object' && 'records' in raw
      ? (raw as { records: unknown }).records
      : raw;
  if (!Array.isArray(container)) return [];

  const out: DailyLogRecord[] = [];
  const nowIso = new Date().toISOString();

  for (let i = 0; i < container.length; i++) {
    const row = container[i];
    if (!row || typeof row !== 'object') continue;
    const obj = row as Record<string, unknown>;
    const id = String(obj.id || '').trim();
    const title = String(obj.title || '').trim();
    if (!id || !title) continue;

    out.push({
      id,
      occurredAt: String(obj.occurredAt || obj.occurredAtIso || nowIso.slice(0, 16)),
      category: normalizeCategoryId(obj.category || obj.categoryLabel),
      title,
      summary: String(obj.summary || title).trim(),
      province: String(obj.province || '').trim(),
      district: String(obj.district || '').trim(),
      subdistrict: String(obj.subdistrict || '').trim(),
      lat: toFiniteNumberOrNull(obj.lat),
      lng: toFiniteNumberOrNull(obj.lng),
      sourceName: String(obj.sourceName || 'บันทึกแผนก ผขว.').trim(),
      sourceLink: obj.sourceLink ? String(obj.sourceLink).trim() : undefined,
      reliabilityCode: String(obj.reliabilityCode || 'B2').trim(),
      entryOrigin: normalizeOrigin(obj.entryOrigin),
      analystNote: obj.analystNote ? String(obj.analystNote).trim() : undefined,
      reporter: String(obj.reporter || '-').trim(),
      createdAt: String(obj.createdAt || nowIso),
      updatedAt: String(obj.updatedAt || nowIso),
      syncStatus: 'synced',
      newsId: obj.newsId ? String(obj.newsId).trim() : undefined,
    });
  }

  return out.sort(
    (a, b) =>
      new Date(b.occurredAt || b.createdAt).getTime() -
      new Date(a.occurredAt || a.createdAt).getTime()
  );
}

export async function pullDailyLogsFromGas(
  settings: AppSettings
): Promise<{ ok: boolean; records: DailyLogRecord[]; message: string }> {
  const url = (settings.dailyLogGasUrl || '').trim();
  if (!url) {
    return { ok: false, records: [], message: 'ยังไม่ได้ตั้งค่า Web App URL ของชีทบันทึกประจำวันแผนก' };
  }
  try {
    const sep = url.includes('?') ? '&' : '?';
    const masterSheet = encodeURIComponent(
      (settings.dailyLogMasterSheetName || '').trim() || DEFAULT_DAILY_LOG_MASTER_SHEET
    );
    const res = await fetchWithTimeout(
      `${url}${sep}action=fetch_daily_logs&masterSheet=${masterSheet}`,
      {
        method: 'GET',
      }
    );
    if (!res.ok) {
      return { ok: false, records: [], message: `ระบบฐานข้อมูลตอบกลับ HTTP ${res.status}` };
    }
    const text = await res.text();
    const json = JSON.parse(text) as unknown;
    if (
      json &&
      typeof json === 'object' &&
      'ok' in json &&
      (json as { ok?: unknown }).ok === false
    ) {
      const errObj = json as { message?: unknown; error?: unknown };
      return {
        ok: false,
        records: [],
        message: String(errObj.message || errObj.error || 'ระบบชีทแผนกแจ้งข้อผิดพลาด'),
      };
    }
    const records = parsePulledDailyLogsResponse(json);
    return {
      ok: true,
      records,
      message: `ดึงบันทึกเหตุการณ์ประจำวันของแผนกได้ ${records.length} รายการ`,
    };
  } catch (err) {
    return {
      ok: false,
      records: [],
      message: `ดึงข้อมูลไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Generate the standalone Google Apps Script (`Wing56DailyLog.gs`) for the Department Daily Log
 * Google Sheet (1 master tab + 7 category tabs + GAS ScriptProperties PIN verification).
 */
export function generateDailyLogGasCode(settings: AppSettings): string {
  const masterSheet =
    (settings.dailyLogMasterSheetName || '').trim() || DEFAULT_DAILY_LOG_MASTER_SHEET;

  return `// ===== Wing56DailyLog.gs — ศูนย์บริการด้านการข่าวกรอง ผขว.บก.บน.56 =====
// วิธีติดตั้ง:
// 1. สร้าง Google Sheet ใหม่สำหรับ "บันทึกเหตุการณ์ประจำวัน ผขว.บก.บน.56"
// 2. ไปที่ Extensions -> Apps Script วางโค้ดนี้ทั้งหมดแล้วบันทึก
// 3. ไปที่ Project Settings (รูปเฟืองซ้ายล่าง) -> Script Properties -> Add script property
//    ตั้งชื่อ Property = STAFF_PIN และใส่รหัสผ่าน/PIN ของเจ้าหน้าที่แผนก (เช่น 561234)
// 4. กด Run ฟังก์ชัน setupWing56DailyLogSheets() 1 ครั้งเพื่อสร้างแท็บรวม + 7 หมวดอัตโนมัติ
// 5. Deploy -> New deployment -> Web app (Execute as: Me, Who has access: Anyone) แล้วนำลิงก์ /exec มาใส่ในหน้าตั้งค่า

const MASTER_SHEET_NAME = ${JSON.stringify(masterSheet)};
const CATEGORY_SHEETS = {
  politics: 'การเมือง',
  economy: 'เศรษฐกิจ',
  social: 'สังคมและประชาคม',
  narcotics: 'ยาเสพติด',
  security: 'ความมั่นคงและเหตุรุนแรง',
  weather: 'อากาศและภัยพิบัติ',
  migrant: 'แรงงานต่างด้าว'
};

const HEADERS = [
  'รหัสรายการ (ID)',
  'วัน-เวลา (ISO)',
  'วัน-เวลา (พ.ศ.)',
  'รหัสหมวด',
  'หมวดข่าวกรอง',
  'หัวข้อข่าว/เหตุการณ์',
  'สรุปข่าวกรอง (1 ย่อหน้า)',
  'จังหวัด',
  'อำเภอ',
  'ตำบล',
  'ละติจูด (Lat)',
  'ลองจิจูด (Lng)',
  'แหล่งข่าว',
  'ความน่าเชื่อถือ',
  'ที่มาของรายการ',
  'ความเห็น ผขว.',
  'ผู้บันทึก',
  'ลิงก์อ้างอิง',
  'เวลาสร้าง',
  'อัปเดตล่าสุด'
];

function jsonReply_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifyPin_(inputPin) {
  const expected = PropertiesService.getScriptProperties().getProperty('STAFF_PIN');
  if (!expected) {
    return { ok: false, message: 'ยังไม่ได้ตั้งค่า STAFF_PIN ใน Project Settings -> Script Properties ของ Google Apps Script' };
  }
  const actual = String(inputPin || '').trim();
  const target = String(expected).trim();
  if (!actual || actual.length !== target.length) {
    return { ok: false, message: 'รหัสผ่านเจ้าหน้าที่ไม่ถูกต้อง' };
  }
  let diff = 0;
  for (let i = 0; i < target.length; i++) {
    diff |= actual.charCodeAt(i) ^ target.charCodeAt(i);
  }
  return diff === 0
    ? { ok: true, message: 'ยืนยันสิทธิ์เจ้าหน้าที่ ผขว. สำเร็จ' }
    : { ok: false, message: 'รหัสผ่านเจ้าหน้าที่ไม่ถูกต้อง' };
}

function getOrCreateSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length)
      .setBackground('#0c192c')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
  }
  return sh;
}

function setupWing56DailyLogSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  getOrCreateSheet_(ss, MASTER_SHEET_NAME);
  const keys = Object.keys(CATEGORY_SHEETS);
  for (let i = 0; i < keys.length; i++) {
    getOrCreateSheet_(ss, CATEGORY_SHEETS[keys[i]]);
  }
  return 'สร้างแท็บรวมและ 7 หมวดข่าวครบเรียบร้อยแล้ว';
}

function buildRowFromRecord_(rec) {
  const catId = String(rec.category || 'security');
  const catLabel = CATEGORY_SHEETS[catId] || String(rec.categoryLabel || catId);
  return [
    String(rec.id || ''),
    String(rec.occurredAt || ''),
    String(rec.occurredAtBE || ''),
    catId,
    catLabel,
    String(rec.title || ''),
    String(rec.summary || ''),
    String(rec.province || ''),
    String(rec.district || ''),
    String(rec.subdistrict || ''),
    rec.lat !== null && rec.lat !== undefined && rec.lat !== '' ? Number(rec.lat) : '',
    rec.lng !== null && rec.lng !== undefined && rec.lng !== '' ? Number(rec.lng) : '',
    String(rec.sourceName || ''),
    String(rec.reliabilityCode || 'B2'),
    String(rec.entryOrigin || 'manual') === 'news' ? 'คัดกรองจากข่าวรายวัน' : 'บันทึกเอง (แผนก ผขว.)',
    String(rec.analystNote || ''),
    String(rec.reporter || ''),
    String(rec.sourceLink || ''),
    String(rec.createdAt || ''),
    String(rec.updatedAt || new Date().toISOString())
  ];
}

function upsertRowById_(sh, id, rowValues) {
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === id) {
        sh.getRange(i + 2, 1, 1, rowValues.length).setValues([rowValues]);
        return;
      }
    }
  }
  sh.appendRow(rowValues);
}

function deleteRowById_(sh, id) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return false;
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]).trim() === id) {
      sh.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const action = String(params.action || 'ping');

  if (action === 'ping') {
    const hasPin = Boolean(PropertiesService.getScriptProperties().getProperty('STAFF_PIN'));
    return jsonReply_({
      ok: true,
      message: hasPin
        ? 'เชื่อมต่อชีทบันทึกเหตุการณ์ประจำวัน ผขว.บก.บน.56 สำเร็จ (ตั้งค่า STAFF_PIN แล้ว)'
        : 'เชื่อมต่อได้แล้ว แต่ยังไม่ได้ตั้งค่า STAFF_PIN ใน Script Properties'
    });
  }

  if (action === 'fetch_daily_logs') {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = String(params.masterSheet || MASTER_SHEET_NAME);
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) {
      return jsonReply_({ ok: true, records: [] });
    }
    const values = sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).getValues();
    const records = [];
    for (let i = 0; i < values.length; i++) {
      const r = values[i];
      const id = String(r[0] || '').trim();
      const title = String(r[5] || '').trim();
      if (!id || !title) continue;
      records.push({
        id: id,
        occurredAt: String(r[1] || ''),
        category: String(r[3] || 'security'),
        categoryLabel: String(r[4] || ''),
        title: title,
        summary: String(r[6] || ''),
        province: String(r[7] || ''),
        district: String(r[8] || ''),
        subdistrict: String(r[9] || ''),
        lat: r[10] === '' ? null : Number(r[10]),
        lng: r[11] === '' ? null : Number(r[11]),
        sourceName: String(r[12] || ''),
        reliabilityCode: String(r[13] || 'B2'),
        entryOrigin: String(r[14] || ''),
        analystNote: String(r[15] || ''),
        reporter: String(r[16] || ''),
        sourceLink: String(r[17] || ''),
        createdAt: String(r[18] || ''),
        updatedAt: String(r[19] || '')
      });
    }
    return jsonReply_({ ok: true, records: records });
  }

  return jsonReply_({ ok: true, message: 'Wing56DailyLog API ready' });
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const body = JSON.parse(raw);
    const action = String(body.action || '');

    const pinCheck = verifyPin_(body.pin);
    if (!pinCheck.ok) {
      return jsonReply_(pinCheck);
    }

    if (action === 'verify_staff_pin') {
      return jsonReply_(pinCheck);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const masterName = String(body.masterSheetName || MASTER_SHEET_NAME);

    if (action === 'save_daily_log') {
      const rec = body.record || {};
      const id = String(rec.id || '').trim();
      if (!id) return jsonReply_({ ok: false, message: 'ไม่พบรหัสรายการ (ID)' });

      const catId = String(rec.category || 'security');
      const targetCatSheet = CATEGORY_SHEETS[catId] || String(body.categorySheetName || 'ความมั่นคงและเหตุรุนแรง');
      const rowValues = buildRowFromRecord_(rec);

      const masterSh = getOrCreateSheet_(ss, masterName);
      upsertRowById_(masterSh, id, rowValues);

      // Remove from other category sheets in case the officer recategorized an existing item
      const allCatKeys = Object.keys(CATEGORY_SHEETS);
      for (let i = 0; i < allCatKeys.length; i++) {
        const otherName = CATEGORY_SHEETS[allCatKeys[i]];
        if (otherName !== targetCatSheet) {
          const otherSh = ss.getSheetByName(otherName);
          if (otherSh) deleteRowById_(otherSh, id);
        }
      }

      const catSh = getOrCreateSheet_(ss, targetCatSheet);
      upsertRowById_(catSh, id, rowValues);

      return jsonReply_({
        ok: true,
        message: 'บันทึกลงแท็บ "' + masterName + '" และ "' + targetCatSheet + '" เรียบร้อยแล้ว'
      });
    }

    if (action === 'delete_daily_log') {
      const id = String(body.id || '').trim();
      if (!id) return jsonReply_({ ok: false, message: 'ไม่พบรหัสรายการที่จะลบ' });

      const masterSh = ss.getSheetByName(masterName);
      if (masterSh) deleteRowById_(masterSh, id);

      const allCatKeys = Object.keys(CATEGORY_SHEETS);
      for (let i = 0; i < allCatKeys.length; i++) {
        const sh = ss.getSheetByName(CATEGORY_SHEETS[allCatKeys[i]]);
        if (sh) deleteRowById_(sh, id);
      }
      return jsonReply_({ ok: true, message: 'ลบรายการออกจากชีทแผนกแล้ว' });
    }

    return jsonReply_({ ok: false, message: 'ไม่รู้จัก action: ' + action });
  } catch (err) {
    return jsonReply_({ ok: false, message: 'เกิดข้อผิดพลาดใน GAS: ' + String(err) });
  }
}
`;
}
