import { DEFAULT_SETTINGS } from '../data/defaults';
import type { AppSettings, IncidentRecord } from '../types/incident';

const DB_NAME = 'sbp_intelligence_report_db';
const DB_VERSION = 1;
const STORE_INCIDENTS = 'incidents';
const STORE_SETTINGS = 'settings';
const LS_INCIDENTS_KEY = 'sbp_incidents_fallback_v1';
const LS_SETTINGS_KEY = 'sbp_settings_fallback_v1';

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
      categories: saved.categories?.length ? saved.categories : DEFAULT_SETTINGS.categories,
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
