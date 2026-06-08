import { describe, it, expect } from 'vitest';
import validators from '../utils/validators.js';
const { validatePhone, validateEmail, validateUsername, validatePassword, validateFullName } = validators;

describe('validatePhone', () => {
  it('chấp nhận SĐT 10 số bắt đầu bằng 0', () => {
    expect(validatePhone('0905729602')).toBeNull();
  });
  it('từ chối SĐT không bắt đầu bằng 0', () => {
    expect(validatePhone('1905729602')).toBeTruthy();
  });
  it('từ chối SĐT < 10 số', () => {
    expect(validatePhone('090572')).toBeTruthy();
  });
  it('từ chối rỗng', () => {
    expect(validatePhone('')).toBeTruthy();
  });
});

describe('validateEmail', () => {
  it('chấp nhận @gmail.com', () => {
    expect(validateEmail('abc@gmail.com')).toBeNull();
  });
  it('chấp nhận @company.com', () => {
    expect(validateEmail('abc@company.com')).toBeNull();
  });
  it('chấp nhận mọi nhà cung cấp (@yahoo.com, @outlook.com, @icloud.com)', () => {
    expect(validateEmail('abc@yahoo.com')).toBeNull();
    expect(validateEmail('abc@outlook.com')).toBeNull();
    expect(validateEmail('a.b@icloud.com')).toBeNull();
  });
  it('từ chối thiếu tên miền hoặc không có dấu chấm', () => {
    expect(validateEmail('abc@localhost')).toBeTruthy();
    expect(validateEmail('abc')).toBeTruthy();
  });
  it('từ chối dấu chấm liên tiếp', () => {
    expect(validateEmail('a..b@gmail.com')).toBeTruthy();
  });
  it('từ chối bắt đầu bằng dấu chấm', () => {
    expect(validateEmail('.abc@gmail.com')).toBeTruthy();
  });
});

describe('validateUsername', () => {
  it('chấp nhận chữ thường + số', () => {
    expect(validateUsername('lethanhdat')).toBeNull();
  });
  it('từ chối có hoa', () => {
    expect(validateUsername('LeThanhDat')).toBeTruthy();
  });
  it('từ chối có khoảng trắng', () => {
    expect(validateUsername('le thanh')).toBeTruthy();
  });
  it('từ chối < 4 ký tự', () => {
    expect(validateUsername('abc')).toBeTruthy();
  });
});

describe('validatePassword', () => {
  it('chấp nhận mật khẩu mạnh', () => {
    expect(validatePassword('Abc12345!')).toBeNull();
  });
  it('từ chối thiếu hoa', () => {
    expect(validatePassword('abc12345!')).toBeTruthy();
  });
  it('từ chối thiếu số', () => {
    expect(validatePassword('Abcdefg!')).toBeTruthy();
  });
  it('từ chối thiếu ký tự đặc biệt', () => {
    expect(validatePassword('Abc12345')).toBeTruthy();
  });
  it('từ chối < 8 ký tự', () => {
    expect(validatePassword('Ab1!')).toBeTruthy();
  });
});

describe('validateFullName', () => {
  it('chấp nhận tên hợp lệ', () => {
    expect(validateFullName('Lê Thành Đạt')).toBeNull();
  });
  it('từ chối rỗng', () => {
    expect(validateFullName('   ')).toBeTruthy();
  });
});
