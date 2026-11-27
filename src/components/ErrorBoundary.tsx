import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Top-level fallback UI so unexpected runtime/render errors never leave a blank white page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            background: '#f4f6f9',
            color: '#162032',
            fontFamily: "'Noto Sans Thai', 'Sarabun', sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: 480,
              width: '100%',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 14,
              padding: '1.75rem',
              textAlign: 'center',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
            }}
          >
            <h1 style={{ margin: '0 0 0.6rem', fontSize: '1.25rem' }}>
              ขออภัย เกิดข้อผิดพลาดในการแสดงผลหน้าจอ
            </h1>
            <p style={{ margin: '0 0 1.25rem', color: '#475569', lineHeight: 1.65 }}>
              ข้อมูลที่บันทึกไว้ในเครื่องยังคงปลอดภัย กรุณากดปุ่มด้านล่างเพื่อโหลดหน้าเว็บใหม่อีกครั้ง
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: '#1d5bb8',
                color: '#ffffff',
                border: 'none',
                borderRadius: 10,
                padding: '0.7rem 1.4rem',
                fontSize: '1rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              โหลดหน้าเว็บใหม่
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
