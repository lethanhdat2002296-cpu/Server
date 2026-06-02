// Hàm gửi email - nếu chưa cấu hình SMTP thì log ra console
const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;
if (config.SMTP.host && config.SMTP.user) {
  transporter = nodemailer.createTransport({
    host: config.SMTP.host,
    port: config.SMTP.port,
    secure: config.SMTP.secure,
    auth: { user: config.SMTP.user, pass: config.SMTP.pass }
  });
}

async function sendResetCode(toEmail, code, fullName) {
  const subject = '[5AM Check-in] Mã xác nhận đổi mật khẩu';
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2>Xin chào ${fullName},</h2>
      <p>Bạn vừa yêu cầu đổi mật khẩu trên hệ thống 5AM Check-in.</p>
      <p>Mã xác nhận của bạn là:</p>
      <h1 style="background:#f0f0f0; padding: 15px; text-align:center; letter-spacing: 5px;">${code}</h1>
      <p>Mã có hiệu lực trong 10 phút.</p>
      <p>Nếu bạn không yêu cầu, vui lòng bỏ qua email này.</p>
    </div>
  `;

  if (!transporter) {
    // Chưa cấu hình SMTP - log để dev test
    console.log('\n========== [DEV] Email reset code ==========');
    console.log(`To: ${toEmail}`);
    console.log(`Mã: ${code}`);
    console.log('============================================\n');
    return { ok: true, dev: true };
  }

  await transporter.sendMail({
    from: config.SMTP.from,
    to: toEmail,
    subject,
    html
  });
  return { ok: true };
}

module.exports = { sendResetCode };
