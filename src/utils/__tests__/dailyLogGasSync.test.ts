import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../data/defaults';
import { decodeConfigHash, encodeConfigHash } from '../configShare';
import {
  DAILY_LOG_CATEGORY_TABS,
  DEFAULT_DAILY_LOG_MASTER_SHEET,
  generateDailyLogGasCode,
  parsePulledDailyLogsResponse,
} from '../dailyLogGasSync';

describe('dailyLogGasSync & Wing56DailyLog.gs generator', () => {
  it('generates valid JS code covering master tab, all 7 category tabs, and GAS STAFF_PIN verification', () => {
    const code = generateDailyLogGasCode(DEFAULT_SETTINGS);
    expect(() => new Function(code)).not.toThrow();

    expect(code).toContain(DEFAULT_DAILY_LOG_MASTER_SHEET);
    expect(code).toContain('STAFF_PIN');
    expect(code).toContain('verify_staff_pin');
    expect(code).toContain('save_daily_log');
    expect(code).toContain('fetch_daily_logs');
    expect(code).toContain('delete_daily_log');

    for (const label of Object.values(DAILY_LOG_CATEGORY_TABS)) {
      expect(code).toContain(label);
    }
  });

  it('parses pulled daily log rows and preserves empty district/subdistrict without fabricating defaults', () => {
    const pulled = parsePulledDailyLogsResponse({
      ok: true,
      records: [
        {
          id: 'DLOG-2569-001',
          occurredAt: '2026-11-27T09:00',
          category: 'weather',
          title: 'Synthetic flood watch',
          summary: 'Synthetic summary in Songkhla province only.',
          province: 'สงขลา',
          district: '',
          subdistrict: '',
          lat: null,
          lng: null,
          sourceName: 'Thai PBS',
          reliabilityCode: 'B2',
          entryOrigin: 'คัดกรองจากข่าวรายวัน',
          reporter: 'ฝ่ายข่าว',
        },
      ],
    });

    expect(pulled).toHaveLength(1);
    expect(pulled[0].category).toBe('weather');
    expect(pulled[0].province).toBe('สงขลา');
    expect(pulled[0].district).toBe('');
    expect(pulled[0].subdistrict).toBe('');
    expect(pulled[0].lat).toBeNull();
    expect(pulled[0].entryOrigin).toBe('news');
    expect(pulled[0].syncStatus).toBe('synced');
  });

  it('round-trips dailyLogGasUrl through configShare hash without including any PIN', () => {
    const testSettings = {
      ...DEFAULT_SETTINGS,
      gasWebhookUrl: 'https://script.google.com/macros/s/example-ipb/exec',
      dailyLogGasUrl: 'https://script.google.com/macros/s/example-daily-log/exec',
      dailyLogMasterSheetName: 'รวมข่าวกรองประจำวัน',
    };

    const url = encodeConfigHash(testSettings, 'https://example.org/app/');
    const hash = url.slice(url.indexOf('#'));
    const decoded = decodeConfigHash(hash);

    expect(decoded).not.toBeNull();
    expect(decoded?.dailyLogGasUrl).toBe('https://script.google.com/macros/s/example-daily-log/exec');
    expect(decoded?.dailyLogMasterSheetName).toBe('รวมข่าวกรองประจำวัน');

    const bad = encodeConfigHash(
      { ...testSettings, dailyLogGasUrl: 'http://insecure.example.com/exec' },
      'https://example.org/app/'
    );
    expect(decodeConfigHash(bad.slice(bad.indexOf('#')))).toBeNull();
  });
});
