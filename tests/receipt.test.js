import { describe, it, expect } from 'vitest';
import receipt from '../utils/receipt.js';
const { analyzeReceiptText } = receipt;

describe('analyzeReceiptText', () => {
  it('rỗng/không phải chuỗi → không phải biên lai', () => {
    expect(analyzeReceiptText('').is_receipt).toBe(false);
    expect(analyzeReceiptText(null).is_receipt).toBe(false);
    expect(analyzeReceiptText(undefined).is_receipt).toBe(false);
  });

  it('biên lai thật (nhiều từ khóa) → is_receipt true + nhận diện ngân hàng', () => {
    const r = analyzeReceiptText('VIETCOMBANK CHUYEN KHOAN THANH CONG 500000 VND');
    expect(r.is_receipt).toBe(true);
    expect(r.detected_banks).toContain('VIETCOMBANK');
  });

  it('text ngẫu nhiên không liên quan → false', () => {
    expect(analyzeReceiptText('hello world day la text bat ky').is_receipt).toBe(false);
  });

  it('chỉ 1 từ khóa → chưa đủ (cần >=2)', () => {
    expect(analyzeReceiptText('TRANSFER').is_receipt).toBe(false);
  });

  it('detected_banks loại bỏ từ generic (VND/SUCCESS...)', () => {
    const r = analyzeReceiptText('MBBANK SO TIEN 200000 VND SUCCESS');
    expect(r.detected_banks).not.toContain('VND');
    expect(r.detected_banks).not.toContain('SUCCESS');
    expect(r.detected_banks).toContain('MBBANK');
  });
});
