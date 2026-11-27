import { Accessibility, BookOpen, FileCheck2, Map as MapIcon, Rss, ShieldCheck } from 'lucide-react';
import type { AppSettings } from '../types/incident';
import { getBoundaryCountSummary } from '../utils/geoLookup';
import type { ComplianceModalTab } from './GovComplianceModal';
import type { ActiveTab } from './GovHeader';

interface GovFooterProps {
  settings: AppSettings;
  staffUnlocked: boolean;
  onChangeTab: (tab: ActiveTab) => void;
  onOpenModal: (tab: ComplianceModalTab) => void;
}

export function GovFooter({ settings, staffUnlocked, onChangeTab, onOpenModal }: GovFooterProps) {
  const { districts, subdistricts } = getBoundaryCountSummary();
  const thaiYear = new Date().getFullYear() + 543;

  return (
    <footer className="gov-footer" role="contentinfo">
      <div className="gov-container">
        <div className="gov-footer-grid">
          {/* 1 & 2: Agency info & public official unit contact */}
          <div className="footer-col">
            <div className="footer-brand-row">
              <div className="footer-emblem" aria-hidden="true">
                <img
                  src="./wing56-logo.jpg"
                  alt=""
                  className="w56-brand-logo-img"
                />
              </div>
              <div>
                <p className="footer-title">{settings.systemTitle}</p>
                <p className="footer-sub">{settings.agencyName}</p>
              </div>
            </div>
            <address className="footer-address">
              กองบิน 56 ตำบลโคกม่วง อำเภอคลองหอยโข่ง จังหวัดสงขลา 90115
              <br />
              พื้นที่รับผิดชอบ: 7 จังหวัดภาคใต้ตอนล่าง ({districts} อำเภอ / {subdistricts} ตำบล)
            </address>
            <p className="footer-note">
              จัดเก็บสำรองข้อมูลในเครื่องด้วย IndexedDB และเชื่อมต่อ Google Apps Script ตามสิทธิ์หน่วยงาน
            </p>
          </div>

          {/* 1 (DGA Text Main Menu) & Sitemap / FAQ / RSS */}
          <nav className="footer-col" aria-label="เมนูหลักท้ายหน้าและผังเว็บไซต์">
            <p className="footer-heading">เมนูหลักและแผนผังเว็บไซต์</p>
            <ul className="footer-link-list">
              <li>
                <button type="button" className="footer-link" onClick={() => onChangeTab('news-hub')}>
                  ศูนย์ข่าวกรองรายวัน (7 หมวดข่าว)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="footer-link"
                  onClick={() => onChangeTab('unified-map')}
                >
                  แผนที่สรุปสถานการณ์รวม 7 จังหวัด
                </button>
              </li>
              {staffUnlocked && (
                <>
                  <li>
                    <button
                      type="button"
                      className="footer-link"
                      onClick={() => onChangeTab('daily-log')}
                    >
                      บันทึกเหตุการณ์ประจำวัน (ชีทแผนก)
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="footer-link"
                      onClick={() => onChangeTab('entry')}
                    >
                      บันทึกเหตุการณ์ IPB &amp; จับพิกัดอัตโนมัติ
                    </button>
                  </li>
                  <li>
                    <button type="button" className="footer-link" onClick={() => onChangeTab('ipb')}>
                      แดชบอร์ด &amp; แผนที่วิเคราะห์ IPB
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="footer-link"
                      onClick={() => onChangeTab('map-list')}
                    >
                      คลังรายการเหตุการณ์ &amp; ส่งออกข้อมูล
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="footer-link"
                      onClick={() => onChangeTab('settings')}
                    >
                      ตั้งค่าระบบ &amp; เชื่อมระบบ
                    </button>
                  </li>
                </>
              )}
              <li className="footer-util-pair">
                <button
                  type="button"
                  className="footer-link"
                  onClick={() => onOpenModal('sitemap')}
                >
                  <MapIcon size={13} aria-hidden="true" />
                  <span>ผังเว็บไซต์</span>
                </button>
                <button type="button" className="footer-link" onClick={() => onOpenModal('faq')}>
                  <BookOpen size={13} aria-hidden="true" />
                  <span>คู่มือ &amp; FAQ</span>
                </button>
                <a
                  href="./daily-news.xml"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="footer-link"
                >
                  <Rss size={13} aria-hidden="true" />
                  <span>RSS 2.0</span>
                </a>
              </li>
            </ul>
          </nav>

          {/* 5 & 6: 3 Mandatory Policies + Web Accessibility & Browser Requirements */}
          <div className="footer-col">
            <p className="footer-heading">นโยบายเว็บไซต์และการเข้าถึง (มสพร. 11-2566)</p>
            <ul className="footer-link-list">
              <li>
                <button
                  type="button"
                  className="footer-link"
                  onClick={() => onOpenModal('website-policy')}
                >
                  <FileCheck2 size={13} aria-hidden="true" />
                  <span>นโยบายเว็บไซต์ &amp; ข้อจำกัดความรับผิดชอบ</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="footer-link"
                  onClick={() => onOpenModal('privacy-security')}
                >
                  <ShieldCheck size={13} aria-hidden="true" />
                  <span>นโยบายคุ้มครองข้อมูลส่วนบุคคล (PDPA) &amp; ความปลอดภัย</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="footer-link"
                  onClick={() => onOpenModal('accessibility')}
                >
                  <Accessibility size={13} aria-hidden="true" />
                  <span>การเข้าถึงเว็บไซต์ (WCAG 2.1 AA) &amp; เบราว์เซอร์ที่รองรับ</span>
                </button>
              </li>
            </ul>
            <p className="footer-note" style={{ marginTop: '0.45rem' }}>
              รองรับ Chrome / Edge / Firefox / Safari รุ่นปัจจุบัน • ปฏิทินพุทธศักราช (พ.ศ.) • ไม่ใช้คุกกี้ติดตามบุคคลที่สาม
            </p>
          </div>
        </div>

        {/* 3 & 4: Copyright & Disclaimer bar */}
        <div className="footer-bottom-bar">
          <p>
            &copy; พ.ศ. {thaiYear} แผนกข่าวกรอง กองบังคับการ กองบิน 56 • ข้อจำกัดความรับผิดชอบ:
            ข้อมูลข่าวสาธารณะคัดกรองเพื่อสนับสนุนการติดตามสถานการณ์ ควรตรวจยืนยันกับต้นทางก่อนอ้างอิงปฏิบัติการ
          </p>
          <span className="footer-std-pill">DGA Web Std 3.0 • WCAG 2.1 AA</span>
        </div>
      </div>
    </footer>
  );
}

