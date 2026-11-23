import type {
  AppSettings,
  IncidentRecord,
  WatchAlertLevel,
  WatchAlertRecord,
  WatchAreaTarget,
} from '../types/incident';
import { buildParsedCoordinate, parseCoordinateInput } from './coordinates';
import { lookupAreaByLatLng, matchAreaByThaiNames } from './geoLookup';
import {
  classifyCategoryFromText,
  extractPaperMetadata,
  extractWatchAdvisory,
  formatThaiDateTime,
  WATCH_ADVISORY_CATEGORY,
} from './thaiDate';

export interface GasSyncResult {
  ok: boolean;
  message: string;
  responseData?: unknown;
}

export interface GasPullResult {
  ok: boolean;
  message: string;
  records: IncidentRecord[];
  watchAlerts?: WatchAlertRecord[];
  ipbCount: number;
  legacyCount: number;
}

interface RawLegacyRow {
  rowNumber?: number;
  date?: string;
  incident_type?: string;
  location?: string;
  reporter_name?: string;
  phone?: string;
  gps?: string;
  createdAt?: string;
}

function stripLegacyBracketPrefix(text: string): string {
  return text.replace(/^(?:\[[^\]]+\][^—\n]*—\s*)+/, '').trim();
}

/**
 * Format compact legacy 10-column Sheet Column C ("สถานที่") preserving IPB category + area + details.
 */
