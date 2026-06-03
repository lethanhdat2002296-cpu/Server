const express = require('express');
const { query } = require('../lib/db');
const config = require('../config');
const { adminRequired } = require('../middleware/auth');
const { sendPaymentConfirmed, sendPaymentRejected } = require('../utils/email');
const { nowInTimezone, addDays, daysBetween, toLocalDateHour } = require('../utils/time');

const router = express.Router();

// Ghi audit log (best-effort, không làm fail request chính)
async function logAudit(admin, action, target, note) {
  try {
    await query(
      'INSERT INTO audit_log (admin_id, admin_name, action, target, note) VALUES ($1, $2, $3, $4, $5)',
      [admin.id, admin.username || admin.full_name || 'admin', action, target || '', note || '']
    );
  } catch (e) {
    console.error('Lỗi ghi audit_log:', e.message);
  }
}

// ============== LIST ALL PAYMENTS (admin) ==============
// Query params: status=pending|confirmed|rejected|all, search, limit, offset
router.get('/payments', adminRequired, async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const search = (req.query.search || '').trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    // Build WHERE động
    const conds = [];
    const params = [];
    let i = 1;
    if (status !== 'all') {
      conds.push(`p.status = $${i++}`);
      params.push(status);
    }
    if (search) {
      conds.push(`(LOWER(p.full_name) LIKE $${i} OR LOWER(p.email) LIKE $${i} OR p.phone LIKE $${i} OR LOWER(u.username) LIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }
    const whereClause = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const sql = `
      SELECT p.*, u.username, u.full_name AS user_full_name,
             admin.username AS confirmed_by_username
      FROM payments p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN users admin ON admin.id = p.confirmed_by
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(limit, offset);
    const r = await query(sql, params);

    // Tổng số bản ghi (cho pagination) theo filter hiện tại
    const countSql = `
      SELECT COUNT(*)::int AS c
      FROM payments p
      JOIN users u ON u.id = p.user_id
      ${whereClause}
    `;
    const totalRes = await query(countSql, params.slice(0, params.length - 2));

    // Đếm theo status (cho badge)
    const countRes = await query(`SELECT status, COUNT(*)::int AS c FROM payments GROUP BY status`);
    const counts = { pending: 0, confirmed: 0, rejected: 0 };
    for (const row of countRes.rows) counts[row.status] = row.c;

    res.json({
      payments: r.rows,
      counts,
      total: totalRes.rows[0].c,
      limit,
      offset
    });
  } catch (err) { next(err); }
});

// ============== CONFIRM PAYMENT ==============
router.post('/payments/:id/confirm', adminRequired, async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    // Truncate adminNote về 500 ký tự (server-side hardening)
    const adminNote = String((req.body && req.body.note) || '').slice(0, 500);

    // Lấy payment
    const r = await query(`
      SELECT p.*, u.email AS user_email, u.full_name AS user_full_name
      FROM payments p
      JOIN users u ON u.id = p.user_id
      WHERE p.id = $1
    `, [paymentId]);
    const payment = r.rows[0];
    if (!payment) return res.status(404).json({ error: 'Không tìm thấy thanh toán' });
    if (payment.status === 'confirmed') {
      return res.status(400).json({ error: 'Thanh toán này đã được xác nhận trước đó' });
    }

    // Update status
    await query(`
      UPDATE payments
      SET status = 'confirmed',
          confirmed_at = NOW(),
          confirmed_by = $1,
          admin_note = $2
      WHERE id = $3
    `, [req.user.id, adminNote, paymentId]);

    // Gửi email xác nhận cho user
    let emailResult = { ok: false };
    try {
      emailResult = await sendPaymentConfirmed({
        toEmail: payment.email,           // email user đã nhập khi nộp biên lai
        full_name: payment.full_name,
        phone: payment.phone,
        payment_id: payment.id,
        created_at: payment.created_at,
        admin_note: adminNote,
        detected_banks: payment.detected_banks
      });
    } catch (mailErr) {
      console.error('Lỗi gửi email confirm:', mailErr);
      emailResult = { ok: false, err: mailErr.message };
    }

    // Lưu trạng thái email để biết cái nào cần resend
    await query(
      'UPDATE payments SET email_sent = $1, email_error = $2, email_attempts = email_attempts + 1 WHERE id = $3',
      [emailResult.ok, emailResult.ok ? null : (emailResult.err || 'Không gửi được email'), paymentId]
    );
    await logAudit(req.user, 'confirm_payment', `payment#${paymentId}`, adminNote);

    res.json({
      ok: true,
      message: 'Đã xác nhận thanh toán',
      payment_id: paymentId,
      email_sent: emailResult.ok,
      email_dev_mode: emailResult.dev || false,
      email_error: emailResult.ok ? null : (emailResult.err || 'Không gửi được email')
    });
  } catch (err) { next(err); }
});

