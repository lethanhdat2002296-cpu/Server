const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../lib/db');
const config = require('../config');
const { validateRegister, validatePassword } = require('../utils/validators');
const { sendResetCode } = require('../utils/email');

const router = express.Router();

// Lấy IP client (Vercel đặt qua x-forwarded-for)
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Rate limit đăng ký: tối đa 5 lần / IP / giờ
const REGISTER_LIMIT = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
async function checkRegisterRateLimit(ip) {
  const now = Date.now();
  const r = await query('SELECT * FROM register_attempts WHERE ip = $1', [ip]);
  const row = r.rows[0];
  if (!row || now - Number(row.window_start) > REGISTER_WINDOW_MS) {
    // Cửa sổ mới
    await query(`
      INSERT INTO register_attempts (ip, count, window_start)
      VALUES ($1, 1, $2)
      ON CONFLICT (ip) DO UPDATE SET count = 1, window_start = $2
    `, [ip, now]);
    return { allowed: true };
  }
  if (row.count >= REGISTER_LIMIT) {
    const retryMin = Math.ceil((REGISTER_WINDOW_MS - (now - Number(row.window_start))) / 60000);
    return { allowed: false, retryMin };
  }
  await query('UPDATE register_attempts SET count = count + 1 WHERE ip = $1', [ip]);
  return { allowed: true };
}

