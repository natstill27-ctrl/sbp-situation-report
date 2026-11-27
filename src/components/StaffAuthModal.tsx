import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, KeyRound, Lock, Settings, ShieldCheck, X } from 'lucide-react';
import { verifyStaffPinWithGas } from '../utils/dailyLogGasSync';
import { useModalFocusTrap } from '../utils/useModalFocusTrap';

interface StaffAuthModalProps {
  open: boolean;
  dailyLogGasUrl: string;
  hasLegacyGasUrl: boolean;
  onClose: () => void;
  onUnlockSuccess: (pin: string, goToSettings?: boolean) => void;
}

export function StaffAuthModal({
  open,
  dailyLogGasUrl,
  hasLegacyGasUrl,
  onClose,
  onUnlockSuccess,
}: StaffAuthModalProps) {
  const [pin, setPin] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const cleanDailyUrl = dailyLogGasUrl.trim();
  const isConfigured = Boolean(cleanDailyUrl);

  useModalFocusTrap(open, dialogRef, onClose);

  useEffect(() => {
    if (!open) {
      setPin('');
      setError('');
      setVerifying(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!pin.trim()) {
      setError('กรุณากรอกรหัสผ่าน/PIN ของเจ้าหน้าที่ ผขว.');
      return;
    }
    setVerifying(true);
    try {
      const res = await verifyStaffPinWithGas(cleanDailyUrl, pin);
      if (res.ok) {
        onUnlockSuccess(pin.trim(), false);
      } else {
        setError(res.message);
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div
      className="gov-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="gov-modal-dialog gov-auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-auth-title"
        tabIndex={-1}
      >
        <div className="gov-modal-header">
          <div>
            <p className="gov-modal-kicker">สิทธิ์ปฏิบัติการภายในแผนกข่าวกรอง</p>
            <h2 id="staff-auth-title" className="gov-modal-title">
              ปลดล็อกโหมดเจ้าหน้าที่ ผขว.บก.บน.56
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

        <div className="gov-modal-body">
          {isConfigured ? (
            <form onSubmit={handleSubmit}>
              <p className="gov-compliance-lead">
                กรอกรหัสผ่านเจ้าหน้าที่แผนกข่าวกรอง กองบิน 56 เพื่อเปิดใช้งานหน้าบันทึกประจำวัน, งานวิเคราะห์ IPB และการตั้งค่าระบบ (ระบบจะล็อกกลับอัตโนมัติเมื่อปิดหน้าต่างเบราว์เซอร์)
              </p>

              <div className="form-group">
                <label htmlFor="staff-pin-input" className="form-label required">
                  รหัสผ่านเจ้าหน้าที่
                </label>
                <div className="input-with-icon">
                  <KeyRound size={16} aria-hidden="true" />
                  <input
                    id="staff-pin-input"
                    type="password"
                    autoFocus
                    autoComplete="off"
                    className={`form-input ${error ? 'is-error' : ''}`}
                    value={pin}
                    onChange={(e) => {
                      setPin(e.target.value);
                      setError('');
                    }}
                    placeholder="กรอกรหัสผ่านเจ้าหน้าที่..."
                    aria-invalid={Boolean(error)}
                  />
                </div>
              </div>

              {error && (
                <div className="inline-alert danger" role="alert" style={{ marginBottom: '0.85rem' }}>
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={verifying}>
                  <ShieldCheck size={16} aria-hidden="true" />
                  <span>{verifying ? 'กำลังตรวจสอบรหัส...' : 'ยืนยันสิทธิ์เจ้าหน้าที่'}</span>
                </button>
                <button type="button" className="btn btn-outline" onClick={onClose}>
                  ยกเลิก
                </button>
              </div>
            </form>
          ) : (
            <div>
              <div className="inline-alert info" style={{ marginBottom: '0.9rem' }}>
                <Lock size={17} aria-hidden="true" />
                <span>
                  {hasLegacyGasUrl
                    ? 'ตรวจพบการเชื่อมต่อระบบเดิม แต่เครื่องนี้ยังไม่ได้เชื่อมลิงก์ชีทบันทึกประจำวันของแผนก'
                    : 'เบราว์เซอร์นี้ยังไม่ได้ตั้งค่าลิงก์เชื่อมต่อระบบฐานข้อมูลของแผนก'}
                </span>
              </div>
              <p className="gov-compliance-lead">
                ผู้ดูแลระบบสามารถเข้าไปวางลิงก์เชื่อมต่อในหน้าตั้งค่า (เมื่อเชื่อมระบบแล้ว ระบบจะเปิดให้ยืนยันรหัสผ่านเจ้าหน้าที่ทุกครั้งก่อนเข้าใช้งาน)
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onUnlockSuccess('', true)}
                >
                  <Settings size={16} aria-hidden="true" />
                  <span>ไปหน้าตั้งค่าเชื่อมต่อระบบ</span>
                </button>
                <button type="button" className="btn btn-outline" onClick={onClose}>
                  ปิด
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
