import { useEffect } from 'react';
import {
  Accessibility,
  BookOpen,
  ExternalLink,
  FileCheck2,
  Map as MapIcon,
  Rss,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { NewsCategoryId } from '../types/news';
import { NEWS_CATEGORIES } from '../utils/newsCurator';
import type { ActiveTab } from './GovHeader';

export type ComplianceModalTab =
  | 'sitemap'
  | 'faq'
  | 'accessibility'
  | 'website-policy'
  | 'privacy-security';

interface GovComplianceModalProps {
  activeModal: ComplianceModalTab | null;
  staffUnlocked: boolean;
  onChangeModal: (tab: ComplianceModalTab) => void;
  onClose: () => void;
  onNavigateTab: (tab: ActiveTab, newsCategory?: 'all' | NewsCategoryId) => void;
}

const MODAL_TABS: Array<{ id: ComplianceModalTab; label: string; icon: typeof MapIcon }> = [
  { id: 'sitemap', label: 'ผังเว็บไซต์', icon: MapIcon },
  { id: 'faq', label: 'คู่มือ & FAQ', icon: BookOpen },
  { id: 'accessibility', label: 'การเข้าถึง (WCAG)', icon: Accessibility },
  { id: 'website-policy', label: 'นโยบายเว็บไซต์', icon: FileCheck2 },
  { id: 'privacy-security', label: 'PDPA & ความปลอดภัย', icon: ShieldCheck },
];

export function GovComplianceModal({
  activeModal,
  staffUnlocked,
  onChangeModal,
  onClose,
  onNavigateTab,
}: GovComplianceModalProps) {
  useEffect(() => {
    if (!activeModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeModal, onClose]);

  if (!activeModal) return null;

  const thaiYear = new Date().getFullYear() + 543;

  return (
    <div
      className="gov-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="gov-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gov-modal-title"
      >
        <div className="gov-modal-header">
          <div>
            <p className="gov-modal-kicker">มาตรฐานเว็บไซต์ภาครัฐ เวอร์ชัน 3.0 (มสพร. 11-2566)</p>
            <h2 id="gov-modal-title" className="gov-modal-title">
              {MODAL_TABS.find((t) => t.id === activeModal)?.label || 'ข้อมูลมาตรฐานเว็บไซต์'}
            </h2>
          </div>
          <button
            type="button"
            className="gov-modal-close"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="gov-modal-tabs" role="tablist" aria-label="หมวดข้อมูลมาตรฐานเว็บไซต์ภาครัฐ">
          {MODAL_TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = activeModal === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`gov-modal-tab ${selected ? 'active' : ''}`}
                onClick={() => onChangeModal(tab.id)}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="gov-modal-body">
          {activeModal === 'sitemap' && (
            <div className="gov-compliance-section">
              <p className="gov-compliance-lead">
                โครงสร้างเมนูและหน้าจอทั้งหมดของศูนย์บริการด้านการข่าวกรอง ผขว.บก.บน.56 (คลิกเพื่อเปิดหน้าจอที่ต้องการได้ทันที)
              </p>
              <div className="gov-sitemap-grid">
                <div className="gov-sitemap-card">
                  <h3>1. ศูนย์ข่าวสาร (News HUB)</h3>
                  <ul>
                    <li>
                      <button
                        type="button"
                        className="gov-inline-nav-link"
                        onClick={() => onNavigateTab('news-hub', 'all')}
                      >
                        ศูนย์ข่าวกรองรายวัน (ทุกหมวดข่าว)
                      </button>
                    </li>
                    {NEWS_CATEGORIES.map((cat) => (
                      <li key={cat.id}>
                        <button
                          type="button"
                          className="gov-inline-nav-link"
                          onClick={() => onNavigateTab('news-hub', cat.id)}
                        >
                          หมวดข่าว: {cat.label}
                        </button>
                      </li>
                    ))}
                    <li>
                      <a
                        href="./daily-news.xml"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="gov-inline-ext-link"
                      >
                        <Rss size={14} aria-hidden="true" />
                        <span>ฟีดข่าวมาตรฐาน RSS 2.0 (XML)</span>
                        <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    </li>
                  </ul>
                </div>

                <div className="gov-sitemap-card">
                  <h3>2. แผนที่และปฏิบัติการข่าวกรอง</h3>
                  <ul>
                    <li>
                      <button
                        type="button"
                        className="gov-inline-nav-link"
                        onClick={() => onNavigateTab('unified-map')}
                      >
                        แผนที่สรุปสถานการณ์รวม 7 จังหวัด (สำหรับการประชุม บน.56)
                      </button>
                    </li>
                    {staffUnlocked && (
                      <>
                        <li>
                          <button
                            type="button"
                            className="gov-inline-nav-link"
                            onClick={() => onNavigateTab('daily-log')}
                          >
                            บันทึกประจำวันของแผนก (ซิงก์ชีทแยก 7 หมวด)
                          </button>
                        </li>
                        <li>
                          <button
                            type="button"
                            className="gov-inline-nav-link"
                            onClick={() => onNavigateTab('entry')}
                          >
                            บันทึกเหตุการณ์ IPB &amp; จับพิกัดอัตโนมัติ
                          </button>
                        </li>
                        <li>
                          <button
                            type="button"
                            className="gov-inline-nav-link"
                            onClick={() => onNavigateTab('ipb')}
                          >
                            แดชบอร์ด &amp; แผนที่วิเคราะห์ IPB (7 จังหวัดภาคใต้ตอนล่าง)
                          </button>
                        </li>
                        <li>
                          <button
                            type="button"
                            className="gov-inline-nav-link"
                            onClick={() => onNavigateTab('map-list')}
                          >
                            คลังรายการเหตุการณ์ &amp; ส่งออกข้อมูล (CSV / GeoJSON / KML / Word)
                          </button>
                        </li>
                      </>
                    )}
                  </ul>

                  {staffUnlocked && (
                    <>
                      <h3 style={{ marginTop: '1rem' }}>3. ระบบและการเชื่อมต่อ</h3>
                      <ul>
                        <li>
                          <button
                            type="button"
                            className="gov-inline-nav-link"
                            onClick={() => onNavigateTab('settings')}
                          >
                            ตั้งค่าระบบ &amp; เชื่อมต่อ Google Apps Script
                          </button>
                        </li>
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeModal === 'faq' && (
            <div className="gov-compliance-section">
              <p className="gov-compliance-lead">
                คำอธิบายการใช้งานหลักและคำถามที่พบบ่อย (Help &amp; FAQ) สำหรับเจ้าหน้าที่และผู้ใช้งาน
              </p>
              <div className="gov-faq-list">
                <details className="gov-faq-details" open>
                  <summary>1. ระบบศูนย์ข่าวกรองรายวันคัดกรองข่าวอย่างไร และครอบคลุมพื้นที่ใดบ้าง?</summary>
                  <p>
                    ระบบคัดเลือกข่าวสาธารณะจากหน่วยงานรัฐ (เช่น กอ.รมน.ภาค 4 สน.) สื่อหลักระดับประเทศ และสื่อท้องถิ่นที่มีความเป็นกลาง ครอบคลุมพื้นที่รับผิดชอบ 7 จังหวัดภาคใต้ตอนล่าง (ตรัง พัทลุง สตูล สงขลา ปัตตานี ยะลา นราธิวาส) แบ่งเป็น 7 หมวดข่าว ได้แก่ การเมือง เศรษฐกิจ สังคม/ประชาคม ยาเสพติด ความมั่นคง พยากรณ์อากาศ/ภัยพิบัติ และแรงงานต่างด้าว โดยคัดทิ้งข่าวดราม่าหรือข่าวบันเทิงออกอัตโนมัติ
                  </p>
                </details>
                <details className="gov-faq-details">
                  <summary>2. รูปแบบสรุปข่าวแบบ สขช. และมุมมอง 5W1H ต่างกันอย่างไร?</summary>
                  <p>
                    มุมมองเริ่มต้นแสดงผลเป็น 1 ย่อหน้ากระชับความยาว 4–5 บรรทัดตามแนวทางสำนักข่าวกรองแห่งชาติ (สขช.) เพื่อให้เข้าใจสาระสำคัญทันที หากต้องการดูรายละเอียดแยกช่อง Who / What / Where-When / Why-How / Assessment และรหัสความน่าเชื่อถือแหล่งข่าว (B2/C2/C3) สามารถกดปุ่มสลับมุมมองได้บนหน้าศูนย์ข่าวกรอง
                  </p>
                </details>
                <details className="gov-faq-details">
                  <summary>3. ฟอร์มบันทึกเหตุการณ์รองรับพิกัดรูปแบบใดบ้าง?</summary>
                  <p>
                    รองรับทั้งค่า Lat/Lng (Decimal), พิกัดทางทหาร MGRS (เช่น 47N QH ...), UTM (เช่น 47N ...), องศา-ลิปดา-ฟิลิปดา (DMS), ลิงก์ Google Maps และการคลิก/ลากหมุดบนแผนที่โดยตรง เมื่อระบุพิกัดแล้วระบบจะหาชื่อจังหวัด อำเภอ และตำบลในฐานข้อมูล 77 อำเภอ / 568 ตำบลให้อัตโนมัติ
                  </p>
                </details>
                <details className="gov-faq-details">
                  <summary>4. หากใช้งานแบบออฟไลน์ ข้อมูลเหตุการณ์จะสูญหายหรือไม่?</summary>
                  <p>
                    ไม่สูญหาย รายการทั้งหมดจะถูกบันทึกลงฐานข้อมูลในเครื่อง (IndexedDB) ทันทีที่กดบันทึก และเมื่อตั้งค่า URL ของ Google Apps Script แล้ว สามารถกดซิงก์ซ้ำ (Retry Sync) เพื่อส่งขึ้น Google Sheets ของหน่วยงานภายหลังได้
                  </p>
                </details>
                <details className="gov-faq-details">
                  <summary>5. ฟีดข่าว RSS 2.0 (daily-news.xml) ใช้ทำอะไร?</summary>
                  <p>
                    ไฟล์ daily-news.xml จัดทำตามมาตรฐาน RSS 2.0 ของ มสพร. 11-2566 เพื่อให้นำลิงก์ไปเชื่อมต่อกับโปรแกรมอ่านข่าว RSS หรือระบบแจ้งเตือนภายในหน่วยงานได้โดยตรง อัปเดตอัตโนมัติพร้อมกับการดึงข่าวรายวัน
                  </p>
                </details>
              </div>
            </div>
          )}

          {activeModal === 'accessibility' && (
            <div className="gov-compliance-section">
              <p className="gov-compliance-lead">
                แนวทางการเข้าถึงเว็บไซต์สำหรับทุกคน (Web Accessibility) สอดคล้องกับ WCAG 2.1 ระดับ AA และ มสพร. 11-2566
              </p>
              <ul className="gov-policy-list">
                <li>
                  <strong>การปรับขนาดตัวอักษร 3 ระดับ (ก- / ก / ก+):</strong> สามารถย่อหรือขยายขนาดตัวอักษรจากแถบเครื่องมือด้านบนโดยไม่ทำให้โครงสร้างหน้าเว็บซ้อนทับหรือเสียหาย
                </li>
                <li>
                  <strong>โหมดสีสำหรับผู้มีข้อจำกัดทางการมองเห็น:</strong> รองรับโหมดสว่าง (Soft Light), โหมดมืด (Soft Dark) และโหมดความเปรียบต่างสูง (High Contrast)
                </li>
                <li>
                  <strong>การนำทางด้วยแป้นพิมพ์และโปรแกรมอ่านหน้าจอ:</strong> มีลิงก์ &ldquo;ข้ามไปยังเนื้อหาหลัก&rdquo; (Skip Link), รองรับปุ่ม Tab / Enter / Escape, มีป้ายกำกับ ARIA Landmark และสถานะข้อผิดพลาดของฟอร์มอย่างชัดเจน
                </li>
                <li>
                  <strong>ข้อกำหนดเบราว์เซอร์และโปรแกรมเสริมขั้นต่ำ:</strong> แนะนำให้ใช้งานผ่าน Google Chrome, Microsoft Edge, Mozilla Firefox หรือ Apple Safari เวอร์ชันปัจจุบัน (รองรับ HTML5, CSS3 และ ES2020) สำหรับไฟล์ส่งออกแนะนำโปรแกรมเปิดอ่าน CSV/Spreadsheet (Excel / LibreOffice Calc) และไฟล์แผนที่ KML/GeoJSON (Google Earth / QGIS)
                </li>
              </ul>
            </div>
          )}

          {activeModal === 'website-policy' && (
            <div className="gov-compliance-section">
              <p className="gov-compliance-lead">
                นโยบายเว็บไซต์ (Website Policy) และข้อจำกัดความรับผิดชอบของศูนย์บริการด้านการข่าวกรอง ผขว.บก.บน.56
              </p>
              <ul className="gov-policy-list">
                <li>
                  <strong>วัตถุประสงค์:</strong> เว็บไซต์นี้จัดทำขึ้นเพื่อรวบรวมข่าวสารสาธารณะที่คัดกรองแล้วในพื้นที่ 7 จังหวัดภาคใต้ตอนล่าง และสนับสนุนการจัดทำแผนที่/ฐานข้อมูลวิเคราะห์สถานการณ์ (IPB) ของแผนกข่าวกรอง กองบังคับการ กองบิน 56
                </li>
                <li>
                  <strong>ลิขสิทธิ์และสิทธิ์การใช้งาน:</strong> โครงสร้างระบบ รูปแบบการแสดงผล และฐานข้อมูลขอบเขตพื้นที่ที่พัฒนาขึ้น สงวนลิขสิทธิ์ พ.ศ. {thaiYear} แผนกข่าวกรอง กองบังคับการ กองบิน 56 (ข้อมูลข่าวจากสื่อภายนอกเป็นลิขสิทธิ์ของสำนักข่าวต้นทางแต่ละแห่ง)
                </li>
                <li>
                  <strong>ข้อจำกัดความรับผิดชอบ (Disclaimer):</strong> ข่าวสารในศูนย์ข่าวกรองรายวันรวบรวมและสรุปความจากแหล่งข่าวเปิดสาธารณะและข่าวประชาสัมพันธ์ทางการเพื่อประกอบการติดตามสถานการณ์เท่านั้น ผู้ใช้งานควรตรวจสอบยืนยันกับแหล่งข่าวต้นทางหรือเอกสารสั่งการทางการก่อนนำไปอ้างอิงเชิงปฏิบัติการ
                </li>
                <li>
                  <strong>การเชื่อมโยงไปยังเว็บไซต์ภายนอก:</strong> ลิงก์ข่าวต้นทางเชื่อมโยงไปยังเว็บไซต์ภายนอกซึ่งอยู่นอกเหนือการควบคุมของระบบนี้ หน่วยงานไม่รับผิดชอบต่อเนื้อหาหรือการเปลี่ยนแปลงของเว็บไซต์ปลายทาง
                </li>
              </ul>
            </div>
          )}

          {activeModal === 'privacy-security' && (
            <div className="gov-compliance-section">
              <p className="gov-compliance-lead">
                นโยบายคุ้มครองข้อมูลส่วนบุคคล (พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562), การจัดเก็บข้อมูลบนอุปกรณ์ และความมั่นคงปลอดภัยเว็บไซต์
              </p>
              <ul className="gov-policy-list">
                <li>
                  <strong>ไม่ใช้คุกกี้ติดตามหรือโฆษณาจากบุคคลที่สาม:</strong> เว็บไซต์แบบ Static นี้ไม่ฝังคุกกี้โฆษณา คุกกี้วิเคราะห์พฤติกรรม หรือตัวติดตามจากบุคคลที่สาม (Zero Third-Party Tracking Cookies)
                </li>
                <li>
                  <strong>การจัดเก็บข้อมูลในเบราว์เซอร์ (LocalStorage &amp; IndexedDB):</strong> ระบบบันทึกค่าการตั้งค่าการแสดงผล (เช่น ธีมสว่าง/มืด ขนาดตัวอักษร สถานะแถบเมนู) ใน <code>localStorage</code> และเก็บบันทึกเหตุการณ์/จุดเฝ้าระวังเฉพาะในเครื่องของผู้ใช้งานผ่าน <code>IndexedDB</code> เท่านั้น ผู้ใช้งานสามารถล้างข้อมูลในเครื่องได้ตลอดเวลา
                </li>
                <li>
                  <strong>การเชื่อมต่อระบบ Google Apps Script (ถ้าเปิดใช้):</strong> ระบบซิงก์ข้อมูลจะทำงานต่อเมื่อผู้ดูแลระบบของหน่วยงานกรอก URL ของ Google Apps Script (/exec) ในหน้า &ldquo;ตั้งค่า&rdquo; ด้วยตนเองเท่านั้น โดยไม่ฝัง URL ปฏิบัติการหรือข้อมูลลับไว้ในซอร์สโค้ดสาธารณะ
                </li>
                <li>
                  <strong>ความมั่นคงปลอดภัยด้านการสื่อสารและการพัฒนา:</strong> เว็บไซต์ให้บริการผ่านการเข้ารหัส HTTPS/TLS มีการตรวจสอบความปลอดภัยโค้ดและสแกนข้อมูลลับอัตโนมัติ (Secret Scanning Gate) ก่อนเผยแพร่ทุกครั้ง เพื่อป้องกันการรั่วไหลของข้อมูลปฏิบัติการและข้อมูลส่วนบุคคล
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
