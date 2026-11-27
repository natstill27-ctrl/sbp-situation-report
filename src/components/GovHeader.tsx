import {
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FilePlus2,
  Globe2,
  Home,
  Lock,
  Map as MapIcon,
  Menu,
  Newspaper,
  NotebookPen,
  Settings,
  Unlock,
  X,
} from 'lucide-react';
import type { AppSettings } from '../types/incident';
import type { NewsCategoryId } from '../types/news';
import { NEWS_CATEGORIES } from '../utils/newsCurator';
import { formatThaiDateTime, getBangkokYmd } from '../utils/thaiDateFormat';
import type { ComplianceModalTab } from './GovComplianceModal';

export type ActiveTab =
  | 'news-hub'
  | 'unified-map'
  | 'daily-log'
  | 'entry'
  | 'ipb'
  | 'map-list'
  | 'settings';
export type FontSizeMode = 'sm' | 'md' | 'lg';

export const TAB_BREADCRUMBS: Record<ActiveTab, { group: string; title: string }> = {
  'news-hub': { group: 'ศูนย์ข่าวสาร & สถานการณ์', title: 'ศูนย์ข่าวกรองรายวัน' },
  'unified-map': { group: 'ศูนย์ข่าวสาร & สถานการณ์', title: 'แผนที่สรุปสถานการณ์รวม' },
  'daily-log': { group: 'ปฏิบัติการ ผขว. (เจ้าหน้าที่)', title: 'บันทึกประจำวัน (ชีทแผนก)' },
  entry: { group: 'ปฏิบัติการ ผขว. (เจ้าหน้าที่)', title: 'บันทึกเหตุการณ์ IPB' },
  ipb: { group: 'ปฏิบัติการ ผขว. (เจ้าหน้าที่)', title: 'แดชบอร์ด & แผนที่ IPB' },
  'map-list': { group: 'ปฏิบัติการ ผขว. (เจ้าหน้าที่)', title: 'คลังรายการเหตุการณ์' },
  settings: { group: 'ระบบ', title: 'ตั้งค่า & เชื่อมระบบ' },
};

const TOPBAR_TITLES: Record<ActiveTab, string> = {
  'news-hub': 'ศูนย์ข่าวกรองรายวัน (7 หมวดข่าว • 7 จังหวัดภาคใต้ตอนล่าง)',
  'unified-map': 'แผนที่สรุปสถานการณ์รวม 7 จังหวัด (การประชุม บน.56)',
  'daily-log': 'บันทึกเหตุการณ์ประจำวันของแผนก (ซิงก์ชีทแยก 7 หมวดอัตโนมัติ)',
  entry: 'บันทึกเหตุการณ์ IPB & จับพิกัดอัตโนมัติ',
  ipb: 'แดชบอร์ด & แผนที่วิเคราะห์ IPB',
  'map-list': 'คลังรายการเหตุการณ์ & ส่งออกข้อมูล',
  settings: 'ตั้งค่าระบบและเชื่อมต่อข้อมูล',
};

interface SidebarProps {
  activeTab: ActiveTab;
  onChangeTab: (tab: ActiveTab) => void;
  onGoHome: () => void;
  activeNewsCategory?: 'all' | NewsCategoryId;
  onSelectNewsCategory?: (category: 'all' | NewsCategoryId) => void;
  onOpenComplianceModal?: (modal: ComplianceModalTab) => void;
  staffUnlocked: boolean;
  onRequestStaffUnlock: () => void;
  onLockStaffMode: () => void;
  settings: AppSettings;
  pendingSyncCount: number;
  pendingDailyLogCount?: number;
  totalIncidents: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function W56Sidebar({
  activeTab,
  onChangeTab,
  onGoHome,
  activeNewsCategory = 'all',
  onSelectNewsCategory,
  onOpenComplianceModal,
  staffUnlocked,
  onRequestStaffUnlock,
  onLockStaffMode,
  settings,
  pendingSyncCount,
  pendingDailyLogCount = 0,
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
      label: 'ศูนย์ข่าวสาร & สถานการณ์',
      items: [
        { id: 'news-hub', label: 'ศูนย์ข่าวกรองรายวัน', icon: Newspaper },
        { id: 'unified-map', label: 'แผนที่สรุปสถานการณ์รวม', icon: Globe2 },
      ],
    },
  ];

