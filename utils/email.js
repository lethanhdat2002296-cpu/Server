// Email service - SMTP từ env vars
// Nếu SMTP chưa cấu hình thì log ra console (DEV)
const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;
function getTransporter() {
  if (transporter !== null) return transporter;
  if (config.SMTP.host && config.SMTP.user && config.SMTP.pass) {
    transporter = nodemailer.createTransport({
      host: config.SMTP.host,
      port: config.SMTP.port,
      secure: config.SMTP.secure,
      auth: { user: config.SMTP.user, pass: config.SMTP.pass }
    });
  }
  return transporter;
}

// ============== RESET PASSWORD CODE ==============
async function sendResetCode(toEmail, code, fullName) {
  const subject = '[5AM Check-in] Mã xác nhận đổi mật khẩu';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
      <h2>Xin chào ${escapeHtml(fullName)},</h2>
      <p>Bạn vừa yêu cầu đổi mật khẩu trên hệ thống <strong>5AM Check-in</strong>.</p>
      <p>Mã xác nhận của bạn là:</p>
      <h1 style="background:#fff3cd; color:#d35400; padding: 20px; text-align:center; letter-spacing: 8px; border-radius: 10px; font-family: monospace;">${code}</h1>
      <p>Mã có hiệu lực trong <strong>10 phút</strong>.</p>
      <p style="color:#7f8c8d; font-size: 13px;">Nếu bạn không yêu cầu, vui lòng bỏ qua email này.</p>
    </div>
  `;

  const t = getTransporter();
  if (!t) {
    console.log('\n========== [DEV] Email reset code ==========');
    console.log(`To: ${toEmail}`);
    console.log(`Mã: ${code}`);
    console.log('============================================\n');
    return { ok: true, dev: true };
  }

  await t.sendMail({
    from: config.SMTP.from,
    to: toEmail,
    subject,
    html
  });
  return { ok: true };
}

// ============== PAYMENT CONFIRMATION ==============
async function sendPaymentConfirmation(data) {
  const {
    toEmail, full_name, phone,
    payment_id, created_at,
    is_receipt, detected_banks,
    image_data, image_mime
  } = data;

  const subject = `[5AM Check-in] Xác nhận biên lai thanh toán #${payment_id}`;
  const createdStr = new Date(created_at).toLocaleString('vi-VN', {
    timeZone: config.TIMEZONE,
    dateStyle: 'full',
    timeStyle: 'medium'
  });

  // Status badge - mặc định submit là "ĐANG CHỜ XÁC NHẬN"
  const statusBadge = `<span style="background:#fff3cd;color:#856404;padding:6px 14px;border-radius:20px;font-weight:600;font-size:13px;">⏳ ĐÃ GỬI MAIL - CHỜ XÁC NHẬN</span>`;

  const detectedBanksText = (detected_banks && detected_banks.length > 0)
    ? detected_banks.join(', ')
    : 'Không phát hiện';

  const autoHint = is_receipt
    ? '✓ Hệ thống tự động nhận diện đây là biên lai chuyển khoản hợp lệ.'
    : '⚠ Hệ thống chưa tự động xác minh được ảnh là biên lai. Admin sẽ kiểm tra thủ công.';

  const noteHtml = `
    <div style="background:#fff3cd;color:#856404;padding:14px 16px;border-radius:8px;margin-top:16px;font-size:14px;line-height:1.6;">
      <strong>⏳ Trạng thái: Đang chờ xác nhận</strong><br>
      ${autoHint}<br>
      Admin sẽ xem xét và phản hồi qua email trong vòng <strong>24 giờ</strong>.
      Bạn sẽ nhận email thông báo ngay khi được xác nhận.
    </div>
  `;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f6fa;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:30px 20px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#ff7e5f 0%,#feb47b 100%);padding:30px 24px;border-radius:14px 14px 0 0;text-align:center;color:white;">
      <div style="display:inline-flex;width:60px;height:60px;background:rgba(255,255,255,0.25);border:2px solid rgba(255,255,255,0.4);border-radius:14px;align-items:center;justify-content:center;font-weight:800;font-size:18px;margin-bottom:12px;line-height:60px;">5AM</div>
      <h1 style="margin:8px 0 4px;font-size:22px;font-weight:700;">Xác nhận biên lai thanh toán</h1>
      <p style="margin:0;opacity:0.9;font-size:14px;">Mã giao dịch: #${payment_id}</p>
    </div>

    <!-- Body -->
    <div style="background:white;padding:30px 24px;border-radius:0 0 14px 14px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">

      <p style="font-size:15px;margin:0 0 8px;">Xin chào <strong>${escapeHtml(full_name)}</strong>,</p>
      <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 20px;">
        Chúng tôi đã nhận được biên lai chuyển khoản của bạn. Dưới đây là thông tin chi tiết:
      </p>

      <div style="text-align:center;margin:20px 0;">${statusBadge}</div>

      <!-- Info table -->
      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
        <tr>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px 0 0 6px;color:#7f8c8d;width:40%;">Họ và tên</td>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:0 6px 6px 0;font-weight:600;">${escapeHtml(full_name)}</td>
        </tr>
        <tr><td colspan="2" style="height:4px;"></td></tr>
        <tr>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px 0 0 6px;color:#7f8c8d;">Số điện thoại</td>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:0 6px 6px 0;font-weight:600;">${escapeHtml(phone)}</td>
        </tr>
        <tr><td colspan="2" style="height:4px;"></td></tr>
        <tr>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px 0 0 6px;color:#7f8c8d;">Email</td>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:0 6px 6px 0;font-weight:600;">${escapeHtml(toEmail)}</td>
        </tr>
        <tr><td colspan="2" style="height:4px;"></td></tr>
        <tr>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px 0 0 6px;color:#7f8c8d;">Thời gian gửi</td>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:0 6px 6px 0;font-weight:600;">${escapeHtml(createdStr)}</td>
        </tr>
        <tr><td colspan="2" style="height:4px;"></td></tr>
        <tr>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px 0 0 6px;color:#7f8c8d;">Phát hiện</td>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:0 6px 6px 0;font-weight:600;">${escapeHtml(detectedBanksText)}</td>
        </tr>
      </table>

      <p style="font-size:14px;color:#555;margin:20px 0 8px;">
        <strong>📎 Ảnh biên lai đính kèm:</strong>
      </p>
      <div style="text-align:center;padding:8px;background:#f8f9fa;border-radius:8px;">
        <img src="cid:receipt-image" alt="Biên lai" style="max-width:100%;max-height:400px;border-radius:6px;" />
      </div>

      ${noteHtml}

      <hr style="border:none;border-top:1px solid #ecf0f1;margin:24px 0;" />
      <p style="font-size:12px;color:#95a5a6;text-align:center;margin:0;line-height:1.6;">
        Email này được gửi tự động từ hệ thống 5AM Check-in.<br>
        Vui lòng KHÔNG trả lời trực tiếp email này.<br>
        Nếu có thắc mắc, liên hệ admin để được hỗ trợ.
      </p>
    </div>

    <p style="text-align:center;font-size:11px;color:#bdc3c7;margin-top:14px;">
      © ${new Date().getFullYear()} 5AM Check-in. All rights reserved.
    </p>
  </div>
</body>
</html>`;

  const t = getTransporter();
  if (!t) {
    console.log('\n========== [DEV] Email payment confirmation ==========');
    console.log(`To: ${toEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(`Payment ID: #${payment_id}`);
    console.log(`Is receipt: ${is_receipt}`);
    console.log(`Detected banks: ${detectedBanksText}`);
    console.log('=======================================================\n');
    return { ok: true, dev: true };
  }

  // Chuẩn bị ảnh từ base64 cho attachment inline
  const base64 = image_data.replace(/^data:image\/\w+;base64,/, '');
  const ext = (image_mime || 'image/jpeg').split('/')[1] || 'jpg';

  await t.sendMail({
    from: config.SMTP.from,
    to: toEmail,
    subject,
    html,
    attachments: [{
      filename: `bien-lai-${payment_id}.${ext}`,
      content: base64,
      encoding: 'base64',
      cid: 'receipt-image'
    }]
  });
  return { ok: true };
}