// ============== ĐĂNG KÝ ==============
router.post('/register', async (req, res, next) => {
  try {
    // Rate limit theo IP
    const ip = getClientIp(req);
    const rl = await checkRegisterRateLimit(ip);
    if (!rl.allowed) {
      return res.status(429).json({
        error: `Bạn đã đăng ký quá nhiều lần. Vui lòng thử lại sau ${rl.retryMin} phút.`
      });
    }

    const data = req.body || {};
    const errors = validateRegister(data);
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ', fields: errors });
    }

    const phone = data.phone;
    const email = data.email.toLowerCase();
    const username = data.username.toLowerCase();

    // Kiểm tra trùng số điện thoại
    const dupPhone = await query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (dupPhone.rows.length) {
      return res.status(409).json({
        error: 'Số điện thoại đã được sử dụng',
        fields: { phone: 'Số điện thoại này đã có tài khoản' }
      });
    }
    // Trùng email
    const dupEmail = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (dupEmail.rows.length) {
      return res.status(409).json({
        error: 'Email đã được sử dụng',
        fields: { email: 'Email này đã có tài khoản' }
      });
    }
    // Trùng username
    const dupUsername = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (dupUsername.rows.length) {
      return res.status(409).json({
        error: 'Tên đăng nhập đã tồn tại',
        fields: { username: 'Tên đăng nhập đã được sử dụng' }
      });
    }

    const password_hash = await bcrypt.hash(data.password, 10);
    const insert = await query(`
      INSERT INTO users (full_name, phone, email, username, password_hash)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [data.full_name.trim(), phone, email, username, password_hash]);

    return res.json({
      ok: true,
      message: 'Đăng ký thành công',
      user_id: insert.rows[0].id
    });
  } catch (err) { next(err); }
});

// ============== ĐĂNG NHẬP ==============
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
    }
    const uname = username.toLowerCase().trim();
    const now = Date.now();

    // Kiểm tra khoá
    const attemptRes = await query('SELECT * FROM login_attempts WHERE username = $1', [uname]);
    const attempt = attemptRes.rows[0];
    if (attempt && Number(attempt.locked_until) > now) {
      const seconds = Math.ceil((Number(attempt.locked_until) - now) / 1000);
      return res.status(429).json({
        error: `Tài khoản đang bị khoá. Vui lòng thử lại sau ${seconds} giây`,
        locked: true,
        seconds_left: seconds
      });
    }

    // Tìm user (loại trừ user đã bị soft-delete)
    const userRes = await query('SELECT * FROM users WHERE username = $1 AND deleted_at IS NULL', [uname]);
    const user = userRes.rows[0];
    if (!user) {
      return res.status(404).json({
        error: 'Tài khoản chưa tồn tại. Vui lòng đăng ký',
        not_found: true
      });
    }

    // So mật khẩu
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const current = attempt ? attempt.failed_count + 1 : 1;
      let locked_until = 0;
      if (current >= config.MAX_LOGIN_ATTEMPTS) {
        locked_until = now + config.LOCKOUT_SECONDS * 1000;
      }
      await query(`
        INSERT INTO login_attempts (username, failed_count, locked_until)
        VALUES ($1, $2, $3)
        ON CONFLICT (username) DO UPDATE
        SET failed_count = EXCLUDED.failed_count, locked_until = EXCLUDED.locked_until
      `, [uname, current, locked_until]);

      if (locked_until) {
        return res.status(429).json({
          error: `Bạn đã nhập sai ${config.MAX_LOGIN_ATTEMPTS} lần. Tài khoản bị khoá ${config.LOCKOUT_SECONDS} giây`,
          locked: true,
          seconds_left: config.LOCKOUT_SECONDS
        });
      }
      return res.status(401).json({
        error: `Sai mật khẩu. Bạn còn ${config.MAX_LOGIN_ATTEMPTS - current} lần thử`,
        attempts_left: config.MAX_LOGIN_ATTEMPTS - current
      });
    }

    // Đăng nhập thành công
    await query('DELETE FROM login_attempts WHERE username = $1', [uname]);

    const token = jwt.sign(
      { id: user.id, username: user.username, full_name: user.full_name, role: user.role || 'user' },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );

    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role || 'user'
      }
    });
  } catch (err) { next(err); }
});

// ============== FORGOT PASSWORD - Bước 1: gửi mã ==============
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { identifier } = req.body || {};
    if (!identifier || !identifier.trim()) {
      return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập, email hoặc số điện thoại' });
    }
    const id = identifier.toLowerCase().trim();

    // Tìm user theo username / email / phone
    const r = await query(
      `SELECT * FROM users WHERE (username = $1 OR email = $1 OR phone = $1) AND deleted_at IS NULL`,
      [id]
    );
    const user = r.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản với thông tin này' });
    }

    // Tạo mã 8 chữ số (tăng entropy từ 1M lên 100M)
    const code = String(Math.floor(10000000 + Math.random() * 90000000));
    const expiresAt = Date.now() + 10 * 60 * 1000;

    // Vô hiệu hóa mã cũ
    await query('UPDATE reset_codes SET used = 1 WHERE user_id = $1 AND used = 0', [user.id]);
    await query(
      'INSERT INTO reset_codes (user_id, code, expires_at) VALUES ($1, $2, $3)',
      [user.id, code, expiresAt]
    );

    try {
      const result = await sendResetCode(user.email, code, user.full_name);
      // Mask email để user xác nhận đúng tài khoản
      const masked = user.email.replace(/^(.{1,2}).*(@.*)$/, '$1***$2');
      return res.json({
        ok: true,
        message: `Mã xác nhận đã được gửi đến ${masked}`,
        masked_email: masked,
        dev_mode: result.dev || false
      });
    } catch (mailErr) {
      console.error('Lỗi gửi email forgot-password:', mailErr);
      return res.status(500).json({ error: 'Không gửi được email. Vui lòng thử lại sau' });
    }
  } catch (err) { next(err); }
});

// ============== FORGOT PASSWORD - Bước 2: reset bằng mã ==============
router.post('/reset-password', async (req, res, next) => {
  try {
    const { identifier, code, new_password, confirm_password } = req.body || {};
    if (!identifier || !code) {
      return res.status(400).json({ error: 'Thiếu thông tin xác nhận' });
    }
    const pwdErr = validatePassword(new_password);
    if (pwdErr) {
      return res.status(400).json({ error: pwdErr, fields: { new_password: pwdErr } });
    }
    if (new_password !== confirm_password) {
      return res.status(400).json({
        error: 'Mật khẩu nhập lại không khớp',
        fields: { confirm_password: 'Mật khẩu nhập lại không khớp' }
      });
    }

    const id = identifier.toLowerCase().trim();
    const userRes = await query(
      `SELECT * FROM users WHERE (username = $1 OR email = $1 OR phone = $1) AND deleted_at IS NULL`,
      [id]
    );
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

    // Verify code
    const codeRes = await query(`
      SELECT * FROM reset_codes
      WHERE user_id = $1 AND code = $2 AND used = 0
      ORDER BY id DESC LIMIT 1
    `, [user.id, code.trim()]);
    const row = codeRes.rows[0];
    if (!row) return res.status(400).json({ error: 'Mã xác nhận không đúng' });
    if (Number(row.expires_at) < Date.now()) {
      return res.status(400).json({ error: 'Mã xác nhận đã hết hạn. Vui lòng yêu cầu mã mới' });
    }

    // Update password
    const hash = await bcrypt.hash(new_password, 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
    await query('UPDATE reset_codes SET used = 1 WHERE id = $1', [row.id]);

    // Reset login_attempts (trong trường hợp user đang bị khóa)
    await query('DELETE FROM login_attempts WHERE username = $1', [user.username]);

    res.json({
      ok: true,
      message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập.',
      username: user.username
    });
  } catch (err) { next(err); }
});

module.exports = router;
