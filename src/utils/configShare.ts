import type { AppSettings } from '../types/incident';

interface CompactConfigPayload {
  w?: string; // gasWebhookUrl
  f?: string; // gasFetchUrl
  i?: string; // ipbSheetName
  l?: string; // legacySheetName
  t?: string; // legacyIncidentType
  d?: boolean; // legacyDualWrite
  a?: boolean; // autoPullOnLoad
  s?: string; // systemTitle
  n?: string; // agencyName
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function isSafeHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/[^\s]+$/i.test(value.trim());
}

/**
 * Encode shareable department configuration into a client-only URL hash (`#config=...`).
 */
export function encodeConfigHash(settings: AppSettings, baseUrl?: string): string {
  const payload: CompactConfigPayload = {
    w: settings.gasWebhookUrl.trim(),
    f: settings.gasFetchUrl.trim(),
    i: settings.ipbSheetName.trim(),
    l: settings.legacySheetName.trim(),
    t: settings.legacyIncidentType.trim(),
    d: settings.legacyDualWrite,
    a: settings.autoPullOnLoad,
    s: settings.systemTitle.trim(),
    n: settings.agencyName.trim(),
  };

  const base =
    baseUrl ??
    (typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : '');
  return `${base}#config=${toBase64Url(JSON.stringify(payload))}`;
}

/**
 * Decode and validate a `#config=...` URL fragment. Returns null on invalid or unsafe URLs.
 */
export function decodeConfigHash(hash: string): Partial<AppSettings> | null {
  if (!hash) return null;
  const match = hash.match(/config=([A-Za-z0-9\-_]+)/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(match[1])) as CompactConfigPayload;
    if (!parsed || typeof parsed !== 'object') return null;

    if (parsed.w && !isSafeHttpsUrl(parsed.w)) return null;
    if (parsed.f && !isSafeHttpsUrl(parsed.f)) return null;

    const result: Partial<AppSettings> = {};
    if (typeof parsed.w === 'string') result.gasWebhookUrl = parsed.w.trim();
    if (typeof parsed.f === 'string') result.gasFetchUrl = parsed.f.trim();
    if (typeof parsed.i === 'string' && parsed.i.trim()) result.ipbSheetName = parsed.i.trim();
    if (typeof parsed.l === 'string' && parsed.l.trim()) result.legacySheetName = parsed.l.trim();
    if (typeof parsed.t === 'string' && parsed.t.trim()) result.legacyIncidentType = parsed.t.trim();
    if (typeof parsed.d === 'boolean') result.legacyDualWrite = parsed.d;
    if (typeof parsed.a === 'boolean') result.autoPullOnLoad = parsed.a;
    if (typeof parsed.s === 'string' && parsed.s.trim()) result.systemTitle = parsed.s.trim();
    if (typeof parsed.n === 'string' && parsed.n.trim()) result.agencyName = parsed.n.trim();

    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}
