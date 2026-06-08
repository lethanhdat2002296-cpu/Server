import { describe, it, expect } from 'vitest';
import mask from '../utils/mask.js';
const { maskPhone, maskEmail } = mask;

describe('maskPhone — KHÔNG được lộ 4 số cuối (phần dùng xác minh)', () => {
  it('SĐT 10 số: chỉ hiện 4 số đầu, phần còn lại che', () => {
    const out = maskPhone('0905123402');
    expect(out.startsWith('0905')).toBe(true);
    expect(out).not.toContain('3402');      // 4 số cuối tuyệt đối không lộ
    expect(out.slice(-4)).toBe('****');     // 4 ký tự cuối là dấu sao
  });
  it('rỗng → rỗng', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone(null)).toBe('');
  });
  it('không lộ trọn vẹn số', () => {
    expect(maskPhone('0987654321')).not.toContain('4321');
  });
});

describe('maskEmail', () => {
  it('hiện 3 ký tự đầu + tên miền', () => {
    expect(maskEmail('ledat@gmail.com')).toBe('led***@gmail.com');
  });
  it('local ngắn', () => {
    expect(maskEmail('ab@x.com')).toBe('ab***@x.com');
  });
  it('rỗng → rỗng', () => {
    expect(maskEmail('')).toBe('');
  });
});
