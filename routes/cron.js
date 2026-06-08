// Job định kỳ (Vercel Cron / GitHub Actions gọi). Bảo vệ bằng CRON_SECRET.
const express = require('express');
const { query } = require('../lib/db');
const { sendPaymentConfirmed, sendPaymentRejected } = require('../utils/email');

const router = express.Router();

// Xác thực cron: bắt buộc có CRON_SECRET (chưa cấu hình → khóa hẳn để không hở).
function cronAuth(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'CRON chưa được cấu hình (thiếu CRON_SECRET).' });
  const auth = req.headers.authorization || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.secret || '');
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Gửi lại email kết quả (confirmed/rejected) bị lỗi. KHÔNG retry email "đã nhận" vì cần ảnh (không lưu).
router.get('/retry-email', cronAuth, async (req, res, next) => {
  try {
    const r = await query(`
      SELECT * FROM payments
      WHERE email_sent = false AND status IN ('confirmed','rejected') AND COALESCE(email_attempts,0) < 5
      ORDER BY id DESC LIMIT 20
    `);
    let sent = 0, failed = 0;
    for (const p of r.rows) {
      let result = { ok: false };
      try {
        if (p.status === 'confirmed') {
          result = await sendPaymentConfirmed({
            toEmail: p.email, full_name: p.full_name, phone: p.phone, payment_id: p.id,
            created_at: p.created_at, admin_note: p.admin_note, detected_banks: p.detected_banks
          });
        } else {
          result = await sendPaymentRejected({
            toEmail: p.email, full_name: p.full_name, phone: p.phone, payment_id: p.id,
            created_at: p.created_at, admin_note: p.admin_note
          });
        }
      } catch (e) { result = { ok: false, err: e.message }; }
      await query('UPDATE payments SET email_sent=$1, email_error=$2, email_attempts=COALESCE(email_attempts,0)+1 WHERE id=$3',
        [result.ok, result.ok ? null : (result.err || 'retry lỗi'), p.id]);
      if (result.ok) sent++; else failed++;
    }
    res.json({ ok: true, processed: r.rows.length, sent, failed });
  } catch (err) { next(err); }
});

// Dọn bảng phụ phình to (giải phóng dung lượng Neon free-tier).
router.get('/prune', cronAuth, async (req, res, next) => {
  try {
    const now = Date.now();
    const staleWindow = now - 24 * 60 * 60 * 1000; // rate-limit window cũ hơn 24h
    const [rl, la, rc, al] = await Promise.all([
      query('DELETE FROM rate_limits WHERE window_start < $1', [staleWindow]),
      query('DELETE FROM login_attempts WHERE locked_until > 0 AND locked_until < $1', [now]),
      query('DELETE FROM reset_codes WHERE used = 1 OR expires_at < $1', [now]),
      query('DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT 5000)')
    ]);
    res.json({
      ok: true,
      pruned: {
        rate_limits: rl.rowCount, login_attempts: la.rowCount,
        reset_codes: rc.rowCount, audit_log: al.rowCount
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