export function buildLegacyLocationText(record: IncidentRecord): string {
  const area = [
    record.subdistrict ? `ต.${record.subdistrict}` : '',
    record.district ? `อ.${record.district}` : '',
    record.province ? `จว.${record.province}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const count = record.eventCount && record.eventCount > 1 ? Math.round(record.eventCount) : 1;
  const countTag = count > 1 ? ` ×${count}` : '';
  const prefix = `[${record.category}${countTag}]${area ? ` ${area}` : ''}`;
  const details = stripLegacyBracketPrefix((record.details || '').trim());
  return details ? `${prefix} — ${details}` : prefix;
}

/**
 * Build JSON payload using the user's configured field/column mapping plus legacy 10-column Dual-Write block.
 */
export function buildGasPayload(record: IncidentRecord, settings: AppSettings): Record<string, unknown> {
  const m = settings.fieldMapping;
  const inferredRow =
    record.legacyRowNumber ??
    (/^LEGACY-ROW-(\d+)$/.test(record.id) ? Number(record.id.replace('LEGACY-ROW-', '')) : undefined);
  const payload: Record<string, unknown> = {
    action: 'createOrUpdateIncident',
    ipbSheetName: (settings.ipbSheetName || 'สถานการณ์_3_จชต_IPB').trim(),
    dualWriteLegacy: settings.legacyDualWrite,
    legacySheetName: (settings.legacySheetName || 'ชีต1').trim(),
    sendLine: settings.legacySendLine,
    legacyRowNumber: inferredRow ?? '',
    legacy: {
      date: (record.occurredAt || '').slice(0, 10),
      incident_type: (settings.legacyIncidentType || 'สถานการณ์ 3 จชต.').trim(),
      location: buildLegacyLocationText(record),
      reporter_name: record.reporter || '-',
      phone: '-',
      gps: record.lat !== null && record.lng !== null ? `${record.lat},${record.lng}` : '-',
    },
  };

  const values: Record<keyof typeof m, unknown> = {
    id: record.id,
    occurredAt: record.occurredAt,
    occurredAtBE: formatThaiDateTime(record.occurredAt, { shortMonth: true, thaiDigits: false }),
    coordinateRaw: record.coordinateRaw,
    lat: record.lat ?? '',
    lng: record.lng ?? '',
    mgrs: record.mgrs,
    utm: record.utm,
    province: record.province,
    district: record.district,
    subdistrict: record.subdistrict,
    inTargetArea: record.inTargetArea ? 'ในพื้นที่รับผิดชอบ' : 'นอกพื้นที่รับผิดชอบ',
    category: record.category,
    details: record.details,
    reporter: record.reporter,
    createdAt: record.createdAt,
  };

  for (const key of Object.keys(m) as Array<keyof typeof m>) {
    const targetKey = (m[key] || key).trim();
    if (targetKey) {
      payload[targetKey] = values[key];
    }
  }
  payload.eventCount = record.eventCount && record.eventCount > 1 ? Math.round(record.eventCount) : 1;
  if (record.batchId) {
    payload.batchId = record.batchId;
  }
  return payload;
}

function readMappedField(
  row: Record<string, unknown>,
  mappedKey: string,
  fallbackKey: string
): unknown {
  if (mappedKey && row[mappedKey] !== undefined) return row[mappedKey];
  return row[fallbackKey];
}

function toOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeOccurredAt(value: unknown): string {
  const str = String(value ?? '').trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) return str.slice(0, 16);
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  }
  return str;
}

function extractBracketMeta(
  location: string,
  categories: string[]
): { category: string | null; eventCount?: number } {
  const match = location.match(/^\[([^\]]+)\]/);
  if (!match) return { category: null };
  let raw = match[1].trim();
  let eventCount: number | undefined;
  const countMatch = raw.match(/\s*[×xX*]\s*(\d+)\s*$/);
  if (countMatch) {
    const parsed = Number(countMatch[1]);
    if (Number.isFinite(parsed) && parsed > 1) {
      eventCount = parsed;
    }
    raw = raw.slice(0, countMatch.index).trim();
  }
  const category = categories.includes(raw) ? raw : raw || null;
  return { category, eventCount };
}

/**
 * Parse GET ?page=json response into deduplicated IPB and legacy IncidentRecords.
 */
export function parsePulledGasResponse(
  raw: unknown,
  settings: AppSettings
): {
  records: IncidentRecord[];
  watchAlerts: WatchAlertRecord[];
  ipbCount: number;
  legacyCount: number;
} {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ipbRows = Array.isArray(obj.ipbRows) ? (obj.ipbRows as Array<Record<string, unknown>>) : [];
  const legacyRows = Array.isArray(obj.legacyRows) ? (obj.legacyRows as RawLegacyRow[]) : [];

  const m = settings.fieldMapping;
  const ipbRecords: IncidentRecord[] = [];
  const ipbWatchAlerts: WatchAlertRecord[] = [];
  const watchLegacyRows = new Set<number>();
  const watchDetailsPrefixes: string[] = [];
  const legacyRecords: IncidentRecord[] = [];

  for (let idx = 0; idx < ipbRows.length; idx++) {
    const row = ipbRows[idx];
    const id = String(readMappedField(row, m.id, 'id') ?? '').trim() || `IPB-GAS-${idx + 1}`;
    const occurredAt = normalizeOccurredAt(readMappedField(row, m.occurredAt, 'occurredAt'));
    const details = String(readMappedField(row, m.details, 'details') ?? '').trim();
    const reporter = String(readMappedField(row, m.reporter, 'reporter') ?? '').trim() || '-';
    const createdAt =
      String(readMappedField(row, m.createdAt, 'createdAt') ?? '').trim() ||
      new Date().toISOString();
    const legacyRowNum = toOptionalNumber(row.legacyRowNumber) ?? undefined;

    // Fallback: route legacy-bridge WATCH-* rows saved into ipbRows into Watch Alerts instead of incidents
    if (id.startsWith('WATCH-')) {
      const parsed = extractWatchAdvisory(details);
      const reportedAt = occurredAt.slice(0, 10) || parsed.reportedAt || createdAt.slice(0, 10);
      const watchStart = parsed.watchStart || reportedAt;
      const watchEnd = parsed.watchEnd || watchStart;
      ipbWatchAlerts.push({
        id,
        reportedAt,
        watchStart,
        watchEnd,
        areas: parsed.areas,
        threatType: parsed.threatType,
        alertLevel: parsed.alertLevel,
        details,
        reporter,
        createdAt,
        updatedAt: createdAt,
        syncStatus: 'synced',
      });
      if (legacyRowNum) watchLegacyRows.add(legacyRowNum);
      if (details.length >= 12) watchDetailsPrefixes.push(details.slice(0, 40));
      continue;
    }

    const coordinateRaw = String(readMappedField(row, m.coordinateRaw, 'coordinateRaw') ?? '').trim();

    let lat = toOptionalNumber(readMappedField(row, m.lat, 'lat'));
    let lng = toOptionalNumber(readMappedField(row, m.lng, 'lng'));
    let mgrs = String(readMappedField(row, m.mgrs, 'mgrs') ?? '').trim();
    let utm = String(readMappedField(row, m.utm, 'utm') ?? '').trim();

    if ((lat === null || lng === null) && coordinateRaw) {
      const parsedCoord = parseCoordinateInput(coordinateRaw);
      if (parsedCoord) {
        lat = parsedCoord.lat;
        lng = parsedCoord.lng;
        if (!mgrs || mgrs === '-') mgrs = parsedCoord.mgrs;
        if (!utm || utm === '-') utm = parsedCoord.utm;
      }
    } else if (lat !== null && lng !== null && (!mgrs || mgrs === '-' || !utm || utm === '-')) {
      const derived = buildParsedCoordinate(lat, lng, 'latlng', coordinateRaw || `${lat}, ${lng}`);
      if (!mgrs || mgrs === '-') mgrs = derived.mgrs;
      if (!utm || utm === '-') utm = derived.utm;
    }

    let province = String(readMappedField(row, m.province, 'province') ?? '').trim();
    let district = String(readMappedField(row, m.district, 'district') ?? '').trim();
    let subdistrict = String(readMappedField(row, m.subdistrict, 'subdistrict') ?? '').trim();
    const inTargetRaw = String(readMappedField(row, m.inTargetArea, 'inTargetArea') ?? '').trim();
    let inTargetArea =
      inTargetRaw === 'นอกพื้นที่รับผิดชอบ' || inTargetRaw.toLowerCase() === 'false'
        ? false
        : inTargetRaw === 'ในพื้นที่รับผิดชอบ' || inTargetRaw.toLowerCase() === 'true'
          ? true
          : Boolean(province);

    if (lat !== null && lng !== null && (!province || !district || !subdistrict)) {
      const areaMatch = lookupAreaByLatLng(lat, lng);
      if (areaMatch.inTargetArea) {
        province = province || areaMatch.province;
        district = district || areaMatch.district;
        subdistrict = subdistrict || areaMatch.subdistrict;
        inTargetArea = true;
      }
    }

    const rawCategory = String(readMappedField(row, m.category, 'category') ?? '').trim();
    const category =
      rawCategory ||
      classifyCategoryFromText(details, settings.categories) ||
      settings.categories[0] ||
      'อื่นๆ';
    const eventCountVal = toOptionalNumber(row.eventCount);
    const batchIdVal = String(row.batchId ?? '').trim();

    ipbRecords.push({
      id,
      occurredAt,
      coordinateRaw: coordinateRaw || (lat !== null && lng !== null ? `${lat}, ${lng}` : ''),
      lat,
      lng,
      mgrs: mgrs || '-',
      utm: utm || '-',
      province,
      district,
      subdistrict,
      inTargetArea,
      category,
      details,
      reporter,
      createdAt,
      updatedAt: createdAt,
      syncStatus: 'synced',
      sourceSheet: 'ipb',
      legacyRowNumber: legacyRowNum,
      ...(eventCountVal && eventCountVal > 1 ? { eventCount: Math.round(eventCountVal) } : {}),
      ...(batchIdVal ? { batchId: batchIdVal } : {}),
    });
  }

  const targetLegacyType = (settings.legacyIncidentType || 'สถานการณ์ 3 จชต.').trim();

  for (let idx = 0; idx < legacyRows.length; idx++) {
    const row = legacyRows[idx];
    const rowType = String(row.incident_type ?? '').trim();
    if (!rowType || rowType !== targetLegacyType) continue;

    const dateStr = String(row.date ?? '').trim().slice(0, 10);
    const locationText = String(row.location ?? '').trim();
    const gpsText = String(row.gps ?? '').trim();
    const parsedCoord =
      (gpsText && gpsText !== '-' ? parseCoordinateInput(gpsText) : null) ||
      (locationText ? parseCoordinateInput(locationText) : null);

    const isDuplicateWatch =
      (typeof row.rowNumber === 'number' && watchLegacyRows.has(row.rowNumber)) ||
      (locationText && watchDetailsPrefixes.some((prefix) => locationText.includes(prefix)));
    if (isDuplicateWatch) continue;

    // Deduplicate Dual-Write rows already present in ipbRows
    const isDuplicate = ipbRecords.some((ipb) => {
      const ipbDate = (ipb.occurredAt || '').slice(0, 10);
      if (dateStr && ipbDate && dateStr !== ipbDate) return false;
      if (
        parsedCoord &&
        ipb.lat !== null &&
        ipb.lng !== null &&
        Math.abs(parsedCoord.lat - ipb.lat) <= 0.0002 &&
        Math.abs(parsedCoord.lng - ipb.lng) <= 0.0002
      ) {
        return true;
      }
      const expectedLegacyLoc = buildLegacyLocationText(ipb);
      if (locationText && locationText === expectedLegacyLoc) return true;
      if (
        locationText &&
        ipb.details.length >= 12 &&
        locationText.includes(ipb.details.slice(0, 40))
      ) {
        return true;
      }
      return false;
    });

    if (isDuplicate) continue;

    let province = '';
    let district = '';
    let subdistrict = '';
    let inTargetArea = false;

    if (parsedCoord) {
      const areaMatch = lookupAreaByLatLng(parsedCoord.lat, parsedCoord.lng);
      province = areaMatch.province;
      district = areaMatch.district;
      subdistrict = areaMatch.subdistrict;
      inTargetArea = areaMatch.inTargetArea;
    }

    const paperMeta = extractPaperMetadata(locationText, settings.categories);
    if (!province && (paperMeta.province || paperMeta.district || paperMeta.subdistrict)) {
      const nameMatch = matchAreaByThaiNames(
        paperMeta.province,
        paperMeta.district,
        paperMeta.subdistrict
      );
      if (nameMatch) {
        province = nameMatch.province;
        district = nameMatch.district;
        subdistrict = nameMatch.subdistrict;
        inTargetArea = nameMatch.inTargetArea;
      } else {
        province = paperMeta.province || '';
        district = paperMeta.district || '';
        subdistrict = paperMeta.subdistrict || '';
      }
    }

    const fallbackOther = settings.categories.includes('อื่นๆ')
      ? 'อื่นๆ'
      : settings.categories[0] || 'อื่นๆ';
    const bracketMeta = extractBracketMeta(locationText, settings.categories);
    const category = bracketMeta.category || paperMeta.category || fallbackOther;

    const id = row.rowNumber
      ? `LEGACY-ROW-${row.rowNumber}`
      : `LEGACY-${dateStr || 'NODATE'}-${idx + 1}`;
    const createdAt = String(row.createdAt ?? '').trim() || new Date().toISOString();

    legacyRecords.push({
      id,
      occurredAt: dateStr,
      coordinateRaw: gpsText && gpsText !== '-' ? gpsText : '',
      lat: parsedCoord?.lat ?? null,
      lng: parsedCoord?.lng ?? null,
      mgrs: parsedCoord?.mgrs ?? '-',
      utm: parsedCoord?.utm ?? '-',
      province,
      district,
      subdistrict,
      inTargetArea,
      category,
      details: stripLegacyBracketPrefix(locationText) || locationText || targetLegacyType,
      reporter: String(row.reporter_name ?? '').trim() || '-',
      createdAt,
      updatedAt: createdAt,
      syncStatus: 'synced',
      sourceSheet: 'legacy',
      legacyRowNumber: typeof row.rowNumber === 'number' && row.rowNumber > 1 ? row.rowNumber : undefined,
      ...(bracketMeta.eventCount && bracketMeta.eventCount > 1
        ? { eventCount: bracketMeta.eventCount }
        : {}),
    });
  }

  const combined = [...ipbRecords, ...legacyRecords].sort((a, b) => {
    const tA = new Date(a.occurredAt || a.createdAt).getTime();
    const tB = new Date(b.occurredAt || b.createdAt).getTime();
    return tB - tA;
  });

  const watchRows = Array.isArray(obj.watchRows)
    ? (obj.watchRows as Array<Record<string, unknown>>)
    : [];
  const watchAlerts: WatchAlertRecord[] = watchRows.map((row, idx) => {
    const id = String(row.id ?? '').trim() || `WATCH-GAS-${idx + 1}`;
    const reportedAt = normalizeOccurredAt(row.reportedAt).slice(0, 10);
    const watchStart = normalizeOccurredAt(row.watchStart).slice(0, 10) || reportedAt;
    const watchEnd = normalizeOccurredAt(row.watchEnd).slice(0, 10) || watchStart;
    const alertLevelRaw = String(row.alertLevel ?? '').trim();
    const alertLevel: WatchAlertLevel =
      alertLevelRaw === 'critical' || alertLevelRaw === 'high' || alertLevelRaw === 'medium'
        ? alertLevelRaw
        : 'medium';
    const threatType = String(row.threatType ?? '').trim() || 'ความเคลื่อนไหวกลุ่มผู้ก่อเหตุรุนแรง';
    const details = String(row.details ?? '').trim();
    const reporter = String(row.reporter ?? '').trim() || '-';
    const createdAt = String(row.createdAt ?? '').trim() || new Date().toISOString();

    let areas: WatchAreaTarget[] = [];
    if (typeof row.areasJson === 'string' && row.areasJson.trim().startsWith('[')) {
      try {
        const parsedAreas = JSON.parse(row.areasJson) as WatchAreaTarget[];
        if (Array.isArray(parsedAreas)) {
          areas = parsedAreas.filter((a) => a && (a.province || a.district));
        }
      } catch {
        areas = [];
      }
    }
    if (areas.length === 0) {
      const fallbackText = String(row.areasText ?? details);
      areas = extractWatchAdvisory(fallbackText).areas;
    }

    return {
      id,
      reportedAt,
      watchStart,
      watchEnd,
      areas,
      threatType,
      alertLevel,
      details,
      reporter,
      createdAt,
      updatedAt: createdAt,
      syncStatus: 'synced',
    };
  });

  const watchById = new Map<string, WatchAlertRecord>();
  for (const w of ipbWatchAlerts) {
    watchById.set(w.id, w);
  }
  for (const w of watchAlerts) {
    watchById.set(w.id, w);
  }

  return {
    records: combined,
    watchAlerts: Array.from(watchById.values()),
    ipbCount: ipbRecords.length,
    legacyCount: legacyRecords.length,
  };
}

export function buildWatchAlertGasPayload(
  alert: WatchAlertRecord,
  settings: AppSettings
): Record<string, unknown> {
  const areasText = alert.areas
    .map((a) =>
      `${a.subdistrict ? `ต.${a.subdistrict} ` : ''}${a.district ? `อ.${a.district} ` : ''}${
        a.province ? `จว.${a.province}` : ''
      }`.trim()
    )
    .filter(Boolean)
    .join(', ');

  return {
    action: 'createOrUpdateWatchAlert',
    watchSheetName: (settings.watchSheetName || 'พื้นที่เฝ้าระวัง_IPB').trim(),
    dualWriteLegacy: false,
    id: alert.id,
    reportedAt: alert.reportedAt,
    occurredAt: alert.reportedAt,
    occurredAtBE: formatThaiDateTime(alert.reportedAt, { includeTime: false }),
    category: WATCH_ADVISORY_CATEGORY,
    province: alert.areas[0]?.province || '',
    district: alert.areas[0]?.district || '',
    watchStart: alert.watchStart,
    watchEnd: alert.watchEnd,
    alertLevel: alert.alertLevel,
    threatType: alert.threatType,
    areasText,
    areasJson: JSON.stringify(alert.areas),
    details: alert.details,
    reporter: alert.reporter,
    createdAt: alert.createdAt,
  };
}

async function postGasPayload(
  url: string,
  payload: Record<string, unknown>
): Promise<GasSyncResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // GAS might return HTML or plain text
    }

    if (!response.ok) {
      return {
        ok: false,
        message: `เซิร์ฟเวอร์ตอบกลับ HTTP ${response.status}`,
      };
    }

    if (parsed && parsed.ok === false) {
      return {
        ok: false,
        message: String(parsed.error || parsed.message || 'ระบบเดิมปฏิเสธการบันทึก'),
        responseData: parsed,
      };
    }

    return {
      ok: true,
      message: (parsed?.message as string) || 'ส่งข้อมูลเข้าสู่ระบบเดิมสำเร็จ',
      responseData: parsed ?? text,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? `เชื่อมต่อไม่สำเร็จ: ${err.message}`
          : 'ไม่สามารถเชื่อมต่อ Google Apps Script ได้',
    };
  }
}

/**
 * Send record to Google Apps Script Web App (/exec) using text/plain to avoid CORS preflight failures.
 */
export async function sendIncidentToGas(
  record: IncidentRecord,
  settings: AppSettings
): Promise<GasSyncResult> {
  const url = settings.gasWebhookUrl.trim();
  if (!url) {
    return { ok: false, message: 'ยังไม่ได้ตั้งค่า Webhook URL ของ Google Apps Script' };
  }
  return postGasPayload(url, buildGasPayload(record, settings));
}

/**
 * Send a watch/advisory record to a dedicated Google Sheets tab (`พื้นที่เฝ้าระวัง_IPB`).
 */
export async function sendWatchAlertToGas(
  alert: WatchAlertRecord,
  settings: AppSettings
): Promise<GasSyncResult> {
  const url = settings.gasWebhookUrl.trim();
  if (!url) {
    return { ok: false, message: 'ยังไม่ได้ตั้งค่า Webhook URL ของ Google Apps Script' };
  }
  return postGasPayload(url, buildWatchAlertGasPayload(alert, settings));
}

/**
 * Pull historical SBP rows from Google Apps Script (?page=json&scope=sbp).
 */
export async function pullIncidentsFromGas(settings: AppSettings): Promise<GasPullResult> {
  const baseUrl = (settings.gasFetchUrl || settings.gasWebhookUrl).trim();
  if (!baseUrl) {
    return {
      ok: false,
      message: 'ยังไม่ได้ตั้งค่า Web App URL ของ Google Apps Script',
      records: [],
      watchAlerts: [],
      ipbCount: 0,
      legacyCount: 0,
    };
  }

  const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=json&scope=sbp`;
  try {
    const response = await fetch(url, { method: 'GET' });
    const text = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        message: `ดึงข้อมูลไม่สำเร็จ (HTTP ${response.status})`,
        records: [],
        watchAlerts: [],
        ipbCount: 0,
        legacyCount: 0,
      };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        message:
          'ปลายทางส่งกลับมาเป็น HTML ไม่ใช่ JSON — กรุณาเพิ่มเงื่อนไข if (page == "json") return exportSbpJson(e); ใน doGet(e) ของ GAS และ Deploy เวอร์ชันใหม่',
        records: [],
        watchAlerts: [],
        ipbCount: 0,
        legacyCount: 0,
      };
    }

    if (parsed.ok === false) {
      return {
        ok: false,
        message: String(parsed.error || parsed.message || 'GAS ส่งกลับข้อผิดพลาด'),
        records: [],
        watchAlerts: [],
        ipbCount: 0,
        legacyCount: 0,
      };
    }

    const { records, watchAlerts, ipbCount, legacyCount } = parsePulledGasResponse(
      parsed,
      settings
    );
    const watchMsg =
      watchAlerts.length > 0 ? ` และพื้นที่เฝ้าระวัง ${watchAlerts.length} รายการ` : '';
    return {
      ok: true,
      message: `ดึงข้อมูลสำเร็จ: แท็บ IPB ${ipbCount} รายการ และจากชีตเดิม ${legacyCount} รายการ${watchMsg} (รวม ${records.length} เหตุการณ์)`,
      records,
      watchAlerts,
      ipbCount,
      legacyCount,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? `ไม่สามารถเชื่อมต่อเพื่อดึงข้อมูลได้: ${err.message}`
          : 'ไม่สามารถเชื่อมต่อ Google Apps Script ได้',
      records: [],
      watchAlerts: [],
      ipbCount: 0,
      legacyCount: 0,
    };
  }
}

