import * as mgrsLib from 'mgrs';
import type { CoordinateFormat, ParsedCoordinate } from '../types/incident';
import { fromThaiDigits } from './thaiDateFormat';

// WGS84 ellipsoid constants for exact UTM <-> Lat/Lng conversions (Zone 47N / 48N for Thailand)
const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);
const UTM_K0 = 0.9996;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Convert WGS84 Lat/Lng to UTM string (e.g. "47N 748512 671234"). */
export function latLngToUtmString(lat: number, lng: number): string {
  const zone = Math.floor((lng + 180) / 6) + 1;
  const band = lat >= 0 ? 'N' : 'S';
  const lon0 = degToRad((zone - 1) * 6 - 180 + 3);
  const phi = degToRad(lat);
  const lam = degToRad(lng);

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const t = tanPhi * tanPhi;
  const c = WGS84_EP2 * cosPhi * cosPhi;
  const aTerm = cosPhi * (lam - lon0);

  const e4 = WGS84_E2 * WGS84_E2;
  const e6 = e4 * WGS84_E2;
  const m =
    WGS84_A *
    ((1 - WGS84_E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * WGS84_E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi));

  const easting =
    UTM_K0 *
      n *
      (aTerm +
        ((1 - t + c) * Math.pow(aTerm, 3)) / 6 +
        ((5 - 18 * t + t * t + 72 * c - 58 * WGS84_EP2) * Math.pow(aTerm, 5)) / 120) +
    500000;

  let northing =
    UTM_K0 *
    (m +
      n *
        tanPhi *
        ((aTerm * aTerm) / 2 +
          ((5 - t + 9 * c + 4 * c * c) * Math.pow(aTerm, 4)) / 24 +
          ((61 - 58 * t + t * t + 600 * c - 330 * WGS84_EP2) * Math.pow(aTerm, 6)) / 720));

  if (lat < 0) {
    northing += 10000000;
  }

  return `${zone}${band} ${Math.round(easting)} ${Math.round(northing)}`;
}

/** Convert UTM (zone, hemisphere N/S or MGRS latitude band, easting, northing) to WGS84 Lat/Lng. */
export function utmToLatLng(
  zone: number,
  hemisphereOrBand: string,
  easting: number,
  northing: number
): { lat: number; lng: number } | null {
  if (zone < 1 || zone > 60 || easting < 100000 || easting > 999999 || northing < 0 || northing > 10000000) {
    return null;
  }
  const upperBand = hemisphereOrBand.toUpperCase();
  // In MGRS/Thai military convention, Thailand spans N (equator) and P (8-16°N), both in Northern Hemisphere!
  const isSouthern = upperBand === 'S' && northing > 5000000 ? false : upperBand < 'N';
  const y = isSouthern ? northing - 10000000 : northing;
  const x = easting - 500000;

  const e1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2));
  const m = y / UTM_K0;
  const mu = m / (WGS84_A * (1 - WGS84_E2 / 4 - (3 * WGS84_E2 * WGS84_E2) / 64 - (5 * Math.pow(WGS84_E2, 3)) / 256));

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu) +
    ((151 * Math.pow(e1, 3)) / 96) * Math.sin(6 * mu) +
    ((1097 * Math.pow(e1, 4)) / 512) * Math.sin(8 * mu);

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);

  const c1 = WGS84_EP2 * cos1 * cos1;
  const t1 = tan1 * tan1;
  const n1 = WGS84_A / Math.sqrt(1 - WGS84_E2 * sin1 * sin1);
  const r1 = (WGS84_A * (1 - WGS84_E2)) / Math.pow(1 - WGS84_E2 * sin1 * sin1, 1.5);
  const d = x / (n1 * UTM_K0);

  const latRad =
    phi1 -
    ((n1 * tan1) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * WGS84_EP2) * Math.pow(d, 4)) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * WGS84_EP2 - 3 * c1 * c1) * Math.pow(d, 6)) / 720);

  const lon0 = degToRad((zone - 1) * 6 - 180 + 3);
  const lngRad =
    lon0 +
    (d -
      ((1 + 2 * t1 + c1) * Math.pow(d, 3)) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * WGS84_EP2 + 24 * t1 * t1) * Math.pow(d, 5)) / 120) /
      cos1;

  const lat = radToDeg(latRad);
  const lng = radToDeg(lngRad);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

