import type {
  AppSettings,
  IncidentRecord,
  WatchAlertLevel,
  WatchAlertRecord,
  WatchAreaTarget,
} from '../types/incident';
import { buildParsedCoordinate, parseCoordinateInput } from './coordinates';
import { getCenterOfArea, lookupAreaByLatLng, matchAreaByThaiNames } from './geoLookup';
import {
  classifyCategoryFromText,
  extractPaperMetadata,
  extractWatchAdvisory,
  formatThaiDateTime,
  isWatchAdvisoryCategory,
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

/**
 * Flatten embedded CR/LF line breaks into single spaces so Google Sheets cells
 * never split into corrupted rows when imported as CSV into Power BI.
 */
export function sanitizeSingleLineText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\u2028\u2029\v]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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
  const details = sanitizeSingleLineText(stripLegacyBracketPrefix((record.details || '').trim()));
  return sanitizeSingleLineText(details ? `${prefix} — ${details}` : prefix);
}

/**
 * Build JSON payload using the user's configured field/column mapping plus legacy 10-column Dual-Write block.
 */
export function buildGasPayload(record: IncidentRecord, settings: AppSettings): Record<string, unknown> {
  const m = settings.fieldMapping;
  const inferredRow =
    record.legacyRowNumber ??
    (/^LEGACY-ROW-(\d+)$/.test(record.id) ? Number(record.id.replace('LEGACY-ROW-', '')) : undefined);
  const cleanReporter = sanitizeSingleLineText(record.reporter);
  const payload: Record<string, unknown> = {
    action: 'createOrUpdateIncident',
    ipbSheetName: (settings.ipbSheetName || 'สถานการณ์_3_จชต_IPB').trim(),
    dualWriteLegacy: settings.legacyDualWrite,
    legacySheetName: (settings.legacySheetName || 'ชีต1').trim(),
    sendLine: settings.legacySendLine,
    legacyRowNumber: inferredRow ?? '',
    legacy: {
      date: (record.occurredAt || '').slice(0, 10),
      incident_type: sanitizeSingleLineText(settings.legacyIncidentType || 'สถานการณ์ 3 จชต.'),
      location: buildLegacyLocationText(record),
      reporter_name: cleanReporter || '-',
      phone: '-',
      gps: record.lat !== null && record.lng !== null ? `${record.lat},${record.lng}` : '-',
    },
  };

  const values: Record<keyof typeof m, unknown> = {
    id: record.id,
    occurredAt: record.occurredAt,
    occurredAtBE: formatThaiDateTime(record.occurredAt, { shortMonth: true, thaiDigits: false }),
    coordinateRaw: sanitizeSingleLineText(record.coordinateRaw),
    lat: record.lat ?? '',
    lng: record.lng ?? '',
    mgrs: record.mgrs,
    utm: record.utm,
    province: record.province,
    district: record.district,
    subdistrict: record.subdistrict,
    inTargetArea: record.inTargetArea ? 'ในพื้นที่รับผิดชอบ' : 'นอกพื้นที่รับผิดชอบ',
    category: record.category,
    details: sanitizeSingleLineText(record.details),
    reporter: cleanReporter,
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
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(str)) return str.slice(0, 16);

  const slashMatch = str.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/
  );
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    let yr = Number(slashMatch[3]);
    if (yr < 100) yr += yr >= 50 ? 2500 : 2000;
    const yearAd = yr >= 2400 ? yr - 543 : yr;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && yearAd >= 1990 && yearAd <= 2100) {
      const pad = (n: number) => String(n).padStart(2, '0');
      const ymd = `${yearAd}-${pad(month)}-${pad(day)}`;
      if (slashMatch[4] !== undefined && slashMatch[5] !== undefined) {
        return `${ymd}T${pad(Math.min(23, Number(slashMatch[4])))}:${pad(Math.min(59, Number(slashMatch[5])))}`;
      }
      return ymd;
    }
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const bangkok = new Date(parsed.getTime() + 7 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${bangkok.getUTCFullYear()}-${pad(bangkok.getUTCMonth() + 1)}-${pad(bangkok.getUTCDate())}T${pad(bangkok.getUTCHours())}:${pad(bangkok.getUTCMinutes())}`;
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
      const rawProvince = String(readMappedField(row, m.province, 'province') ?? '').trim();
      const rawDistrict = String(readMappedField(row, m.district, 'district') ?? '').trim();
      const areas =
        parsed.areas.length > 0
          ? parsed.areas
          : rawProvince
            ? [{ province: rawProvince, district: rawDistrict }]
            : [];
      const reportedAt = occurredAt.slice(0, 10) || parsed.reportedAt || '';
      const watchStart = parsed.watchStart || reportedAt;
      const watchEnd = parsed.watchEnd || watchStart;
      ipbWatchAlerts.push({
        id,
        reportedAt,
        watchStart,
        watchEnd,
        areas,
        threatType: parsed.threatType,
        alertLevel: parsed.alertLevel,
        details,
        reporter,
        createdAt,
        updatedAt: createdAt,
        syncStatus: 'synced',
      });
      if (legacyRowNum) watchLegacyRows.add(legacyRowNum);
      const normalizedWatchDetails = sanitizeSingleLineText(details);
      if (normalizedWatchDetails.length >= 12) {
        watchDetailsPrefixes.push(normalizedWatchDetails.slice(0, 40));
      }
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
      if (!province) {
        const areaMatch = lookupAreaByLatLng(lat, lng);
        if (areaMatch.inTargetArea) {
          province = areaMatch.province;
          district = district || areaMatch.district;
          subdistrict = subdistrict || areaMatch.subdistrict;
          inTargetArea = true;
        }
      } else if (!district) {
        const provCenter = getCenterOfArea(province);
        if (
          !provCenter ||
          Math.abs(lat - provCenter.lat) >= 0.001 ||
          Math.abs(lng - provCenter.lng) >= 0.001
        ) {
          const areaMatch = lookupAreaByLatLng(lat, lng);
          if (areaMatch.inTargetArea) {
            district = areaMatch.district;
            subdistrict = subdistrict || areaMatch.subdistrict;
            inTargetArea = true;
          }
        }
      } else {
        const distCenter = getCenterOfArea(province, district);
        if (
          !distCenter ||
          Math.abs(lat - distCenter.lat) >= 0.001 ||
          Math.abs(lng - distCenter.lng) >= 0.001
        ) {
          const areaMatch = lookupAreaByLatLng(lat, lng);
          if (areaMatch.inTargetArea) {
            subdistrict = areaMatch.subdistrict;
            inTargetArea = true;
          }
        }
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

    const normalizedLocationText = sanitizeSingleLineText(locationText);
    const isDuplicateWatch =
      (typeof row.rowNumber === 'number' && watchLegacyRows.has(row.rowNumber)) ||
      (normalizedLocationText &&
        watchDetailsPrefixes.some((prefix) => normalizedLocationText.includes(prefix)));
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
      if (normalizedLocationText && normalizedLocationText === expectedLegacyLoc) return true;
      const normalizedIpbDetails = sanitizeSingleLineText(ipb.details);
      if (
        normalizedLocationText &&
        normalizedIpbDetails.length >= 12 &&
        normalizedLocationText.includes(normalizedIpbDetails.slice(0, 40))
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

    let effectiveCoord = parsedCoord;
    let effectiveCoordRaw = gpsText && gpsText !== '-' ? gpsText : '';
    if (isWatchAdvisoryCategory(category)) {
      const watchParsed = extractWatchAdvisory(locationText);
      if (watchParsed.areas.length > 0) {
        const matchesParsedArea =
          effectiveCoord &&
          province &&
          watchParsed.areas.some(
            (a) => a.province === province && (!a.district || a.district === district)
          );
        if (!effectiveCoord || !matchesParsedArea) {
          const target = watchParsed.areas[0];
          province = target.province;
          district = target.district;
          subdistrict = target.subdistrict || '';
          inTargetArea = true;
          const center = getCenterOfArea(
            province,
            district || undefined,
            subdistrict || undefined
          );
          if (center) {
            effectiveCoord = buildParsedCoordinate(
              center.lat,
              center.lng,
              'map-pick',
              `${center.lat}, ${center.lng}`
            );
            effectiveCoordRaw = `${center.lat}, ${center.lng}`;
          }
        }
      }
    }

    const id = row.rowNumber
      ? `LEGACY-ROW-${row.rowNumber}`
      : `LEGACY-${dateStr || 'NODATE'}-${idx + 1}`;
    const createdAt = String(row.createdAt ?? '').trim() || new Date().toISOString();

    legacyRecords.push({
      id,
      occurredAt: dateStr,
      coordinateRaw: effectiveCoordRaw,
      lat: effectiveCoord?.lat ?? null,
      lng: effectiveCoord?.lng ?? null,
      mgrs: effectiveCoord?.mgrs ?? '-',
      utm: effectiveCoord?.utm ?? '-',
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
    threatType: sanitizeSingleLineText(alert.threatType),
    areasText: sanitizeSingleLineText(areasText),
    areasJson: JSON.stringify(alert.areas),
    details: sanitizeSingleLineText(alert.details),
    reporter: sanitizeSingleLineText(alert.reporter),
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

  const singleLineKeys = new Set([m.details, m.reporter, m.coordinateRaw]);
  const rowMappingLines = headers
    .map((h) => {
      const rawExpr = `data[${JSON.stringify(h)}] !== undefined ? data[${JSON.stringify(h)}] : ''`;
      return singleLineKeys.has(h)
        ? `      sanitizeSbpCell_(${rawExpr})`
        : `      ${rawExpr}`;
    })
    .join(',\n');

  return `/**
 * SbpBridge.gs — โค้ดเชื่อมต่อระบบศูนย์บริการด้านการข่าวกรอง ผขว.บก.บน.56 (Dual-Write + ดึงข้อมูลย้อนหลัง + ข่าวรายวัน)
 * วิธีติดตั้งในโปรเจกต์ Google Apps Script เดิม:
 * 1) สร้างไฟล์สคริปต์ใหม่ชื่อ SbpBridge แล้ววางโค้ดนี้ลงไปทั้งหมด
 * 2) เพิ่มเงื่อนไขนี้ในฟังก์ชัน doGet(e) ของไฟล์หลักเดิม:
 *      if (page == "json") {
 *        return exportSbpJson(e);
 *      }
 *      if (page == "news") {
 *        return exportWing56NewsJson(e);
 *      }
 * 3) (ทางเลือก) ใน exportKML() สามารถเพิ่ม:
 *      if (type == ${JSON.stringify(legacyIncidentType)}) style = "suspicious_object";
 * 4) กด Deploy -> Manage deployments -> Edit -> New version -> Deploy (Execute as: Me, Access: Anyone)
 */

var SBP_IPB_SHEET_NAME = ${JSON.stringify(ipbSheetName)};
var SBP_WATCH_SHEET_NAME = ${JSON.stringify(watchSheetName)};
var SBP_LEGACY_SHEET_NAME = ${JSON.stringify(legacySheetName)};
var SBP_LEGACY_TYPE = ${JSON.stringify(legacyIncidentType)};

function sanitizeSbpCell_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\\r\\n\\u2028\\u2029\\v]+/g, ' ').replace(/[ \\t]{2,}/g, ' ').trim();
}

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

