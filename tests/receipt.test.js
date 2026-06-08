import { describe, it, expect } from 'vitest';
import receipt from '../utils/receipt.js';
const { analyzeReceiptText, extractAmount } = receipt;

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

  it('CHỈ từ generic (VND/DONG/SUCCESS) → KHÔNG phải biên lai (giảm dương tính giả)', () => {
    expect(analyzeReceiptText('VND DONG SUCCESS').is_receipt).toBe(false);
  });
});

describe('extractAmount', () => {
  it('lấy số tiền có phân tách (500.000)', () => {
    expect(extractAmount('So tien: 500.000 VND')).toBe(500000);
  });
  it('lấy số tiền dạng 1,500,000', () => {
    expect(extractAmount('Amount 1,500,000d')).toBe(1500000);
  });
  it('bỏ qua số tài khoản dài, lấy đúng số tiền', () => {
    expect(extractAmount('STK 19036020562019 so tien 500000')).toBe(500000);
  });
  it('không có số tiền hợp lý → null', () => {
    expect(extractAmount('khong co so')).toBeNull();
    expect(extractAmount('')).toBeNull();
  });
});
