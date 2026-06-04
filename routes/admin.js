const express = require('express');
const { query } = require('../lib/db');
const config = require('../config');
const { adminRequired } = require('../middleware/auth');
const { sendPaymentConfirmed, sendPaymentRejected } = require('../utils/email');
const { nowInTimezone, addDays, daysBetween } = require('../utils/time');

const router = express.Router();

// Ghi audit log (best-effort)
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

function validateDateParam(input, fallback) {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return fallback;
  if (input < '2024-01-01' || input > fallback) return fallback;
  return input;
}

// ============================================================
//  THANH TOÁN (admin duyệt)
// ============================================================

// LIST payments: status + search + pagination
router.get('/payments', adminRequired, async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const search = (req.query.search || '').trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    const conds = [];
    const params = [];
    let i = 1;
    if (status !== 'all') { conds.push(`p.status = $${i++}`); params.push(status); }
    if (search) {
      conds.push(`(LOWER(p.full_name) LIKE $${i} OR LOWER(p.email) LIKE $${i} OR p.phone LIKE $${i})`);
      params.push(`%${search}%`); i++;
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const sql = `
      SELECT p.*, admin.username AS confirmed_by_username
      FROM payments p
      LEFT JOIN users admin ON admin.id = p.confirmed_by
      ${where}
      ORDER BY p.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(limit, offset);
    const r = await query(sql, params);

    const totalRes = await query(
      `SELECT COUNT(*)::int AS c FROM payments p ${where}`,
      params.slice(0, params.length - 2)
    );
    const countRes = await query(`SELECT status, COUNT(*)::int AS c FROM payments GROUP BY status`);
    const counts = { pending: 0, confirmed: 0, rejected: 0 };
    for (const row of countRes.rows) counts[row.status] = row.c;

    res.json({ payments: r.rows, counts, total: totalRes.rows[0].c, limit, offset });
  } catch (err) { next(err); }
});

router.post('/payments/:id/confirm', adminRequired, async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const adminNote = String((req.body && req.body.note) || '').slice(0, 500);

    const r = await query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    const payment = r.rows[0];
    if (!payment) return res.status(404).json({ error: 'Không tìm thấy thanh toán' });
    if (payment.status === 'confirmed') return res.status(400).json({ error: 'Đã xác nhận trước đó' });

    await query(`UPDATE payments SET status='confirmed', confirmed_at=NOW(), confirmed_by=$1, admin_note=$2 WHERE id=$3`,
      [req.user.id, adminNote, paymentId]);

    let emailResult = { ok: false };
    try {
      emailResult = await sendPaymentConfirmed({
        toEmail: payment.email, full_name: payment.full_name, phone: payment.phone,
        payment_id: payment.id, created_at: payment.created_at,
        admin_note: adminNote, detected_banks: payment.detected_banks
      });
    } catch (e) { emailResult = { ok: false, err: e.message }; }

    await query('UPDATE payments SET email_sent=$1, email_error=$2, email_attempts=email_attempts+1 WHERE id=$3',
      [emailResult.ok, emailResult.ok ? null : (emailResult.err || 'Lỗi gửi mail'), paymentId]);
    await logAudit(req.user, 'confirm_payment', `payment#${paymentId}`, adminNote);

    res.json({ ok: true, message: 'Đã xác nhận', payment_id: paymentId,
      email_sent: emailResult.ok, email_dev_mode: emailResult.dev || false,
      email_error: emailResult.ok ? null : (emailResult.err || 'Lỗi gửi mail') });
  } catch (err) { next(err); }
});

