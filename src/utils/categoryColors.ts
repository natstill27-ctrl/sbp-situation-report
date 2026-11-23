const CATEGORY_COLOR_MAP: Array<[RegExp, string]> = [
  [/ปะทะ|ปิดล้อม/, '#b91c1c'],
  [/ปืน|ซุ่มยิง|ลอบยิง/, '#dc2626'],
  [/ระเบิด/, '#991b1b'],
  [/วางเพลิง/, '#c2410c'],
  [/ตรวจยึด|จับกุม/, '#1d4ed8'],
  [/ก่อกวน|ตะปู|เผายาง/, '#b45309'],
  [/อุบัติเหตุ|ภัยพิบัติ/, '#0369a1'],
];

const PALETTE = ['#0f4c81', '#1d4ed8', '#b91c1c', '#c2410c', '#0f766e', '#7c2d12', '#4338ca', '#475569'];

export function getCategoryColor(category: string, indexHint = 0): string {
  for (const [pattern, color] of CATEGORY_COLOR_MAP) {
    if (pattern.test(category)) return color;
  }
  return PALETTE[Math.abs(indexHint) % PALETTE.length];
}
