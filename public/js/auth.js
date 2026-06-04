// Trang đăng nhập ADMIN (+ quên mật khẩu)

if (localStorage.getItem('token')) {
  window.location.href = '/dashboard.html';
}

const validators = {
  password(v) {
    if (!v) return 'Mật khẩu không được để trống';
    if (v.length < 8) return 'Mật khẩu tối thiểu 8 ký tự';
    if (!/[A-Z]/.test(v)) return 'Phải có ít nhất 1 chữ IN HOA';
    if (!/[a-z]/.test(v)) return 'Phải có ít nhất 1 chữ thường';
    if (!/[0-9]/.test(v)) return 'Phải có ít nhất 1 chữ số';
    if (!/[^A-Za-z0-9]/.test(v)) return 'Phải có ít nhất 1 ký tự đặc biệt';
    return null;
  }
};

function showFieldError(input, msg) {
  const wrap = input.closest('.form-group');
  if (!wrap) return;
  const errEl = wrap.querySelector('.field-error');
  if (msg) { input.classList.add('error'); if (errEl) errEl.textContent = msg; }
  else { input.classList.remove('error'); if (errEl) errEl.textContent = ''; }
}
function showMsg(elId, type, text) {
  const el = document.getElementById(elId);
  el.className = `message show ${type}`;
  el.textContent = text;
}
function hideMsg(elId) { document.getElementById(elId).className = 'message'; }

// Toggle password
document.querySelectorAll('.toggle-pwd').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

// ============ LOGIN ============
let loginLockTimer = null;
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMsg('login-message');
  const form = e.target;
  form.querySelectorAll('input').forEach(i => showFieldError(i, null));

  const username = form.username.value.trim().toLowerCase();
  const password = form.password.value;
  if (!username) return showFieldError(form.username, 'Vui lòng nhập tên đăng nhập');
  if (!password) return showFieldError(form.password, 'Vui lòng nhập mật khẩu');

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Đang đăng nhập...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
      if (data.user?.role !== 'admin') {
        showMsg('login-message', 'error', 'Tài khoản này không có quyền quản trị');
        btn.disabled = false; btn.textContent = 'Đăng nhập';
        return;
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.removeItem('app_state_v1');
      window.location.href = '/dashboard.html';
      return;
    }
    if (data.not_found) {
      showMsg('login-message', 'error', '⚠ Tài khoản không tồn tại');
    } else if (data.locked) {
      startLockoutCountdown(data.seconds_left, btn);
      showMsg('login-message', 'error', `🔒 ${data.error}`);
    } else {
      showMsg('login-message', 'error', data.error || 'Đăng nhập thất bại');
    }
  } catch (err) {
    showMsg('login-message', 'error', 'Không thể kết nối máy chủ');
  } finally {
    if (!loginLockTimer) { btn.disabled = false; btn.textContent = 'Đăng nhập'; }
  }
});

function startLockoutCountdown(seconds, btn) {
  let left = seconds;
  btn.disabled = true;
  loginLockTimer = setInterval(() => {
    left--;
    btn.textContent = `Khoá... ${left}s`;
    if (left <= 0) {
      clearInterval(loginLockTimer); loginLockTimer = null;
      btn.disabled = false; btn.textContent = 'Đăng nhập';
      hideMsg('login-message');
    }
  }, 1000);
  btn.textContent = `Khoá... ${left}s`;
}

// ============ FORGOT PASSWORD ============
function showForgotForm() {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('forgot-form').classList.add('active');
  document.getElementById('forgot-step-1').style.display = '';
  document.getElementById('forgot-step-2').style.display = 'none';
  hideMsg('forgot-message-1'); hideMsg('forgot-message-2');
}
function backToLogin() {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('login-form').classList.add('active');
}
document.getElementById('forgot-link').addEventListener('click', e => { e.preventDefault(); showForgotForm(); });
document.getElementById('back-to-login').addEventListener('click', e => { e.preventDefault(); backToLogin(); });

let forgotIdentifier = '';
async function sendForgotCode() {
  const form = document.getElementById('forgot-form');
  const identifier = form.identifier.value.trim();
  if (!identifier) return showFieldError(form.identifier, 'Vui lòng nhập thông tin');
  forgotIdentifier = identifier;
  hideMsg('forgot-message-1');
  const btn = document.getElementById('forgot-send-code');
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('forgot-masked-email').textContent = data.masked_email;
      document.getElementById('forgot-step-1').style.display = 'none';
      document.getElementById('forgot-step-2').style.display = '';
      if (data.dev_mode) showMsg('forgot-message-2', 'info', '⚙ DEV mode: mã ở console server.');
    } else {
      showMsg('forgot-message-1', 'error', data.error || 'Lỗi gửi mã');
    }
  } catch (err) {
    showMsg('forgot-message-1', 'error', 'Không thể kết nối máy chủ');
  } finally {
    btn.disabled = false; btn.textContent = 'Gửi mã xác nhận';
  }
}
document.getElementById('forgot-send-code').addEventListener('click', sendForgotCode);
document.getElementById('forgot-resend').addEventListener('click', () => {
  document.getElementById('forgot-step-1').style.display = '';
  document.getElementById('forgot-step-2').style.display = 'none';
  hideMsg('forgot-message-2');
});

document.getElementById('forgot-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  form.querySelectorAll('input').forEach(i => showFieldError(i, null));
  hideMsg('forgot-message-2');
  const code = form.code.value.trim();
  const new_password = form.new_password.value;
  const confirm_password = form.confirm_password.value;
  if (!code) return showFieldError(form.code, 'Vui lòng nhập mã');
  const pwdErr = validators.password(new_password);
  if (pwdErr) return showFieldError(form.new_password, pwdErr);
  if (new_password !== confirm_password) return showFieldError(form.confirm_password, 'Mật khẩu nhập lại không khớp');

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Đang xử lý...';
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: forgotIdentifier, code, new_password, confirm_password })
    });
    const data = await res.json();
    if (res.ok) {
      showMsg('forgot-message-2', 'success', '✓ Đổi mật khẩu thành công! Đang chuyển về đăng nhập...');
      setTimeout(() => {
        backToLogin();
        document.getElementById('login-form').username.value = data.username || forgotIdentifier;
      }, 1800);
    } else {
      if (data.fields) Object.entries(data.fields).forEach(([k, v]) => { if (form[k]) showFieldError(form[k], v); });
      showMsg('forgot-message-2', 'error', data.error || 'Lỗi đặt mật khẩu');
    }
  } catch (err) {
    showMsg('forgot-message-2', 'error', 'Không thể kết nối máy chủ');
  } finally {
    btn.disabled = false; btn.textContent = 'Đặt mật khẩu mới';
  }
});
