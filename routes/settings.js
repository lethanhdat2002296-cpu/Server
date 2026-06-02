const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { validateEmail, validateFullName, validatePassword } = require('../utils/validators');
const { sendResetCode } = require('../utils/email');

const router = express.Router();

// ============== LẤY THÔNG TIN ==============
router.get('/me', authRequired, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, max-age=30');
    const r = await query(
      'SELECT id, full_name, email, phone, username FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    res.json({ user: r.rows[0] });
  } catch (err) { next(err); }
});

// ============== CẬP NHẬT HỌ TÊN / EMAIL ==============
router.put('/profile', authRequired, async (req, res, next) => {
  try {
    const { full_name, email } = req.body || {};
    const errors = {};
    const nameErr = validateFullName(full_name);
    if (nameErr) errors.full_name = nameErr;
    const emailErr = validateEmail(email);
    if (emailErr) errors.email = emailErr;
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ', fields: errors });
    }

    const dup = await query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [email.toLowerCase(), req.user.id]
    );
    if (dup.rows.length) {
      return res.status(409).json({
        error: 'Email đã được sử dụng',
        fields: { email: 'Email đã có tài khoản khác' }
      });
    }

    await query(
      'UPDATE users SET full_name = $1, email = $2 WHERE id = $3',
      [full_name.trim(), email.toLowerCase(), req.user.id]
    );
    res.json({ ok: true, message: 'Cập nhật thành công' });
  } catch (err) { next(err); }
});

// ============== YÊU CẦU MÃ ĐỔI MẬT KHẨU ==============
router.post('/password/request-code', authRequired, async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = r.rows[0];
    if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 10 * 60 * 1000;

    await query('UPDATE reset_codes SET used = 1 WHERE user_id = $1 AND used = 0', [user.id]);
    await query(
      'INSERT INTO reset_codes (user_id, code, expires_at) VALUES ($1, $2, $3)',
      [user.id, code, expiresAt]
    );

    try {
      const result = await sendResetCode(user.email, code, user.full_name);
      res.json({
        ok: true,
        message: `Mã xác nhận đã được gửi đến ${user.email}`,
        dev_mode: result.dev || false
      });
    } catch (mailErr) {
      console.error('Lỗi gửi email:', mailErr);
      res.status(500).json({ error: 'Không gửi được email. Vui lòng thử lại' });
    }
  } catch (err) { next(err); }
});

// ============== ĐỔI MẬT KHẨU ==============
router.post('/password/change', authRequired, async (req, res, next) => {
  try {
    const { code, new_password, confirm_password } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Vui lòng nhập mã xác nhận' });

    const pwdErr = validatePassword(new_password);
    if (pwdErr) return res.status(400).json({ error: pwdErr, fields: { new_password: pwdErr } });

    if (new_password !== confirm_password) {
      return res.status(400).json({
        error: 'Mật khẩu nhập lại không khớp',
        fields: { confirm_password: 'Mật khẩu nhập lại không khớp' }
      });
    }

    const r = await query(`
      SELECT * FROM reset_codes
      WHERE user_id = $1 AND code = $2 AND used = 0
      ORDER BY id DESC LIMIT 1
    `, [req.user.id, code]);
    const row = r.rows[0];

    if (!row) return res.status(400).json({ error: 'Mã xác nhận không đúng' });
    if (Number(row.expires_at) < Date.now()) {
      return res.status(400).json({ error: 'Mã xác nhận đã hết hạn. Vui lòng yêu cầu mã mới' });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    await query('UPDATE reset_codes SET used = 1 WHERE id = $1', [row.id]);

    res.json({ ok: true, message: 'Đổi mật khẩu thành công' });
  } catch (err) { next(err); }
});

module.exports = router;
