import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../../data/defaults';
import { getMilSymbolSpec, renderMilSymbolSvg } from '../milSymbols';

describe('MIL-STD-2525 Military Symbology Helper', () => {
  it('renders valid SVG for every default IPB category', () => {
    for (const cat of DEFAULT_CATEGORIES) {
      const spec = getMilSymbolSpec(cat);
      expect(spec.sidc).toHaveLength(15);
      const svg = renderMilSymbolSvg(cat);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('</svg>');
    }
  });

  it('falls back cleanly for unknown categories', () => {
    const spec = getMilSymbolSpec('หมวดหมู่ใหม่ที่ยังไม่ได้ตั้งค่า');
    expect(spec.sidc).toBe('SUGPU-----****X');
    const svg = renderMilSymbolSvg('หมวดหมู่ใหม่ที่ยังไม่ได้ตั้งค่า', 28);
    expect(svg.startsWith('<svg')).toBe(true);
  });
});
