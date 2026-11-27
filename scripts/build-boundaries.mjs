import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'src', 'data', 'southern_boundaries.json');
const SOURCE_URL =
  'https://raw.githubusercontent.com/chingchai/OpenGISData-Thailand/master/subdistricts.geojson';

const TARGET_PROVINCES = new Set([
  'ตรัง',
  'พัทลุง',
  'สตูล',
  'สงขลา',
  'ปัตตานี',
  'ยะลา',
  'นราธิวาส',
]);

const TOLERANCE_DEG = 0.0008;

function perpDistSq(p, a, b) {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

function simplifyDPStep(points, first, last, sqTol, simplified) {
  let maxSqDist = sqTol;
  let index = -1;
  for (let i = first + 1; i < last; i++) {
    const sqDist = perpDistSq(points[i], points[first], points[last]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }
  if (index > -1) {
    if (index - first > 1) simplifyDPStep(points, first, index, sqTol, simplified);
    simplified.push(points[index]);
    if (last - index > 1) simplifyDPStep(points, index, last, sqTol, simplified);
  }
}

function roundCoord(pt) {
  return [Number(pt[0].toFixed(4)), Number(pt[1].toFixed(4))];
}

function simplifyRing(ring, tolerance) {
  if (!Array.isArray(ring) || ring.length <= 4) {
    return ring.map(roundCoord);
  }
  const sqTol = tolerance * tolerance;
  const open =
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring.slice();

  if (open.length <= 4) {
    const rounded = open.map(roundCoord);
    rounded.push([...rounded[0]]);
    return rounded;
  }

  const mid = Math.floor(open.length / 2);
  const firstHalf = [open[0]];
  simplifyDPStep(open, 0, mid, sqTol, firstHalf);
  firstHalf.push(open[mid]);
  const secondHalf = [];
  simplifyDPStep(open, mid, open.length - 1, sqTol, secondHalf);
  secondHalf.push(open[open.length - 1]);

  let combined = [...firstHalf, ...secondHalf].map(roundCoord);
  // Deduplicate adjacent identical points after rounding
  const deduped = [];
  for (const pt of combined) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev[0] !== pt[0] || prev[1] !== pt[1]) {
      deduped.push(pt);
    }
  }
  if (deduped.length < 3) {
    combined = ring.slice(0, 4).map(roundCoord);
  } else {
    combined = deduped;
  }
  if (
    combined[0][0] !== combined[combined.length - 1][0] ||
    combined[0][1] !== combined[combined.length - 1][1]
  ) {
    combined.push([...combined[0]]);
  }
  return combined;
}

function simplifyGeometry(geom) {
  if (geom.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geom.coordinates.map((ring) => simplifyRing(ring, TOLERANCE_DEG)),
    };
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map((poly) =>
        poly.map((ring) => simplifyRing(ring, TOLERANCE_DEG))
      ),
    };
  }
  throw new Error(`Unsupported geometry type: ${geom.type}`);
}

function computeBBox(geom) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [
    Number(minLng.toFixed(4)),
    Number(minLat.toFixed(4)),
    Number(maxLng.toFixed(4)),
    Number(maxLat.toFixed(4)),
  ];
}

async function main() {
  const existingRaw = await fs.readFile(OUTPUT_PATH, 'utf8');
  const existingEntries = JSON.parse(existingRaw);
  const existingByCode = new Map(existingEntries.map((e) => [String(e.c), e]));

  console.log(`Fetching boundaries from ${SOURCE_URL}...`);
  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching boundaries`);
  }
  const gj = await res.json();

  const entries = [];
  for (const feat of gj.features) {
    const props = feat.properties || {};
    const province = String(props.pro_th || '').trim();
    if (!TARGET_PROVINCES.has(province)) continue;

    const code = String(props.tam_code || '').trim();
    const existing = existingByCode.get(code);

    const p = existing ? existing.p : province;
    const d = existing
      ? existing.d
      : String(props.amp_th || '')
          .replace(/^กิ่งอำเภอ/, '')
          .trim();
    const s = existing ? existing.s : String(props.tam_th || '').trim();

    const g = simplifyGeometry(feat.geometry);
    const b = computeBBox(g);

    entries.push({ p, d, s, c: code, b, g });
  }

  entries.sort((a, b) => a.c.localeCompare(b.c));

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(entries), 'utf8');

  const provinces = new Set(entries.map((e) => e.p));
  const districts = new Set(entries.map((e) => `${e.p}|${e.d}`));
  const stat = await fs.stat(OUTPUT_PATH);
  console.log(
    `Saved ${entries.length} subdistricts across ${districts.size} districts in ${provinces.size} provinces (${(stat.size / 1024).toFixed(1)} KB)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
