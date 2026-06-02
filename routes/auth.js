const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../lib/db');
const config = require('../config');
const { validateRegister } = require('../utils/validators');

const router = express.Router();

// ============== ĐĂNG KÝ ==============
router.post('/register', async (req, res, next) => {
  try {
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

    // Tìm user
    const userRes = await query('SELECT * FROM users WHERE username = $1', [uname]);
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
      { id: user.id, username: user.username, full_name: user.full_name },
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
        phone: user.phone
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
