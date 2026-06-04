// Endpoint CÔNG KHAI (không cần đăng nhập) cho trang thanh toán
const express = require('express');
const { query } = require('../lib/db');
const { analyzeReceiptText } = require('../utils/receipt');
const { sendPaymentConfirmation } = require('../utils/email');
const { validateEmail, validatePhone, validateFullName } = require('../utils/validators');
const { getClientIp, checkRateLimit } = require('../utils/ratelimit');

const router = express.Router();

// Rate-limit nhẹ cho việc dò danh sách (search + detail): 120 req / 10 phút / IP
async function lookupLimit(req, res, next) {
  const rl = await checkRateLimit(`pub:lookup:${getClientIp(req)}`, 120, 10 * 60 * 1000);
  if (!rl.allowed) return res.status(429).json({ error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút' });
  next();
}

// Che giữa SĐT: hiện 4 số đầu + 2 số cuối (vd 0905***02) để phân biệt mà không lộ hết
function maskPhone(p) {
  if (!p) return '';
  const s = String(p);
  if (s.length <= 4) return s;
  if (s.length <= 6) return s.slice(0, 3) + '***';
  return s.slice(0, 4) + '***' + s.slice(-2);
}
// Che giữa email: hiện 3 ký tự đầu phần tên + tên miền (vd led***@gmail.com)
function maskEmail(e) {
  if (!e) return '';
  const at = e.indexOf('@');
  if (at < 0) return e.slice(0, 3) + '***';
  const local = e.slice(0, at), domain = e.slice(at);
  const shown = local.slice(0, Math.min(3, local.length));
  return shown + '***' + domain;
}

// ============== GỢI Ý TÊN (autocomplete) ==============
// GET /api/public/members/search?q=...
router.get('/members/search', lookupLimit, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim().toLowerCase();
    if (q.length < 1) return res.json({ members: [] });
    res.set('Cache-Control', 'no-store');
    const r = await query(`
      SELECT id, full_name, phone, email
      FROM members
      WHERE LOWER(full_name) LIKE $1
      ORDER BY full_name
      LIMIT 8
    `, [`%${q}%`]);
    // Trả SĐT + email che giữa để phân biệt người trùng tên (không lộ đầy đủ)
    const members = r.rows.map(m => ({
      id: m.id,
      full_name: m.full_name,
      phone_hint: maskPhone(m.phone),
      email_hint: maskEmail(m.email)
    }));
    res.json({ members });
  } catch (err) { next(err); }
});

// ============== CHI TIẾT 1 MEMBER (để autofill) ==============
// GET /api/public/members/:id
router.get('/members/:id', lookupLimit, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const r = await query('SELECT id, full_name, phone, email, address FROM members WHERE id = $1', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
    res.json({ member: r.rows[0] });
  } catch (err) { next(err); }
});

// ============== LỊCH SỬ THANH TOÁN CỦA 1 MEMBER (public) ==============
// GET /api/public/payments?member_id=...
router.get('/payments', lookupLimit, async (req, res, next) => {
  try {
    const memberId = parseInt(req.query.member_id, 10);
    if (!memberId) return res.json({ payments: [] });
    res.set('Cache-Control', 'no-store');
    const r = await query(`
      SELECT id, status, detected_banks, admin_note, created_at, confirmed_at
      FROM payments
      WHERE member_id = $1
      ORDER BY created_at DESC
      LIMIT 30
    `, [memberId]);
    res.json({ payments: r.rows });
  } catch (err) { next(err); }
});

// ============== SUBMIT THANH TOÁN (public) ==============
// body: { member_id, full_name, phone, email, image_data, image_mime, ocr_text }
router.post('/payment', async (req, res, next) => {
  try {
    // Rate-limit: tối đa 8 lần / IP / giờ (chống spam + flood email)
    const rl = await checkRateLimit(`pub:pay:${getClientIp(req)}`, 8, 60 * 60 * 1000);
    if (!rl.allowed) {
      return res.status(429).json({ error: `Bạn đã gửi quá nhiều lần. Vui lòng thử lại sau ${Math.ceil(rl.retryAfterSec / 60)} phút.` });
    }

    const { member_id, full_name, phone, email, image_data, image_mime, ocr_text } = req.body || {};

    const errors = {};
    const nameErr = validateFullName(full_name);
    if (nameErr) errors.full_name = nameErr;
    const phoneErr = validatePhone(phone);
    if (phoneErr) errors.phone = phoneErr;
    const emailErr = validateEmail(email);
    if (emailErr) errors.email = emailErr;
    if (!image_data) errors.image = 'Vui lòng đính kèm ảnh biên lai';
    else if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(image_data)) errors.image = 'Ảnh không hợp lệ';
    else if (image_data.length > 5 * 1024 * 1024) errors.image = 'Ảnh quá lớn (>5MB)';
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ', fields: errors });
    }

    // BẮT BUỘC: phải chọn thành viên từ gợi ý (member_id phải tồn tại)
    if (!member_id) {
      return res.status(400).json({
        error: 'Vui lòng chọn đúng tên của bạn từ danh sách gợi ý. Nếu chưa có tên, liên hệ admin để được thêm.',
        fields: { full_name: 'Chưa chọn tên từ danh sách' }
      });
    }
    const m = await query('SELECT id FROM members WHERE id = $1', [parseInt(member_id, 10)]);
    if (!m.rows.length) {
      return res.status(400).json({
        error: 'Tên bạn chọn không còn trong danh sách. Vui lòng chọn lại hoặc liên hệ admin.',
        fields: { full_name: 'Thành viên không tồn tại' }
      });
    }
    const memberId = m.rows[0].id;

    const analysis = analyzeReceiptText(ocr_text);

    const insertRes = await query(`
      INSERT INTO payments (member_id, full_name, phone, email, ocr_text, is_receipt, detected_banks, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING id, created_at
    `, [
      memberId,
      full_name.trim(),
      phone,
      email.toLowerCase(),
      ocr_text || '',
      analysis.is_receipt,
      analysis.detected_banks.join(', ')
    ]);
    const payment = insertRes.rows[0];

    // Gửi email "đã nhận - chờ xác nhận"
    let emailResult = { ok: false };
    try {
      emailResult = await sendPaymentConfirmation({
        toEmail: email,
        full_name,
        phone,
        payment_id: payment.id,
        created_at: payment.created_at,
        is_receipt: analysis.is_receipt,
        detected_banks: analysis.detected_banks,
        image_data,
        image_mime: image_mime || 'image/jpeg'
      });
    } catch (mailErr) {
      console.error('Lỗi gửi email payment public:', mailErr);
      emailResult = { ok: false, err: mailErr.message };
    }

    await query(
      'UPDATE payments SET email_sent = $1, email_error = $2, email_attempts = 1 WHERE id = $3',
      [emailResult.ok, emailResult.ok ? null : (emailResult.err || 'Không gửi được email'), payment.id]
    );

    res.json({
      ok: true,
      message: 'Đã gửi biên lai. Vui lòng chờ admin xác nhận.',
      payment_id: payment.id,
      is_receipt: analysis.is_receipt,
      email_sent: emailResult.ok,
      email_dev_mode: emailResult.dev || false
      // Không trả chi tiết lỗi SMTP ra ngoài public
    });
  } catch (err) { next(err); }
});

module.exports = router;
