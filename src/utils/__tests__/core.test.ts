import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, buildSampleIncidents } from '../../data/defaults';
import { decodeConfigHash, encodeConfigHash } from '../configShare';
import { latLngToUtmString, parseCoordinateInput } from '../coordinates';
import { buildIncidentsKml, formatIncidentForLine, formatIncidentForPaper } from '../exportUtils';
import {
  buildGasPayload,
  buildLegacyLocationText,
  buildWatchAlertGasPayload,
  generateGasReceiverCode,
  parsePulledGasResponse,
} from '../gasSync';
import {
  getWatchZonePolygonsGeoJson,
  lookupAreaByLatLng,
  matchAreaByThaiNames,
} from '../geoLookup';
import {
  buildAreaSeverityStats,
  buildDailyTrendBuckets,
  classifyIncidentSeverity,
} from '../severity';
import {
  CCTV_DESTRUCTION_CATEGORY,
  WATCH_ADVISORY_CATEGORY,
  classifyCategoryFromText,
  extractMultiAreaPaper,
  extractPaperMetadata,
  extractWatchAdvisory,
  formatThaiDateTime,
  fromThaiDigits,
  toThaiDigits,
} from '../thaiDate';

describe('Coordinate Auto-Parser', () => {
  it('parses decimal Lat, Lng and converts to MGRS and UTM', () => {
    const res = parseCoordinateInput('6.0462, 101.2015');
    expect(res).not.toBeNull();
    expect(res?.format).toBe('latlng');
    expect(res?.lat).toBeCloseTo(6.0462, 4);
    expect(res?.lng).toBeCloseTo(101.2015, 4);
    expect(res?.mgrs).toMatch(/^47N\s+[A-Z]{2}\s+\d{5}\s+\d{5}$/);
    expect(res?.utm).toMatch(/^47N\s+\d+\s+\d+$/);
  });

  it('auto-corrects swapped Lng, Lat in Thailand bounds', () => {
    const res = parseCoordinateInput('101.2498, 6.8675');
    expect(res).not.toBeNull();
    expect(res?.lat).toBeCloseTo(6.8675, 4);
    expect(res?.lng).toBeCloseTo(101.2498, 4);
  });

  it('parses Thai numerals in coordinates', () => {
    const res = parseCoordinateInput('๖.๐๔๖๒, ๑๐๑.๒๐๑๕');
    expect(res).not.toBeNull();
    expect(res?.lat).toBeCloseTo(6.0462, 4);
    expect(res?.lng).toBeCloseTo(101.2015, 4);
  });

  it('parses Google Maps URLs', () => {
    const res = parseCoordinateInput('พบเหตุที่ https://maps.google.com/?q=6.8675,101.2498 เร่งตรวจสอบ');
    expect(res).not.toBeNull();
    expect(res?.format).toBe('google-maps-url');
    expect(res?.lat).toBeCloseTo(6.8675, 4);
    expect(res?.lng).toBeCloseTo(101.2498, 4);
  });

  it('round-trips MGRS and UTM coordinates accurately', () => {
    const base = parseCoordinateInput('6.0462, 101.2015');
    expect(base).not.toBeNull();
    const fromMgrs = parseCoordinateInput(`พิกัดเหตุการณ์ ${base!.mgrs}`);
    expect(fromMgrs).not.toBeNull();
    expect(fromMgrs?.format).toBe('mgrs');
    expect(fromMgrs?.lat).toBeCloseTo(6.0462, 3);
    expect(fromMgrs?.lng).toBeCloseTo(101.2015, 3);

    const utmStr = latLngToUtmString(6.0462, 101.2015);
    const fromUtm = parseCoordinateInput(utmStr);
    expect(fromUtm).not.toBeNull();
    expect(fromUtm?.format).toBe('utm');
    expect(fromUtm?.lat).toBeCloseTo(6.0462, 3);
    expect(fromUtm?.lng).toBeCloseTo(101.2015, 3);
  });

  it('parses DMS coordinates', () => {
    const res = parseCoordinateInput(`6°52'03.0"N 101°14'59.3"E`);
    expect(res).not.toBeNull();
    expect(res?.format).toBe('dms');
    expect(res?.lat).toBeCloseTo(6.8675, 3);
    expect(res?.lng).toBeCloseTo(101.2498, 3);
  });
});

