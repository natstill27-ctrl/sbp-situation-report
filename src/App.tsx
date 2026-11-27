import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { GovComplianceModal, type ComplianceModalTab } from './components/GovComplianceModal';
import { GovFooter } from './components/GovFooter';
import {
  GovBreadcrumb,
  GovHeader,
  W56MobileBottomNav,
  W56Sidebar,
  type ActiveTab,
  type FontSizeMode,
} from './components/GovHeader';
import { StaffAuthModal } from './components/StaffAuthModal';
import { DEFAULT_SETTINGS, buildSampleIncidents } from './data/defaults';
import type { AppSettings, IncidentRecord, WatchAlertRecord } from './types/incident';
import type {
  DailyLogDraft,
  DailyLogRecord,
  NewsCategoryId,
  NewsToIncidentDraft,
} from './types/news';
import { decodeConfigHash } from './utils/configShare';
import {
  deleteDailyLogFromGas,
  pullDailyLogsFromGas,
  sendDailyLogToGas,
} from './utils/dailyLogGasSync';
import type { GasPullResult, GasSyncResult } from './utils/gasSync';
import {
  clearAllIncidents,
  deleteDailyLog,
  deleteIncident,
  deleteWatchAlert,
  loadDailyLogs,
  loadIncidents,
  loadSettings,
  loadWatchAlerts,
  saveDailyLog,
  saveDailyLogsBatch,
  saveIncident,
  saveIncidentsBatch,
  saveSettings,
  saveWatchAlert,
  saveWatchAlertsBatch,
} from './utils/storage';
import { useModalFocusTrap } from './utils/useModalFocusTrap';

const IncidentFormPage = lazy(() =>
  import('./components/IncidentFormPage').then((m) => ({ default: m.IncidentFormPage }))
);

