import { useEffect, useMemo, useState } from 'react';
import { GovFooter } from './components/GovFooter';
import { GovHeader, type ActiveTab } from './components/GovHeader';
import { IncidentFormPage } from './components/IncidentFormPage';
import { IpbDashboardPage } from './components/IpbDashboardPage';
import { MapAndListPage } from './components/MapAndListPage';
import { SettingsPage } from './components/SettingsPage';
import { DEFAULT_SETTINGS, buildSampleIncidents } from './data/defaults';
import type { AppSettings, IncidentRecord } from './types/incident';
import { pullIncidentsFromGas, sendIncidentToGas, type GasPullResult } from './utils/gasSync';
import {
  clearAllIncidents,
  deleteIncident,
  loadIncidents,
  loadSettings,
  saveIncident,
  saveIncidentsBatch,
  saveSettings,
} from './utils/storage';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('entry');
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  const [editingIncident, setEditingIncident] = useState<IncidentRecord | null>(null);
  const [lastSavedRecord, setLastSavedRecord] = useState<IncidentRecord | null>(null);

  const [fontScale, setFontScale] = useState<number>(1);
  const [highContrast, setHighContrast] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [loadedIncidents, loadedSettings] = await Promise.all([
        loadIncidents(),
        loadSettings(),
      ]);
      if (!active) return;
      setIncidents(loadedIncidents);
      setSettings(loadedSettings);
      setLoading(false);
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
      finalRecord = {
        ...finalRecord,
        syncStatus: syncRes.ok ? 'synced' : 'failed',
        lastSyncAttempt: new Date().toISOString(),
        syncError: syncRes.ok ? undefined : syncRes.message,
      };
      await saveIncident(finalRecord);
      upsertLocalIncident(finalRecord);
    }

    setLastSavedRecord(finalRecord);
    return finalRecord;
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

  const handlePullFromGas = async (overrideSettings?: AppSettings): Promise<GasPullResult> => {
    const activeSettings = overrideSettings || settings;
    const res = await pullIncidentsFromGas(activeSettings);
    if (res.ok && res.records.length > 0) {
      await saveIncidentsBatch(res.records);
      const reloaded = await loadIncidents();
      setIncidents(reloaded);
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
        fontScale={fontScale}
        onChangeFontScale={setFontScale}
        highContrast={highContrast}
        onToggleHighContrast={() => setHighContrast((prev) => !prev)}
      />

      <main id="main-content" className="gov-main" tabIndex={-1}>
        <div className="gov-container">
          {loading ? (
            <div className="gov-card loading-card" role="status">
              กำลังโหลดข้อมูลระบบ...
            </div>
          ) : (
            <>
              {activeTab === 'entry' && (
                <IncidentFormPage
                  settings={settings}
                  editingIncident={editingIncident}
                  onCancelEdit={() => setEditingIncident(null)}
                  onSaveIncident={handleSaveIncident}
                  lastSavedRecord={lastSavedRecord}
                />
              )}

              {activeTab === 'ipb' && (
                <IpbDashboardPage
                  incidents={incidents}
                  categories={settings.categories}
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
                />
              )}

              {activeTab === 'settings' && (
                <SettingsPage
                  settings={settings}
                  onSaveSettings={handleSaveSettings}
                  onPullFromGas={handlePullFromGas}
                />
              )}
            </>
          )}
        </div>
      </main>

      <GovFooter settings={settings} />
    </div>
  );
}

export default App;
