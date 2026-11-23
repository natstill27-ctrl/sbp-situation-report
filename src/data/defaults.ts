import type { AppSettings, IncidentRecord } from '../types/incident';
import { buildParsedCoordinate } from '../utils/coordinates';

export const DEFAULT_CATEGORIES: string[] = [
  'ปะทะ/ปิดล้อมตรวจค้น',
  'ใช้อาวุธปืน/ลอบยิง',
  'ระเบิด',
  'วางเพลิง',
  'ตรวจยึด/จับกุม',
  'ก่อกวน/โปรยตะปูเรือใบ-เผายาง',
  'อุบัติเหตุ/ภัยพิบัติ',
  'ข่าวสารความเคลื่อนไหว/เฝ้าระวัง',
  'อื่นๆ',
];

export const DEFAULT_SETTINGS: AppSettings = {
  systemTitle: 'ระบบรายงานสถานการณ์ 3 จังหวัดชายแดนภาคใต้',
  agencyName: 'ศูนย์ข้อมูลสถานการณ์และสถิติเพื่อการวิเคราะห์ IPB (Standalone)',
  agencySubtitle: 'พื้นที่รับผิดชอบ 3 จังหวัดชายแดนภาคใต้ และ 4 อำเภอ จังหวัดสงขลา',
  gasWebhookUrl: '',
  gasFetchUrl: '',
  autoSyncOnSave: true,
  categories: [...DEFAULT_CATEGORIES],
  fieldMapping: {
    id: 'id',
    occurredAt: 'occurredAt',
    occurredAtBE: 'occurredAtBE',
    coordinateRaw: 'coordinateRaw',
    lat: 'lat',
    lng: 'lng',
    mgrs: 'mgrs',
    utm: 'utm',
    province: 'province',
    district: 'district',
    subdistrict: 'subdistrict',
    inTargetArea: 'inTargetArea',
    category: 'category',
    details: 'details',
    reporter: 'reporter',
    createdAt: 'createdAt',
  },
  defaultReporter: '',
  offlinePmtilesUrl: '',
  legacyDualWrite: true,
  legacySheetName: 'ชีต1',
  ipbSheetName: 'สถานการณ์_3_จชต_IPB',
  watchSheetName: 'พื้นที่เฝ้าระวัง_IPB',
  legacyIncidentType: 'สถานการณ์ 3 จชต.',
  legacySendLine: false,
  autoPullOnLoad: true,
};

/**
 * Sample incidents for previewing the IPB Dashboard & Map immediately.
 * Users can load or clear sample records in one click.
 */
export function buildSampleIncidents(): IncidentRecord[] {
  const make = (
    id: string,
    occurredAt: string,
    lat: number,
    lng: number,
    province: string,
    district: string,
    subdistrict: string,
    category: string,
    details: string,
    reporter: string
  ): IncidentRecord => {
    const parsed = buildParsedCoordinate(lat, lng, 'latlng', `${lat}, ${lng}`);
    return {
      id,
      occurredAt,
      coordinateRaw: `${lat}, ${lng}`,
      lat: parsed.lat,
      lng: parsed.lng,
      mgrs: parsed.mgrs,
      utm: parsed.utm,
      province,
      district,
      subdistrict,
      inTargetArea: true,
      category,
      details,
      reporter,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending',
    };
  };

  return [
    make(
      'SAMPLE-2569-001',
      '2026-11-09T09:30',
      6.0462,
      101.2015,
      'ยะลา',
      'ธารโต',
      'แม่หวาด',
      'ปะทะ/ปิดล้อมตรวจค้น',
      'ตัวอย่างข้อมูลทดสอบ: หน่วยปฏิบัติการร่วมเข้าตรวจสอบพื้นที่เป้าหมายบริเวณ ต.แม่หวาด อ.ธารโต จว.ยะลา เกิดการปะทะระยะสั้นก่อนควบคุมสถานการณ์ได้ ไม่มีข้อมูลบุคคลจริง ใช้สำหรับทดสอบการแสดงผลแดชบอร์ด IPB เท่านั้น',
      'ฝ่ายข่าว/ศปก.ตัวอย่าง'
    ),
    make(
      'SAMPLE-2569-002',
      '2026-11-05T14:15',
      6.8675,
      101.2498,
      'ปัตตานี',
      'เมืองปัตตานี',
      'สะบารัง',
      'ก่อกวน/โปรยตะปูเรือใบ-เผายาง',
      'ตัวอย่างข้อมูลทดสอบ: พบการโปรยตะปูเรือใบและเผายางรถยนต์บนเส้นทางสายหลัก เพื่อสร้างสถานการณ์ก่อกวนในพื้นที่ เจ้าหน้าที่เข้าเคลียร์เส้นทางและเปิดการจราจรได้ตามปกติ',
      'ฝ่ายข่าว/ศปก.ตัวอย่าง'
    ),
    make(
      'SAMPLE-2569-003',
      '2026-10-28T07:45',
      6.4258,
      101.8234,
      'นราธิวาส',
      'เมืองนราธิวาส',
      'โคกเคียน',
      'ระเบิด',
      'ตัวอย่างข้อมูลทดสอบ: เกิดเหตุลอบวางระเบิดแสวงเครื่องบริเวณริมถนนสายรอง ระหว่างชุดลาดตระเวนเส้นทางปฏิบัติหน้าที่ ชุด EOD เข้าตรวจสอบและเก็บกู้หลักฐานเพื่อวิเคราะห์จุดเชื่อมโยง',
      'ฝ่ายข่าว/ศปก.ตัวอย่าง'
    ),
    make(
      'SAMPLE-2569-004',
      '2026-10-19T20:10',
      6.7185,
      101.1482,
      'ปัตตานี',
      'โคกโพธิ์',
      'นาประดู่',
      'ใช้อาวุธปืน/ลอบยิง',
      'ตัวอย่างข้อมูลทดสอบ: คนร้ายไม่ทราบจำนวนใช้อาวุธปืนยิงรบกวนจุดตรวจช่วงเวลากลางคืน ไม่มีผู้ได้รับบาดเจ็บ เจ้าหน้าที่เข้าควบคุมพื้นที่และตรวจสอบภาพวงจรปิดโดยรอบ',
      'ฝ่ายข่าว/ศปก.ตัวอย่าง'
    ),
    make(
      'SAMPLE-2569-005',
      '2026-10-12T11:20',
      6.842,
      100.9165,
      'สงขลา',
      'เทพา',
      'เทพา',
      'ตรวจยึด/จับกุม',
      'ตัวอย่างข้อมูลทดสอบ: หน่วยปฏิบัติการร่วมเข้าตรวจสอบพื้นที่เป้าหมายใน อ.เทพา จ.สงขลา สามารถตรวจยึดอุปกรณ์สื่อสารและวัตถุต้องสงสัยเพื่อขยายผลทางนิติวิทยาศาสตร์',
      'ฝ่ายข่าว/ศปก.ตัวอย่าง'
    ),
    make(
      'SAMPLE-2569-006',
      '2026-09-24T16:40',
      6.2155,
      101.7115,
      'นราธิวาส',
      'ระแงะ',
      'ตันหยงมัส',
      'วางเพลิง',
      'ตัวอย่างข้อมูลทดสอบ: เกิดเหตุลอบวางเพลิงเสาส่งสัญญาณสื่อสารในพื้นที่ อ.ระแงะ เจ้าหน้าที่ดับเพลิงและหน่วยความมั่นคงเข้าควบคุมเพลิงและเก็บพยานหลักฐาน',
      'ฝ่ายข่าว/ศปก.ตัวอย่าง'
    ),
  ];
}
