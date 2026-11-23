import type { IncidentRecord } from '../types/incident';
import { formatThaiDateTime, formatThaiNumericDate, toThaiDigits } from './thaiDate';

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function triggerCsvDownload(filename: string, csvBody: string): void {
  const bom = '\uFEFF'; // UTF-8 BOM so Microsoft Excel reads Thai text cleanly
  const blob = new Blob([bom + csvBody], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Export incidents list to UTF-8 BOM CSV for Excel / IPB analysis. */
export function exportIncidentsToCsv(incidents: IncidentRecord[], filenamePrefix = 'situation-report'): void {
  const headers = [
    'รหัสเหตุการณ์',
    'วัน-เวลาเกิดเหตุ (พ.ศ.)',
    'วัน-เวลาเกิดเหตุ (ISO)',
    'ประเภทเหตุการณ์',
    'จังหวัด',
    'อำเภอ',
    'ตำบล',
    'พื้นที่รับผิดชอบ',
    'ละติจูด (Lat)',
    'ลองจิจูด (Lng)',
    'พิกัด MGRS',
    'พิกัด UTM',
    'พิกัดที่กรอก',
    'รายละเอียดเหตุการณ์',
    'ผู้บันทึกเหตุการณ์',
    'สถานะซิงก์ระบบเดิม',
  ];

  const rows = incidents.map((r) => [
    r.id,
    formatThaiNumericDate(r.occurredAt),
    r.occurredAt,
    r.category,
    r.province || '-',
    r.district || '-',
    r.subdistrict || '-',
    r.inTargetArea ? 'ในพื้นที่ 3 จว.+4 อ.สงขลา' : 'นอกเขตพื้นที่หลัก',
    r.lat ?? '',
    r.lng ?? '',
    r.mgrs,
    r.utm,
    r.coordinateRaw,
    r.details,
    r.reporter,
    r.syncStatus === 'synced' ? 'ส่งแล้ว' : r.syncStatus === 'pending' ? 'รอส่ง' : 'ส่งไม่สำเร็จ',
  ]);

  const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  const today = new Date().toISOString().slice(0, 10);
  triggerCsvDownload(`${filenamePrefix}-${today}.csv`, csv);
}

/** Export IPB Area × Category Matrix to CSV for PowerPoint / Paper reference. */
export function exportIpbMatrixToCsv(
  matrixRows: Array<{ area: string; counts: Record<string, number>; total: number }>,
  categories: string[]
): void {
  const headers = ['พื้นที่', ...categories, 'รวมทั้งหมด'];
  const rows = matrixRows.map((r) => [
    r.area,
    ...categories.map((c) => r.counts[c] || 0),
    r.total,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  const today = new Date().toISOString().slice(0, 10);
  triggerCsvDownload(`ipb-matrix-${today}.csv`, csv);
}

/** Format incident as concise Thai LINE/chat report text. */
export function formatIncidentForLine(record: IncidentRecord): string {
  const dt = formatThaiDateTime(record.occurredAt, { shortMonth: true, thaiDigits: false });
  const area = [
    record.subdistrict ? `ต.${record.subdistrict}` : '',
    record.district ? `อ.${record.district}` : '',
    record.province ? `จว.${record.province}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const coordLine =
    record.lat !== null && record.lng !== null
      ? `พิกัด: ${record.lat}, ${record.lng} (MGRS: ${record.mgrs})\nแผนที่: https://maps.google.com/?q=${record.lat},${record.lng}`
      : `พิกัด: ${record.coordinateRaw || '-'}`;

  return [
    `[รายงานสถานการณ์] ${record.category}`,
    `วัน-เวลา: ${dt}`,
    `พื้นที่: ${area || 'ไม่ระบุ'}`,
    coordLine,
    `รายละเอียด: ${record.details}`,
    `ผู้บันทึก: ${record.reporter || '-'}`,
  ].join('\n');
}

/** Format incident in formal Thai command Paper style (supports Thai numerals ๐-๙). */
export function formatIncidentForPaper(record: IncidentRecord, useThaiDigits = true): string {
  const dt = formatThaiDateTime(record.occurredAt, { shortMonth: true, thaiDigits: false });
  const area = [
    record.subdistrict ? `ต.${record.subdistrict}` : '',
    record.district ? `อ.${record.district}` : '',
    record.province ? `จว.${record.province}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const coordPart =
    record.mgrs && record.mgrs !== '-'
      ? `พิกัด ${record.mgrs}`
      : record.lat !== null && record.lng !== null
        ? `พิกัด ${record.lat}, ${record.lng}`
        : '';

  const body = `เมื่อ ${dt} เกิดเหตุ${record.category} บริเวณพื้นที่ ${area || 'ไม่ระบุ'} ${coordPart ? `(${coordPart}) ` : ''}รายละเอียดเบื้องต้น: ${record.details} (ผู้รายงาน: ${record.reporter || '-'})`;
  return useThaiDigits ? toThaiDigits(body) : body;
}