// Escape HTML để tránh XSS trong email
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============== PAYMENT CONFIRMED BY ADMIN ==============
async function sendPaymentConfirmed(data) {
  const { toEmail, full_name, phone, payment_id, created_at, admin_note, detected_banks } = data;

  const subject = `[5AM Check-in] ✓ Thanh toán #${payment_id} đã được xác nhận`;
  const createdStr = new Date(created_at).toLocaleString('vi-VN', {
    timeZone: config.TIMEZONE,
    dateStyle: 'full',
    timeStyle: 'short'
  });
  const confirmedStr = new Date().toLocaleString('vi-VN', {
    timeZone: config.TIMEZONE,
    dateStyle: 'full',
    timeStyle: 'short'
  });

  const noteSection = admin_note && admin_note.trim()
    ? `<div style="background:#e3f2fd;color:#0d47a1;padding:14px 16px;border-radius:8px;margin-top:16px;font-size:14px;">
         <strong>💬 Ghi chú từ admin:</strong><br>${escapeHtml(admin_note)}
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f6fa;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:30px 20px;">

    <!-- Header với màu xanh thành công -->
    <div style="background:linear-gradient(135deg,#00b894 0%,#00cec9 100%);padding:30px 24px;border-radius:14px 14px 0 0;text-align:center;color:white;">
      <div style="font-size:50px;margin-bottom:6px;">✓</div>
      <h1 style="margin:0 0 4px;font-size:24px;font-weight:700;">Thanh toán đã được xác nhận!</h1>
      <p style="margin:0;opacity:0.95;font-size:14px;">Mã giao dịch: #${payment_id}</p>
    </div>

    <div style="background:white;padding:30px 24px;border-radius:0 0 14px 14px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
      <p style="font-size:15px;margin:0 0 8px;">Xin chào <strong>${escapeHtml(full_name)}</strong>,</p>
      <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 20px;">
        Tin vui! Thanh toán của bạn đã được <strong>admin xác nhận thành công</strong>.
        Cảm ơn bạn đã sử dụng dịch vụ 5AM Check-in.
      </p>

      <div style="text-align:center;margin:20px 0;">
        <span style="background:#d4edda;color:#155724;padding:8px 18px;border-radius:20px;font-weight:700;font-size:14px;">
          ✓ ĐÃ XÁC NHẬN
        </span>
      </div>

      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
        <tr>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px 0 0 6px;color:#7f8c8d;width:42%;">Họ và tên</td>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:0 6px 6px 0;font-weight:600;">${escapeHtml(full_name)}</td>
        </tr>
        <tr><td colspan="2" style="height:4px;"></td></tr>
        <tr>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px 0 0 6px;color:#7f8c8d;">Số điện thoại</td>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:0 6px 6px 0;font-weight:600;">${escapeHtml(phone)}</td>
        </tr>
        <tr><td colspan="2" style="height:4px;"></td></tr>
        <tr>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px 0 0 6px;color:#7f8c8d;">Thời gian gửi</td>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:0 6px 6px 0;font-weight:600;">${escapeHtml(createdStr)}</td>
        </tr>
        <tr><td colspan="2" style="height:4px;"></td></tr>
        <tr>
          <td style="padding:10px 14px;background:#e8f5e9;border-radius:6px 0 0 6px;color:#1b5e20;">Thời gian xác nhận</td>
          <td style="padding:10px 14px;background:#e8f5e9;border-radius:0 6px 6px 0;font-weight:700;color:#1b5e20;">${escapeHtml(confirmedStr)}</td>
        </tr>
        ${detected_banks ? `
        <tr><td colspan="2" style="height:4px;"></td></tr>
        <tr>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:6px 0 0 6px;color:#7f8c8d;">Phát hiện</td>
          <td style="padding:10px 14px;background:#f8f9fa;border-radius:0 6px 6px 0;font-weight:600;">${escapeHtml(detected_banks)}</td>
        </tr>` : ''}
      </table>

      ${noteSection}

      <hr style="border:none;border-top:1px solid #ecf0f1;margin:24px 0;" />
      <p style="font-size:12px;color:#95a5a6;text-align:center;margin:0;line-height:1.6;">
        Email này được gửi tự động từ hệ thống 5AM Check-in.<br>
        Vui lòng KHÔNG trả lời trực tiếp email này.
      </p>
    </div>

    <p style="text-align:center;font-size:11px;color:#bdc3c7;margin-top:14px;">
      © ${new Date().getFullYear()} 5AM Check-in. All rights reserved.
    </p>
  </div>
</body>
</html>`;

  const t = getTransporter();
  if (!t) {
    console.log('\n========== [DEV] Email payment CONFIRMED ==========');
    console.log(`To: ${toEmail} - Payment #${payment_id} - Admin note: ${admin_note}`);
    console.log('===================================================\n');
    return { ok: true, dev: true };
  }
  await t.sendMail({ from: config.SMTP.from, to: toEmail, subject, html });
  return { ok: true };
}

