const express = require('express');
const { query } = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { validateEmail, validatePhone, validateFullName } = require('../utils/validators');
const { sendPaymentConfirmation } = require('../utils/email');

const router = express.Router();

// Danh sách keyword nhận diện biên lai - dùng cả phía client và server
const BANK_KEYWORDS = [
  // Banks
  'VIETCOMBANK', 'VCB',
  'TECHCOMBANK', 'TCB',
  'VIETINBANK', 'VTB', 'CTG',
  'BIDV',
  'AGRIBANK', 'VBA',
  'MB BANK', 'MBBANK', 'MILITARY BANK',
  'ACB', 'A CHAU',
  'VPBANK', 'VP BANK',
  'SACOMBANK', 'STB',
  'TPBANK', 'TP BANK',
  'HDBANK', 'HD BANK',
  'EXIMBANK',
  'SHB',
  'OCB',
  'MSB', 'MARITIME BANK',
  'NCB',
  'SEABANK',
  'PVCOMBANK',
  // E-wallet
  'MOMO', 'MO MO',
  'ZALOPAY', 'ZALO PAY',
  'VNPAY', 'VN PAY',
  'SHOPEEPAY', 'SHOPEE PAY',
  'VIETTELPAY', 'VIETTEL MONEY',
  // Transfer keywords
  'CHUYEN KHOAN', 'CHUYỂN KHOẢN',
  'CHUYEN TIEN', 'CHUYỂN TIỀN',
  'GIAO DICH', 'GIAO DỊCH',
  'TRANSACTION', 'TRANSFER',
  'BIEN LAI', 'BIÊN LAI',
  'HOA DON', 'HÓA ĐƠN',
  'THANH TOAN', 'THANH TOÁN',
  'SO TIEN', 'SỐ TIỀN',
  'NOI DUNG', 'NỘI DUNG',
  'NGUOI NHAN', 'NGƯỜI NHẬN',
  'NGUOI GUI', 'NGƯỜI GỬI',
  'STK', 'TAI KHOAN', 'TÀI KHOẢN',
  'THANH CONG', 'THÀNH CÔNG',
  'SUCCESS', 'SUCCESSFUL',
  'VND', 'DONG', 'ĐỒNG'
];

// Phân tích text OCR → có phải biên lai không + ngân hàng phát hiện
function analyzeReceiptText(text) {
  if (!text || typeof text !== 'string') {
    return { is_receipt: false, matched_keywords: [], detected_banks: [] };
  }
  const upper = text.toUpperCase();
  const matched = BANK_KEYWORDS.filter(k => upper.includes(k));
  const detectedBanks = matched.filter(k =>
    !['VND', 'DONG', 'ĐỒNG', 'STK', 'SUCCESS', 'SUCCESSFUL', 'THANH CONG', 'THÀNH CÔNG'].includes(k)
  );
  // Cần match ít nhất 2 keyword để cho qua (tránh false positive)
  const is_receipt = matched.length >= 2;
  return { is_receipt, matched_keywords: matched, detected_banks: detectedBanks };
}

// Endpoint trả keyword list cho frontend
router.get('/receipt-keywords', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ keywords: BANK_KEYWORDS });
});

// ============== SUBMIT PAYMENT ==============
router.post('/submit', authRequired, async (req, res, next) => {
  try {
    const { full_name, phone, email, image_data, image_mime, ocr_text } = req.body || {};

    // Validate fields
    const errors = {};
    const nameErr = validateFullName(full_name);
    if (nameErr) errors.full_name = nameErr;
    const phoneErr = validatePhone(phone);
    if (phoneErr) errors.phone = phoneErr;
    const emailErr = validateEmail(email);
    if (emailErr) errors.email = emailErr;
    if (!image_data) errors.image = 'Vui lòng đính kèm ảnh biên lai';
    if (image_data && image_data.length > 5 * 1024 * 1024) {
      errors.image = 'Ảnh quá lớn (>5MB). Vui lòng nén lại';
    }
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ', fields: errors });
    }

    // Phân tích OCR text (đã chạy ở client)
    const analysis = analyzeReceiptText(ocr_text);

    // Lưu DB với status='pending' (chờ admin xác nhận)
    const insertRes = await query(`
      INSERT INTO payments (
        user_id, full_name, phone, email,
        ocr_text, is_receipt, detected_banks, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING id, created_at
    `, [
      req.user.id,
      full_name.trim(),
      phone,
      email.toLowerCase(),
      ocr_text || '',
      analysis.is_receipt,
      analysis.detected_banks.join(', ')
    ]);
    const payment = insertRes.rows[0];

    // Gửi email
    let emailResult = { ok: false, dev: false, err: null };
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
      if (emailResult.ok) {
        await query('UPDATE payments SET email_sent = TRUE WHERE id = $1', [payment.id]);
      }
    } catch (mailErr) {
      console.error('Lỗi gửi email payment:', mailErr);
      emailResult = { ok: false, err: mailErr.message };
    }

    res.json({
      ok: true,
      message: 'Thanh toán đã được ghi nhận',
      payment_id: payment.id,
      is_receipt: analysis.is_receipt,
      detected_banks: analysis.detected_banks,
      email_sent: emailResult.ok,
      email_dev_mode: emailResult.dev || false,
      email_error: emailResult.ok ? null : (emailResult.err || 'Không gửi được email')
    });
  } catch (err) { next(err); }
});

// ============== LỊCH SỬ THANH TOÁN ==============
router.get('/history', authRequired, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, max-age=30');
    const r = await query(`
      SELECT id, full_name, phone, email, is_receipt, detected_banks,
             email_sent, status, confirmed_at, admin_note, created_at
      FROM payments
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.user.id]);
    res.json({ history: r.rows });
  } catch (err) { next(err); }
});

module.exports = router;
