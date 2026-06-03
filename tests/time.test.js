import { describe, it, expect } from 'vitest';
import time from '../utils/time.js';
const { addDays, daysBetween } = time;

describe('addDays', () => {
  it('cộng ngày trong cùng tháng', () => {
    expect(addDays('2026-06-02', 1)).toBe('2026-06-03');
  });
  it('cộng qua ranh giới tháng', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
  });
  it('trừ ngày', () => {
    expect(addDays('2026-06-02', -1)).toBe('2026-06-01');
  });
  it('trừ qua ranh giới tháng', () => {
    expect(addDays('2026-06-01', -1)).toBe('2026-05-31');
  });
  it('cộng qua ranh giới năm', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('xử lý năm nhuận (2024-02-28 + 1 = 02-29)', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
});

describe('daysBetween', () => {
  it('cùng ngày = 1 (inclusive)', () => {
    expect(daysBetween('2026-06-02', '2026-06-02')).toBe(1);
  });
  it('2 ngày liên tiếp = 2', () => {
    expect(daysBetween('2026-06-01', '2026-06-02')).toBe(2);
  });
  it('cả tuần = 7', () => {
    expect(daysBetween('2026-06-01', '2026-06-07')).toBe(7);
  });
  it('qua ranh giới tháng', () => {
    expect(daysBetween('2026-05-30', '2026-06-02')).toBe(4);
  });
});
