// Hàm validate dùng cho backend (và đồng bộ với frontend)
const config = require('../config');

function validatePhone(phone) {
  if (!phone) return 'Số điện thoại không được để trống';
  if (!/^0\d{9}$/.test(phone)) return 'Số điện thoại phải có 10 chữ số và bắt đầu bằng số 0';
  return null;
}

function validateEmail(email) {
  if (!email) return 'Email không được để trống';
  // Local part: không cho bắt đầu/kết thúc bằng dấu chấm, không cho 2 chấm liên tiếp
  const allowedDomains = ['gmail.com', `${config.COMPANY_DOMAIN}.com`];
  const domainPattern = allowedDomains.join('|').replace(/\./g, '\\.');
  const re = new RegExp(`^[a-zA-Z0-9_%+-]+(\\.[a-zA-Z0-9_%+-]+)*@(${domainPattern})$`);
  if (!re.test(email)) {
    return `Email phải kết thúc bằng @gmail.com hoặc @${config.COMPANY_DOMAIN}.com (không chứa dấu chấm liên tiếp)`;
  }
  return null;
}

function validateUsername(username) {
  if (!username) return 'Tên đăng nhập không được để trống';
  // Viết liền không dấu - chỉ chữ thường, số, dấu chấm/gạch dưới
  if (!/^[a-z0-9._]+$/.test(username)) {
    return 'Tên đăng nhập phải viết liền không dấu, chỉ gồm chữ thường, số';
  }
  if (username.length < 4) return 'Tên đăng nhập tối thiểu 4 ký tự';
  return null;
}

function validatePassword(password) {
  if (!password) return 'Mật khẩu không được để trống';
  if (password.length < 8) return 'Mật khẩu tối thiểu 8 ký tự';
  if (!/[A-Z]/.test(password)) return 'Mật khẩu phải có ít nhất 1 chữ IN HOA';
  if (!/[a-z]/.test(password)) return 'Mật khẩu phải có ít nhất 1 chữ thường';
  if (!/[0-9]/.test(password)) return 'Mật khẩu phải có ít nhất 1 chữ số';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Mật khẩu phải có ít nhất 1 ký tự đặc biệt';
  return null;
}

function validateFullName(name) {
  if (!name || !name.trim()) return 'Họ và tên không được để trống';
  if (name.trim().length < 2) return 'Họ và tên quá ngắn';
  return null;
}

module.exports = {
  validatePhone,
  validateEmail,
  validateUsername,
  validatePassword,
  validateFullName
};