// ============== REJECT PAYMENT ==============
router.post('/payments/:id/reject', adminRequired, async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const adminNote = String((req.body && req.body.note) || '').slice(0, 500);

    const r = await query(`
      SELECT p.*, u.email AS user_email, u.full_name AS user_full_name
      FROM payments p
      JOIN users u ON u.id = p.user_id
      WHERE p.id = $1
    `, [paymentId]);
    const payment = r.rows[0];
    if (!payment) return res.status(404).json({ error: 'Không tìm thấy thanh toán' });

    await query(`
      UPDATE payments
      SET status = 'rejected',
          confirmed_at = NOW(),
          confirmed_by = $1,
          admin_note = $2
      WHERE id = $3
    `, [req.user.id, adminNote, paymentId]);

    let emailResult = { ok: false };
    try {
      emailResult = await sendPaymentRejected({
        toEmail: payment.email,
        full_name: payment.full_name,
        phone: payment.phone,
        payment_id: payment.id,
        created_at: payment.created_at,
        admin_note: adminNote
      });
    } catch (mailErr) {
      console.error('Lỗi gửi email reject:', mailErr);
      emailResult = { ok: false, err: mailErr.message };
    }

    await query(
      'UPDATE payments SET email_sent = $1, email_error = $2, email_attempts = email_attempts + 1 WHERE id = $3',
      [emailResult.ok, emailResult.ok ? null : (emailResult.err || 'Không gửi được email'), paymentId]
    );
    await logAudit(req.user, 'reject_payment', `payment#${paymentId}`, adminNote);

    res.json({
      ok: true,
      message: 'Đã từ chối thanh toán',
      payment_id: paymentId,
      email_sent: emailResult.ok,
      email_error: emailResult.ok ? null : (emailResult.err || 'Không gửi được email')
    });
  } catch (err) { next(err); }
});

// ============== RESEND EMAIL (khi email gửi lỗi) ==============
router.post('/payments/:id/resend-email', adminRequired, async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const r = await query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    const payment = r.rows[0];
    if (!payment) return res.status(404).json({ error: 'Không tìm thấy thanh toán' });
    if (payment.status === 'pending') {
      return res.status(400).json({ error: 'Thanh toán chưa được xử lý, chưa có email kết quả để gửi lại' });
    }

    let emailResult = { ok: false };
    try {
      if (payment.status === 'confirmed') {
        emailResult = await sendPaymentConfirmed({
          toEmail: payment.email, full_name: payment.full_name, phone: payment.phone,
          payment_id: payment.id, created_at: payment.created_at,
          admin_note: payment.admin_note, detected_banks: payment.detected_banks
        });
      } else {
        emailResult = await sendPaymentRejected({
          toEmail: payment.email, full_name: payment.full_name, phone: payment.phone,
          payment_id: payment.id, created_at: payment.created_at, admin_note: payment.admin_note
        });
      }
    } catch (mailErr) {
      emailResult = { ok: false, err: mailErr.message };
    }

    await query(
      'UPDATE payments SET email_sent = $1, email_error = $2, email_attempts = email_attempts + 1 WHERE id = $3',
      [emailResult.ok, emailResult.ok ? null : (emailResult.err || 'Không gửi được email'), paymentId]
    );
    await logAudit(req.user, 'resend_email', `payment#${paymentId}`, '');

    res.json({
      ok: true,
      email_sent: emailResult.ok,
      email_error: emailResult.ok ? null : (emailResult.err || 'Không gửi được email')
    });
  } catch (err) { next(err); }
});