function sanitizeSheetCols_(sheet, startCol, numCols) {
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  var lastRow = sheet.getLastRow();
  var range = sheet.getRange(2, startCol, lastRow - 1, numCols);
  var values = range.getValues();
  var formulas = range.getFormulas();
  var cleaned = 0;
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < numCols; c++) {
      var formula = formulas[r][c];
      var val = values[r][c];
      if (!formula && typeof val === 'string' && /[\\r\\n\\u2028\\u2029\\v]/.test(val)) {
        var next = sanitizeSbpCell_(val);
        var safeVal = next.charAt(0) === '=' ? "'" + next : next;
        if (safeVal !== val) {
          sheet.getRange(r + 2, startCol + c).setValue(safeVal);
          cleaned++;
        }
      }
    }
  }
  return cleaned;
}

function sanitizeExistingSheetLineBreaks() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, error: 'กำลังดำเนินการทำความสะอาดข้อมูลอยู่ กรุณาลองใหม่อีกครั้ง' };
  }
  try {
    var ss = getSbpSpreadsheet_();
    var legacyCleaned = 0;
    var ipbCleaned = 0;
    var watchCleaned = 0;

    var legacySheet = ss.getSheetByName(SBP_LEGACY_SHEET_NAME);
    if (legacySheet) {
      legacyCleaned = sanitizeSheetCols_(legacySheet, 2, 3);
    }

    var ipbSheet = ss.getSheetByName(SBP_IPB_SHEET_NAME);
    if (ipbSheet && ipbSheet.getLastColumn() > 0) {
      ipbCleaned = sanitizeSheetCols_(ipbSheet, 1, ipbSheet.getLastColumn());
    }

    var watchSheet = ss.getSheetByName(SBP_WATCH_SHEET_NAME);
    if (watchSheet && watchSheet.getLastColumn() > 0) {
      watchCleaned = sanitizeSheetCols_(watchSheet, 1, watchSheet.getLastColumn());
    }

    var cleanedCells = legacyCleaned + ipbCleaned + watchCleaned;
    if (cleanedCells > 0) {
      SpreadsheetApp.flush();
    }
    Logger.log('sanitizeExistingSheetLineBreaks cleaned cells: ' + cleanedCells);
    return {
      ok: true,
      cleanedCells: cleanedCells,
      breakdown: { legacy: legacyCleaned, ipb: ipbCleaned, watch: watchCleaned }
    };
  } finally {
    lock.releaseLock();
  }
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
    sanitizeSbpCell_(data.threatType || ''),
    sanitizeSbpCell_(data.areasText || ''),
    data.areasJson || '[]',
    sanitizeSbpCell_(data.details || ''),
    sanitizeSbpCell_(data.reporter || '') || '-',
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

    if (data.action === 'sanitizeLineBreaks') {
      return sbpJsonResponse_(sanitizeExistingSheetLineBreaks());
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
      var legacyType = sanitizeSbpCell_(legacyObj.incident_type || SBP_LEGACY_TYPE);
      var legacyLocation = sanitizeSbpCell_(legacyObj.location || data[${JSON.stringify(m.details)}] || '') || '-';
      var legacyReporter = sanitizeSbpCell_(legacyObj.reporter_name || data[${JSON.stringify(m.reporter)}] || '') || '-';
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

function decodeNewsEntities_(str) {
  return String(str || '')
    .replace(/<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function stripNewsTrailingSource_(title, sourceName) {
  if (!sourceName) return title;
  var suffix = ' - ' + sourceName;
  if (title.slice(-suffix.length) === suffix) {
    return title.slice(0, title.length - suffix.length).trim();
  }
  return title;
}

function exportWing56NewsJson(e) {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('wing56_news_v1');
    if (cached && !(e && e.parameter && e.parameter.nocache === '1')) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }

    var queries = [
      { cat: 'politics', q: '(การเมือง OR ผู้ว่า OR เลือกตั้ง OR กกต OR อบจ OR เทศบาล OR ครม OR รัฐมนตรี) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:3d' },
      { cat: 'economy', q: '(เศรษฐกิจ OR การค้าชายแดน OR ยางพารา OR ปาล์มน้ำมัน OR ท่องเที่ยว OR ลงทุน OR ศุลกากร OR ด่านสะเดา OR สนามบินหาดใหญ่) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:3d' },
      { cat: 'social', q: '(น้ำท่วม OR อุทกภัย OR สาธารณสุข OR การศึกษา OR ประชาคม OR ชุมชน OR แรงงานต่างด้าว) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:3d' },
      { cat: 'narcotics', q: '(ยาเสพติด OR ยาบ้า OR ไอซ์ OR ป.ป.ส. OR กัญชา OR กระท่อม OR เครือข่ายยาเสพติด) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:3d' },
      { cat: 'security', q: '(ความมั่นคง OR กอ.รมน. OR ระเบิด OR ลอบยิง OR ปะทะ OR ก่อเหตุรุนแรง OR ฝ่ายความมั่นคง OR EOD OR ปิดล้อม) (สงขลา OR พัทลุง OR ตรัง OR สตูล OR ปัตตานี OR ยะลา OR นราธิวาส) when:3d' }
    ];

    var rawItems = [];

    var spEndpoints = [
      { cat: 'security', url: 'https://www.southpeace.go.th/index.php?rest_route=/wp/v2/posts&categories=24&per_page=10' },
      { cat: '', url: 'https://www.southpeace.go.th/index.php?rest_route=/wp/v2/posts&categories=23&categories_exclude=27,28,29,30&per_page=10' }
    ];
    for (var s = 0; s < spEndpoints.length; s++) {
      try {
        var spRes = UrlFetchApp.fetch(spEndpoints[s].url, { muteHttpExceptions: true });
        if (spRes.getResponseCode() !== 200) continue;
        var spPosts = JSON.parse(spRes.getContentText());
        if (!spPosts || !spPosts.length) continue;
        for (var p = 0; p < spPosts.length; p++) {
          var post = spPosts[p];
          var spTitle = decodeNewsEntities_(post.title && post.title.rendered ? post.title.rendered : '');
          var spExcerpt = decodeNewsEntities_(post.excerpt && post.excerpt.rendered ? post.excerpt.rendered : '').replace(/\\[…\\]|\\[\\.\\.\\.\\]/g, '').trim();
          var spRawDate = String(post.date_gmt || post.date || '');
          var spPub = spRawDate ? new Date(spRawDate.slice(-1) === 'Z' ? spRawDate : spRawDate + 'Z').toISOString() : new Date().toISOString();
          if (spTitle) {
            var spItem = {
              title: spTitle,
              summary: spExcerpt || spTitle,
              link: String(post.link || ''),
              sourceName: 'กอ.รมน.ภาค 4 สน.',
              publishedAt: spPub
            };
            if (spEndpoints[s].cat) spItem.queryHintCategory = spEndpoints[s].cat;
            rawItems.push(spItem);
          }
        }
      } catch (_spErr) {}
    }

    for (var i = 0; i < queries.length; i++) {
      var qObj = queries[i];
      var url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(qObj.q) + '&hl=th&gl=TH&ceid=TH:th';
      try {
        var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) continue;
        var xml = res.getContentText();
        var itemRegex = /<item>([\\s\\S]*?)<\\/item>/g;
        var m;
        while ((m = itemRegex.exec(xml)) !== null) {
          var block = m[1];
          var srcMatch = block.match(/<source[^>]*>([\\s\\S]*?)<\\/source>/i);
          var titleMatch = block.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i);
          var linkMatch = block.match(/<link[^>]*>([\\s\\S]*?)<\\/link>/i);
          var pubMatch = block.match(/<pubDate[^>]*>([\\s\\S]*?)<\\/pubDate>/i);
          var descMatch = block.match(/<description[^>]*>([\\s\\S]*?)<\\/description>/i);

          var sourceName = srcMatch ? decodeNewsEntities_(srcMatch[1]) : '';
          var rawTitle = titleMatch ? decodeNewsEntities_(titleMatch[1]) : '';
          var title = stripNewsTrailingSource_(rawTitle, sourceName);
          var summary = descMatch ? stripNewsTrailingSource_(decodeNewsEntities_(descMatch[1]), sourceName) : title;
          var link = linkMatch ? decodeNewsEntities_(linkMatch[1]) : '';
          var publishedAt = pubMatch ? new Date(decodeNewsEntities_(pubMatch[1])).toISOString() : new Date().toISOString();

          if (title && sourceName) {
            rawItems.push({
              title: title,
              summary: summary || title,
              link: link,
              sourceName: sourceName,
              publishedAt: publishedAt,
              queryHintCategory: qObj.cat
            });
          }
        }
      } catch (_fetchErr) {}
    }

    var out = JSON.stringify({
      ok: true,
      generatedAt: new Date().toISOString(),
      windowHours: 72,
      rawItems: rawItems
    });
    if (out.length < 95000) {
      cache.put('wing56_news_v1', out, 900);
    }
    return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
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