  if (staffUnlocked) {
    groups.push(
      {
        id: 'ipb',
        label: 'ปฏิบัติการ ผขว. (เจ้าหน้าที่)',
        items: [
          {
            id: 'daily-log',
            label: 'บันทึกประจำวัน (ชีทแผนก)',
            icon: NotebookPen,
            badge: pendingDailyLogCount > 0 ? pendingDailyLogCount : undefined,
            warnBadge: pendingDailyLogCount > 0,
          },
          { id: 'entry', label: 'บันทึกเหตุการณ์ IPB', icon: FilePlus2 },
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
            label: 'ตั้งค่า & เชื่อมระบบ',
            icon: Settings,
            badge: pendingSyncCount > 0 ? pendingSyncCount : undefined,
            warnBadge: pendingSyncCount > 0,
          },
        ],
      }
    );
  }

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
          <button
            type="button"
            className="w56-brand-left w56-brand-btn"
            onClick={() => {
              onGoHome();
              onCloseMobile();
            }}
            aria-label="กลับหน้าหลัก ศูนย์ข่าวกรองรายวัน"
            title="กลับหน้าหลัก ศูนย์ข่าวกรองรายวัน"
          >
            <div className="w56-brand-emblem" aria-hidden="true">
              <img
                src="./wing56-logo.jpg"
                alt=""
                className="w56-brand-logo-img"
              />
            </div>
            {!collapsed && (
              <div className="w56-brand-titles">
                <span className="w56-brand-name">ศูนย์ข่าวกรอง บน.56</span>
                <span className="w56-brand-unit">แผนกข่าวกรอง กองบิน 56</span>
              </div>
            )}
          </button>
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
                    <div key={item.id}>
                      <button
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

                      {item.id === 'news-hub' && !collapsed && onSelectNewsCategory && (
                        <div className="w56-subcat-list" role="group" aria-label="หมวดข่าวกรอง 7 หมวด">
                          {NEWS_CATEGORIES.map((cat) => {
                            const catActive =
                              activeTab === 'news-hub' && activeNewsCategory === cat.id;
                            return (
                              <button
                                key={cat.id}
                                type="button"
                                className={`w56-subcat-item ${catActive ? 'active' : ''}`}
                                onClick={() => {
                                  onSelectNewsCategory(catActive ? 'all' : cat.id);
                                  onCloseMobile();
                                }}
                              >
                                <span
                                  className="w56-subcat-dot"
                                  style={{ backgroundColor: cat.color }}
                                  aria-hidden="true"
                                />
                                <span>{cat.shortLabel}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
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
          {onOpenComplianceModal && (
            <div className={`w56-sidebar-util-row ${collapsed ? 'compact' : ''}`}>
              <button
                type="button"
                className="w56-sidebar-util-btn"
                onClick={() => {
                  onOpenComplianceModal('sitemap');
                  onCloseMobile();
                }}
                aria-label="เปิดผังเว็บไซต์ (Sitemap)"
                title="ผังเว็บไซต์ (Sitemap)"
              >
                <MapIcon size={14} aria-hidden="true" />
                {!collapsed && <span>ผังเว็บ</span>}
              </button>
              <button
                type="button"
                className="w56-sidebar-util-btn"
                onClick={() => {
                  onOpenComplianceModal('faq');
                  onCloseMobile();
                }}
                aria-label="เปิดคู่มือการใช้งานและคำถามที่พบบ่อย"
                title="คู่มือ & คำถามที่พบบ่อย (FAQ)"
              >
                <BookOpen size={14} aria-hidden="true" />
                {!collapsed && <span>คู่มือ/FAQ</span>}
              </button>
            </div>
          )}
          <button
            type="button"
            className={`w56-staff-lock-btn ${staffUnlocked ? 'unlocked' : ''}`}
            onClick={() => {
              if (staffUnlocked) {
                onLockStaffMode();
              } else {
                onRequestStaffUnlock();
              }
              onCloseMobile();
            }}
            aria-label={
              staffUnlocked
                ? 'ล็อกและซ่อนเมนูเจ้าหน้าที่ ผขว.'
                : 'ปลดล็อกโหมดเจ้าหน้าที่ ผขว.'
            }
            title={
              staffUnlocked
                ? 'ล็อกโหมดเจ้าหน้าที่ ผขว.'
                : 'สำหรับเจ้าหน้าที่ ผขว. (ต้องยืนยัน PIN)'
            }
          >
            {staffUnlocked ? (
              <Unlock size={14} aria-hidden="true" />
            ) : (
              <Lock size={14} aria-hidden="true" />
            )}
            {!collapsed && (
              <span>
                {staffUnlocked ? 'โหมดเจ้าหน้าที่ (เปิด) • กดเพื่อล็อก' : 'สำหรับเจ้าหน้าที่ ผขว.'}
              </span>
            )}
          </button>

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
  staffUnlocked: boolean;
  pendingSyncCount: number;
  lastPulledAt?: string | null;
  themeDark: boolean;
  onToggleTheme: () => void;
  fontSizeMode: FontSizeMode;
  onChangeFontSize: (mode: FontSizeMode) => void;
  highContrast: boolean;
  onToggleHighContrast: () => void;
  onOpenMobileSidebar: () => void;
}

export function GovHeader({
  activeTab,
  settings,
  staffUnlocked,
  pendingSyncCount,
  lastPulledAt,
  themeDark,
  onToggleTheme,
  fontSizeMode,
  onChangeFontSize,
  highContrast,
  onToggleHighContrast,
  onOpenMobileSidebar,
}: GovHeaderProps) {
  const todayLabel = formatThaiDateTime(getBangkokYmd(), {
    shortMonth: true,
    includeTime: false,
  });

  return (
    <header className="w56-topbar" role="banner">
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

        <div className="w56-font-wrap">
          <span className="w56-ctl-label hide-md">ตัวอักษร:</span>
          <div className="w56-font-group" role="group" aria-label="ปรับขนาดตัวอักษร 3 ระดับ">
            <button
              type="button"
              className={`w56-font-btn ${fontSizeMode === 'sm' ? 'active-primary' : ''}`}
              onClick={() => onChangeFontSize('sm')}
              aria-pressed={fontSizeMode === 'sm'}
              aria-label="ลดขนาดตัวอักษร (ก-)"
              title="ตัวอักษรเล็ก"
            >
              ก-
            </button>
            <button
              type="button"
              className={`w56-font-btn ${fontSizeMode === 'md' ? 'active-primary' : ''}`}
              onClick={() => onChangeFontSize('md')}
              aria-pressed={fontSizeMode === 'md'}
              aria-label="ขนาดตัวอักษรปกติ (ก)"
              title="ตัวอักษรปกติ"
            >
              ก
            </button>
            <button
              type="button"
              className={`w56-font-btn ${fontSizeMode === 'lg' ? 'active-primary' : ''}`}
              onClick={() => onChangeFontSize('lg')}
              aria-pressed={fontSizeMode === 'lg'}
              aria-label="เพิ่มขนาดตัวอักษร (ก+)"
              title="ตัวอักษรใหญ่ อ่านง่าย"
            >
              ก+
            </button>
          </div>
        </div>

        <button
          type="button"
          className={`w56-ctl-btn hide-sm ${highContrast ? 'active-primary' : ''}`}
          onClick={onToggleHighContrast}
          aria-pressed={highContrast}
          title="สลับโหมดความเปรียบต่างสูง"
        >
          <span>{highContrast ? 'สีปกติ' : 'สีชัดพิเศษ'}</span>
        </button>

        {staffUnlocked && (
          <span
            className="w56-status-pill hide-md"
            title={
              settings.gasWebhookUrl || settings.dailyLogGasUrl
                ? `เชื่อมต่อฐานข้อมูลแผนกแล้ว${lastPulledAt ? ` • ซิงก์ล่าสุด ${lastPulledAt} น.` : ''}`
                : 'ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูลกลาง (บันทึกไว้ในเครื่อง)'
            }
          >
            <span
              className={`sync-dot ${
                settings.gasWebhookUrl || settings.dailyLogGasUrl ? 'online' : 'unconfigured'
              }`}
            />
            <span>
              {settings.gasWebhookUrl || settings.dailyLogGasUrl
                ? pendingSyncCount > 0
                  ? `รอส่ง ${pendingSyncCount} รายการ`
                  : 'เชื่อมต่อระบบแล้ว'
                : 'เก็บข้อมูลในเครื่อง'}
              {lastPulledAt ? ` • ${lastPulledAt}` : ''}
            </span>
          </span>
        )}

        <span className="w56-date-pill hide-sm" aria-label="วันที่ปัจจุบัน">
          <span className="w56-date-dot" aria-hidden="true" />
          <span>{todayLabel}</span>
        </span>
      </div>
    </header>
  );
}

interface GovBreadcrumbProps {
  activeTab: ActiveTab;
  onGoHome: () => void;
}

export function GovBreadcrumb({ activeTab, onGoHome }: GovBreadcrumbProps) {
  const crumb = TAB_BREADCRUMBS[activeTab];

  return (
    <nav className="w56-breadcrumb" aria-label="เส้นนำทางเว็บไซต์ (Breadcrumb)">
      <ol className="w56-breadcrumb-list">
        <li>
          <button
            type="button"
            className="w56-crumb-link"
            onClick={onGoHome}
            aria-label="กลับหน้าหลัก ศูนย์ข่าวกรองรายวัน"
          >
            <Home size={13} aria-hidden="true" />
            <span>หน้าหลัก</span>
          </button>
        </li>
        <li className="w56-crumb-sep" aria-hidden="true">
          &gt;
        </li>
        <li>
          <span className="w56-crumb-group">{crumb.group}</span>
        </li>
        <li className="w56-crumb-sep" aria-hidden="true">
          &gt;
        </li>
        <li>
          <span className="w56-crumb-current" aria-current="page">
            {crumb.title}
          </span>
        </li>
      </ol>
    </nav>
  );
}

interface MobileBottomNavProps {
  activeTab: ActiveTab;
  staffUnlocked: boolean;
  onChangeTab: (tab: ActiveTab) => void;
  onOpenHelp: () => void;
  onOpenMenu: () => void;
}

export function W56MobileBottomNav({
  activeTab,
  staffUnlocked,
  onChangeTab,
  onOpenHelp,
  onOpenMenu,
}: MobileBottomNavProps) {
  return (
    <nav className="w56-mobile-bottom-nav" aria-label="แถบนำทางด่วนสำหรับมือถือ">
      <button
        type="button"
        className={`w56-mob-nav-btn ${activeTab === 'news-hub' ? 'active' : ''}`}
        onClick={() => onChangeTab('news-hub')}
      >
        <Newspaper size={18} aria-hidden="true" />
        <span>ข่าวรายวัน</span>
      </button>
      <button
        type="button"
        className={`w56-mob-nav-btn ${activeTab === 'unified-map' ? 'active' : ''}`}
        onClick={() => onChangeTab('unified-map')}
      >
        <Globe2 size={18} aria-hidden="true" />
        <span>แผนที่รวม</span>
      </button>
      {staffUnlocked ? (
        <button
          type="button"
          className={`w56-mob-nav-btn ${activeTab === 'daily-log' ? 'active' : ''}`}
          onClick={() => onChangeTab('daily-log')}
        >
          <NotebookPen size={18} aria-hidden="true" />
          <span>บันทึกประจำวัน</span>
        </button>
      ) : (
        <button
          type="button"
          className="w56-mob-nav-btn"
          onClick={onOpenHelp}
        >
          <BookOpen size={18} aria-hidden="true" />
          <span>วิธีใช้งาน</span>
        </button>
      )}
      <button
        type="button"
        className="w56-mob-nav-btn"
        onClick={onOpenMenu}
      >
        <Menu size={18} aria-hidden="true" />
        <span>เมนูทั้งหมด</span>
      </button>
    </nav>
  );
}