// ============== STATS (legacy) ==============
router.get('/stats', adminRequired, async (req, res, next) => {
  try {
    const [usersRes, paymentsRes, checkinsRes] = await Promise.all([
      query('SELECT COUNT(*)::int AS c FROM users'),
      query(`SELECT status, COUNT(*)::int AS c FROM payments GROUP BY status`),
      query('SELECT COUNT(*)::int AS c FROM check_ins')
    ]);
    const counts = { pending: 0, confirmed: 0, rejected: 0 };
    for (const row of paymentsRes.rows) counts[row.status] = row.c;
    res.json({
      total_users: usersRes.rows[0].c,
      total_checkins: checkinsRes.rows[0].c,
      payments: counts
    });
  } catch (err) { next(err); }
});

// ============== BÁO CÁO TỔNG ==============
// Tổng user (loại trừ admin), số check-in hôm nay, tổng payment các trạng thái
router.get('/reports/overview', adminRequired, async (req, res, next) => {
  try {
    const t = nowInTimezone();
    const [usersRes, allUsersRes, todayCheckRes, totalCheckRes, paymentsRes] = await Promise.all([
      query("SELECT COUNT(*)::int AS c FROM users WHERE role != 'admin' AND deleted_at IS NULL"),
      query('SELECT COUNT(*)::int AS c FROM users WHERE deleted_at IS NULL'),
      query("SELECT COUNT(*)::int AS c FROM check_ins WHERE check_date = $1", [t.date]),
      query('SELECT COUNT(*)::int AS c FROM check_ins'),
      query("SELECT status, COUNT(*)::int AS c FROM payments GROUP BY status")
    ]);
    const paymentCounts = { pending: 0, confirmed: 0, rejected: 0 };
    for (const row of paymentsRes.rows) paymentCounts[row.status] = row.c;

    res.json({
      date: t.date,
      server_time: `${t.date} ${t.time}`,
      total_users: usersRes.rows[0].c,           // user thường (không tính admin)
      total_users_with_admin: allUsersRes.rows[0].c,
      checked_in_today: todayCheckRes.rows[0].c,
      not_checked_today: usersRes.rows[0].c - todayCheckRes.rows[0].c,
      total_checkins_all_time: totalCheckRes.rows[0].c,
      payments: paymentCounts
    });
  } catch (err) { next(err); }
});

// Validate date param: chỉ chấp nhận YYYY-MM-DD trong khoảng hợp lý
function validateDateParam(input, fallback) {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return fallback;
  if (input < '2024-01-01' || input > fallback) return fallback;
  return input;
}

// ============== BÁO CÁO NHANH TRONG NGÀY ==============
// Họ tên / SĐT / check-in (hôm đó) + sum
// Query param: date (mặc định hôm nay)
router.get('/reports/daily', adminRequired, async (req, res, next) => {
  try {
    const today = nowInTimezone().date;
    const date = validateDateParam(req.query.date, today);
    const r = await query(`
      SELECT u.id, u.full_name, u.phone, u.email, u.username,
             c.check_time
      FROM users u
      LEFT JOIN check_ins c ON c.user_id = u.id AND c.check_date = $1
      WHERE u.role != 'admin' AND u.deleted_at IS NULL
      ORDER BY (c.check_time IS NULL), u.full_name
    `, [date]);

    const rows = r.rows.map(u => ({
      full_name: u.full_name,
      phone: u.phone,
      email: u.email,
      checked_in: !!u.check_time,
      check_time: u.check_time ? u.check_time.slice(0, 5) : null
    }));
    const checked = rows.filter(x => x.checked_in).length;

    res.json({
      date,
      total: rows.length,
      checked,
      not_checked: rows.length - checked,
      rows
    });
  } catch (err) { next(err); }
});