/** Format Lat/Lng to spaced readable MGRS string e.g. "47N QH 48512 71234". */
export function latLngToMgrsString(lat: number, lng: number): string {
  try {
    const raw = mgrsLib.forward([lng, lat], 5);
    const match = raw.match(/^(\d{1,2}[A-Z])([A-Z]{2})(\d{5})(\d{5})$/);
    if (match) {
      return `${match[1]} ${match[2]} ${match[3]} ${match[4]}`;
    }
    return raw;
  } catch {
    return '-';
  }
}

export function buildParsedCoordinate(
  lat: number,
  lng: number,
  format: CoordinateFormat,
  rawMatched: string
): ParsedCoordinate {
  const fixedLat = Number(lat.toFixed(6));
  const fixedLng = Number(lng.toFixed(6));
  return {
    lat: fixedLat,
    lng: fixedLng,
    format,
    mgrs: latLngToMgrsString(fixedLat, fixedLng),
    utm: latLngToUtmString(fixedLat, fixedLng),
    rawMatched,
  };
}

function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Normalize potential swapped lng,lat in Thailand (Lat ~4..22, Lng ~97..106). */
function normalizeThailandPair(a: number, b: number): { lat: number; lng: number } | null {
  if (a >= 97 && a <= 106 && b >= 4 && b <= 22) {
    return { lat: b, lng: a };
  }
  if (a >= -90 && a <= 90 && b >= -180 && b <= 180) {
    return { lat: a, lng: b };
  }
  return null;
}

/**
 * Auto-detect and parse coordinates from either a coordinate input or an entire pasted report text.
 * Supports: Google Maps URL, MGRS, UTM, DMS, and Decimal Degrees (Lat, Lng).
 */
