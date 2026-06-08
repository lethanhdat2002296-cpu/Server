// Che thông tin PII cho trang công khai (autocomplete gợi ý).
// QUAN TRỌNG: maskPhone KHÔNG được lộ 4 số CUỐI vì đó là phần dùng để xác minh (verifyLast4).
// → chỉ hiện vài số ĐẦU, phần còn lại che hết.

function maskPhone(p) {
  if (!p) return '';
  const s = String(p);
  if (s.length <= 4) return (s[0] || '') + '***';
  return s.slice(0, 4) + '*'.repeat(Math.max(3, s.length - 4));
}

// Email: hiện 3 ký tự đầu phần tên + tên miền (vd led***@gmail.com)
function maskEmail(e) {
  if (!e) return '';
  const at = e.indexOf('@');
  if (at < 0) return e.slice(0, 3) + '***';
  const local = e.slice(0, at), domain = e.slice(at);
  const shown = local.slice(0, Math.min(3, local.length));
  return shown + '***' + domain;
}

module.exports = { maskPhone, maskEmail };
