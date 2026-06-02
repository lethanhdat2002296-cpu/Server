const express = require('express');
const { query } = require('../lib/db');
const config = require('../config');
const { adminRequired } = require('../middleware/auth');
const { sendPaymentConfirmed, sendPaymentRejected } = require('../utils/email');
const { nowInTimezone, addDays, daysBetween, toLocalDateHour } = require('../utils/time');

const router = express.Router();

// ============== LIST ALL PAYMENTS (admin) ==============
// Query params: status=pending|confirmed|rejected|all, limit, offset
router.get('/payments', adminRequired, async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);

    let sql, params;
    if (status === 'all') {
      sql = `
        SELECT p.*, u.username, u.full_name AS user_full_name,
               admin.username AS confirmed_by_username
        FROM payments p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN users admin ON admin.id = p.confirmed_by
        ORDER BY p.created_at DESC
        LIMIT $1 OFFSET $2
      `;
      params = [limit, offset];
    } else {
      sql = `
        SELECT p.*, u.username, u.full_name AS user_full_name,
               admin.username AS confirmed_by_username
        FROM payments p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN users admin ON admin.id = p.confirmed_by
        WHERE p.status = $1
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3
      `;
      params = [status, limit, offset];
    }

    const r = await query(sql, params);

    // Đếm tổng để hiển thị badge ở UI
    const countRes = await query(`
      SELECT status, COUNT(*)::int AS c
      FROM payments
      GROUP BY status
    `);
    const counts = { pending: 0, confirmed: 0, rejected: 0 };
    for (const row of countRes.rows) counts[row.status] = row.c;

    res.json({ payments: r.rows, counts, limit, offset });
  } catch (err) { next(err); }
});

// ============== CONFIRM PAYMENT ==============
router.post('/payments/:id/confirm', adminRequired, async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const adminNote = (req.body && req.body.note) || '';

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
    const adminNote = (req.body && req.body.note) || '';

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

    res.json({
      ok: true,
      message: 'Đã từ chối thanh toán',
      payment_id: paymentId,
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
      query("SELECT COUNT(*)::int AS c FROM users WHERE role != 'admin'"),
      query('SELECT COUNT(*)::int AS c FROM users'),
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

// ============== BÁO CÁO NHANH TRONG NGÀY ==============
// Họ tên / SĐT / check-in (hôm đó) + sum
// Query param: date (mặc định hôm nay)
router.get('/reports/daily', adminRequired, async (req, res, next) => {
  try {
    const date = req.query.date || nowInTimezone().date;
    const r = await query(`
      SELECT u.id, u.full_name, u.phone, u.email, u.username,
             c.check_time
      FROM users u
      LEFT JOIN check_ins c ON c.user_id = u.id AND c.check_date = $1
      WHERE u.role != 'admin'
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
    const date = req.query.date || t.date;
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
      WHERE u.role != 'admin'
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

module.exports = router;