describe('Offline Southern Border Area Lookup', () => {
  it('identifies ต.แม่หวาด อ.ธารโต จว.ยะลา accurately', () => {
    const match = lookupAreaByLatLng(6.0462, 101.2015);
    expect(match.inTargetArea).toBe(true);
    expect(match.province).toBe('ยะลา');
    expect(match.district).toBe('ธารโต');
    expect(match.subdistrict).toBe('แม่หวาด');
  });

  it('identifies ต.สะบารัง อ.เมืองปัตตานี จว.ปัตตานี and 4 Songkhla districts', () => {
    const pat = lookupAreaByLatLng(6.8675, 101.2498);
    expect(pat.inTargetArea).toBe(true);
    expect(pat.province).toBe('ปัตตานี');
    expect(pat.district).toBe('เมืองปัตตานี');

    const sk = lookupAreaByLatLng(6.842, 100.9165);
    expect(sk.inTargetArea).toBe(true);
    expect(sk.province).toBe('สงขลา');
    expect(sk.district).toBe('เทพา');
  });

  it('flags coordinates outside the 3 provinces + 4 Songkhla districts', () => {
    const bkk = lookupAreaByLatLng(13.7563, 100.5018);
    expect(bkk.inTargetArea).toBe(false);
  });
});

describe('Thai Date, Numerals & Paper Report Metadata Extractor', () => {
  it('extracts date, incident area (ignoring later suspect domicile), and category from full Paper report text', () => {
    const samplePaper =
      'เมื่อ ๙ พ.ย.๖๙ หน่วยทดสอบ อ.ตัวอย่าง (ทดสอบ กอ.รมน.จำลอง) ปฏิบัติภารกิจในพื้นที่ บ.ตัวอย่าง ม.๗ ต.แม่หวาด อ.ธารโต จว.ยะลา ระหว่างลาดตระเวนเกิดการปะทะและยิงตอบโต้ หมายเหตุผู้ต้องสงสัยสมมติภูมิลำเนา ต.บันนังสตา อ.บันนังสตา จว.ยะลา';
    const parsed = extractPaperMetadata(samplePaper, DEFAULT_CATEGORIES);
    expect(parsed.occurredAt?.startsWith('2026-11-09')).toBe(true);
    expect(parsed.province).toBe('ยะลา');
    expect(parsed.district).toBe('ธารโต');
    expect(parsed.subdistrict).toBe('แม่หวาด');
    expect(parsed.category).toBe('ปะทะ/ปิดล้อมตรวจค้น');

    const matched = matchAreaByThaiNames(parsed.province, parsed.district, parsed.subdistrict);
    expect(matched?.inTargetArea).toBe(true);
    expect(matched?.subdistrict).toBe('แม่หวาด');
  });

  it('converts Thai numerals and formats BE dates cleanly', () => {
    expect(toThaiDigits('9 พ.ย.69')).toBe('๙ พ.ย.๖๙');
    expect(fromThaiDigits('๙ พ.ย.๖๙')).toBe('9 พ.ย.69');
    expect(formatThaiDateTime('2026-11-09T09:30', { shortMonth: true, thaiDigits: true })).toBe(
      '๙ พ.ย.๖๙ เวลา ๐๙.๓๐ น.'
    );
  });
});

