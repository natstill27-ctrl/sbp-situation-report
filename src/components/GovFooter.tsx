import type { AppSettings } from '../types/incident';
import { getBoundaryCountSummary } from '../utils/geoLookup';

interface GovFooterProps {
  settings: AppSettings;
}

export function GovFooter({ settings }: GovFooterProps) {
  const { districts, subdistricts } = getBoundaryCountSummary();

  return (
    <footer className="gov-footer" role="contentinfo">
      <div className="gov-container gov-footer-inner">
        <div>
          <p className="footer-title">{settings.systemTitle}</p>
          <p className="footer-sub">{settings.agencyName}</p>
          <p className="footer-note">
            ครอบคลุมฐานข้อมูลขอบเขตพื้นที่ 7 จังหวัดภาคใต้ตอนล่าง ตรัง พัทลุง สตูล สงขลา ปัตตานี ยะลา นราธิวาส ({districts} อำเภอ /{' '}
            {subdistricts} ตำบล) • จัดเก็บสำรองในเครื่องด้วย IndexedDB และเชื่อมต่อ Google Apps Script
          </p>
        </div>
        <div className="footer-meta">
          <p>ออกแบบตามแนวทางมาตรฐานเว็บไซต์ภาครัฐ (WCAG / DGA Accessibility)</p>
          <p>แสดงผลปฏิทินพุทธศักราช (พ.ศ.) • รองรับการส่งออกข้อมูล CSV &amp; สนับสนุนการวิเคราะห์ IPB</p>
        </div>
      </div>
    </footer>
  );
}