export async function testGasConnection(settings: AppSettings): Promise<GasSyncResult> {
  const url = settings.gasWebhookUrl.trim();
  if (!url) {
    return { ok: false, message: 'กรุณากรอก Webhook URL ก่อนทดสอบ' };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'ping', source: 'SBP-Standalone-Report' }),
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, message: `HTTP ${response.status}: ไม่สามารถเชื่อมต่อปลายทางได้` };
    }
    try {
      const parsed = JSON.parse(text) as { ok?: boolean; message?: string };
      return {
        ok: parsed.ok !== false,
        message: parsed.message || 'เชื่อมต่อ Google Apps Script สำเร็จ',
        responseData: parsed,
      };
    } catch {
      return {
        ok: true,
        message: 'เชื่อมต่อปลายทางได้ (ได้รับ HTTP 200 แต่ผลลัพธ์ไม่ใช่ JSON — ตรวจสอบฟังก์ชัน doPost)',
        responseData: text.slice(0, 200),
      };
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? `เชื่อมต่อไม่สำเร็จ: ${err.message}` : 'เชื่อมต่อล้มเหลว',
    };
  }
}

/**
 * Generate a drop-in Google Apps Script bridge (`SbpBridge.gs`) compatible with legacy 10-column sheets.
 * Contains ZERO hardcoded secrets/IDs/tokens.
 */