describe('GAS Sync Payload & Paper Formatter', () => {
  it('maps custom GAS field keys and generates matching Code.gs', () => {
    const sample = buildSampleIncidents()[0];
    const customSettings = {
      ...DEFAULT_SETTINGS,
      fieldMapping: {
        ...DEFAULT_SETTINGS.fieldMapping,
        province: 'จังหวัด',
        details: 'รายละเอียด',
      },
    };
    const payload = buildGasPayload(sample, customSettings);
    expect(payload['จังหวัด']).toBe('ยะลา');
    expect(payload['รายละเอียด']).toBe(sample.details);

    const codeGs = generateGasReceiverCode(customSettings);
    expect(codeGs).toContain('"จังหวัด"');
    expect(codeGs).toContain('function doPost(e)');

    const paperOut = formatIncidentForPaper(sample, true);
    expect(paperOut).toContain('๙ พ.ย.๖๙');
    expect(paperOut).toContain('ต.แม่หวาด อ.ธารโต จว.ยะลา');
  });

  it('builds Dual-Write legacy payload and SbpBridge.gs without hardcoded secrets', () => {
    const sample = buildSampleIncidents()[0];
    const payload = buildGasPayload(sample, DEFAULT_SETTINGS);

    expect(payload.dualWriteLegacy).toBe(true);
    expect(payload.sendLine).toBe(false);
    expect(payload.ipbSheetName).toBe('สถานการณ์_3_จชต_IPB');
    expect(payload.legacySheetName).toBe('ชีต1');

    const legacy = payload.legacy as Record<string, string>;
    expect(legacy.date).toBe('2026-11-09');
    expect(legacy.incident_type).toBe('สถานการณ์ 3 จชต.');
    expect(legacy.gps).toBe('6.0462,101.2015');
    expect(legacy.location).toContain('[ปะทะ/ปิดล้อมตรวจค้น] ต.แม่หวาด อ.ธารโต จว.ยะลา');

    const bridge = generateGasReceiverCode(DEFAULT_SETTINGS);
    expect(bridge).toContain('function doPost(e)');
    expect(bridge).toContain('function exportSbpJson(e)');
    expect(bridge).toContain('function getSbpTimezone_()');
    expect(bridge).toContain('function getSbpSpreadsheet_()');
    expect(bridge).not.toContain('var SBP_TIMEZONE = typeof TIMEZONE');
    expect(bridge).toContain('page == "json"');
    expect(bridge).toContain('สถานการณ์_3_จชต_IPB');
    expect(bridge).toContain('ชีต1');
    expect(bridge).toContain('สถานการณ์ 3 จชต.');
    expect(bridge).not.toMatch(/script\.google\.com\/macros\/s\//);
  });

  it('parses pulled GAS JSON rows, auto-resolves legacy coordinates, and deduplicates Dual-Write pairs', () => {
    const sample = buildSampleIncidents()[0];
    const pulled = parsePulledGasResponse(
      {
        ok: true,
        ipbRows: [
          {
            id: sample.id,
            occurredAt: sample.occurredAt,
            lat: sample.lat,
            lng: sample.lng,
            province: sample.province,
            district: sample.district,
            subdistrict: sample.subdistrict,
            category: sample.category,
            details: sample.details,
            reporter: sample.reporter,
          },
        ],
        legacyRows: [
          // Duplicate of the IPB row written via Dual-Write -> must be deduplicated
          {
            rowNumber: 2,
            date: '2026-11-09',
            incident_type: 'สถานการณ์ 3 จชต.',
            location: `[ปะทะ/ปิดล้อมตรวจค้น] ต.แม่หวาด อ.ธารโต จว.ยะลา — ${sample.details}`,
            reporter_name: sample.reporter,
            gps: '6.0462,101.2015',
          },
          // Genuine historical legacy row only in ชีต1 -> must be kept & geocoded
          {
            rowNumber: 5,
            date: '2026-10-18',
            incident_type: 'สถานการณ์ 3 จชต.',
            location: 'เหตุลอบวางระเบิดริมทาง ต.สะบารัง อ.เมืองปัตตานี จว.ปัตตานี',
            reporter_name: 'เวรข่าวตัวอย่าง',
            gps: '6.8675,101.2498',
          },
          // Non-3-border legacy incident -> must be filtered out
          {
            rowNumber: 6,
            date: '2026-10-19',
            incident_type: 'พบโดรน',
            location: 'รันเวย์ตัวอย่าง',
            reporter_name: 'เวรรักษาการณ์',
            gps: '7.008,100.474',
          },
        ],
      },
      DEFAULT_SETTINGS
    );

    expect(pulled.ipbCount).toBe(1);
    expect(pulled.legacyCount).toBe(1);
    expect(pulled.records).toHaveLength(2);

    const legacyImported = pulled.records.find((r) => r.id === 'LEGACY-ROW-5');
    expect(legacyImported).toBeDefined();
    expect(legacyImported?.sourceSheet).toBe('legacy');
    expect(legacyImported?.legacyRowNumber).toBe(5);
    expect(legacyImported?.occurredAt).toBe('2026-10-18');
    expect(formatThaiDateTime(legacyImported!.occurredAt)).toBe('18 ต.ค.69');
    expect(formatThaiDateTime(legacyImported!.occurredAt)).not.toContain('เวลา');
    expect(legacyImported?.province).toBe('ปัตตานี');
    expect(legacyImported?.district).toBe('เมืองปัตตานี');
    expect(legacyImported?.category).toBe('ระเบิด');
    expect(legacyImported?.mgrs).toMatch(/^47N\s+/);

    // Editing a pulled LEGACY-ROW-N record must round-trip legacyRowNumber into payload & SbpBridge
    const editPayload = buildGasPayload(legacyImported!, DEFAULT_SETTINGS);
    expect(editPayload.legacyRowNumber).toBe(5);
    expect(generateGasReceiverCode(DEFAULT_SETTINGS)).toContain('data.legacyRowNumber');
  });
});

describe('Tactical Keywords, Quick Config Share & KML Export', () => {
  it('classifies expanded Southern Border tactical keywords accurately', () => {
    expect(extractPaperMetadata('เกิดเหตุซุ่มโจมตีชุดลาดตระเวน', DEFAULT_CATEGORIES).category).toBe(
      'ใช้อาวุธปืน/ลอบยิง'
    );
    expect(extractPaperMetadata('คนร้ายขว้างไปป์บอมบ์และยิง M79', DEFAULT_CATEGORIES).category).toBe(
      'ระเบิด'
    );
    expect(extractPaperMetadata('พบการพ่นสีและแขวนป้ายผ้าก่อกวน', DEFAULT_CATEGORIES).category).toBe(
      'ก่อกวน/โปรยตะปูเรือใบ-เผายาง'
    );
    expect(extractPaperMetadata('จับกุมผู้ต้องหาตามหมายจับป.วิอาญา', DEFAULT_CATEGORIES).category).toBe(
      'ตรวจยึด/จับกุม'
    );
  });

  it('round-trips HTTPS config share hash and rejects unsafe URLs', () => {
    const sampleUrl = encodeConfigHash(
      {
        ...DEFAULT_SETTINGS,
        gasWebhookUrl: 'https://example.com/macros/s/DEMO/exec',
        agencyName: 'ศูนย์ข่าวทดสอบ',
        autoPullOnLoad: false,
      },
      'https://example.github.io/app/'
    );
    expect(sampleUrl).toContain('#config=');

    const decoded = decodeConfigHash(new URL(sampleUrl).hash);
    expect(decoded).not.toBeNull();
    expect(decoded?.gasWebhookUrl).toBe('https://example.com/macros/s/DEMO/exec');
    expect(decoded?.agencyName).toBe('ศูนย์ข่าวทดสอบ');
    expect(decoded?.autoPullOnLoad).toBe(false);

    const badPayload = btoa(JSON.stringify({ w: 'javascript:alert(1)' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeConfigHash(`#config=${badPayload}`)).toBeNull();
  });

  it('builds valid XML-escaped Google Earth KML for mapped incidents', () => {
    const sample = buildSampleIncidents()[0];
    const withXmlChars = {
      ...sample,
      details: 'ทดสอบ <Tag> & "Quote" ในพื้นที่',
    };
    const kml = buildIncidentsKml([withXmlChars]);
    expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
    expect(kml).toContain(`<coordinates>${sample.lng},${sample.lat},0</coordinates>`);
    expect(kml).toContain('&lt;Tag&gt; &amp; &quot;Quote&quot;');
  });
});

describe('Multi-Area Paper Parser & eventCount Support', () => {
  it('parses Thai military 4-digit time ranges and standalone military hours', () => {
    const resRange = extractPaperMetadata(
      'เมื่อ ๑๕ มี.ค.๖๘, ๐๔๑๕ - ๐๕๓๐ เกิดเหตุโปรยตะปูเรือใบ ต.บานา อ.เมืองปัตตานี จว.ปัตตานี',
      DEFAULT_CATEGORIES
    );
    expect(resRange.occurredAt).toBe('2025-03-15T04:15');
    expect(resRange.province).toBe('ปัตตานี');
    expect(resRange.district).toBe('เมืองปัตตานี');

    const resSingle = extractPaperMetadata(
      'เมื่อ 12 เม.ย. 2568 เวลา 1430 น. ลอบวางระเบิด อ.สายบุรี จว.ปัตตานี',
      DEFAULT_CATEGORIES
    );
    expect(resSingle.occurredAt).toBe('2025-04-12T14:30');
    expect(resSingle.category).toBe('ระเบิด');
  });

  it('extracts coordinated multi-area reports with wrapped breakdown clauses', () => {
    const syntheticReport = [
      '๒.๑ เมื่อ ๑๘ เม.ย.๖๘, ๐๒๔๕ - ๐๔๑๐ เกิดเหตุคนร้ายลอบวางระเบิดและสร้างสถานการณ์ก่อกวน ในพื้นที่ ๓ อำเภอ ของ จว.ปัตตานี จำนวน ๘ จุด ดังนี้',
      '  ๒.๑.๑ อ.ยะรัง จำนวน ๒ เหตุการณ์ เป็นเหตุสร้างสถานการณ์ก่อกวนด้วยการเผาเสาไฟริมทาง ทำให้เสาไฟเสียหาย จำนวน ๔ ต้น ไม่มีผู้ได้รับบาดเจ็บหรือเสียชีวิต พิกัด 6.7512, 101.3045',
      '  ๒.๑.๒ อ.โคกโพธิ์ จำนวน ๔ เหตุการณ์ แยกเป็นเหตุลอบวางระเบิด ๒ เหตุการณ์,',
      'ยิงทำลายป้ายจราจร ๑ เหตุการณ์ และเผาป้อมจุดตรวจ ๑ เหตุการณ์ ทำให้ป้อมเสียหาย จำนวน ๑ หลัง',
      '  ๒.๑.๓ อ.สายบุรี จำนวน ๒ เหตุการณ์ เป็นเหตุสร้างสถานการณ์ก่อกวนด้วยการเผายางรถยนต์ ไม่มีผู้ได้รับบาดเจ็บหรือเสียชีวิต',
    ].join('\n');

    const parsed = extractMultiAreaPaper(syntheticReport, DEFAULT_CATEGORIES);
    expect(parsed.occurredAt).toBe('2025-04-18T02:45');
    expect(parsed.province).toBe('ปัตตานี');
    expect(parsed.reportedTotalCount).toBe(8);
    expect(parsed.items).toHaveLength(5);

    const sumCounts = parsed.items.reduce((acc, item) => acc + item.eventCount, 0);
    expect(sumCounts).toBe(8);

    // Item 1: อ.ยะรัง (explicit coord, harassment despite burning pole)
    expect(parsed.items[0].district).toBe('ยะรัง');
    expect(parsed.items[0].province).toBe('ปัตตานี');
    expect(parsed.items[0].category).toBe('ก่อกวน/โปรยตะปูเรือใบ-เผายาง');
    expect(parsed.items[0].eventCount).toBe(2);
    expect(parsed.items[0].coordMatched).toBe(true);
    expect(parsed.items[0].lat).toBeCloseTo(6.7512, 4);

    // Items 2..4: อ.โคกโพธิ์ split into 3 distinct categories
    expect(parsed.items[1].district).toBe('โคกโพธิ์');
    expect(parsed.items[1].category).toBe('ระเบิด');
    expect(parsed.items[1].eventCount).toBe(2);
    expect(parsed.items[1].coordMatched).toBe(false);
    expect(parsed.items[1].lat).not.toBeNull();

    expect(parsed.items[2].district).toBe('โคกโพธิ์');
    expect(parsed.items[2].category).toBe('ใช้อาวุธปืน/ลอบยิง');
    expect(parsed.items[2].eventCount).toBe(1);

    expect(parsed.items[3].district).toBe('โคกโพธิ์');
    expect(parsed.items[3].category).toBe('วางเพลิง');
    expect(parsed.items[3].eventCount).toBe(1);

    // Item 5: อ.สายบุรี
    expect(parsed.items[4].district).toBe('สายบุรี');
    expect(parsed.items[4].category).toBe('ก่อกวน/โปรยตะปูเรือใบ-เผายาง');
    expect(parsed.items[4].eventCount).toBe(2);
  });

  it('propagates eventCount and batchId across sync, round-trip pull, and exports', () => {
    const sample = buildSampleIncidents()[0];
    const batchRec = {
      ...sample,
      id: 'INC-2568-BATCH-01',
      category: 'ก่อกวน/โปรยตะปูเรือใบ-เผายาง',
      eventCount: 3,
      batchId: 'BATCH-2568-01',
      details: 'เผายางรถยนต์ 3 จุดในพื้นที่ทดสอบ',
    };

    const legacyLoc = buildLegacyLocationText(batchRec);
    expect(legacyLoc).toContain('[ก่อกวน/โปรยตะปูเรือใบ-เผายาง ×3]');

    const payload = buildGasPayload(batchRec, DEFAULT_SETTINGS);
    expect(payload.eventCount).toBe(3);
    expect(payload.batchId).toBe('BATCH-2568-01');

    const lineText = formatIncidentForLine(batchRec);
    expect(lineText).toContain('(จำนวน 3 เหตุการณ์)');
    const paperText = formatIncidentForPaper(batchRec, false);
    expect(paperText).toContain('(จำนวน 3 เหตุการณ์)');
    expect(buildIncidentsKml([batchRec])).toContain('จำนวนเหตุการณ์: 3');

    const pulled = parsePulledGasResponse(
      {
        ok: true,
        ipbRows: [
          {
            id: 'INC-IPB-MULTI',
            occurredAt: '2025-04-18T02:45',
            lat: 6.75,
            lng: 101.3,
            category: 'ระเบิด',
            details: 'ทดสอบดึงยอด eventCount',
            reporter: 'ทม.ทดสอบ',
            eventCount: 4,
            batchId: 'BATCH-2568-02',
          },
        ],
        legacyRows: [
          {
            rowNumber: 12,
            date: '2025-04-19',
            incident_type: DEFAULT_SETTINGS.legacyIncidentType,
            location: '[วางเพลิง ×2] อ.ยะรัง จว.ปัตตานี — ทดสอบดึง legacy ×N',
            gps: '6.7510,101.3010',
            reporter_name: 'จ.ส.อ.ทดสอบ',
          },
        ],
      },
      DEFAULT_SETTINGS
    );

    const ipbMulti = pulled.records.find((r) => r.id === 'INC-IPB-MULTI');
    expect(ipbMulti?.eventCount).toBe(4);
    expect(ipbMulti?.batchId).toBe('BATCH-2568-02');

    const legacyMulti = pulled.records.find((r) => r.id === 'LEGACY-ROW-12');
    expect(legacyMulti?.category).toBe('วางเพลิง');
    expect(legacyMulti?.eventCount).toBe(2);
  });
});

describe('IPB Severity Classification & C2 Aggregations', () => {
  it('classifies Southern Border tactical categories cleanly and ignores negated casualties', () => {
    expect(classifyIncidentSeverity('ปะทะ/ปิดล้อมตรวจค้น').level).toBe('critical');
    expect(classifyIncidentSeverity('ระเบิด').level).toBe('critical');
    expect(classifyIncidentSeverity('ใช้อาวุธปืน/ลอบยิง').level).toBe('critical');
    expect(classifyIncidentSeverity('วางเพลิง').level).toBe('high');
    expect(
      classifyIncidentSeverity(
        'ก่อกวน/โปรยตะปูเรือใบ-เผายาง',
        'เผายางรถยนต์ 2 จุด ไม่มีผู้ได้รับบาดเจ็บหรือเสียชีวิต'
      ).level
    ).toBe('medium');
    expect(
      classifyIncidentSeverity(
        'ตรวจยึด/จับกุม',
        'ตรวจยึดอาวุธปืนและวัตถุระเบิด ไม่มีผู้ได้รับบาดเจ็บหรือเสียชีวิต'
      ).level
    ).toBe('low');
    expect(classifyIncidentSeverity('อุบัติเหตุ/ภัยพิบัติ').level).toBe('low');
  });

  it('builds 30 daily trend buckets and weighted area severity percentages', () => {
    const base = buildSampleIncidents()[0];
    const items = [
      {
        ...base,
        id: 'SEV-1',
        province: 'ปัตตานี',
        category: 'ระเบิด',
        details: 'เหตุวัตถุระเบิดริมถนนทดสอบ',
        occurredAt: '2025-04-30T08:00',
        eventCount: 3,
      },
      {
        ...base,
        id: 'SEV-2',
        province: 'ปัตตานี',
        category: 'ตรวจยึด/จับกุม',
        details: 'ตั้งจุดสกัดตรวจยึดสิ่งผิดกฎหมาย',
        occurredAt: '2025-04-01T10:00',
        eventCount: 1,
      },
    ];

    const buckets = buildDailyTrendBuckets(items, 30, '2025-04-30');
    expect(buckets).toHaveLength(30);
    expect(buckets[0].ymd).toBe('2025-04-01');
    expect(buckets[0].count).toBe(1);
    expect(buckets[29].ymd).toBe('2025-04-30');
    expect(buckets[29].count).toBe(3);

    const areaRows = buildAreaSeverityStats(items);
    const pattani = areaRows.find((r) => r.key === 'ปัตตานี');
    expect(pattani).toBeDefined();
    expect(pattani?.total).toBe(4);
    expect(pattani?.counts.critical).toBe(3);
    expect(pattani?.counts.low).toBe(1);
    expect(pattani?.pcts.critical).toBe(75);
    expect(pattani?.pcts.low).toBe(25);
  });
});

describe('Refined Category Classifier & Legacy Prefix Stripping', () => {
  it('avoids false positives on routine searches, weapon seizures, and EOD negative checks', () => {
    expect(
      classifyCategoryFromText(
        'เจ้าหน้าที่ตรวจค้นบ้านเป้าหมายและตรวจยึดอาวุธปืนและกระสุนปืนพร้อมวัตถุระเบิด',
        DEFAULT_CATEGORIES
      )
    ).toBe('ตรวจยึด/จับกุม');

    expect(
      classifyCategoryFromText(
        'ชุดเก็บกู้วัตถุระเบิดเข้าตรวจสอบพื้นที่ ไม่พบวัตถุระเบิด พบเพียงป้ายผ้าก่อกวน',
        DEFAULT_CATEGORIES
      )
    ).toBe('ก่อกวน/โปรยตะปูเรือใบ-เผายาง');
  });

  it('strips stacked [category] prefixes on legacy pull and updates cleanly without duplicating', () => {
    const pulled = parsePulledGasResponse(
      {
        ok: true,
        ipbRows: [],
        legacyRows: [
          {
            rowNumber: 22,
            date: '2025-05-01',
            incident_type: DEFAULT_SETTINGS.legacyIncidentType,
            location: '[ระเบิด] ต.สะบารัง อ.เมืองปัตตานี จว.ปัตตานี — เจ้าหน้าที่ตรวจยึดวัตถุระเบิดได้ 1 รายการ',
            gps: '6.8675,101.2498',
            reporter_name: 'ร.ต.ทดสอบ',
          },
        ],
      },
      DEFAULT_SETTINGS
    );

    const legacyItem = pulled.records[0];
    expect(legacyItem.details).toBe('เจ้าหน้าที่ตรวจยึดวัตถุระเบิดได้ 1 รายการ');

    const reclassified = {
      ...legacyItem,
      category: 'ตรวจยึด/จับกุม',
    };
    const nextLoc = buildLegacyLocationText(reclassified);
    expect(nextLoc).toContain('[ตรวจยึด/จับกุม]');
    expect(nextLoc).not.toContain('[ระเบิด]');
    expect((nextLoc.match(/—/g) || []).length).toBe(1);

    // Also strip double-stacked prefixes if passed directly
    const alreadyPrefixed = {
      ...legacyItem,
      category: 'ตรวจยึด/จับกุม',
      details: '[ปะทะ] จว.ปัตตานี — [ระเบิด] อ.เมืองปัตตานี — เจ้าหน้าที่ตรวจยึดของกลาง',
    };
    const cleanedLoc = buildLegacyLocationText(alreadyPrefixed);
    expect(cleanedLoc).toBe(
      '[ตรวจยึด/จับกุม] ต.สะบารัง อ.เมืองปัตตานี จว.ปัตตานี — เจ้าหน้าที่ตรวจยึดของกลาง'
    );
  });
});

describe('Threat Watch Advisory Parser, Polygons & Separate GAS Tab', () => {
  it('classifies watch advisory reports under dedicated advisory category', () => {
    expect(
      classifyCategoryFromText(
        'ปรากฏข่าวสารความเคลื่อนไหวเตรียมลอบวางระเบิด พื้นที่เฝ้าระวัง อ.ยะรัง จว.ปัตตานี',
        DEFAULT_CATEGORIES
      )
    ).toBe(WATCH_ADVISORY_CATEGORY);
  });

  it('extracts multi-district watch targets, hyphenated names, short เมือง alias, and date windows', () => {
    const syntheticWatch =
      'เมื่อ ๕ มี.ค.๖๘ ปรากฏข่าวสารความเคลื่อนไหวกลุ่มผู้ก่อเหตุรุนแรง เตรียมนำยานพาหนะดัดแปลงเป็นระเบิดคาร์บอมบ์ (Car Bomb) และ จยย.บอมบ์ ก่อเหตุในพื้นที่เฝ้าระวัง อ.ยี่งอ อ.สุไหงโก-ลก อ.ตากใบ และ อ.เมือง จว.นราธิวาส ห้วงเฝ้าระวัง ๕ - ๑๖ มี.ค.๖๘';

    const parsed = extractWatchAdvisory(syntheticWatch);
    expect(parsed.reportedAt).toBe('2025-03-05');
    expect(parsed.watchStart).toBe('2025-03-05');
    expect(parsed.watchEnd).toBe('2025-03-16');
    expect(parsed.threatType).toBe('คาร์บอมบ์ / จยย.บอมบ์');
    expect(parsed.alertLevel).toBe('critical');
    expect(parsed.areas).toHaveLength(4);
    expect(parsed.areas).toContainEqual({ province: 'นราธิวาส', district: 'สุไหงโก-ลก' });
    expect(parsed.areas).toContainEqual({ province: 'นราธิวาส', district: 'เมืองนราธิวาส' });

    const crossMonth = extractWatchAdvisory(
      'พื้นที่เพ่งเล็ง อ.ยะรัง จว.ปัตตานี ห้วงเฝ้าระวังตั้งแต่ ๒๕ ก.พ. - ๑๐ มี.ค.๖๘'
    );
    expect(crossMonth.watchStart).toBe('2025-02-25');
    expect(crossMonth.watchEnd).toBe('2025-03-10');
    expect(crossMonth.areas).toContainEqual({ province: 'ปัตตานี', district: 'ยะรัง' });

    const geo = getWatchZonePolygonsGeoJson([
      { province: 'นราธิวาส', district: 'สุไหงโก-ลก' },
      { province: 'นราธิวาส', district: 'เมืองนราธิวาส' },
    ]);
    expect(geo.features.length).toBeGreaterThan(2);
    expect(geo.features.some((f) => f.properties.district === 'สุไหงโก-ลก')).toBe(true);
    expect(geo.features.some((f) => f.properties.district === 'เมืองนราธิวาส')).toBe(true);
  });

  it('builds separate watch-tab GAS payload and SbpBridge handler without secrets', () => {
    const sampleWatch = {
      id: 'WATCH-2568-001',
      reportedAt: '2025-03-05',
      watchStart: '2025-03-05',
      watchEnd: '2025-03-16',
      areas: [{ province: 'นราธิวาส', district: 'สุไหงโก-ลก' }],
      threatType: 'คาร์บอมบ์ / จยย.บอมบ์',
      alertLevel: 'critical' as const,
      details: 'ข้อมูลทดสอบพื้นที่เฝ้าระวังสังเคราะห์',
      reporter: 'ศปก.ทดสอบ',
      createdAt: '2025-03-05T08:00:00Z',
      updatedAt: '2025-03-05T08:00:00Z',
      syncStatus: 'pending' as const,
    };

    const payload = buildWatchAlertGasPayload(sampleWatch, DEFAULT_SETTINGS);
    expect(payload.action).toBe('createOrUpdateWatchAlert');
    expect(payload.watchSheetName).toBe('พื้นที่เฝ้าระวัง_IPB');
    expect(String(payload.areasJson)).toContain('สุไหงโก-ลก');

    const bridge = generateGasReceiverCode(DEFAULT_SETTINGS);
    expect(bridge).toContain('createOrUpdateWatchAlert');
    expect(bridge).toContain('พื้นที่เฝ้าระวัง_IPB');
  });
});

describe('CCTV Destruction Category & Legacy WATCH- Compatibility', () => {
  it('classifies CCTV sabotage accurately without false positives on damage summaries or footage checks', () => {
    expect(DEFAULT_CATEGORIES).toContain(CCTV_DESTRUCTION_CATEGORY);

    expect(
      classifyCategoryFromText(
        'สร้างสถานการณ์ก่อกวนด้วยการเผากล้อง CCTV เสียหาย 3 ตัว',
        DEFAULT_CATEGORIES
      )
    ).toBe(CCTV_DESTRUCTION_CATEGORY);

    expect(
      classifyCategoryFromText(
        'คนร้ายใช้อาวุธปืนยิงทำลายกล้อง CCTV บนเสาไฟฟ้าเสียหาย 1 ตัว',
        DEFAULT_CATEGORIES
      )
    ).toBe(CCTV_DESTRUCTION_CATEGORY);

    expect(
      classifyCategoryFromText(
        'ก่อเหตุยิงและเผาทำลายกล้อง CCTV บริเวณสามแยกถนนสายรอง',
        DEFAULT_CATEGORIES
      )
    ).toBe(CCTV_DESTRUCTION_CATEGORY);

    expect(
      classifyCategoryFromText(
        'คนร้ายลอบทำลายกล้องวงจรปิด (CCTV) หน้าป้อมจุดตรวจ',
        DEFAULT_CATEGORIES
      )
    ).toBe(CCTV_DESTRUCTION_CATEGORY);

    // Anti-false-positive checks
    expect(
      classifyCategoryFromText(
        'เหตุลอบวางระเบิด 2 เหตุการณ์ (ความเสียหายรวม: กล้อง CCTV เสียหาย 2 กล้อง)',
        DEFAULT_CATEGORIES
      )
    ).toBe('ระเบิด');

    expect(
      classifyCategoryFromText(
        'เผาศาลา 1 เหตุการณ์ (ความเสียหายรวม: กล้อง CCTV เสียหาย 2 กล้อง)',
        DEFAULT_CATEGORIES
      )
    ).toBe('วางเพลิง');

    expect(
      classifyCategoryFromText(
        'คนร้ายใช้อาวุธปืนยิงรบกวนจุดตรวจ เจ้าหน้าที่ตรวจสอบภาพวงจรปิดโดยรอบ',
        DEFAULT_CATEGORIES
      )
    ).toBe('ใช้อาวุธปืน/ลอบยิง');

    expect(
      classifyCategoryFromText(
        'ปรากฏข่าวสารความเคลื่อนไหว อาจก่อเหตุเผากล้อง CCTV พื้นที่เฝ้าระวัง อ.ยะรัง จว.ปัตตานี',
        DEFAULT_CATEGORIES
      )
    ).toBe(WATCH_ADVISORY_CATEGORY);

    expect(
      classifyIncidentSeverity(
        CCTV_DESTRUCTION_CATEGORY,
        'เผากล้อง CCTV 2 จุด ไม่มีผู้ได้รับบาดเจ็บ'
      ).level
    ).toBe('medium');
  });

  it('routes fallback WATCH-* rows in ipbRows to watchAlerts and deduplicates legacy pairs', () => {
    const watchDetails =
      'เมื่อ ๕ มี.ค.๖๘ ปรากฏข่าวสารความเคลื่อนไหวเตรียมก่อเหตุ พื้นที่เฝ้าระวัง อ.ยะรัง จว.ปัตตานี ห้วงเฝ้าระวัง ๕ - ๑๖ มี.ค.๖๘';
    const pulled = parsePulledGasResponse(
      {
        ok: true,
        ipbRows: [
          {
            id: 'WATCH-2568-TEST1',
            occurredAt: '',
            category: '',
            province: '',
            district: '',
            details: watchDetails,
            reporter: 'ศปก.ทดสอบ',
            createdAt: '2025-03-05T08:00:00Z',
            legacyRowNumber: 88,
          },
          {
            id: 'INC-2568-CCTV1',
            occurredAt: '2025-03-06T03:00',
            category: '',
            province: 'ปัตตานี',
            district: 'ยะรัง',
            details: 'คนร้ายลอบเผากล้อง CCTV เสียหาย 2 ตัว',
            reporter: 'ศปก.ทดสอบ',
            createdAt: '2025-03-06T03:30:00Z',
          },
        ],
        legacyRows: [
          {
            rowNumber: 88,
            date: '2025-03-05',
            incident_type: DEFAULT_SETTINGS.legacyIncidentType,
            location: watchDetails,
            reporter_name: 'ศปก.ทดสอบ',
            gps: '-',
          },
        ],
      },
      DEFAULT_SETTINGS
    );

    expect(pulled.records).toHaveLength(1);
    expect(pulled.records[0].id).toBe('INC-2568-CCTV1');
    expect(pulled.records[0].category).toBe(CCTV_DESTRUCTION_CATEGORY);
    expect(pulled.watchAlerts).toHaveLength(1);
    expect(pulled.watchAlerts[0].id).toBe('WATCH-2568-TEST1');
    expect(pulled.watchAlerts[0].watchStart).toBe('2025-03-05');
    expect(pulled.watchAlerts[0].areas).toContainEqual({
      province: 'ปัตตานี',
      district: 'ยะรัง',
    });
  });
});