router.post('/payments/:id/reject', adminRequired, async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const adminNote = String((req.body && req.body.note) || '').slice(0, 500);

    const r = await query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    const payment = r.rows[0];
    if (!payment) return res.status(404).json({ error: 'Không tìm thấy thanh toán' });

    await query(`UPDATE payments SET status='rejected', confirmed_at=NOW(), confirmed_by=$1, admin_note=$2 WHERE id=$3`,
      [req.user.id, adminNote, paymentId]);

    let emailResult = { ok: false };
    try {
      emailResult = await sendPaymentRejected({
        toEmail: payment.email, full_name: payment.full_name, phone: payment.phone,
        payment_id: payment.id, created_at: payment.created_at, admin_note: adminNote
      });
    } catch (e) { emailResult = { ok: false, err: e.message }; }

    await query('UPDATE payments SET email_sent=$1, email_error=$2, email_attempts=email_attempts+1 WHERE id=$3',
      [emailResult.ok, emailResult.ok ? null : (emailResult.err || 'Lỗi gửi mail'), paymentId]);
    await logAudit(req.user, 'reject_payment', `payment#${paymentId}`, adminNote);

    res.json({ ok: true, message: 'Đã từ chối', payment_id: paymentId,
      email_sent: emailResult.ok, email_error: emailResult.ok ? null : (emailResult.err || 'Lỗi gửi mail') });
  } catch (err) { next(err); }
});

router.post('/payments/:id/resend-email', adminRequired, async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const r = await query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    const payment = r.rows[0];
    if (!payment) return res.status(404).json({ error: 'Không tìm thấy thanh toán' });
    if (payment.status === 'pending') return res.status(400).json({ error: 'Chưa xử lý, chưa có email kết quả' });

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
    } catch (e) { emailResult = { ok: false, err: e.message }; }

    await query('UPDATE payments SET email_sent=$1, email_error=$2, email_attempts=email_attempts+1 WHERE id=$3',
      [emailResult.ok, emailResult.ok ? null : (emailResult.err || 'Lỗi gửi mail'), paymentId]);
    await logAudit(req.user, 'resend_email', `payment#${paymentId}`, '');

    res.json({ ok: true, email_sent: emailResult.ok, email_error: emailResult.ok ? null : (emailResult.err || 'Lỗi gửi mail') });
  } catch (err) { next(err); }
});

// ============================================================
//  BÁO CÁO (theo members + member_checkins)
// ============================================================

// Tổng quan
router.get('/reports/overview', adminRequired, async (req, res, next) => {
  try {
    const t = nowInTimezone();
    const [membersRes, todayRes, totalRes, payRes] = await Promise.all([
      query('SELECT COUNT(*)::int AS c FROM members'),
      query('SELECT COUNT(*)::int AS c FROM member_checkins WHERE check_date = $1', [t.date]),
      query('SELECT COUNT(*)::int AS c FROM member_checkins'),
      query('SELECT status, COUNT(*)::int AS c FROM payments GROUP BY status')
    ]);
    const payments = { pending: 0, confirmed: 0, rejected: 0 };
    for (const row of payRes.rows) payments[row.status] = row.c;
    const total = membersRes.rows[0].c;
    const checked = todayRes.rows[0].c;
    res.json({
      date: t.date,
      server_time: `${t.date} ${t.time}`,
      total_members: total,
      checked_in_today: checked,
      not_checked_today: Math.max(0, total - checked),
      total_checkins_all_time: totalRes.rows[0].c,
      payments
    });
  } catch (err) { next(err); }
});

// Báo cáo nhanh trong ngày: họ tên / sđt / check-in
router.get('/reports/daily', adminRequired, async (req, res, next) => {
  try {
    const today = nowInTimezone().date;
    const date = validateDateParam(req.query.date, today);
    const r = await query(`
      SELECT m.full_name, m.phone, m.email, c.check_time
      FROM members m
      LEFT JOIN member_checkins c ON c.member_id = m.id AND c.check_date = $1
      ORDER BY (c.check_time IS NULL), m.full_name
    `, [date]);
    const rows = r.rows.map(m => ({
      full_name: m.full_name, phone: m.phone, email: m.email,
      checked_in: !!m.check_time,
      check_time: m.check_time ? m.check_time.slice(0, 5) : null
    }));
    const checked = rows.filter(x => x.checked_in).length;
    res.json({ date, total: rows.length, checked, not_checked: rows.length - checked, rows });
  } catch (err) { next(err); }
});

