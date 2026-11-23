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
    'จำนวนเหตุการณ์',
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
    r.eventCount && r.eventCount > 0 ? r.eventCount : 1,
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

  const countSuffix =
    record.eventCount && record.eventCount > 1 ? ` (จำนวน ${record.eventCount} เหตุการณ์)` : '';

  return [
    `[รายงานสถานการณ์] ${record.category}${countSuffix}`,
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

  const countPart =
    record.eventCount && record.eventCount > 1 ? ` (จำนวน ${record.eventCount} เหตุการณ์)` : '';

  const body = `เมื่อ ${dt} เกิดเหตุ${record.category}${countPart} บริเวณพื้นที่ ${area || 'ไม่ระบุ'} ${coordPart ? `(${coordPart}) ` : ''}รายละเอียดเบื้องต้น: ${record.details} (ผู้รายงาน: ${record.reporter || '-'})`;
  return useThaiDigits ? toThaiDigits(body) : body;
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function resolveKmlStyleId(category: string): string {
  if (/ปะทะ|ปิดล้อม/.test(category)) return 'clash';
  if (/ปืน|ซุ่มยิง|ลอบยิง/.test(category)) return 'gunfire';
  if (/ระเบิด/.test(category)) return 'ied';
  if (/วางเพลิง/.test(category)) return 'arson';
  if (/ตรวจยึด|จับกุม/.test(category)) return 'seizure';
  if (/ก่อกวน|ตะปู|เผายาง/.test(category)) return 'harassment';
  if (/อุบัติเหตุ|ภัยพิบัติ/.test(category)) return 'disaster';
  return 'other';
}

/**
 * Build Google Earth KML 2.2 XML string for incidents with valid coordinates.
 */
export function buildIncidentsKml(incidents: IncidentRecord[]): string {
  const styles = [
    ['clash', 'https://maps.google.com/mapfiles/kml/paddle/red-stars.png'],
    ['gunfire', 'https://maps.google.com/mapfiles/kml/paddle/red-circle.png'],
    ['ied', 'https://maps.google.com/mapfiles/kml/paddle/purple-circle.png'],
    ['arson', 'https://maps.google.com/mapfiles/kml/paddle/orange-circle.png'],
    ['seizure', 'https://maps.google.com/mapfiles/kml/paddle/blu-circle.png'],
    ['harassment', 'https://maps.google.com/mapfiles/kml/paddle/ylw-circle.png'],
    ['disaster', 'https://maps.google.com/mapfiles/kml/paddle/ltblu-circle.png'],
    ['other', 'https://maps.google.com/mapfiles/kml/paddle/wht-circle.png'],
  ]
    .map(
      ([id, href]) =>
        `  <Style id="${id}"><IconStyle><Icon><href>${href}</href></Icon></IconStyle></Style>`
    )
    .join('\n');

  const placemarks = incidents
    .filter((r) => r.lat !== null && r.lng !== null)
    .map((r) => {
      const area = [
        r.subdistrict ? `ต.${r.subdistrict}` : '',
        r.district ? `อ.${r.district}` : '',
        r.province ? `จว.${r.province}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const dt = formatThaiDateTime(r.occurredAt, { shortMonth: true, thaiDigits: false });
      const count = r.eventCount && r.eventCount > 1 ? r.eventCount : 1;
      const desc = [
        `วัน-เวลา: ${dt}`,
        ...(count > 1 ? [`จำนวนเหตุการณ์: ${count}`] : []),
        `พื้นที่: ${area || 'ไม่ระบุ'}`,
        `พิกัด: ${r.lat}, ${r.lng}`,
        `MGRS: ${r.mgrs || '-'}`,
        `UTM: ${r.utm || '-'}`,
        `รายละเอียด: ${r.details}`,
        `ผู้บันทึก: ${r.reporter || '-'}`,
      ].join('\n');

      return [
        '  <Placemark>',
        `    <name>${escapeXml(r.category)}${count > 1 ? ` (×${count})` : ''}${area ? ` - ${escapeXml(area)}` : ''}</name>`,
        `    <styleUrl>#${resolveKmlStyleId(r.category)}</styleUrl>`,
        `    <description>${escapeXml(desc)}</description>`,
        '    <Point>',
        `      <coordinates>${r.lng},${r.lat},0</coordinates>`,
        '    </Point>',
        '  </Placemark>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '<Document>',
    '  <name>SBP Situation Report Map</name>',
    styles,
    placemarks,
    '</Document>',
    '</kml>',
    '',
  ].join('\n');
}

export function exportIncidentsToKml(
  incidents: IncidentRecord[],
  filenamePrefix = 'sbp-incidents'
): void {
  const kml = buildIncidentsKml(incidents);
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.kml`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function triggerPngBlobDownload(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 'image/png');
}

/**
 * Render an SVG chart element onto a white HiDPI PNG with optional slide title.
 */
export async function exportSvgElementToPng(
  svgEl: SVGSVGElement,
  filename: string,
  title?: string
): Promise<void> {
  const vb = svgEl.viewBox.baseVal;
  const width = vb && vb.width ? vb.width : svgEl.clientWidth || 640;
  const height = vb && vb.height ? vb.height : svgEl.clientHeight || 260;

  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const serialized = new XMLSerializer()
    .serializeToString(clone)
    .replace(/var\(--info\)/g, '#0f4c81')
    .replace(/var\(--text-main\)/g, '#0f172a')
    .replace(/var\(--text-muted\)/g, '#334155');

  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load SVG for PNG export'));
      image.src = svgUrl;
    });

    const scale = 2;
    const padding = 24;
    const titleHeight = title ? 36 : 0;
    const canvas = document.createElement('canvas');
    canvas.width = (width + padding * 2) * scale;
    canvas.height = (height + padding * 2 + titleHeight) * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width + padding * 2, height + padding * 2 + titleHeight);

    if (title) {
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 18px Sarabun, "Noto Sans Thai", Tahoma, sans-serif';
      ctx.fillText(title, padding, padding + 18);
    }

    ctx.drawImage(img, padding, padding + titleHeight, width, height);
    triggerPngBlobDownload(canvas, filename);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/**
 * Draw a slide-ready HiDPI PNG for horizontal bar statistics.
 */
export function exportHorizontalBarsToPng(
  title: string,
  items: Array<{ label: string; value: number; subtitle?: string; color: string }>,
  filename: string
): void {
  const width = 880;
  const padding = 28;
  const headerH = 44;
  const rowH = 46;
  const height = padding * 2 + headerH + Math.max(1, items.length) * rowH;
  const scale = 2;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#0f172a';
  ctx.font = '700 20px Sarabun, "Noto Sans Thai", Tahoma, sans-serif';
  ctx.fillText(title, padding, padding + 20);

  const maxVal = Math.max(1, ...items.map((item) => item.value));
  const barWidth = width - padding * 2;

  items.forEach((item, idx) => {
    const y = padding + headerH + idx * rowH;
    ctx.fillStyle = '#0f172a';
    ctx.font = '600 15px Sarabun, "Noto Sans Thai", Tahoma, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(item.label, padding, y + 14);

    ctx.font = '700 15px Sarabun, "Noto Sans Thai", Tahoma, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(item.subtitle || String(item.value), width - padding, y + 14);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(padding, y + 22, barWidth, 12);

    const fillW = item.value > 0 ? Math.max(8, (item.value / maxVal) * barWidth) : 0;
    ctx.fillStyle = item.color || '#0f4c81';
    ctx.fillRect(padding, y + 22, fillW, 12);
  });

  triggerPngBlobDownload(canvas, filename);
}
