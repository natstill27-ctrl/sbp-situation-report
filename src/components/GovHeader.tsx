import { BarChart3, FilePlus2, MapPin, Settings, ShieldAlert } from 'lucide-react';
import type { AppSettings } from '../types/incident';
import { formatThaiDateTime } from '../utils/thaiDate';

export type ActiveTab = 'entry' | 'ipb' | 'map-list' | 'settings';

interface GovHeaderProps {
  activeTab: ActiveTab;
  onChangeTab: (tab: ActiveTab) => void;
  settings: AppSettings;
  pendingSyncCount: number;
  totalIncidents: number;
  lastPulledAt?: string | null;
  fontScale: number;
  onChangeFontScale: (next: number) => void;
  highContrast: boolean;
  onToggleHighContrast: () => void;
}

export function GovHeader({
  activeTab,
  onChangeTab,
  settings,
  pendingSyncCount,
  totalIncidents,
  lastPulledAt,
  fontScale,
  onChangeFontScale,
  highContrast,
  onToggleHighContrast,
}: GovHeaderProps) {
  const todayLabel = formatThaiDateTime(new Date().toISOString().slice(0, 10), {
    shortMonth: false,
    includeTime: false,
  });

  const navItems: Array<{ id: ActiveTab; label: string; icon: typeof FilePlus2; badge?: number }> = [
    { id: 'entry', label: 'บันทึกเหตุการณ์', icon: FilePlus2 },
    { id: 'ipb', label: 'แดชบอร์ดสถิติ & IPB', icon: BarChart3 },
    {
      id: 'map-list',
      label: 'แผนที่รวม & รายการเหตุการณ์',
      icon: MapPin,
      badge: totalIncidents > 0 ? totalIncidents : undefined,
    },
    {
      id: 'settings',
      label: 'ตั้งค่า & เชื่อมระบบเดิม',
      icon: Settings,
      badge: pendingSyncCount > 0 ? pendingSyncCount : undefined,
    },
  ];

  return (
    <header className="gov-header" role="banner">
      {/* Top Accessibility & Government Standard Strip */}
      <div className="gov-topbar">
        <div className="gov-container gov-topbar-inner">
          <div className="gov-topbar-left">
            <a href="#main-content" className="skip-link">
              ข้ามไปยังเนื้อหาหลัก
            </a>
            <span className="gov-date-pill" aria-label="วันที่ปัจจุบัน">
              วันที่ {todayLabel}
            </span>
            <span className="gov-std-tag">มาตรฐานเว็บไซต์ภาครัฐ • Standalone System</span>
          </div>

          <div className="gov-a11y-controls" role="group" aria-label="เครื่องมือช่วยการเข้าถึงเนื้อหา">
            <span className="a11y-label">ขนาดตัวอักษร:</span>
            <button
              type="button"
              className={`a11y-btn ${fontScale <= 0.92 ? 'active' : ''}`}
              onClick={() => onChangeFontScale(0.9)}
              aria-label="ลดขนาดตัวอักษร"
              title="ลดขนาดตัวอักษร"
            >
              ก-
            </button>
            <button
              type="button"
              className={`a11y-btn ${fontScale > 0.92 && fontScale < 1.08 ? 'active' : ''}`}
              onClick={() => onChangeFontScale(1)}
              aria-label="ขนาดตัวอักษรปกติ"
              title="ขนาดตัวอักษรปกติ"
            >
              ก
            </button>
            <button
              type="button"
              className={`a11y-btn ${fontScale >= 1.08 ? 'active' : ''}`}
              onClick={() => onChangeFontScale(1.12)}
              aria-label="ขยายขนาดตัวอักษร"
              title="ขยายขนาดตัวอักษร"
            >
              ก+
            </button>
            <span className="a11y-divider" aria-hidden="true" />
            <button
              type="button"
              className={`a11y-btn contrast-toggle ${highContrast ? 'active' : ''}`}
              onClick={onToggleHighContrast}
              aria-pressed={highContrast}
              title="สลับโหมดความเปรียบต่างสูง"
            >
              {highContrast ? 'โหมดปกติ' : 'ความเปรียบต่างสูง'}
            </button>
          </div>
        </div>
      </div>

      {/* Main Agency Identity Banner */}
      <div className="gov-brand-bar">
        <div className="gov-container gov-brand-inner">
          <div className="gov-emblem" aria-hidden="true">
            <ShieldAlert size={30} />
          </div>
          <div className="gov-brand-text">
            <h1 className="gov-system-title">{settings.systemTitle}</h1>
            <p className="gov-agency-name">{settings.agencyName}</p>
            <p className="gov-agency-sub">{settings.agencySubtitle}</p>
          </div>
          <div className="gov-sync-summary" aria-live="polite">
            <div className="sync-pill">
              <span className={`sync-dot ${settings.gasWebhookUrl ? 'online' : 'unconfigured'}`} />
              <span>
                {settings.gasWebhookUrl
                  ? pendingSyncCount > 0
                    ? `รอส่งเข้าระบบเดิม ${pendingSyncCount} รายการ`
                    : 'เชื่อมต่อ Google Apps Script พร้อมใช้'
                  : 'ยังไม่ตั้งค่า Webhook ระบบเดิม'}
                {lastPulledAt ? ` • ซิงก์ล่าสุด ${lastPulledAt} น.` : ''}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Primary Navigation */}
      <nav className="gov-nav" aria-label="เมนูหลักของระบบ">
        <div className="gov-container gov-nav-inner">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`gov-nav-btn ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onChangeTab(item.id)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className={`nav-badge ${item.id === 'settings' && pendingSyncCount > 0 ? 'warn' : ''}`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