export function parseCoordinateInput(input: string): ParsedCoordinate | null {
  if (!input || !input.trim()) return null;
  const text = fromThaiDigits(input).trim();

  // 1. Google Maps / Map URL patterns (!3dLAT!4dLNG, @LAT,LNG, ?q=LAT,LNG, ll=LAT,LNG)
  const gmapsBang = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (gmapsBang) {
    const lat = Number(gmapsBang[1]);
    const lng = Number(gmapsBang[2]);
    if (isValidLatLng(lat, lng)) {
      return buildParsedCoordinate(lat, lng, 'google-maps-url', gmapsBang[0]);
    }
  }

  const gmapsUrlParam = text.match(/(?:[?&](?:q|ll|query|center)=|@)(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
  if (gmapsUrlParam && /https?:\/\/|maps\.|goo\.gl|google\./i.test(text)) {
    const lat = Number(gmapsUrlParam[1]);
    const lng = Number(gmapsUrlParam[2]);
    if (isValidLatLng(lat, lng)) {
      return buildParsedCoordinate(lat, lng, 'google-maps-url', gmapsUrlParam[0]);
    }
  }

  // 2. MGRS patterns: e.g. "47N QH 12345 67890", "47NPH1234567890", "47P AA 1234 5678"
  const mgrsRegex = /\b(\d{1,2}\s*[C-HJ-NP-X])\s*([A-HJ-NP-Z]{2})\s*(\d{2,5})\s*(\d{2,5})\b/i;
  const mgrsCompactRegex = /\b(\d{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}(?:\d{4}|\d{6}|\d{8}|\d{10}))\b/i;

  const mMatch = text.match(mgrsRegex) || text.match(mgrsCompactRegex);
  if (mMatch) {
    const compact =
      mMatch.length >= 5
        ? `${mMatch[1].replace(/\s+/g, '')}${mMatch[2]}${mMatch[3]}${mMatch[4]}`.toUpperCase()
        : mMatch[1].replace(/\s+/g, '').toUpperCase();
    try {
      const [lng, lat] = mgrsLib.toPoint(compact);
      if (isValidLatLng(lat, lng)) {
        return buildParsedCoordinate(lat, lng, 'mgrs', mMatch[0]);
      }
    } catch {
      // Fall through to other formats
    }
  }

  // 3. UTM patterns: e.g. "47N 748512 759831", "UTM 47N E 748512 N 759831", "47P 748512E 759831N"
  const utmRegex =
    /(?:UTM\s*)?\b(4[6-9]|50|[1-5]?\d)\s*([NSPQR])\s*[,:\s]*E?\s*(\d{6}(?:\.\d+)?)\s*E?\s*[,;\s]+\s*N?\s*(\d{6,7}(?:\.\d+)?)\s*N?\b/i;
  const utmMatch = text.match(utmRegex);
  if (utmMatch) {
    const zone = Number(utmMatch[1]);
    const band = utmMatch[2];
    const easting = Number(utmMatch[3]);
    const northing = Number(utmMatch[4]);
    const converted = utmToLatLng(zone, band, easting, northing);
    if (converted && isValidLatLng(converted.lat, converted.lng)) {
      return buildParsedCoordinate(converted.lat, converted.lng, 'utm', utmMatch[0]);
    }
  }

  // 4. DMS patterns: e.g. 6°52'08.8"N 101°15'01.6"E or N 6°52'08.8" E 101°15'01.6"
  const dmsSingle =
    /(?:([NS])\s*)?(\d{1,3})\s*[°º]\s*(\d{1,2})\s*[′']\s*(\d{1,2}(?:\.\d+)?)\s*[″"]?\s*([NS])?[\s,;]+(?:([EW])\s*)?(\d{1,3})\s*[°º]\s*(\d{1,2})\s*[′']\s*(\d{1,2}(?:\.\d+)?)\s*[″"]?\s*([EW])?/i;
  const dmsMatch = text.match(dmsSingle);
  if (dmsMatch) {
    const latHem = (dmsMatch[1] || dmsMatch[5] || 'N').toUpperCase();
    const lngHem = (dmsMatch[6] || dmsMatch[10] || 'E').toUpperCase();
    const latDec =
      Number(dmsMatch[2]) + Number(dmsMatch[3]) / 60 + Number(dmsMatch[4]) / 3600;
    const lngDec =
      Number(dmsMatch[7]) + Number(dmsMatch[8]) / 60 + Number(dmsMatch[9]) / 3600;
    const lat = latHem === 'S' ? -latDec : latDec;
    const lng = lngHem === 'W' ? -lngDec : lngDec;
    if (isValidLatLng(lat, lng)) {
      return buildParsedCoordinate(lat, lng, 'dms', dmsMatch[0]);
    }
  }

  // 5. Decimal Degrees: e.g. "6.869123, 101.250456" or "6.8691 101.2504"
  const ddLabeled = text.match(
    /(?:lat(?:itude)?|ละติจูด)\s*[:=]?\s*(-?\d{1,3}\.\d+)\s*[,;\s]+(?:lng|lon(?:gitude)?|ลองจิจูด)\s*[:=]?\s*(-?\d{1,3}\.\d+)/i
  );
  if (ddLabeled) {
    const lat = Number(ddLabeled[1]);
    const lng = Number(ddLabeled[2]);
    if (isValidLatLng(lat, lng)) {
      return buildParsedCoordinate(lat, lng, 'latlng', ddLabeled[0]);
    }
  }

  const ddPlain = text.match(/(-?\d{1,3}\.\d{3,})\s*[,;\s/]+\s*(-?\d{1,3}\.\d{3,})/);
  if (ddPlain) {
    const pair = normalizeThailandPair(Number(ddPlain[1]), Number(ddPlain[2]));
    if (pair && isValidLatLng(pair.lat, pair.lng)) {
      return buildParsedCoordinate(pair.lat, pair.lng, 'latlng', ddPlain[0]);
    }
  }

  return null;
}
