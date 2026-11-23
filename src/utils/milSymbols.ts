import ms from 'milsymbol';

export interface MilSymbolSpec {
  sidc: string;
  label: string;
}

export interface MilSymbolIconSpec {
  html: string;
  iconSize: [number, number];
  iconAnchor: [number, number];
  popupAnchor: [number, number];
}

/**
 * Maps Thai IPB incident categories to MIL-STD-2525C / APP-6B SIDCs.
 */
const CATEGORY_SIDC_MAP: Record<string, MilSymbolSpec> = {
  'ปะทะ/ปิดล้อมตรวจค้น': { sidc: 'SHGPUCI---****X', label: 'Combat / Clashes' },
  'ใช้อาวุธปืน/ลอบยิง': { sidc: 'SHGPUS----****X', label: 'Small Arms / Ambush' },
  'ระเบิด': { sidc: 'SHGPUCE---****X', label: 'IED / Explosive Event' },
  'วางเพลิง': { sidc: 'SHGPE-----****X', label: 'Arson / Sabotage' },
  'ตรวจยึด/จับกุม': { sidc: 'SFGPUCI---****X', label: 'Friendly Seizure / Arrest' },
  'ก่อกวน/โปรยตะปูเรือใบ-เผายาง': { sidc: 'SHGPI-----****X', label: 'Harassment / Road Disruption' },
  'อุบัติเหตุ/ภัยพิบัติ': { sidc: 'SNGPE-----****X', label: 'Accident / Disaster' },
  'อื่นๆ': { sidc: 'SUGPU-----****X', label: 'Other / Unspecified' },
};

const DEFAULT_SPEC: MilSymbolSpec = {
  sidc: 'SUGPU-----****X',
  label: 'General Incident',
};

export function getMilSymbolSpec(category: string): MilSymbolSpec {
  const clean = (category || '').trim();
  return CATEGORY_SIDC_MAP[clean] || DEFAULT_SPEC;
}

export function renderMilSymbolSvg(category: string, size = 26): string {
  const spec = getMilSymbolSpec(category);
  const symbol = new ms.Symbol(spec.sidc, {
    size,
    strokeWidth: 4,
    outlineWidth: 2,
    outlineColor: '#ffffff',
  });
  return symbol.asSVG();
}

export function getMilSymbolIconOptions(
  category: string,
  selected = false
): MilSymbolIconSpec {
  const spec = getMilSymbolSpec(category);
  const symbol = new ms.Symbol(spec.sidc, {
    size: selected ? 32 : 24,
    strokeWidth: 4,
    outlineWidth: selected ? 4 : 2,
    outlineColor: selected ? '#facc15' : '#ffffff',
  });
  const anchor = symbol.getAnchor();
  const sz = symbol.getSize();
  return {
    html: symbol.asSVG(),
    iconSize: [sz.width, sz.height],
    iconAnchor: [anchor.x, anchor.y],
    popupAnchor: [0, -Math.max(12, anchor.y)],
  };
}
