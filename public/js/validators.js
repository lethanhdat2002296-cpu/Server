// Validator dùng cho client - đồng bộ với server
window.Validators = {
  COMPANY_DOMAIN: 'company', // sẽ được fetch từ server nếu cần

  phone(v) {
    if (!v) return 'Số điện thoại không được để trống';
    if (!/^0\d{9}$/.test(v)) return 'Số điện thoại phải có 10 chữ số và bắt đầu bằng số 0';
    return null;
  },
  email(v) {
    if (!v) return 'Email không được để trống';
    const re = new RegExp(`^[a-zA-Z0-9._%+-]+@(gmail\\.com|${this.COMPANY_DOMAIN}\\.com)$`);
    if (!re.test(v)) return `Email phải kết thúc bằng @gmail.com hoặc @${this.COMPANY_DOMAIN}.com`;
    return null;
  },
  username(v) {
    if (!v) return 'Tên đăng nhập không được để trống';
    if (!/^[a-z0-9._]+$/.test(v)) return 'Tên đăng nhập phải viết liền không dấu, chữ thường và số';
    if (v.length < 4) return 'Tên đăng nhập tối thiểu 4 ký tự';
    return null;
  },
  password(v) {
    if (!v) return 'Mật khẩu không được để trống';
    if (v.length < 8) return 'Mật khẩu tối thiểu 8 ký tự';
    if (!/[A-Z]/.test(v)) return 'Phải có ít nhất 1 chữ IN HOA';
    if (!/[a-z]/.test(v)) return 'Phải có ít nhất 1 chữ thường';
    if (!/[0-9]/.test(v)) return 'Phải có ít nhất 1 chữ số';
    if (!/[^A-Za-z0-9]/.test(v)) return 'Phải có ít nhất 1 ký tự đặc biệt';
    return null;
  },
  fullName(v) {
    if (!v || !v.trim()) return 'Họ và tên không được để trống';
    if (v.trim().length < 2) return 'Họ và tên quá ngắn';
    return null;
  }
};
