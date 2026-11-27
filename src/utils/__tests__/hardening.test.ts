import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../data/defaults';
import { decodeConfigHash, encodeConfigHash } from '../configShare';
import { pullDailyLogsFromGas } from '../dailyLogGasSync';
import { escapeHtml, sanitizeHttpUrl } from '../safeHtml';
import { getBangkokYmd, toBangkokIso16 } from '../thaiDateFormat';

describe('Security, timezone, and resilience hardening', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sanitizes external URLs to http/https only and escapes single quotes in HTML', () => {
    expect(sanitizeHttpUrl('https://example.org/news?id=1')).toBe('https://example.org/news?id=1');
    expect(sanitizeHttpUrl('http://localhost:5173/test')).toBe('http://localhost:5173/test');
    expect(sanitizeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeHttpUrl('not a url')).toBeNull();

    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;'
    );
  });

  it('computes Bangkok (UTC+7) YYYY-MM-DD across UTC midnight and guards Invalid Date', () => {
    // 18:00 UTC on Nov 26 is 01:00 on Nov 27 in Asia/Bangkok
    const utcEvening = new Date('2026-11-26T18:00:00Z');
    expect(getBangkokYmd(utcEvening)).toBe('2026-11-27');

    expect(toBangkokIso16('2026-11-26T18:15:00Z')).toBe('2026-11-27T01:15');
    expect(toBangkokIso16('not-a-valid-date')).toBe('');
    expect(toBangkokIso16('')).toBe('');
  });

  it('rejects non-script.google.com hosts in #config= hash', () => {
    const encoded = encodeConfigHash(
      {
        ...DEFAULT_SETTINGS,
        dailyLogGasUrl: 'https://attacker.example.com/macros/s/FAKE/exec',
      },
      'https://example.github.io/app/'
    );
    expect(decodeConfigHash(encoded.slice(encoded.indexOf('#')))).toBeNull();

    const valid = encodeConfigHash(
      {
        ...DEFAULT_SETTINGS,
        dailyLogGasUrl: 'https://script.google.com/macros/s/SYNTHETIC-TEST/exec',
      },
      'https://example.github.io/app/'
    );
    const decoded = decodeConfigHash(valid.slice(valid.indexOf('#')));
    expect(decoded?.dailyLogGasUrl).toBe(
      'https://script.google.com/macros/s/SYNTHETIC-TEST/exec'
    );
  });

  it('surfaces ok: false error messages from pullDailyLogsFromGas instead of masking them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, message: 'ไม่มีสิทธิ์เข้าถึงชีทแผนก' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await pullDailyLogsFromGas({
      ...DEFAULT_SETTINGS,
      dailyLogGasUrl: 'https://script.google.com/macros/s/SYNTHETIC_TEST/exec',
    });

    expect(res.ok).toBe(false);
    expect(res.records).toEqual([]);
    expect(res.message).toContain('ไม่มีสิทธิ์เข้าถึงชีทแผนก');
  });
});