export function generateGasReceiverCode(settings: AppSettings): string {
  const m = settings.fieldMapping;
  const ipbSheetName = (settings.ipbSheetName || 'สถานการณ์_3_จชต_IPB').trim();
  const watchSheetName = (settings.watchSheetName || 'พื้นที่เฝ้าระวัง_IPB').trim();
  const legacySheetName = (settings.legacySheetName || 'ชีต1').trim();
  const legacyIncidentType = (settings.legacyIncidentType || 'สถานการณ์ 3 จชต.').trim();

  const headers = [
    m.id,
    m.occurredAt,
    m.occurredAtBE,
    m.category,
    m.province,
    m.district,
    m.subdistrict,
    m.inTargetArea,
    m.lat,
    m.lng,
    m.mgrs,
    m.utm,
    m.coordinateRaw,
    m.details,
    m.reporter,
    m.createdAt,
  ];
  const fullHeaders = [...headers, 'legacyRowNumber'];

  const rowMappingLines = headers
    .map((h) => `      data[${JSON.stringify(h)}] !== undefined ? data[${JSON.stringify(h)}] : ''`)
    .join(',\n');

  return `/**
 * SbpBridge.gs — โค้ดเชื่อมต่อระบบรายงานสถานการณ์ 3 จังหวัดชายแดนภาคใต้ (Dual-Write + ดึงข้อมูลย้อนหลัง)
 * วิธีติดตั้งในโปรเจกต์ Google Apps Script เดิม:
 * 1) สร้างไฟล์สคริปต์ใหม่ชื่อ SbpBridge แล้ววางโค้ดนี้ลงไปทั้งหมด
 * 2) เพิ่ม 3 บรรทัดนี้ในฟังก์ชัน doGet(e) ของไฟล์หลักเดิม:
 *      if (page == "json") {
 *        return exportSbpJson(e);
 *      }
 * 3) (ทางเลือก) ใน exportKML() สามารถเพิ่ม:
 *      if (type == ${JSON.stringify(legacyIncidentType)}) style = "suspicious_object";
 * 4) กด Deploy -> Manage deployments -> Edit -> New version -> Deploy (Execute as: Me, Access: Anyone)
 */

var SBP_IPB_SHEET_NAME = ${JSON.stringify(ipbSheetName)};
var SBP_WATCH_SHEET_NAME = ${JSON.stringify(watchSheetName)};
var SBP_LEGACY_SHEET_NAME = ${JSON.stringify(legacySheetName)};
var SBP_LEGACY_TYPE = ${JSON.stringify(legacyIncidentType)};

function getSbpTimezone_() {
  try {
    if (typeof TIMEZONE !== 'undefined' && TIMEZONE) {
      return TIMEZONE;
    }
  } catch (_e) {}
  return 'Asia/Bangkok';
}

function getSbpSpreadsheet_() {
  try {
    if (typeof SPREADSHEET_ID !== 'undefined' && SPREADSHEET_ID) {
      return SpreadsheetApp.openById(SPREADSHEET_ID);
    }
  } catch (_e) {}
  return SpreadsheetApp.getActiveSpreadsheet();
}

function handleUpsertWatchAlert_(data, ss) {
  var watchName = String(data.watchSheetName || SBP_WATCH_SHEET_NAME);
  var sheet = ss.getSheetByName(watchName) || ss.insertSheet(watchName);
  var headers = ['id', 'reportedAt', 'watchStart', 'watchEnd', 'alertLevel', 'threatType', 'areasText', 'areasJson', 'details', 'reporter', 'createdAt'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  var rowId = String(data.id || '');
  var values = [
    rowId,
    data.reportedAt || '',
    data.watchStart || '',
    data.watchEnd || '',
    data.alertLevel || 'medium',
    data.threatType || '',
    data.areasText || '',
    data.areasJson || '[]',
    data.details || '',
    data.reporter || '-',
    data.createdAt || new Date().toISOString()
  ];
  var targetRow = -1;
  if (rowId && sheet.getLastRow() > 1) {
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === rowId) {
        targetRow = i + 2;
        break;
      }
    }
  }
  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return sbpJsonResponse_({
    ok: true,
    message: 'บันทึกพื้นที่เฝ้าระวังลงแท็บ ' + watchName + ' สำเร็จ',
    id: rowId
  });
}

function doPost(e) {
  try {
    var tz = getSbpTimezone_();
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var data = JSON.parse(raw);

    if (data.action === 'ping') {
      return sbpJsonResponse_({
        ok: true,
        message: 'เชื่อมต่อกับ Google Apps Script สำเร็จ',
        ipbSheet: SBP_IPB_SHEET_NAME,
        watchSheet: SBP_WATCH_SHEET_NAME,
        legacySheet: SBP_LEGACY_SHEET_NAME,
        timestamp: new Date().toISOString()
      });
    }

    if (data.action === 'createOrUpdateWatchAlert') {
      return handleUpsertWatchAlert_(data, getSbpSpreadsheet_());
    }

    var todayText = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var occurredRaw = String(data[${JSON.stringify(m.occurredAt)}] || (data.legacy && data.legacy.date) || '');
    var incidentDateText = occurredRaw ? occurredRaw.slice(0, 10) : todayText;

    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(incidentDateText)) {
      return sbpJsonResponse_({ ok: false, error: 'รูปแบบวันที่เกิดเหตุไม่ถูกต้อง' });
    }
    if (incidentDateText > todayText) {
      return sbpJsonResponse_({ ok: false, error: 'ไม่สามารถเลือกวันที่เกิดเหตุในอนาคตได้' });
    }

    var ss = getSbpSpreadsheet_();
    var ipbSheetName = String(data.ipbSheetName || SBP_IPB_SHEET_NAME);
    var ipbSheet = ss.getSheetByName(ipbSheetName) || ss.insertSheet(ipbSheetName);

    var headers = ${JSON.stringify(fullHeaders)};
    if (ipbSheet.getLastRow() === 0) {
      ipbSheet.appendRow(headers);
    }

    var idKey = ${JSON.stringify(m.id)};
    var idColIndex = headers.indexOf(idKey) + 1;
    var legacyRowColIndex = headers.indexOf('legacyRowNumber') + 1;
    var targetRow = -1;
    var existingLegacyRow = '';

    if (idColIndex > 0 && data[idKey] && ipbSheet.getLastRow() > 1) {
      var lastRow = ipbSheet.getLastRow();
      var ids = ipbSheet.getRange(2, idColIndex, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(data[idKey])) {
          targetRow = i + 2;
          if (legacyRowColIndex > 0) {
            existingLegacyRow = ipbSheet.getRange(targetRow, legacyRowColIndex).getValue();
          }
          break;
        }
      }
    }

    // 1. บันทึก/อัปเดตลงชีตเดิม (10 คอลัมน์ A-J) แบบ Dual-Write
    var incomingLegacyRow = data.legacyRowNumber ? Number(data.legacyRowNumber) : '';
    var legacyRowNum = existingLegacyRow ? Number(existingLegacyRow) : incomingLegacyRow;
    var resolvedLegacyName = String(data.legacySheetName || SBP_LEGACY_SHEET_NAME);
    if (data.dualWriteLegacy !== false) {
      var legacySheet = ss.getSheetByName(resolvedLegacyName);
      if (!legacySheet) {
        return sbpJsonResponse_({ ok: false, error: 'ไม่พบชีตชื่อ ' + resolvedLegacyName });
      }

      var dp = incidentDateText.split('-');
      var incidentDate = new Date(Number(dp[0]), Number(dp[1]) - 1, Number(dp[2]), 0, 0, 0);
      var legacyObj = data.legacy || {};
      var legacyType = String(legacyObj.incident_type || SBP_LEGACY_TYPE);
      var legacyLocation = String(legacyObj.location || data[${JSON.stringify(m.details)}] || '-');
      var legacyReporter = String(legacyObj.reporter_name || data[${JSON.stringify(m.reporter)}] || '-');
      var legacyPhone = String(legacyObj.phone || '-');
      var legacyGps = String(legacyObj.gps || '-');
      var createdAt = new Date();

      var legacyRow = [
        incidentDate,
        legacyType,
        legacyLocation,
        legacyReporter,
        "'" + legacyPhone,
        legacyGps,
        '-',
        '-',
        '-',
        createdAt
      ];

      if (legacyRowNum && legacyRowNum > 1 && legacyRowNum <= legacySheet.getLastRow()) {
        legacySheet.getRange(legacyRowNum, 1, 1, legacyRow.length).setValues([legacyRow]);
      } else {
        legacySheet.appendRow(legacyRow);
        legacyRowNum = legacySheet.getLastRow();
      }

      legacySheet.getRange(legacyRowNum, 1).setNumberFormat('dd/MM/yyyy');
      legacySheet.getRange(legacyRowNum, 10).setNumberFormat('dd/MM/yyyy HH:mm:ss');

      try {
        if (data.sendLine === true && typeof sendLine === 'function') {
          sendLine(
            {
              incident_type: legacyType,
              location: legacyLocation,
              reporter_name: legacyReporter,
              phone: legacyPhone
            },
            ['-', '-', '-'],
            legacyGps,
            incidentDate
          );
        }
      } catch (_lineErr) {}
    }

    // 2. บันทึก/อัปเดตลงแท็บข้อมูลเต็ม IPB
    var ipbRow = [
${rowMappingLines},
      legacyRowNum
    ];

    if (targetRow > 0) {
      ipbSheet.getRange(targetRow, 1, 1, ipbRow.length).setValues([ipbRow]);
    } else {
      ipbSheet.appendRow(ipbRow);
    }

    return sbpJsonResponse_({
      ok: true,
      message: 'บันทึกข้อมูลเข้าแท็บ ' + ipbSheetName + (data.dualWriteLegacy !== false ? ' และ ' + resolvedLegacyName : '') + ' สำเร็จ',
      id: data[idKey] || '',
      legacyRowNumber: legacyRowNum
    });
  } catch (err) {
    return sbpJsonResponse_({ ok: false, error: err.message });
  }
}

function exportSbpJson(e) {
  try {
    var tz = getSbpTimezone_();
    var ss = getSbpSpreadsheet_();
    var ipbRows = [];
    var ipbSheet = ss.getSheetByName(SBP_IPB_SHEET_NAME);
    if (ipbSheet && ipbSheet.getLastRow() > 1) {
      var ipbValues = ipbSheet.getDataRange().getValues();
      var ipbHeaders = ipbValues.shift();
      ipbValues.forEach(function (r) {
        var obj = {};
        ipbHeaders.forEach(function (h, idx) {
          var key = String(h || '').trim();
          if (!key) return;
          var val = r[idx];
          if (val instanceof Date && !isNaN(val.getTime())) {
            obj[key] = Utilities.formatDate(val, tz, "yyyy-MM-dd'T'HH:mm");
          } else {
            obj[key] = val;
          }
        });
        ipbRows.push(obj);
      });
    }

    var legacyRows = [];
    var legacySheet = ss.getSheetByName(SBP_LEGACY_SHEET_NAME);
    if (legacySheet && legacySheet.getLastRow() > 1) {
      var legValues = legacySheet.getDataRange().getValues();
      for (var i = 1; i < legValues.length; i++) {
        var row = legValues[i];
        var type = String(row[1] || '').trim();
        if (type !== SBP_LEGACY_TYPE) continue;

        var dateStr = '';
        if (row[0] instanceof Date && !isNaN(row[0].getTime())) {
          dateStr = Utilities.formatDate(row[0], tz, 'yyyy-MM-dd');
        } else {
          dateStr = String(row[0] || '').trim();
        }

        var createdStr = '';
        if (row[9] instanceof Date && !isNaN(row[9].getTime())) {
          createdStr = Utilities.formatDate(row[9], tz, "yyyy-MM-dd'T'HH:mm:ss");
        }

        legacyRows.push({
          rowNumber: i + 1,
          date: dateStr,
          incident_type: type,
          location: String(row[2] || '').trim(),
          reporter_name: String(row[3] || '').trim(),
          phone: String(row[4] || '').replace(/^'/, '').trim(),
          gps: String(row[5] || '').trim(),
          createdAt: createdStr
        });
      }
    }

    var watchRows = [];
    var watchSheet = ss.getSheetByName(SBP_WATCH_SHEET_NAME);
    if (watchSheet && watchSheet.getLastRow() > 1) {
      var watchValues = watchSheet.getDataRange().getValues();
      var watchHeaders = watchValues.shift();
      watchValues.forEach(function (r) {
        var wObj = {};
        watchHeaders.forEach(function (h, idx) {
          var key = String(h || '').trim();
          if (!key) return;
          var val = r[idx];
          if (val instanceof Date && !isNaN(val.getTime())) {
            wObj[key] = Utilities.formatDate(val, tz, 'yyyy-MM-dd');
          } else {
            wObj[key] = val;
          }
        });
        watchRows.push(wObj);
      });
    }

    return sbpJsonResponse_({
      ok: true,
      ipbRows: ipbRows,
      legacyRows: legacyRows,
      watchRows: watchRows,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    return sbpJsonResponse_({ ok: false, error: err.message });
  }
}

function sbpJsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
}
