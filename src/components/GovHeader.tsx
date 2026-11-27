import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FilePlus2,
  Menu,
  Newspaper,
  Settings,
  Shield,
  X,
} from 'lucide-react';
import type { AppSettings } from '../types/incident';
import { formatThaiDateTime } from '../utils/thaiDate';

export type ActiveTab = 'news-hub' | 'entry' | 'ipb' | 'map-list' | 'settings';

const TOPBAR_TITLES: Record<ActiveTab, string> = {
  'news-hub': 'ศูนย์ข่าวกรองรายวัน (7 หมวดข่าว • 7 จังหวัดภาคใต้ตอนล่าง)',
  entry: 'บันทึกเหตุการณ์ & จับพิกัดอัตโนมัติ',
  ipb: 'แดชบอร์ด & แผนที่วิเคราะห์ IPB',
  'map-list': 'คลังรายการเหตุการณ์ & ส่งออกข้อมูล',
  settings: 'ตั้งค่าระบบ & เชื่อมต่อ Google Apps Script',
};

interface SidebarProps {
  activeTab: ActiveTab;
  onChangeTab: (tab: ActiveTab) => void;
  settings: AppSettings;
  pendingSyncCount: number;
  totalIncidents: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function W56Sidebar({
  activeTab,
  onChangeTab,
  settings,
  pendingSyncCount,
  totalIncidents,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const groups: Array<{
    id: string;
    label: string;
    items: Array<{
      id: ActiveTab;
      label: string;
      icon: typeof Newspaper;
      badge?: number;
      warnBadge?: boolean;
    }>;
  }> = [
    {
      id: 'intel',
      label: 'ศูนย์ข่าวสาร',
      items: [{ id: 'news-hub', label: 'ศูนย์ข่าวกรองรายวัน', icon: Newspaper }],
    },
    {
      id: 'ipb',
      label: 'ปฏิบัติการ IPB',
      items: [
        { id: 'entry', label: 'บันทึกเหตุการณ์', icon: FilePlus2 },
        { id: 'ipb', label: 'แดชบอร์ด & แผนที่ IPB', icon: BarChart3 },
        {
          id: 'map-list',
          label: 'คลังรายการเหตุการณ์',
          icon: ClipboardList,
          badge: totalIncidents > 0 ? totalIncidents : undefined,
        },
      ],
    },
    {
      id: 'system',
      label: 'ระบบ',
      items: [
        {
          id: 'settings',
          label: 'ตั้งค่า & เชื่อมระบบเดิม',
          icon: Settings,
          badge: pendingSyncCount > 0 ? pendingSyncCount : undefined,
          warnBadge: pendingSyncCount > 0,
        },
      ],
    },
  ];

  const handleSelect = (tab: ActiveTab) => {
    onChangeTab(tab);
    onCloseMobile();
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="w56-sidebar-backdrop"
          aria-hidden="true"
          onClick={onCloseMobile}
        />
      )}

      <aside
        aria-label="แถบเมนูนำทางหลัก"
        className={`w56-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
      >
        <div className="w56-sidebar-brand">
          <div className="w56-brand-left">
            <div className="w56-brand-emblem" aria-hidden="true">
              <Shield size={20} />
            </div>
            {!collapsed && (
              <div className="w56-brand-titles">
                <span className="w56-brand-name">Intelligence Hub</span>
                <span className="w56-brand-unit">ผขว.บก.บน.56</span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="w56-mobile-close"
            onClick={onCloseMobile}
            aria-label="ปิดเมนู"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav className="w56-sidebar-nav" aria-label="เมนูหลักของระบบ">
          {groups.map((group) => (
            <div key={group.id} className="w56-nav-group">
              {!collapsed ? (
                <p className="w56-nav-group-label">{group.label}</p>
              ) : (
                <div className="w56-nav-divider" aria-hidden="true" />
              )}
              <div className="w56-nav-list">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`w56-nav-item ${isActive ? 'active' : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      title={collapsed ? item.label : undefined}
                      onClick={() => handleSelect(item.id)}
                    >
                      {isActive && <span className="w56-nav-indicator" aria-hidden="true" />}
                      <Icon size={17} className="w56-nav-icon" aria-hidden="true" />
                      {!collapsed && <span className="w56-nav-text">{item.label}</span>}
                      {!collapsed && item.badge !== undefined && (
                        <span className={`w56-nav-badge ${item.warnBadge ? 'warn' : ''}`}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="w56-sidebar-footer">
          {!collapsed && (
            <div className="w56-sidebar-unit-meta" title={settings.agencySubtitle}>
              <span className="w56-unit-dot" />
              <span className="w56-unit-text">7 จว. ภาคใต้ตอนล่าง</span>
            </div>
          )}
          <button
            type="button"
            className="w56-collapse-btn"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'ขยายแถบเมนูด้านข้าง' : 'ย่อแถบเมนูด้านข้าง'}
            title={collapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู'}
          >
            {!collapsed && <span>ย่อแถบเมนู</span>}
            {collapsed ? (
              <ChevronRight size={16} aria-hidden="true" />
            ) : (
              <ChevronLeft size={16} aria-hidden="true" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
}

interface GovHeaderProps {
  activeTab: ActiveTab;
  settings: AppSettings;
  pendingSyncCount: number;
  lastPulledAt?: string | null;
  themeDark: boolean;
  onToggleTheme: () => void;
  fontLarge: boolean;
  onToggleFontLarge: () => void;
  highContrast: boolean;
  onToggleHighContrast: () => void;
  onOpenMobileSidebar: () => void;
}

export function GovHeader({
  activeTab,
  settings,
  pendingSyncCount,
  lastPulledAt,
  themeDark,
  onToggleTheme,
  fontLarge,
  onToggleFontLarge,
  highContrast,
  onToggleHighContrast,
  onOpenMobileSidebar,
}: GovHeaderProps) {
  const todayLabel = formatThaiDateTime(new Date().toISOString().slice(0, 10), {
    shortMonth: true,
    includeTime: false,
  });

  return (
    <header className="w56-topbar" role="banner">
      <a href="#main-content" className="skip-link">
        ข้ามไปยังเนื้อหาหลัก
      </a>

      <div className="w56-topbar-left">
        <button
          type="button"
          className="w56-mobile-trigger"
          onClick={onOpenMobileSidebar}
          aria-label="เปิดเมนู"
        >
          <Menu size={18} aria-hidden="true" />
        </button>
        <div className="w56-topbar-titles">
          <h1 className="w56-topbar-title">{TOPBAR_TITLES[activeTab] || settings.systemTitle}</h1>
          <p className="w56-topbar-sub">{settings.systemTitle} • {settings.agencyName}</p>
        </div>
      </div>

      <div className="w56-topbar-actions">
        <button
          type="button"
          className="w56-ctl-btn"
          onClick={onToggleTheme}
          aria-label={themeDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
        >
          <span>{themeDark ? '☀ โหมดสว่าง' : '☾ โหมดมืด'}</span>
        </button>

        <button
          type="button"
          className={`w56-ctl-btn ${fontLarge ? 'active-primary' : ''}`}
          onClick={onToggleFontLarge}
          aria-pressed={fontLarge}
          aria-label={fontLarge ? 'กลับเป็นอักษรขนาดปกติ' : 'เปลี่ยนเป็นอักษรใหญ่ สบายตา'}
        >
          <span>ก+{fontLarge ? ' อักษรใหญ่ (เปิด)' : ' อักษรใหญ่'}</span>
        </button>

        <button
          type="button"
          className={`w56-ctl-btn hide-sm ${highContrast ? 'active-primary' : ''}`}
          onClick={onToggleHighContrast}
          aria-pressed={highContrast}
          title="สลับโหมดความเปรียบต่างสูง"
        >
          <span>{highContrast ? 'โหมดปกติ' : 'ความเปรียบต่างสูง'}</span>
        </button>

        <span
          className="w56-status-pill"
          title={
            settings.gasWebhookUrl
              ? `เชื่อมต่อ GAS พร้อมใช้${lastPulledAt ? ` • ซิงก์ล่าสุด ${lastPulledAt} น.` : ''}`
              : 'ยังไม่ตั้งค่า Webhook Google Apps Script'
          }
        >
          <span className={`sync-dot ${settings.gasWebhookUrl ? 'online' : 'unconfigured'}`} />
          <span className="hide-md">
            {settings.gasWebhookUrl
              ? pendingSyncCount > 0
                ? `รอซิงก์ ${pendingSyncCount}`
                : 'GAS พร้อมใช้'
              : 'โหมดออฟไลน์'}
            {lastPulledAt ? ` • ${lastPulledAt}` : ''}
          </span>
        </span>

        <span className="w56-date-pill hide-sm" aria-label="วันที่ปัจจุบัน">
          <span className="w56-date-dot" aria-hidden="true" />
          <span>{todayLabel}</span>
        </span>
      </div>
    </header>
  );
}
