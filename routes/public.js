// Endpoint CÔNG KHAI (không cần đăng nhập) cho trang thanh toán
const express = require('express');
const { query } = require('../lib/db');
const { analyzeReceiptText } = require('../utils/receipt');
const { sendPaymentConfirmation } = require('../utils/email');
const { validateEmail, validatePhone, validateFullName } = require('../utils/validators');
const { getClientIp, checkRateLimit, peekRateLimit, incrementKey, clearKey } = require('../utils/ratelimit');
const { getQrConfig, buildVietQrUrl } = require('../utils/appconfig');
const { maskPhone, maskEmail } = require('../utils/mask');
const { nowInTimezone } = require('../utils/time');

const router = express.Router();

// ============== CẤU HÌNH QR THANH TOÁN (public) ==============
// Trang thanh toán cần để sinh mã VietQR
router.get('/payment-config', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ config: await getQrConfig() });
  } catch (err) { next(err); }
});

// ============== TẢI MÃ QR VỀ MÁY (proxy → ép tải, chạy mọi thiết bị) ==============
router.get('/qr-download', async (req, res, next) => {
  try {
    const cfg = await getQrConfig();
    const r = await fetch(buildVietQrUrl(cfg));
    if (!r.ok) return res.status(502).json({ error: 'Không tải được mã QR từ VietQR' });
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="ma-qr-5am-club.png"');
    res.set('Cache-Control', 'no-store');
    res.send(buf);
  } catch (err) { next(err); }
});

// Rate-limit nhẹ cho việc dò danh sách (search + detail): 120 req / 10 phút / IP
async function lookupLimit(req, res, next) {
  const rl = await checkRateLimit(`pub:lookup:${getClientIp(req)}`, 120, 10 * 60 * 1000);
  if (!rl.allowed) return res.status(429).json({ error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút' });
  next();
}

// maskPhone / maskEmail: xem utils/mask.js (maskPhone KHÔNG lộ 4 số cuối dùng để xác minh)

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

// Kiểm tra 4 số cuối SĐT khớp với member. Trả member nếu đúng, null nếu sai.
async function verifyLast4(memberId, last4) {
  if (!Number.isInteger(memberId) || memberId < 1) return null;
  const r = await query('SELECT id, full_name, phone, email FROM members WHERE id = $1', [memberId]);
  const m = r.rows[0];
  if (!m) return null;
  const code = String(last4 || '').replace(/\D/g, '');
  if (!m.phone) return { error: 'no_phone' };       // không có SĐT → không xác minh được
  if (code.length !== 4 || m.phone.slice(-4) !== code) return null;
  return m;
}

// ============== XÁC MINH + CHI TIẾT 1 MEMBER (để autofill) ==============
// GET /api/public/members/:id/verify?last4=XXXX
router.get('/members/:id/verify', lookupLimit, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'Không tìm thấy thành viên' });

    // Khóa chống dò 4 số cuối: tối đa 5 lần SAI / 15 phút / mỗi member (tách khỏi rate-limit IP chung)
    const failKey = `pub:verify:fail:${id}`;
    const lock = await peekRateLimit(failKey, 5, 15 * 60 * 1000);
    if (lock.locked) {
      return res.status(429).json({ error: `Nhập sai quá nhiều lần. Vui lòng thử lại sau ${Math.ceil(lock.retryAfterSec / 60)} phút.` });
    }

    const m = await verifyLast4(id, req.query.last4);
    if (m && m.error === 'no_phone') {
      return res.status(400).json({ error: 'Thành viên này chưa có số điện thoại để xác minh. Vui lòng liên hệ admin.' });
    }
    if (!m) {
      await incrementKey(failKey, 15 * 60 * 1000);
      return res.status(403).json({ error: '4 số cuối SĐT không đúng. Vui lòng thử lại.' });
    }
    await clearKey(failKey);   // đúng → reset bộ đếm sai
    res.set('Cache-Control', 'no-store');
    res.json({ member: m });
  } catch (err) { next(err); }
});

// ============== LỊCH SỬ THANH TOÁN CỦA 1 MEMBER (public, cần xác minh) ==============
// GET /api/public/payments?member_id=...&last4=XXXX
router.get('/payments', lookupLimit, async (req, res, next) => {
  try {
    const memberId = parseInt(req.query.member_id, 10);
    const m = await verifyLast4(memberId, req.query.last4);
    if (!m || m.error) return res.status(403).json({ error: 'Chưa xác minh', payments: [] });
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
    const m = await query('SELECT id, phone, email FROM members WHERE id = $1', [parseInt(member_id, 10)]);
    if (!m.rows.length) {
      return res.status(400).json({
        error: 'Tên bạn chọn không còn trong danh sách. Vui lòng chọn lại hoặc liên hệ admin.',
        fields: { full_name: 'Thành viên không tồn tại' }
      });
    }
    const member = m.rows[0];
    const memberId = member.id;
    // NGUỒN CHÂN LÝ: ưu tiên SĐT/email từ hồ sơ member (chống gắn tên người khác + gửi mail sai người)
    const effPhone = member.phone || phone;
    const effEmail = (member.email || email).toLowerCase();

    const analysis = analyzeReceiptText(ocr_text);

    const period = nowInTimezone().date.slice(0, 7);  // 'YYYY-MM' kỳ đóng phí theo giờ VN
    const insertRes = await query(`
      INSERT INTO payments (member_id, full_name, phone, email, ocr_text, is_receipt, detected_banks, status, period, detected_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
      RETURNING id, created_at
    `, [
      memberId,
      full_name.trim(),
      effPhone,
      effEmail,
      ocr_text || '',
      analysis.is_receipt,
      analysis.detected_banks.join(', '),
      period,
      analysis.detected_amount
    ]);
    const payment = insertRes.rows[0];

    // Gửi email "đã nhận - chờ xác nhận" (đến email hồ sơ)
    let emailResult = { ok: false };
    try {
      emailResult = await sendPaymentConfirmation({
        toEmail: effEmail,
        full_name,
        phone: effPhone,
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
