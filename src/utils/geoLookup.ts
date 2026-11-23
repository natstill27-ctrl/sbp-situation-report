import rawBoundaries from '../data/southern_boundaries.json';
import type { AreaMatch, WatchAreaTarget } from '../types/incident';

export interface BoundaryGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export interface BoundaryEntry {
  p: string; // province
  d: string; // district
  s: string; // subdistrict
  c: string; // DOPA subdistrict code
  b: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  g: BoundaryGeometry;
}

const BOUNDARIES = rawBoundaries as BoundaryEntry[];

const PROVINCE_ORDER = ['ปัตตานี', 'ยะลา', 'นราธิวาส', 'สงขลา'];

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, rings: number[][][]): boolean {
  if (!rings.length || !pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lng, lat, rings[i])) return false;
  }
  return true;
}

function pointInGeometry(lng: number, lat: number, geom: BoundaryGeometry): boolean {
  if (geom.type === 'Polygon') {
    return pointInPolygon(lng, lat, geom.coordinates as number[][][]);
  }
  const polys = geom.coordinates as number[][][][];
  for (const poly of polys) {
    if (pointInPolygon(lng, lat, poly)) return true;
  }
  return false;
}

/**
 * Look up Province / District / Subdistrict offline across the 3 Southern Border Provinces
 * + 4 Songkhla security districts (290 subdistricts total).
 */
export function lookupAreaByLatLng(lat: number, lng: number): AreaMatch {
  // 1. Exact point-in-polygon match via bounding-box prefilter
  for (const entry of BOUNDARIES) {
    const [minLng, minLat, maxLng, maxLat] = entry.b;
    if (lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat) {
      if (pointInGeometry(lng, lat, entry.g)) {
        return {
          province: entry.p,
          district: entry.d,
          subdistrict: entry.s,
          code: entry.c,
          inTargetArea: true,
          source: 'local-boundary',
        };
      }
    }
  }

  // 2. Tolerance fallback (~1 km buffer) for points slightly smoothed by boundary simplification
  const bufferDeg = 0.01;
  let bestEntry: BoundaryEntry | null = null;
  let bestDistSq = Infinity;
  for (const entry of BOUNDARIES) {
    const [minLng, minLat, maxLng, maxLat] = entry.b;
    if (
      lng >= minLng - bufferDeg &&
      lng <= maxLng + bufferDeg &&
      lat >= minLat - bufferDeg &&
      lat <= maxLat + bufferDeg
    ) {
      const cLng = (minLng + maxLng) / 2;
      const cLat = (minLat + maxLat) / 2;
      const distSq = (lng - cLng) ** 2 + (lat - cLat) ** 2;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestEntry = entry;
      }
    }
  }

  if (bestEntry && bestDistSq < 0.015) {
    return {
      province: bestEntry.p,
      district: bestEntry.d,
      subdistrict: bestEntry.s,
      code: bestEntry.c,
      inTargetArea: true,
      source: 'local-boundary',
    };
  }

  return {
    province: '',
    district: '',
    subdistrict: '',
    code: '',
    inTargetArea: false,
    source: 'outside',
  };
}

export function getTargetProvinces(): string[] {
  return [...PROVINCE_ORDER];
}