// Báo cáo chi tiết: streak / tổng đã / tổng chưa
router.get('/reports/detailed', adminRequired, async (req, res, next) => {
  try {
    const t = nowInTimezone();
    const date = validateDateParam(req.query.date, t.date);
    const windowEnded = t.hour >= config.CHECKIN_END_HOUR; // qua 6h sáng = hôm nay đã đóng

    const r = await query(`
      SELECT m.id, m.full_name, m.phone, m.email, m.created_at,
             COALESCE(ARRAY_AGG(c.check_date ORDER BY c.check_date DESC)
                      FILTER (WHERE c.check_date IS NOT NULL), '{}'::text[]) AS dates
      FROM members m
      LEFT JOIN member_checkins c ON c.member_id = m.id
      GROUP BY m.id
      ORDER BY m.full_name
    `);

    const rows = r.rows.map(m => {
      const dates = m.dates || [];
      const set = new Set(dates);
      const checkedToday = set.has(date);

      // streak: đếm ngược liên tiếp từ hôm nay (hoặc hôm qua nếu hôm nay chưa đóng cửa sổ)
      let cursor;
      if (set.has(date)) cursor = date;
      else if (!windowEnded) cursor = addDays(date, -1);
      else cursor = null;
      let streak = 0;
      while (cursor && set.has(cursor)) { streak++; cursor = addDays(cursor, -1); }

      // tổng chưa = số ngày eligible (từ ngày import) - số ngày đã check
      const created = m.created_at ? m.created_at.toISOString().slice(0, 10) : date;
      const firstDay = created > date ? date : created;
      const lastEnded = windowEnded ? t.date : addDays(t.date, -1);
      let totalMissed = 0;
      if (firstDay <= lastEnded) {
        const eligible = daysBetween(firstDay, lastEnded);
        const inRange = dates.filter(d => d >= firstDay && d <= lastEnded).length;
        totalMissed = Math.max(0, eligible - inRange);
      }

      return {
        full_name: m.full_name, phone: m.phone, email: m.email,
        checked_today: checkedToday, streak,
        total_checked: dates.length, total_missed: totalMissed
      };
    });
    const checked = rows.filter(x => x.checked_today).length;
    res.json({ date, total: rows.length, checked, not_checked: rows.length - checked, rows });
  } catch (err) { next(err); }
});

// Báo cáo theo khoảng (tuần/tháng) + dữ liệu biểu đồ
router.get('/reports/range', adminRequired, async (req, res, next) => {
  try {
    const today = nowInTimezone().date;
    let from = validateDateParam(req.query.from, today);
    let to = validateDateParam(req.query.to, today);
    if (from > to) { const tmp = from; from = to; to = tmp; }
    if (daysBetween(from, to) > 92) from = addDays(to, -91);

    const [dailyRes, perMemberRes, totalRes] = await Promise.all([
      query(`SELECT check_date, COUNT(*)::int AS c FROM member_checkins
             WHERE check_date BETWEEN $1 AND $2 GROUP BY check_date ORDER BY check_date`, [from, to]),
      query(`SELECT m.full_name, m.phone, m.email, COUNT(c.id)::int AS checked_days
             FROM members m
             LEFT JOIN member_checkins c ON c.member_id = m.id AND c.check_date BETWEEN $1 AND $2
             GROUP BY m.id ORDER BY checked_days DESC, m.full_name`, [from, to]),
      query('SELECT COUNT(*)::int AS c FROM members')
    ]);

    const countMap = {};
    for (const row of dailyRes.rows) countMap[row.check_date] = row.c;
    const totalDays = daysBetween(from, to);
    const daily = [];
    let cursor = from;
    for (let d = 0; d < totalDays; d++) { daily.push({ date: cursor, count: countMap[cursor] || 0 }); cursor = addDays(cursor, 1); }

    res.json({
      from, to, total_days: totalDays,
      total_members: totalRes.rows[0].c,
      total_checkins: daily.reduce((s, d) => s + d.count, 0),
      daily, per_member: perMemberRes.rows
    });
  } catch (err) { next(err); }
});

// ============================================================
//  AUDIT LOG
// ============================================================
router.get('/audit-log', adminRequired, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
    const r = await query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1', [limit]);
    res.json({ logs: r.rows });
  } catch (err) { next(err); }
});

module.exports = router;
