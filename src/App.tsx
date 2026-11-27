import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { GovFooter } from './components/GovFooter';
import { GovHeader, type ActiveTab } from './components/GovHeader';
import { IncidentFormPage } from './components/IncidentFormPage';
import { DEFAULT_SETTINGS, buildSampleIncidents } from './data/defaults';
import type { AppSettings, IncidentRecord, WatchAlertRecord } from './types/incident';
import type { NewsToIncidentDraft } from './types/news';
import { decodeConfigHash } from './utils/configShare';
import {
  pullIncidentsFromGas,
  sendIncidentToGas,
  sendWatchAlertToGas,
  type GasPullResult,
} from './utils/gasSync';
import {
  clearAllIncidents,
  deleteIncident,
  deleteWatchAlert,
  loadIncidents,
  loadSettings,
  loadWatchAlerts,
  saveIncident,
  saveIncidentsBatch,
  saveSettings,
  saveWatchAlert,
  saveWatchAlertsBatch,
} from './utils/storage';

const NewsHubPage = lazy(() =>
  import('./components/NewsHubPage').then((m) => ({ default: m.NewsHubPage }))
);
const IpbDashboardPage = lazy(() =>
  import('./components/IpbDashboardPage').then((m) => ({ default: m.IpbDashboardPage }))
);
const MapAndListPage = lazy(() =>
  import('./components/MapAndListPage').then((m) => ({ default: m.MapAndListPage }))
);
const SettingsPage = lazy(() =>
  import('./components/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);

function formatClockHHmm(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}.${mm}`;
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('news-hub');
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [watchAlerts, setWatchAlerts] = useState<WatchAlertRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  const [editingIncident, setEditingIncident] = useState<IncidentRecord | null>(null);
  const [newsDraft, setNewsDraft] = useState<NewsToIncidentDraft | null>(null);
  const [lastSavedRecord, setLastSavedRecord] = useState<IncidentRecord | null>(null);
  const [lastPulledAt, setLastPulledAt] = useState<string | null>(null);
  const [startupNotice, setStartupNotice] = useState<string>('');

  const [fontScale, setFontScale] = useState<number>(1);
  const [highContrast, setHighContrast] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [loadedIncidents, loadedWatchAlerts, loadedSettings] = await Promise.all([
        loadIncidents(),
        loadWatchAlerts(),
        loadSettings(),
      ]);
      if (!active) return;

      let effectiveSettings = loadedSettings;
      const hashConfig = decodeConfigHash(window.location.hash);
      if (hashConfig) {
        effectiveSettings = {
          ...loadedSettings,
          ...hashConfig,
          fieldMapping: {
            ...loadedSettings.fieldMapping,
            ...(hashConfig.fieldMapping || {}),
          },
        };
        await saveSettings(effectiveSettings);
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}`
        );
        if (active) {
          setStartupNotice('นำเข้าการตั้งค่าเชื่อมต่อระบบจากลิงก์เรียบร้อยแล้ว');
        }
      }

      setIncidents(loadedIncidents);
      setWatchAlerts(loadedWatchAlerts);
      setSettings(effectiveSettings);
      setLoading(false);

      const syncUrl = (effectiveSettings.gasFetchUrl || effectiveSettings.gasWebhookUrl).trim();
      if (effectiveSettings.autoPullOnLoad && syncUrl) {
        const pullRes = await pullIncidentsFromGas(effectiveSettings);
        if (active && pullRes.ok) {
          if (pullRes.records.length > 0) {
            await saveIncidentsBatch(pullRes.records);
            const reloaded = await loadIncidents();
            if (active) setIncidents(reloaded);
          }
          if (pullRes.watchAlerts && pullRes.watchAlerts.length > 0) {
            await saveWatchAlertsBatch(pullRes.watchAlerts);
            const reloadedAlerts = await loadWatchAlerts();
            if (active) setWatchAlerts(reloadedAlerts);
          }
          if (active) {
            setLastPulledAt(formatClockHHmm(new Date()));
          }
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Apply DGA accessibility font scaling & high contrast mode to root document
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * fontScale}px`;
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast);
  }, [highContrast]);

  // Update browser tab title when settings change
  useEffect(() => {
    document.title = `${settings.systemTitle} | มาตรฐานเว็บไซต์ภาครัฐ`;
  }, [settings.systemTitle]);

  const pendingSyncCount = useMemo(
    () => incidents.filter((i) => i.syncStatus !== 'synced').length,
    [incidents]
  );

  const upsertLocalIncident = (record: IncidentRecord) => {
    setIncidents((prev) => {
      const others = prev.filter((item) => item.id !== record.id);
      return [record, ...others].sort(
        (a, b) =>
          new Date(b.occurredAt || b.createdAt).getTime() -
          new Date(a.occurredAt || a.createdAt).getTime()
      );
    });
  };

  const handleSaveIncident = async (record: IncidentRecord): Promise<IncidentRecord> => {
    // Remember last reporter automatically for rapid sequential entries
    if (record.reporter && record.reporter !== settings.defaultReporter) {
      const nextSettings = { ...settings, defaultReporter: record.reporter };
      setSettings(nextSettings);
      void saveSettings(nextSettings);
    }

    let finalRecord: IncidentRecord = { ...record };
    await saveIncident(finalRecord);
    upsertLocalIncident(finalRecord);

    if (settings.autoSyncOnSave && settings.gasWebhookUrl.trim()) {
      const syncRes = await sendIncidentToGas(finalRecord, settings);
      const returnedRow =
        syncRes.responseData &&
        typeof syncRes.responseData === 'object' &&
        'legacyRowNumber' in syncRes.responseData
          ? Number((syncRes.responseData as Record<string, unknown>).legacyRowNumber)
          : undefined;
      finalRecord = {
        ...finalRecord,
        syncStatus: syncRes.ok ? 'synced' : 'failed',
        lastSyncAttempt: new Date().toISOString(),
        syncError: syncRes.ok ? undefined : syncRes.message,
        legacyRowNumber:
          returnedRow && Number.isFinite(returnedRow)
            ? returnedRow
            : finalRecord.legacyRowNumber,
      };
      await saveIncident(finalRecord);
      upsertLocalIncident(finalRecord);
    }

    setLastSavedRecord(finalRecord);
    return finalRecord;
  };

  const handleSaveIncidentBatch = async (records: IncidentRecord[]): Promise<IncidentRecord[]> => {
    if (records.length === 0) return [];
    await saveIncidentsBatch(records);
    setIncidents(await loadIncidents());

    if (settings.autoSyncOnSave && settings.gasWebhookUrl.trim()) {
      const updatedRecords: IncidentRecord[] = [];
      for (const rec of records) {
        const syncRes = await sendIncidentToGas(rec, settings);
        const returnedRow =
          syncRes.responseData &&
          typeof syncRes.responseData === 'object' &&
          'legacyRowNumber' in syncRes.responseData
            ? Number((syncRes.responseData as Record<string, unknown>).legacyRowNumber)
            : undefined;
        updatedRecords.push({
          ...rec,
          syncStatus: syncRes.ok ? 'synced' : 'failed',
          lastSyncAttempt: new Date().toISOString(),
          syncError: syncRes.ok ? undefined : syncRes.message,
          legacyRowNumber:
            returnedRow && Number.isFinite(returnedRow)
              ? returnedRow
              : rec.legacyRowNumber,
        });
      }
      await saveIncidentsBatch(updatedRecords);
      setIncidents(await loadIncidents());
      setLastSavedRecord(updatedRecords[0]);
      return updatedRecords;
    }

    setLastSavedRecord(records[0]);
    return records;
  };

  const handleQuickUpdateIncident = async (record: IncidentRecord): Promise<IncidentRecord> => {
    let updated: IncidentRecord = {
      ...record,
      updatedAt: new Date().toISOString(),
      syncStatus: 'pending',
    };
    await saveIncident(updated);
    upsertLocalIncident(updated);

    if (settings.autoSyncOnSave && settings.gasWebhookUrl.trim()) {
      const syncRes = await sendIncidentToGas(updated, settings);
      const returnedRow =
        syncRes.responseData &&
        typeof syncRes.responseData === 'object' &&
        'legacyRowNumber' in syncRes.responseData
          ? Number((syncRes.responseData as Record<string, unknown>).legacyRowNumber)
          : undefined;
      updated = {
        ...updated,
        syncStatus: syncRes.ok ? 'synced' : 'failed',
        lastSyncAttempt: new Date().toISOString(),
        syncError: syncRes.ok ? undefined : syncRes.message,
        legacyRowNumber:
          returnedRow && Number.isFinite(returnedRow)
            ? returnedRow
            : updated.legacyRowNumber,
      };
      await saveIncident(updated);
      upsertLocalIncident(updated);
    }

    return updated;
  };

  const handleQuickUpdateBatch = async (records: IncidentRecord[]): Promise<IncidentRecord[]> => {
    if (records.length === 0) return [];
    const nowIso = new Date().toISOString();
    const stamped: IncidentRecord[] = records.map((rec) => ({
      ...rec,
      updatedAt: nowIso,
      syncStatus: 'pending',
    }));
    await saveIncidentsBatch(stamped);
    setIncidents(await loadIncidents());

    if (settings.autoSyncOnSave && settings.gasWebhookUrl.trim()) {
      const updatedRecords: IncidentRecord[] = [];
      for (const rec of stamped) {
        const syncRes = await sendIncidentToGas(rec, settings);
        const returnedRow =
          syncRes.responseData &&
          typeof syncRes.responseData === 'object' &&
          'legacyRowNumber' in syncRes.responseData
            ? Number((syncRes.responseData as Record<string, unknown>).legacyRowNumber)
            : undefined;
        updatedRecords.push({
          ...rec,
          syncStatus: syncRes.ok ? 'synced' : 'failed',
          lastSyncAttempt: new Date().toISOString(),
          syncError: syncRes.ok ? undefined : syncRes.message,
          legacyRowNumber:
            returnedRow && Number.isFinite(returnedRow)
              ? returnedRow
              : rec.legacyRowNumber,
        });
      }
      await saveIncidentsBatch(updatedRecords);
      setIncidents(await loadIncidents());
      return updatedRecords;
    }

    return stamped;
  };

  const handleRetrySyncOne = async (record: IncidentRecord) => {
    const syncRes = await sendIncidentToGas(record, settings);
    const updated: IncidentRecord = {
      ...record,
      syncStatus: syncRes.ok ? 'synced' : 'failed',
      lastSyncAttempt: new Date().toISOString(),
      syncError: syncRes.ok ? undefined : syncRes.message,
    };
    await saveIncident(updated);
    upsertLocalIncident(updated);
  };

  const handleRetrySyncAll = async () => {
    const unsynced = incidents.filter((i) => i.syncStatus !== 'synced');
    for (const item of unsynced) {
      await handleRetrySyncOne(item);
    }
  };

  const handleDeleteIncident = async (id: string) => {
    await deleteIncident(id);
    setIncidents((prev) => prev.filter((i) => i.id !== id));
    if (lastSavedRecord?.id === id) setLastSavedRecord(null);
    if (editingIncident?.id === id) setEditingIncident(null);
  };

  const handleClearAll = async () => {
    await clearAllIncidents();
    setIncidents([]);
    setLastSavedRecord(null);
    setEditingIncident(null);
  };

  const handleLoadSamples = async () => {
    const samples = buildSampleIncidents();
    await saveIncidentsBatch(samples);
    const reloaded = await loadIncidents();
    setIncidents(reloaded);
  };

  const handleSaveSettings = async (next: AppSettings) => {
    await saveSettings(next);
    setSettings(next);
  };

  const handleSaveWatchAlert = async (alert: WatchAlertRecord): Promise<WatchAlertRecord> => {
    let savedRecord: WatchAlertRecord = { ...alert };
    await saveWatchAlert(savedRecord);
    setWatchAlerts(await loadWatchAlerts());

    if (settings.autoSyncOnSave && settings.gasWebhookUrl.trim()) {
      const syncRes = await sendWatchAlertToGas(savedRecord, settings);
      savedRecord = {
        ...savedRecord,
        syncStatus: syncRes.ok ? 'synced' : 'failed',
        syncError: syncRes.ok ? undefined : syncRes.message,
      };
      await saveWatchAlert(savedRecord);
      setWatchAlerts(await loadWatchAlerts());
    }

    return savedRecord;
  };

  const handleSaveWatchAlertsBatch = async (
    alerts: WatchAlertRecord[]
  ): Promise<WatchAlertRecord[]> => {
    if (alerts.length === 0) return [];
    await saveWatchAlertsBatch(alerts);
    setWatchAlerts(await loadWatchAlerts());

    if (settings.autoSyncOnSave && settings.gasWebhookUrl.trim()) {
      const updatedAlerts: WatchAlertRecord[] = [];
      for (const item of alerts) {
        const syncRes = await sendWatchAlertToGas(item, settings);
        updatedAlerts.push({
          ...item,
          syncStatus: syncRes.ok ? 'synced' : 'failed',
          syncError: syncRes.ok ? undefined : syncRes.message,
        });
      }
      await saveWatchAlertsBatch(updatedAlerts);
      setWatchAlerts(await loadWatchAlerts());
      return updatedAlerts;
    }

    return alerts;
  };

  const handleDeleteWatchAlert = async (id: string) => {
    await deleteWatchAlert(id);
    setWatchAlerts((prev) => prev.filter((item) => item.id !== id));
  };

  const handlePullFromGas = async (overrideSettings?: AppSettings): Promise<GasPullResult> => {
    const activeSettings = overrideSettings || settings;
    const res = await pullIncidentsFromGas(activeSettings);
    if (res.ok) {
      if (res.records.length > 0) {
        await saveIncidentsBatch(res.records);
        const reloaded = await loadIncidents();
        setIncidents(reloaded);
      }
      if (res.watchAlerts && res.watchAlerts.length > 0) {
        await saveWatchAlertsBatch(res.watchAlerts);
        setWatchAlerts(await loadWatchAlerts());
      }
      setLastPulledAt(formatClockHHmm(new Date()));
    }
    return res;
  };

  const hasGasUrl = Boolean((settings.gasFetchUrl || settings.gasWebhookUrl).trim());

  return (
    <div className="app-shell">
      <GovHeader
        activeTab={activeTab}
        onChangeTab={(tab) => setActiveTab(tab)}
        settings={settings}
        pendingSyncCount={pendingSyncCount}
        totalIncidents={incidents.length}
        lastPulledAt={lastPulledAt}
        fontScale={fontScale}
        onChangeFontScale={setFontScale}
        highContrast={highContrast}
        onToggleHighContrast={() => setHighContrast((prev) => !prev)}
      />

      <main id="main-content" className="gov-main" tabIndex={-1}>
        <div className={`gov-container ${activeTab === 'ipb' ? 'wide-dashboard' : ''}`}>
          {startupNotice && (
            <div className="inline-alert info startup-banner" role="status">
              <span>{startupNotice}</span>
              <button
                type="button"
                className="btn-xs btn-outline"
                onClick={() => setStartupNotice('')}
              >
                ปิด
              </button>
            </div>
          )}

          {loading ? (
            <div className="gov-card loading-card" role="status">
              กำลังโหลดข้อมูลระบบ...
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="gov-card loading-card" role="status">
                  กำลังโหลดหน้าจอ...
                </div>
              }
            >
              {activeTab === 'news-hub' && (
                <NewsHubPage
                  settings={settings}
                  onImportToIncident={(draft) => {
                    setEditingIncident(null);
                    setNewsDraft(draft);
                    setActiveTab('entry');
                  }}
                />
              )}

              {activeTab === 'entry' && (
                <IncidentFormPage
                  settings={settings}
                  incidents={incidents}
                  editingIncident={editingIncident}
                  onCancelEdit={() => setEditingIncident(null)}
                  newsDraft={newsDraft}
                  onClearNewsDraft={() => setNewsDraft(null)}
                  onSaveIncident={handleSaveIncident}
                  onSaveIncidentBatch={handleSaveIncidentBatch}
                  lastSavedRecord={lastSavedRecord}
                  watchAlerts={watchAlerts}
                  onSaveWatchAlert={handleSaveWatchAlert}
                  onSaveWatchAlertsBatch={handleSaveWatchAlertsBatch}
                  onQuickUpdateIncidentBatch={handleQuickUpdateBatch}
                  onPullFromGas={() => handlePullFromGas()}
                  onDeleteWatchAlert={handleDeleteWatchAlert}
                />
              )}

              {activeTab === 'ipb' && (
                <IpbDashboardPage
                  incidents={incidents}
                  watchAlerts={watchAlerts}
                  categories={settings.categories}
                  settings={settings}
                  lastPulledAt={lastPulledAt}
                  onLoadSamples={handleLoadSamples}
                  hasGasUrl={hasGasUrl}
                  onPullFromGas={() => handlePullFromGas()}
                />
              )}

              {activeTab === 'map-list' && (
                <MapAndListPage
                  incidents={incidents}
                  settings={settings}
                  onEditIncident={(rec) => {
                    setEditingIncident(rec);
                    setActiveTab('entry');
                  }}
                  onDeleteIncident={handleDeleteIncident}
                  onRetrySyncOne={handleRetrySyncOne}
                  onRetrySyncAll={handleRetrySyncAll}
                  onLoadSamples={handleLoadSamples}
                  onClearAll={handleClearAll}
                  onPullFromGas={() => handlePullFromGas()}
                  onQuickUpdateIncident={handleQuickUpdateIncident}
                  onQuickUpdateBatch={handleQuickUpdateBatch}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsPage
                  settings={settings}
                  onSaveSettings={handleSaveSettings}
                  onPullFromGas={handlePullFromGas}
                />
              )}
            </Suspense>
          )}
        </div>
      </main>

      <GovFooter settings={settings} />
    </div>
  );
}

export default App;