const NewsHubPage = lazy(() =>
  import('./components/NewsHubPage').then((m) => ({ default: m.NewsHubPage }))
);
const UnifiedSituationMapPage = lazy(() =>
  import('./components/UnifiedSituationMapPage').then((m) => ({
    default: m.UnifiedSituationMapPage,
  }))
);
const DailyLogPage = lazy(() =>
  import('./components/DailyLogPage').then((m) => ({ default: m.DailyLogPage }))
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

const STAFF_SESSION_KEY = 'w56_staff_session_v1';
const STAFF_ONLY_TABS = new Set<ActiveTab>(['daily-log', 'entry', 'ipb', 'map-list', 'settings']);

function readStaffSession(): { unlocked: boolean; pin: string } {
  try {
    const raw = sessionStorage.getItem(STAFF_SESSION_KEY);
    if (!raw) return { unlocked: false, pin: '' };
    const parsed = JSON.parse(raw) as { unlocked?: boolean; pin?: string };
    return { unlocked: Boolean(parsed.unlocked), pin: String(parsed.pin || '') };
  } catch {
    return { unlocked: false, pin: '' };
  }
}

function formatClockHHmm(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}.${mm}`;
}

function applyIncidentSyncResult(record: IncidentRecord, syncRes: GasSyncResult): IncidentRecord {
  const returnedRow =
    syncRes.responseData &&
    typeof syncRes.responseData === 'object' &&
    'legacyRowNumber' in syncRes.responseData
      ? Number((syncRes.responseData as Record<string, unknown>).legacyRowNumber)
      : undefined;
  return {
    ...record,
    syncStatus: syncRes.ok ? 'synced' : 'failed',
    lastSyncAttempt: new Date().toISOString(),
    syncError: syncRes.ok ? undefined : syncRes.message,
    legacyRowNumber:
      returnedRow && Number.isFinite(returnedRow) ? returnedRow : record.legacyRowNumber,
  };
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('news-hub');
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [watchAlerts, setWatchAlerts] = useState<WatchAlertRecord[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLogRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  const initialStaff = readStaffSession();
  const [staffUnlocked, setStaffUnlocked] = useState<boolean>(initialStaff.unlocked);
  const [staffPin, setStaffPin] = useState<string>(initialStaff.pin);
  const [staffAuthModalOpen, setStaffAuthModalOpen] = useState<boolean>(false);

  const [editingIncident, setEditingIncident] = useState<IncidentRecord | null>(null);
  const [newsDraft, setNewsDraft] = useState<NewsToIncidentDraft | null>(null);
  const [dailyLogDraft, setDailyLogDraft] = useState<DailyLogDraft | null>(null);
  const [lastSavedRecord, setLastSavedRecord] = useState<IncidentRecord | null>(null);
  const [lastPulledAt, setLastPulledAt] = useState<string | null>(null);
  const [startupNotice, setStartupNotice] = useState<string>('');
  const [pendingHashConfig, setPendingHashConfig] = useState<Partial<AppSettings> | null>(null);
  const hashDialogRef = useRef<HTMLDivElement | null>(null);

  useModalFocusTrap(Boolean(pendingHashConfig), hashDialogRef, () => setPendingHashConfig(null));

  const [themeDark, setThemeDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem('w56_intel_theme') === 'dark';
    } catch {
      return false;
    }
  });
  const [fontSizeMode, setFontSizeMode] = useState<FontSizeMode>(() => {
    try {
      const saved = localStorage.getItem('w56_intel_font_size');
      if (saved === 'sm' || saved === 'md' || saved === 'lg') return saved;
      return localStorage.getItem('w56_intel_font_large') === '1' ? 'lg' : 'md';
    } catch {
      return 'md';
    }
  });
  const [complianceModal, setComplianceModal] = useState<ComplianceModalTab | null>(null);
  const [activeNewsCategory, setActiveNewsCategory] = useState<'all' | NewsCategoryId>('all');
  const [requestedNewsCategory, setRequestedNewsCategory] = useState<'all' | NewsCategoryId | null>(
    null
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('w56_intel_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [highContrast, setHighContrast] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [loadedIncidents, loadedWatchAlerts, loadedDailyLogs, loadedSettings] =
        await Promise.all([
          loadIncidents(),
          loadWatchAlerts(),
          loadDailyLogs(),
          loadSettings(),
        ]);
      if (!active) return;

      const effectiveSettings = loadedSettings;
      const hashConfig = decodeConfigHash(window.location.hash);
      if (hashConfig) {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}`
        );
        if (active) {
          setPendingHashConfig(hashConfig);
        }
      }

      setIncidents(loadedIncidents);
      setWatchAlerts(loadedWatchAlerts);
      setDailyLogs(loadedDailyLogs);
      setSettings(effectiveSettings);
      setLoading(false);

      const syncUrl = (effectiveSettings.gasFetchUrl || effectiveSettings.gasWebhookUrl).trim();
      if (effectiveSettings.autoPullOnLoad && syncUrl) {
        const { pullIncidentsFromGas } = await import('./utils/gasSync');
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

      if (effectiveSettings.dailyLogGasUrl?.trim()) {
        const dailyPull = await pullDailyLogsFromGas(effectiveSettings);
        if (active && dailyPull.ok && dailyPull.records.length > 0) {
          await saveDailyLogsBatch(dailyPull.records);
          const reloadedLogs = await loadDailyLogs();
          if (active) setDailyLogs(reloadedLogs);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Apply Wing 56 Security HUB Soft Light/Dark, 3-level Font & High Contrast modes
  useEffect(() => {
    document.documentElement.classList.toggle('theme-dark', themeDark);
    try {
      localStorage.setItem('w56_intel_theme', themeDark ? 'dark' : 'light');
    } catch {
      // ignore storage errors
    }
  }, [themeDark]);

  useEffect(() => {
    document.documentElement.classList.toggle('font-small', fontSizeMode === 'sm');
    document.documentElement.classList.toggle('font-large', fontSizeMode === 'lg');
    try {
      localStorage.setItem('w56_intel_font_size', fontSizeMode);
      localStorage.setItem('w56_intel_font_large', fontSizeMode === 'lg' ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  }, [fontSizeMode]);

  useEffect(() => {
    try {
      localStorage.setItem('w56_intel_sidebar_collapsed', sidebarCollapsed ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  }, [sidebarCollapsed]);

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

  const pendingDailyLogCount = useMemo(
    () => dailyLogs.filter((d) => d.syncStatus !== 'synced').length,
    [dailyLogs]
  );

  const effectiveTab: ActiveTab =
    !staffUnlocked && STAFF_ONLY_TABS.has(activeTab) ? 'news-hub' : activeTab;

  const handleSelectTab = (tab: ActiveTab) => {
    if (!staffUnlocked && STAFF_ONLY_TABS.has(tab)) {
      setStaffAuthModalOpen(true);
      return;
    }
    setActiveTab(tab);
  };

  const handleUnlockStaffSuccess = (pin: string, goToSettings?: boolean) => {
    setStaffUnlocked(true);
    setStaffPin(pin);
    setStaffAuthModalOpen(false);
    try {
      sessionStorage.setItem(STAFF_SESSION_KEY, JSON.stringify({ unlocked: true, pin }));
    } catch {
      // ignore session storage errors
    }
    if (goToSettings) {
      setActiveTab('settings');
    }
  };

  const handleLockStaffMode = () => {
    setStaffUnlocked(false);
    setStaffPin('');
    try {
      sessionStorage.removeItem(STAFF_SESSION_KEY);
    } catch {
      // ignore session storage errors
    }
    if (STAFF_ONLY_TABS.has(activeTab)) {
      setActiveTab('news-hub');
    }
  };

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

  const upsertLocalDailyLog = (record: DailyLogRecord) => {
    setDailyLogs((prev) => {
      const others = prev.filter((item) => item.id !== record.id);
      return [record, ...others].sort(
        (a, b) =>
          new Date(b.occurredAt || b.createdAt).getTime() -
          new Date(a.occurredAt || a.createdAt).getTime()
      );
    });
  };

  const handleSaveDailyLog = async (record: DailyLogRecord): Promise<DailyLogRecord> => {
    if (record.reporter && record.reporter !== settings.defaultReporter) {
      const nextSettings = { ...settings, defaultReporter: record.reporter };
      setSettings(nextSettings);
      void saveSettings(nextSettings);
    }

    let finalRecord: DailyLogRecord = { ...record };
    await saveDailyLog(finalRecord);
    upsertLocalDailyLog(finalRecord);

    if (settings.dailyLogGasUrl?.trim() && staffPin.trim()) {
      const syncRes = await sendDailyLogToGas(finalRecord, settings, staffPin);
      finalRecord = {
        ...finalRecord,
        syncStatus: syncRes.ok ? 'synced' : 'failed',
        syncError: syncRes.ok ? undefined : syncRes.message,
      };
      await saveDailyLog(finalRecord);
      upsertLocalDailyLog(finalRecord);
    }

    return finalRecord;
  };

  const handleDeleteDailyLog = async (record: DailyLogRecord): Promise<void> => {
    await deleteDailyLog(record.id);
    setDailyLogs((prev) => prev.filter((item) => item.id !== record.id));
    if (settings.dailyLogGasUrl?.trim() && staffPin.trim()) {
      await deleteDailyLogFromGas(record.id, record.category, settings, staffPin);
    }
  };

  const handleRetrySyncDailyLog = async (record: DailyLogRecord): Promise<void> => {
    const syncRes = await sendDailyLogToGas(record, settings, staffPin);
    const updated: DailyLogRecord = {
      ...record,
      syncStatus: syncRes.ok ? 'synced' : 'failed',
      syncError: syncRes.ok ? undefined : syncRes.message,
    };
    await saveDailyLog(updated);
    upsertLocalDailyLog(updated);
  };

  const handlePullDailyLogs = async (
    overrideSettings?: AppSettings
  ): Promise<{ ok: boolean; message: string }> => {
    const targetSettings = overrideSettings || settings;
    const res = await pullDailyLogsFromGas(targetSettings);
    if (res.ok && res.records.length > 0) {
      await saveDailyLogsBatch(res.records);
      setDailyLogs(await loadDailyLogs());
    }
    return { ok: res.ok, message: res.message };
  };

  const handleSaveIncident = async (record: IncidentRecord): Promise<IncidentRecord> => {
    if (record.reporter && record.reporter !== settings.defaultReporter) {
      const nextSettings = { ...settings, defaultReporter: record.reporter };
      setSettings(nextSettings);
      void saveSettings(nextSettings);
    }

    let finalRecord: IncidentRecord = { ...record };
    await saveIncident(finalRecord);
    upsertLocalIncident(finalRecord);

    if (settings.autoSyncOnSave && settings.gasWebhookUrl.trim()) {
      const { sendIncidentToGas } = await import('./utils/gasSync');
      const syncRes = await sendIncidentToGas(finalRecord, settings);
      finalRecord = applyIncidentSyncResult(finalRecord, syncRes);
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
      const { sendIncidentToGas } = await import('./utils/gasSync');
      const updatedRecords: IncidentRecord[] = [];
      for (const rec of records) {
        const syncRes = await sendIncidentToGas(rec, settings);
        updatedRecords.push(applyIncidentSyncResult(rec, syncRes));
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
      const { sendIncidentToGas } = await import('./utils/gasSync');
      const syncRes = await sendIncidentToGas(updated, settings);
      updated = applyIncidentSyncResult(updated, syncRes);
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
      const { sendIncidentToGas } = await import('./utils/gasSync');
      const updatedRecords: IncidentRecord[] = [];
      for (const rec of stamped) {
        const syncRes = await sendIncidentToGas(rec, settings);
        updatedRecords.push(applyIncidentSyncResult(rec, syncRes));
      }
      await saveIncidentsBatch(updatedRecords);
      setIncidents(await loadIncidents());
      return updatedRecords;
    }

    return stamped;
  };

  const handleRetrySyncOne = async (record: IncidentRecord) => {
    const { sendIncidentToGas } = await import('./utils/gasSync');
    const syncRes = await sendIncidentToGas(record, settings);
    const updated = applyIncidentSyncResult(record, syncRes);
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
      const { sendWatchAlertToGas } = await import('./utils/gasSync');
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
      const { sendWatchAlertToGas } = await import('./utils/gasSync');
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
    const { pullIncidentsFromGas } = await import('./utils/gasSync');
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

  const handleGoHome = (newsCategory: 'all' | NewsCategoryId = 'all') => {
    setRequestedNewsCategory(newsCategory);
    setActiveNewsCategory(newsCategory);
    setActiveTab('news-hub');
  };

  const handleConfirmPendingConfig = async () => {
    if (!pendingHashConfig) return;
    const nextSettings: AppSettings = {
      ...settings,
      ...pendingHashConfig,
      fieldMapping: {
        ...settings.fieldMapping,
        ...(pendingHashConfig.fieldMapping || {}),
      },
    };
    setPendingHashConfig(null);
    await saveSettings(nextSettings);
    setSettings(nextSettings);
    setStartupNotice('นำเข้าการตั้งค่าเชื่อมต่อระบบจากลิงก์เรียบร้อยแล้ว');
    if (nextSettings.autoPullOnLoad && (nextSettings.gasFetchUrl || nextSettings.gasWebhookUrl).trim()) {
      await handlePullFromGas(nextSettings);
    }
    if (nextSettings.dailyLogGasUrl?.trim()) {
      await handlePullDailyLogs(nextSettings);
    }
  };

  return (
    <div className="w56-app-layout">
      <a href="#main-content" className="skip-link">
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <W56Sidebar
        activeTab={effectiveTab}
        onChangeTab={handleSelectTab}
        onGoHome={() => handleGoHome('all')}
        activeNewsCategory={activeNewsCategory}
        onSelectNewsCategory={(cat) => handleGoHome(cat)}
        onOpenComplianceModal={(modal) => setComplianceModal(modal)}
        staffUnlocked={staffUnlocked}
        onRequestStaffUnlock={() => setStaffAuthModalOpen(true)}
        onLockStaffMode={handleLockStaffMode}
        settings={settings}
        pendingSyncCount={pendingSyncCount}
        pendingDailyLogCount={pendingDailyLogCount}
        totalIncidents={incidents.length}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="w56-workspace-col">
        <GovHeader
          activeTab={effectiveTab}
          settings={settings}
          staffUnlocked={staffUnlocked}
          pendingSyncCount={pendingSyncCount}
          lastPulledAt={lastPulledAt}
          themeDark={themeDark}
          onToggleTheme={() => setThemeDark((prev) => !prev)}
          fontSizeMode={fontSizeMode}
          onChangeFontSize={setFontSizeMode}
          highContrast={highContrast}
          onToggleHighContrast={() => setHighContrast((prev) => !prev)}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        />

        <main id="main-content" className="gov-main" tabIndex={-1}>
          <div
            className={`gov-container ${
              effectiveTab === 'ipb' || effectiveTab === 'unified-map' ? 'wide-dashboard' : ''
            }`}
          >
            <GovBreadcrumb activeTab={effectiveTab} onGoHome={() => handleGoHome('all')} />
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
                {effectiveTab === 'news-hub' && (
                  <NewsHubPage
                    settings={settings}
                    staffUnlocked={staffUnlocked}
                    requestedCategory={requestedNewsCategory}
                    onConsumeRequestedCategory={() => setRequestedNewsCategory(null)}
                    onCategoryChange={setActiveNewsCategory}
                    onOpenUnifiedMap={() => handleSelectTab('unified-map')}
                    onOpenHelp={() => setComplianceModal('faq')}
                    onImportToDailyLog={(draft) => {
                      setDailyLogDraft(draft);
                      setActiveTab('daily-log');
                    }}
                    onImportToIncident={(draft) => {
                      setEditingIncident(null);
                      setNewsDraft(draft);
                      setActiveTab('entry');
                    }}
                  />
                )}

                {effectiveTab === 'unified-map' && (
                  <UnifiedSituationMapPage
                    settings={settings}
                    dailyLogs={dailyLogs}
                    incidents={incidents}
                    watchAlerts={watchAlerts}
                    staffUnlocked={staffUnlocked}
                    onRefreshDailyLogs={async () => {
                      await handlePullDailyLogs();
                    }}
                    onOpenDailyLogForm={() => handleSelectTab('daily-log')}
                  />
                )}

                {effectiveTab === 'daily-log' && staffUnlocked && (
                  <DailyLogPage
                    settings={settings}
                    dailyLogs={dailyLogs}
                    staffPin={staffPin}
                    draft={dailyLogDraft}
                    onClearDraft={() => setDailyLogDraft(null)}
                    onSaveDailyLog={handleSaveDailyLog}
                    onDeleteDailyLog={handleDeleteDailyLog}
                    onRetrySyncDailyLog={handleRetrySyncDailyLog}
                    onPullDailyLogs={() => handlePullDailyLogs()}
                  />
                )}

                {effectiveTab === 'entry' && staffUnlocked && (
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

                {effectiveTab === 'ipb' && staffUnlocked && (
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

                {effectiveTab === 'map-list' && staffUnlocked && (
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

                {effectiveTab === 'settings' && staffUnlocked && (
                  <SettingsPage
                    settings={settings}
                    onSaveSettings={handleSaveSettings}
                    onPullFromGas={handlePullFromGas}
                    onPullDailyLogs={handlePullDailyLogs}
                  />
                )}
              </Suspense>
            )}
          </div>
        </main>

        <GovFooter
          settings={settings}
          staffUnlocked={staffUnlocked}
          onChangeTab={handleSelectTab}
          onOpenModal={(tab) => setComplianceModal(tab)}
        />

        <GovComplianceModal
          activeModal={complianceModal}
          staffUnlocked={staffUnlocked}
          onChangeModal={(tab) => setComplianceModal(tab)}
          onClose={() => setComplianceModal(null)}
          onNavigateTab={(tab, newsCategory) => {
            if (tab === 'news-hub') {
              handleGoHome(newsCategory || 'all');
            } else {
              handleSelectTab(tab);
            }
            setComplianceModal(null);
          }}
        />

        <StaffAuthModal
          open={staffAuthModalOpen}
          dailyLogGasUrl={settings.dailyLogGasUrl || ''}
          hasLegacyGasUrl={Boolean((settings.gasFetchUrl || settings.gasWebhookUrl).trim())}
          onClose={() => setStaffAuthModalOpen(false)}
          onUnlockSuccess={handleUnlockStaffSuccess}
        />

        {pendingHashConfig && (
          <div
            className="gov-modal-backdrop"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPendingHashConfig(null);
            }}
          >
            <div
              ref={hashDialogRef}
              className="gov-modal-dialog gov-auth-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="config-import-title"
              tabIndex={-1}
            >
              <div className="gov-modal-header">
                <div>
                  <p className="gov-modal-kicker">การนำเข้าการตั้งค่าจากลิงก์</p>
                  <h2 id="config-import-title" className="gov-modal-title">
                    ยืนยันการเปลี่ยนการตั้งค่าเชื่อมต่อระบบ
                  </h2>
                </div>
                <button
                  type="button"
                  className="gov-modal-close"
                  onClick={() => setPendingHashConfig(null)}
                  aria-label="ปิดหน้าต่าง"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="gov-modal-body">
                <div className="inline-alert warn" style={{ marginBottom: '0.85rem' }}>
                  <ShieldAlert size={18} aria-hidden="true" />
                  <span>
                    ตรวจพบการตั้งค่าแนบมากับลิงก์ กรุณาตรวจสอบปลายทางก่อนกดยืนยัน (หากไม่รู้จักผู้ส่งลิงก์ให้กดยกเลิก)
                  </span>
                </div>
                <ul className="gov-policy-list" style={{ marginBottom: '1rem', fontSize: '0.86rem' }}>
                  {pendingHashConfig.agencyName && (
                    <li>
                      <strong>หน่วยงาน:</strong> {pendingHashConfig.agencyName}
                    </li>
                  )}
                  {pendingHashConfig.dailyLogGasUrl && (
                    <li>
                      <strong>ลิงก์ชีทบันทึกประจำวัน:</strong>{' '}
                      <code style={{ wordBreak: 'break-all' }}>{pendingHashConfig.dailyLogGasUrl}</code>
                    </li>
                  )}
                  {pendingHashConfig.gasWebhookUrl && (
                    <li>
                      <strong>ลิงก์เชื่อมต่อระบบ IPB:</strong>{' '}
                      <code style={{ wordBreak: 'break-all' }}>{pendingHashConfig.gasWebhookUrl}</code>
                    </li>
                  )}
                </ul>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleConfirmPendingConfig()}
                  >
                    ยืนยันนำเข้าการตั้งค่า
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setPendingHashConfig(null)}
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <W56MobileBottomNav
        activeTab={effectiveTab}
        staffUnlocked={staffUnlocked}
        onChangeTab={handleSelectTab}
        onOpenHelp={() => setComplianceModal('faq')}
        onOpenMenu={() => setMobileSidebarOpen(true)}
      />
    </div>
  );
}

export default App;
