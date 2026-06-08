const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { query } = require('../lib/db');

// Xác thực JWT + kiểm tra token còn hiệu lực (token_version) và tài khoản chưa bị xóa.
// → đổi mật khẩu / xóa user sẽ thu hồi mọi JWT cũ.
async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });

  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
  }

  try {
    const r = await query('SELECT token_version, deleted_at FROM users WHERE id = $1', [payload.id]);
    const u = r.rows[0];
    if (!u || u.deleted_at) return res.status(401).json({ error: 'Phiên không còn hiệu lực' });
    if ((u.token_version || 0) !== (payload.tv || 0)) {
      return res.status(401).json({ error: 'Phiên đã hết hiệu lực (mật khẩu đã đổi). Vui lòng đăng nhập lại.' });
    }
  } catch (e) {
    // DB chập chờn: fail-open dựa trên JWT hợp lệ để không sập admin (chỉ log)
    console.error('Lỗi kiểm tra token_version:', e.message);
  }

  req.user = payload;
  next();
}

// Yêu cầu user phải đăng nhập VÀ có role=admin
async function adminRequired(req, res, next) {
  await authRequired(req, res, (err) => {
    if (err) return next(err);
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Cần quyền Admin để truy cập' });
    }
    next();
  });
}

// Bắt nhập lại mật khẩu admin cho thao tác PHÁ HỦY (restore ghi đè, xóa toàn bộ).
// Đặt SAU adminRequired. Nhận mật khẩu qua header x-admin-password hoặc body.admin_password.
async function passwordConfirmRequired(req, res, next) {
  try {
    const pw = req.headers['x-admin-password'] || (req.body && (req.body.admin_password || req.body.password)) || '';
    if (!pw) {
      return res.status(403).json({ error: 'Cần nhập lại mật khẩu admin để thực hiện thao tác này.', need_password: true });
    }
    const r = await query('SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user.id]);
    const u = r.rows[0];
    if (!u || !(await bcrypt.compare(String(pw), u.password_hash))) {
      return res.status(403).json({ error: 'Mật khẩu admin không đúng.', need_password: true });
    }
    next();
  } catch (e) { next(e); }
}

module.exports = { authRequired, adminRequired, passwordConfirmRequired };
