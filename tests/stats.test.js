import { describe, it, expect } from 'vitest';
import stats from '../utils/stats.js';
const { foldDatesIntoEntry, computeMemberStreak } = stats;

describe('foldDatesIntoEntry — gộp ngày vào archive', () => {
  it('entry rỗng + 5 ngày liên tiếp → count 5, tail 5', () => {
    const e = foldDatesIntoEntry(null, ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']);
    expect(e).toEqual({ count: 5, last_date: '2026-01-05', tail_streak: 5 });
  });

  it('5 cũ (liên tiếp) + 2 mới LIỀN KỀ → count 7, tail 7 (nối streak xuyên backup)', () => {
    const old = { count: 5, last_date: '2026-01-05', tail_streak: 5 };
    const e = foldDatesIntoEntry(old, ['2026-01-06', '2026-01-07']);
    expect(e).toEqual({ count: 7, last_date: '2026-01-07', tail_streak: 7 });
  });

  it('mới KHÔNG liền kề last_date cũ → tail reset về run mới, count vẫn cộng dồn', () => {
    const old = { count: 5, last_date: '2026-01-05', tail_streak: 5 };
    const e = foldDatesIntoEntry(old, ['2026-01-08', '2026-01-09']); // bỏ 06,07
    expect(e).toEqual({ count: 7, last_date: '2026-01-09', tail_streak: 2 });
  });

  it('loại trùng ngày + chỉ tính đuôi liên tiếp của đợt mới', () => {
    const e = foldDatesIntoEntry(null, ['2026-01-01', '2026-01-01', '2026-01-03', '2026-01-04']);
    // 3 ngày phân biệt; đuôi liên tiếp = 01-03,01-04 → tail 2
    expect(e.count).toBe(3);
    expect(e.last_date).toBe('2026-01-04');
    expect(e.tail_streak).toBe(2);
  });

  it('không có ngày mới → giữ nguyên entry cũ', () => {
    const old = { count: 4, last_date: '2026-01-04', tail_streak: 2 };
    expect(foldDatesIntoEntry(old, [])).toEqual(old);
  });
});

describe('computeMemberStreak — streak hiện tại', () => {
  it('3 ngày live liên tiếp tới hôm nay', () => {
    const streak = computeMemberStreak(['2026-01-08', '2026-01-07', '2026-01-06'], null, '2026-01-08', true);
    expect(streak).toBe(3);
  });

  it('NỐI streak xuyên backup: archive đuôi 7 + 1 ngày live hôm nay = 8', () => {
    const arch = { count: 7, last_date: '2026-01-07', tail_streak: 7 };
    const streak = computeMemberStreak(['2026-01-08'], arch, '2026-01-08', true);
    expect(streak).toBe(8);
  });

  it('RESET khi quên 1 ngày: archive tới 01-06, thiếu 01-07, live 01-08 → streak 1', () => {
    const arch = { count: 7, last_date: '2026-01-06', tail_streak: 7 };
    const streak = computeMemberStreak(['2026-01-08'], arch, '2026-01-08', true);
    expect(streak).toBe(1);
  });

  it('chưa điểm danh hôm nay nhưng CỬA SỔ CHƯA ĐÓNG → tính từ hôm qua', () => {
    const streak = computeMemberStreak(['2026-01-07', '2026-01-06'], null, '2026-01-08', false);
    expect(streak).toBe(2);
  });

  it('chưa điểm danh hôm nay và CỬA SỔ ĐÓNG → streak 0', () => {
    const streak = computeMemberStreak(['2026-01-07', '2026-01-06'], null, '2026-01-08', true);
    expect(streak).toBe(0);
  });

  it('không có dữ liệu gì → 0', () => {
    expect(computeMemberStreak([], null, '2026-01-08', true)).toBe(0);
  });
});