// ============== BÁO CÁO CHI TIẾT TRONG NGÀY ==============
// Họ tên / SĐT / check-in / streak / total checked / total missed
router.get('/reports/detailed', adminRequired, async (req, res, next) => {
  try {
    const t = nowInTimezone();
    const date = validateDateParam(req.query.date, t.date);
    const todayWindowEnded = t.hour >= config.CHECKIN_END_HOUR;

    // 1 query: lấy hết user + tất cả check_date của họ (sorted)
    const r = await query(`
      SELECT u.id, u.full_name, u.phone, u.email, u.username, u.created_at,
             COALESCE(
               ARRAY_AGG(c.check_date ORDER BY c.check_date DESC) FILTER (WHERE c.check_date IS NOT NULL),
               '{}'::text[]
             ) AS dates
      FROM users u
      LEFT JOIN check_ins c ON c.user_id = u.id
      WHERE u.role != 'admin' AND u.deleted_at IS NULL
      GROUP BY u.id
      ORDER BY u.full_name
    `);

    const rows = r.rows.map(u => {
      const dates = u.dates || [];
      const datesSet = new Set(dates);
      const checkedToday = datesSet.has(date);

      // === STREAK: số ngày check-in liên tiếp ===
      // Bắt đầu từ "hôm nay" (nếu đã check) hoặc "hôm qua" (nếu hôm nay chưa khả dụng) đi ngược
      let cursor;
      if (datesSet.has(date)) {
        cursor = date;
      } else if (!todayWindowEnded) {
        // Hôm nay window chưa đóng - tính từ hôm qua (chưa kết thúc cơ hội)
        cursor = addDays(date, -1);
      } else {
        // Hôm nay đã qua mà không check → streak = 0
        cursor = null;
      }
      let streak = 0;
      while (cursor && datesSet.has(cursor)) {
        streak++;
        cursor = addDays(cursor, -1);
      }

      // === TOTAL CHECKED + MISSED ===
      // Eligible range: từ ngày user có thể check đến ngày cuối đã đóng window
      const created = toLocalDateHour(u.created_at);
      const firstMissable = created.hour < config.CHECKIN_START_HOUR
        ? created.date
        : addDays(created.date, 1);
      const lastEnded = todayWindowEnded ? t.date : addDays(t.date, -1);

      let totalMissed = 0;
      if (firstMissable <= lastEnded) {
        const eligibleDays = daysBetween(firstMissable, lastEnded);
        const checkedInRange = dates.filter(d => d >= firstMissable && d <= lastEnded).length;
        totalMissed = Math.max(0, eligibleDays - checkedInRange);
      }

      return {
        full_name: u.full_name,
        phone: u.phone,
        email: u.email,
        checked_today: checkedToday,
        streak,
        total_checked: dates.length,
        total_missed: totalMissed
      };
    });

    const checked = rows.filter(x => x.checked_today).length;

    res.json({
      date,
      total: rows.length,
      checked,
      not_checked: rows.length - checked,
      rows
    });
  } catch (err) { next(err); }
});

// ============== BÁO CÁO THEO KHOẢNG (tuần / tháng) ==============
// Query: from=YYYY-MM-DD, to=YYYY-MM-DD (tối đa 92 ngày)
// Trả: daily_counts (cho biểu đồ) + per_user (số ngày check trong khoảng) + tổng
router.get('/reports/range', adminRequired, async (req, res, next) => {
  try {
    const today = nowInTimezone().date;
    let from = validateDateParam(req.query.from, today);
    let to = validateDateParam(req.query.to, today);
    if (from > to) { const tmp = from; from = to; to = tmp; }
    // Giới hạn 92 ngày để tránh query nặng
    if (daysBetween(from, to) > 92) {
      from = addDays(to, -91);
    }

    const [dailyRes, perUserRes, totalUsersRes] = await Promise.all([
      query(`
        SELECT check_date, COUNT(*)::int AS c
        FROM check_ins
        WHERE check_date BETWEEN $1 AND $2
        GROUP BY check_date
        ORDER BY check_date
      `, [from, to]),
      query(`
        SELECT u.full_name, u.phone, u.email,
               COUNT(c.id)::int AS checked_days
        FROM users u
        LEFT JOIN check_ins c ON c.user_id = u.id AND c.check_date BETWEEN $1 AND $2
        WHERE u.role != 'admin' AND u.deleted_at IS NULL
        GROUP BY u.id
        ORDER BY checked_days DESC, u.full_name
      `, [from, to]),
      query("SELECT COUNT(*)::int AS c FROM users WHERE role != 'admin' AND deleted_at IS NULL")
    ]);

    // Tạo mảng đầy đủ các ngày trong khoảng (kể cả ngày 0 check-in) cho biểu đồ
    const countMap = {};
    for (const row of dailyRes.rows) countMap[row.check_date] = row.c;
    const totalDays = daysBetween(from, to);
    const daily = [];
    let cursor = from;
    for (let d = 0; d < totalDays; d++) {
      daily.push({ date: cursor, count: countMap[cursor] || 0 });
      cursor = addDays(cursor, 1);
    }

    const totalCheckins = daily.reduce((s, d) => s + d.count, 0);

    res.json({
      from, to,
      total_days: totalDays,
      total_users: totalUsersRes.rows[0].c,
      total_checkins: totalCheckins,
      daily,                       // [{date, count}] cho biểu đồ
      per_user: perUserRes.rows    // [{full_name, phone, email, checked_days}]
    });
  } catch (err) { next(err); }
});

