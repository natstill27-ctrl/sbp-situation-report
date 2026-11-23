import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, buildSampleIncidents } from '../../data/defaults';
import { decodeConfigHash, encodeConfigHash } from '../configShare';
import { latLngToUtmString, parseCoordinateInput } from '../coordinates';
import { buildIncidentsKml, formatIncidentForPaper } from '../exportUtils';
import { buildGasPayload, generateGasReceiverCode, parsePulledGasResponse } from '../gasSync';
import { lookupAreaByLatLng, matchAreaByThaiNames } from '../geoLookup';
import { extractPaperMetadata, formatThaiDateTime, fromThaiDigits, toThaiDigits } from '../thaiDate';

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