export function getDistrictsByProvince(province: string): string[] {
  const set = new Set<string>();
  for (const entry of BOUNDARIES) {
    if (!province || entry.p === province) {
      set.add(entry.d);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
}

export function getSubdistrictsByDistrict(province: string, district: string): string[] {
  const set = new Set<string>();
  for (const entry of BOUNDARIES) {
    if ((!province || entry.p === province) && (!district || entry.d === district)) {
      set.add(entry.s);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
}

export function getCenterOfArea(
  province: string,
  district?: string,
  subdistrict?: string
): { lat: number; lng: number } | null {
  const normDistrict = district ? district.replace(/-/g, '') : '';
  let matches = BOUNDARIES.filter(
    (e) =>
      e.p === province &&
      (!district || e.d === district || e.d.replace(/-/g, '') === normDistrict) &&
      (!subdistrict || e.s === subdistrict)
  );
  if (!matches.length && subdistrict) {
    matches = BOUNDARIES.filter(
      (e) =>
        e.p === province &&
        (!district || e.d === district || e.d.replace(/-/g, '') === normDistrict)
    );
  }
  if (!matches.length) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const m of matches) {
    minLng = Math.min(minLng, m.b[0]);
    minLat = Math.min(minLat, m.b[1]);
    maxLng = Math.max(maxLng, m.b[2]);
    maxLat = Math.max(maxLat, m.b[3]);
  }
  return {
    lat: Number(((minLat + maxLat) / 2).toFixed(6)),
    lng: Number(((minLng + maxLng) / 2).toFixed(6)),
  };
}

function normalizeAreaToken(value?: string): string {
  return (value || '')
    .replace(/^(จว\.|จ\.|จังหวัด|อ\.|อำเภอ|อ,|ต\.|ตำบล)\s*/, '')
    .replace(/ฯ+$/, '')
    .trim();
}

function resolveDistrictAlias(district: string, province: string): string {
  const compact = district.replace(/\s*-\s*/g, '');
  if (compact === 'สุไหงโกลก' || compact === 'โกลก') return 'สุไหงโก-ลก';
  if (compact === 'สุคีริน') return 'สุคิริน';
  if ((compact === 'เมือง' || district === 'เมือง') && province) {
    return `เมือง${province}`;
  }
  return district;
}

export function matchAreaByThaiNames(
  provinceHint?: string,
  districtHint?: string,
  subdistrictHint?: string
): AreaMatch | null {
  const rawProv = normalizeAreaToken(provinceHint);
  const provMap: Record<string, string> = {
    'นธ.': 'นราธิวาส',
    นธ: 'นราธิวาส',
    'ปน.': 'ปัตตานี',
    ปน: 'ปัตตานี',
    'ยล.': 'ยะลา',
    ยล: 'ยะลา',
    'สข.': 'สงขลา',
    สข: 'สงขลา',
  };
  const p = provMap[rawProv] || rawProv;
  const rawDist = normalizeAreaToken(districtHint);
  const d = resolveDistrictAlias(rawDist, p);
  const s = normalizeAreaToken(subdistrictHint);

  if (!p && !d && !s) return null;

  const exact = BOUNDARIES.find(
    (e) =>
      (!p || e.p === p) &&
      (!d || e.d === d || e.d.replace(/-/g, '') === d.replace(/-/g, '')) &&
      (!s || e.s === s)
  );
  if (exact) {
    return {
      province: exact.p,
      district: d || s ? exact.d : '',
      subdistrict: s ? exact.s : '',
      code: s ? exact.c : '',
      inTargetArea: true,
      source: 'text-extracted',
    };
  }
  return null;
}

/**
 * Build GeoJSON FeatureCollection of all boundary polygons matching a list of watch target areas.
 */
export function getWatchZonePolygonsGeoJson(areas: WatchAreaTarget[]): {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: { province: string; district: string; subdistrict: string; code: string };
    geometry: BoundaryGeometry;
  }>;
} {
  if (!areas.length) {
    return { type: 'FeatureCollection', features: [] };
  }

  const seenCodes = new Set<string>();
  const features: Array<{
    type: 'Feature';
    properties: { province: string; district: string; subdistrict: string; code: string };
    geometry: BoundaryGeometry;
  }> = [];

  for (const area of areas) {
    const p = normalizeAreaToken(area.province);
    const d = resolveDistrictAlias(normalizeAreaToken(area.district), p);
    const s = normalizeAreaToken(area.subdistrict);
    if (!p && !d) continue;

    for (const entry of BOUNDARIES) {
      if (seenCodes.has(entry.c)) continue;
      const provOk = !p || entry.p === p;
      const distOk =
        !d || entry.d === d || entry.d.replace(/-/g, '') === d.replace(/-/g, '');
      const subOk = !s || entry.s === s;
      if (provOk && distOk && subOk) {
        seenCodes.add(entry.c);
        features.push({
          type: 'Feature',
          properties: {
            province: entry.p,
            district: entry.d,
            subdistrict: entry.s,
            code: entry.c,
          },
          geometry: entry.g,
        });
      }
    }
  }

  return { type: 'FeatureCollection', features };
}

export function getDistrictBoundariesGeoJson(): {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: { province: string; district: string; subdistrict: string; code: string };
    geometry: BoundaryGeometry;
  }>;
} {
  return {
    type: 'FeatureCollection',
    features: BOUNDARIES.map((e) => ({
      type: 'Feature',
      properties: {
        province: e.p,
        district: e.d,
        subdistrict: e.s,
        code: e.c,
      },
      geometry: e.g,
    })),
  };
}

export function getBoundaryCountSummary(): { districts: number; subdistricts: number } {
  const districts = new Set(BOUNDARIES.map((e) => `${e.p}-${e.d}`)).size;
  return { districts, subdistricts: BOUNDARIES.length };
}