// ============== PAYMENT REJECTED BY ADMIN ==============
async function sendPaymentRejected(data) {
  const { toEmail, full_name, phone, payment_id, created_at, admin_note } = data;

  const subject = `[5AM Check-in] ✗ Thanh toán #${payment_id} chưa được xác nhận`;
  const createdStr = new Date(created_at).toLocaleString('vi-VN', {
    timeZone: config.TIMEZONE, dateStyle: 'full', timeStyle: 'short'
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f6fa;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:30px 20px;">
    <div style="background:linear-gradient(135deg,#d63031 0%,#e17055 100%);padding:30px 24px;border-radius:14px 14px 0 0;text-align:center;color:white;">
      <div style="font-size:50px;margin-bottom:6px;">!</div>
      <h1 style="margin:0 0 4px;font-size:22px;font-weight:700;">Thanh toán chưa được xác nhận</h1>
      <p style="margin:0;opacity:0.95;font-size:14px;">Mã giao dịch: #${payment_id}</p>
    </div>
    <div style="background:white;padding:30px 24px;border-radius:0 0 14px 14px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
      <p style="font-size:15px;margin:0 0 8px;">Xin chào <strong>${escapeHtml(full_name)}</strong>,</p>
      <p style="font-size:14px;color:#555;line-height:1.6;">
        Rất tiếc, biên lai thanh toán của bạn <strong>chưa được admin xác nhận</strong>.
      </p>
      <div style="background:#f8d7da;color:#721c24;padding:14px 16px;border-radius:8px;margin:16px 0;font-size:14px;line-height:1.6;">
        <strong>💬 Lý do từ admin:</strong><br>
        ${escapeHtml(admin_note || 'Không có ghi chú thêm. Vui lòng liên hệ admin để biết chi tiết.')}
      </div>
      <p style="font-size:14px;color:#555;line-height:1.6;">
        Vui lòng kiểm tra lại biên lai và gửi lại, hoặc liên hệ admin để được hỗ trợ.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
        <tr><td style="padding:8px 12px;background:#f8f9fa;border-radius:6px 0 0 6px;color:#7f8c8d;width:42%;">Họ và tên</td><td style="padding:8px 12px;background:#f8f9fa;border-radius:0 6px 6px 0;font-weight:600;">${escapeHtml(full_name)}</td></tr>
        <tr><td colspan="2" style="height:4px;"></td></tr>
        <tr><td style="padding:8px 12px;background:#f8f9fa;border-radius:6px 0 0 6px;color:#7f8c8d;">SĐT</td><td style="padding:8px 12px;background:#f8f9fa;border-radius:0 6px 6px 0;font-weight:600;">${escapeHtml(phone)}</td></tr>
        <tr><td colspan="2" style="height:4px;"></td></tr>
        <tr><td style="padding:8px 12px;background:#f8f9fa;border-radius:6px 0 0 6px;color:#7f8c8d;">Thời gian gửi</td><td style="padding:8px 12px;background:#f8f9fa;border-radius:0 6px 6px 0;font-weight:600;">${escapeHtml(createdStr)}</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #ecf0f1;margin:24px 0;" />
      <p style="font-size:12px;color:#95a5a6;text-align:center;margin:0;">Email này được gửi tự động từ hệ thống 5AM Check-in.</p>
    </div>
  </div>
</body></html>`;

  const t = getTransporter();
  if (!t) {
    console.log('\n========== [DEV] Email payment REJECTED ==========');
    console.log(`To: ${toEmail} - Payment #${payment_id} - Reason: ${admin_note}`);
    console.log('==================================================\n');
    return { ok: true, dev: true };
  }
  await t.sendMail({ from: config.SMTP.from, to: toEmail, subject, html });
  return { ok: true };
}

module.exports = { sendResetCode, sendPaymentConfirmation, sendPaymentConfirmed, sendPaymentRejected };