// ============== QUẢN LÝ USER ==============
// List users (có search + pagination), kèm thống kê check-in
router.get('/users', adminRequired, async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    const conds = ['u.deleted_at IS NULL'];
    const params = [];
    let i = 1;
    if (search) {
      conds.push(`(LOWER(u.full_name) LIKE $${i} OR LOWER(u.email) LIKE $${i} OR u.phone LIKE $${i} OR LOWER(u.username) LIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }
    const whereClause = `WHERE ${conds.join(' AND ')}`;

    const sql = `
      SELECT u.id, u.full_name, u.phone, u.email, u.username, u.role, u.created_at,
             COUNT(c.id)::int AS total_checkins,
             MAX(c.check_date) AS last_checkin
      FROM users u
      LEFT JOIN check_ins c ON c.user_id = u.id
      ${whereClause}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(limit, offset);
    const r = await query(sql, params);

    const totalRes = await query(
      `SELECT COUNT(*)::int AS c FROM users u ${whereClause}`,
      params.slice(0, params.length - 2)
    );

    res.json({ users: r.rows, total: totalRes.rows[0].c, limit, offset });
  } catch (err) { next(err); }
});

// Chi tiết check-in của 1 user
router.get('/users/:id/checkins', adminRequired, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const userRes = await query(
      'SELECT id, full_name, phone, email, username, role, created_at FROM users WHERE id = $1 AND deleted_at IS NULL',
      [userId]
    );
    if (!userRes.rows.length) return res.status(404).json({ error: 'Không tìm thấy user' });

    const checkRes = await query(
      'SELECT check_date, check_time FROM check_ins WHERE user_id = $1 ORDER BY check_date DESC LIMIT 100',
      [userId]
    );
    res.json({ user: userRes.rows[0], checkins: checkRes.rows });
  } catch (err) { next(err); }
});

// Promote / demote role
router.post('/users/:id/role', adminRequired, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const newRole = (req.body && req.body.role) === 'admin' ? 'admin' : 'user';

    if (userId === req.user.id && newRole === 'user') {
      return res.status(400).json({ error: 'Không thể tự gỡ quyền admin của chính mình' });
    }
    const r = await query(
      'UPDATE users SET role = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING username, role',
      [newRole, userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Không tìm thấy user' });

    await logAudit(req.user, 'change_role', `user#${userId}`, `→ ${newRole}`);
    res.json({ ok: true, message: `Đã đổi quyền thành ${newRole}`, user: r.rows[0] });
  } catch (err) { next(err); }
});

// Soft delete user
router.delete('/users/:id', adminRequired, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Không thể xóa chính mình' });
    }
    const r = await query(
      'UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING username, full_name',
      [userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Không tìm thấy user' });

    // Xóa session khả năng login: clear login_attempts (không bắt buộc)
    await query('DELETE FROM login_attempts WHERE username = $1', [r.rows[0].username]);
    await logAudit(req.user, 'delete_user', `user#${userId}`, r.rows[0].full_name);
    res.json({ ok: true, message: `Đã xóa user ${r.rows[0].full_name}` });
  } catch (err) { next(err); }
});

// ============== AUDIT LOG ==============
router.get('/audit-log', adminRequired, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
    const r = await query(
      'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    res.json({ logs: r.rows });
  } catch (err) { next(err); }
});

module.exports = router;
