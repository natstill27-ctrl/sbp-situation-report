import { DEFAULT_SETTINGS } from '../data/defaults';
import type { AppSettings, IncidentRecord, WatchAlertRecord } from '../types/incident';

const DB_NAME = 'sbp_intelligence_report_db';
const DB_VERSION = 2;
const STORE_INCIDENTS = 'incidents';
const STORE_SETTINGS = 'settings';
const STORE_WATCH_ALERTS = 'watch_alerts';
const LS_INCIDENTS_KEY = 'sbp_incidents_fallback_v1';
const LS_SETTINGS_KEY = 'sbp_settings_fallback_v1';
const LS_WATCH_ALERTS_KEY = 'sbp_watch_alerts_fallback_v1';
const CCTV_CATEGORY_LABEL = 'ทำลายกล้อง CCTV';
const WATCH_CATEGORY_LABEL = 'ข่าวสารความเคลื่อนไหว/เฝ้าระวัง';

function ensureBuiltinCategories(categories?: string[]): string[] {
  const base = categories?.length ? [...categories] : [...DEFAULT_SETTINGS.categories];
  if (!base.includes(CCTV_CATEGORY_LABEL)) {
    const insertBefore = ['อุบัติเหตุ/ภัยพิบัติ', WATCH_CATEGORY_LABEL, 'อื่นๆ']
      .map((label) => base.indexOf(label))
      .find((idx) => idx >= 0);
    if (insertBefore !== undefined) {
      base.splice(insertBefore, 0, CCTV_CATEGORY_LABEL);
    } else {
      base.push(CCTV_CATEGORY_LABEL);
    }
  }
  if (!base.includes(WATCH_CATEGORY_LABEL)) {
    const otherIdx = base.indexOf('อื่นๆ');
    if (otherIdx >= 0) {
      base.splice(otherIdx, 0, WATCH_CATEGORY_LABEL);
    } else {
      base.push(WATCH_CATEGORY_LABEL);
    }
  }
  return base;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_INCIDENTS)) {
        db.createObjectStore(STORE_INCIDENTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_WATCH_ALERTS)) {
        db.createObjectStore(STORE_WATCH_ALERTS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

function sortIncidentsDesc(items: IncidentRecord[]): IncidentRecord[] {
  return [...items].sort((a, b) => {
    const tA = new Date(a.occurredAt || a.createdAt).getTime();
    const tB = new Date(b.occurredAt || b.createdAt).getTime();
    return tB - tA;
  });
}

function sortWatchAlertsDesc(items: WatchAlertRecord[]): WatchAlertRecord[] {
  return [...items].sort((a, b) => {
    const tA = new Date(a.watchStart || a.reportedAt || a.createdAt).getTime();
    const tB = new Date(b.watchStart || b.reportedAt || b.createdAt).getTime();
    return tB - tA;
  });
}

export async function loadIncidents(): Promise<IncidentRecord[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readonly');
      const store = tx.objectStore(STORE_INCIDENTS);
      const req = store.getAll();
      req.onsuccess = () => resolve(sortIncidentsDesc((req.result as IncidentRecord[]) || []));
      req.onerror = () => reject(req.error);
    });
  } catch {
    try {
      const raw = localStorage.getItem(LS_INCIDENTS_KEY);
      return raw ? sortIncidentsDesc(JSON.parse(raw) as IncidentRecord[]) : [];
    } catch {
      return [];
    }
  }
}

export async function saveIncident(record: IncidentRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readwrite');
      tx.objectStore(STORE_INCIDENTS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const current = await loadIncidents();
    const next = current.filter((item) => item.id !== record.id);
    next.unshift(record);
    localStorage.setItem(LS_INCIDENTS_KEY, JSON.stringify(next));
  }
}

export async function saveIncidentsBatch(records: IncidentRecord[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readwrite');
      const store = tx.objectStore(STORE_INCIDENTS);
      for (const r of records) {
        store.put(r);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const current = await loadIncidents();
    const map = new Map(current.map((c) => [c.id, c]));
    for (const r of records) map.set(r.id, r);
    localStorage.setItem(LS_INCIDENTS_KEY, JSON.stringify(sortIncidentsDesc(Array.from(map.values()))));
  }
}

export async function deleteIncident(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readwrite');
      tx.objectStore(STORE_INCIDENTS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const current = await loadIncidents();
    const next = current.filter((item) => item.id !== id);
    localStorage.setItem(LS_INCIDENTS_KEY, JSON.stringify(next));
  }
}

export async function clearAllIncidents(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readwrite');
      tx.objectStore(STORE_INCIDENTS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    localStorage.removeItem(LS_INCIDENTS_KEY);
  }
}

export async function loadWatchAlerts(): Promise<WatchAlertRecord[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WATCH_ALERTS, 'readonly');
      const store = tx.objectStore(STORE_WATCH_ALERTS);
      const req = store.getAll();
      req.onsuccess = () => resolve(sortWatchAlertsDesc((req.result as WatchAlertRecord[]) || []));
      req.onerror = () => reject(req.error);
    });
  } catch {
    try {
      const raw = localStorage.getItem(LS_WATCH_ALERTS_KEY);
      return raw ? sortWatchAlertsDesc(JSON.parse(raw) as WatchAlertRecord[]) : [];
    } catch {
      return [];
    }
  }
}

export async function saveWatchAlert(record: WatchAlertRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_WATCH_ALERTS, 'readwrite');
      tx.objectStore(STORE_WATCH_ALERTS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const current = await loadWatchAlerts();
    const next = current.filter((item) => item.id !== record.id);
    next.unshift(record);
    localStorage.setItem(LS_WATCH_ALERTS_KEY, JSON.stringify(sortWatchAlertsDesc(next)));
  }
}

export async function saveWatchAlertsBatch(records: WatchAlertRecord[]): Promise<void> {
  if (records.length === 0) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_WATCH_ALERTS, 'readwrite');
      const store = tx.objectStore(STORE_WATCH_ALERTS);
      for (const r of records) {
        store.put(r);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const current = await loadWatchAlerts();
    const map = new Map(current.map((c) => [c.id, c]));
    for (const r of records) map.set(r.id, r);
    localStorage.setItem(
      LS_WATCH_ALERTS_KEY,
      JSON.stringify(sortWatchAlertsDesc(Array.from(map.values())))
    );
  }
}

export async function deleteWatchAlert(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_WATCH_ALERTS, 'readwrite');
      tx.objectStore(STORE_WATCH_ALERTS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const current = await loadWatchAlerts();
    const next = current.filter((item) => item.id !== id);
    localStorage.setItem(LS_WATCH_ALERTS_KEY, JSON.stringify(next));
  }
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const db = await openDb();
    const saved = await new Promise<AppSettings | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, 'readonly');
      const req = tx.objectStore(STORE_SETTINGS).get('app_settings');
      req.onsuccess = () => resolve(req.result?.value as AppSettings | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!saved) return DEFAULT_SETTINGS;
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      fieldMapping: {
        ...DEFAULT_SETTINGS.fieldMapping,
        ...(saved.fieldMapping || {}),
      },
      categories: ensureBuiltinCategories(saved.categories),
    };
  } catch {
    try {
      const raw = localStorage.getItem(LS_SETTINGS_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        fieldMapping: {
          ...DEFAULT_SETTINGS.fieldMapping,
          ...(parsed.fieldMapping || {}),
        },
        categories: ensureBuiltinCategories(parsed.categories),
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, 'readwrite');
      tx.objectStore(STORE_SETTINGS).put({ key: 'app_settings', value: settings });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings));
  }
}
