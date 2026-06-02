const express = require('express');
const { query } = require('../lib/db');
const { adminRequired } = require('../middleware/auth');
const { sendPaymentConfirmed, sendPaymentRejected } = require('../utils/email');

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

// ============== STATS ==============
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

module.exports = router;
