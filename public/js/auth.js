// Trang đăng nhập / đăng ký

// Nếu đã có token thì chuyển sang dashboard
if (localStorage.getItem('token')) {
  window.location.href = '/dashboard.html';
}

// ============ HELPER ============
const validators = {
  phone(v) {
    if (!v) return 'Số điện thoại không được để trống';
    if (!/^0\d{9}$/.test(v)) return 'Số điện thoại phải có 10 chữ số và bắt đầu bằng số 0';
    return null;
  },
  email(v) {
    if (!v) return 'Email không được để trống';
    const dom = (document.getElementById('company-domain')?.textContent || 'company');
    const re = new RegExp(`^[a-zA-Z0-9._%+-]+@(gmail\\.com|${dom}\\.com)$`);
    if (!re.test(v)) return `Email phải kết thúc bằng @gmail.com hoặc @${dom}.com`;
    return null;
  },
  username(v) {
    if (!v) return 'Tên đăng nhập không được để trống';
    if (!/^[a-z0-9._]+$/.test(v)) return 'Phải viết liền không dấu, chữ thường và số';
    if (v.length < 4) return 'Tên đăng nhập tối thiểu 4 ký tự';
    return null;
  },
  password(v) {
    if (!v) return 'Mật khẩu không được để trống';
    if (v.length < 8) return 'Mật khẩu tối thiểu 8 ký tự';
    if (!/[A-Z]/.test(v)) return 'Phải có ít nhất 1 chữ IN HOA';
    if (!/[a-z]/.test(v)) return 'Phải có ít nhất 1 chữ thường';
    if (!/[0-9]/.test(v)) return 'Phải có ít nhất 1 chữ số';
    if (!/[^A-Za-z0-9]/.test(v)) return 'Phải có ít nhất 1 ký tự đặc biệt';
    return null;
  },
  fullName(v) {
    if (!v || !v.trim()) return 'Họ và tên không được để trống';
    if (v.trim().length < 2) return 'Họ và tên quá ngắn';
    return null;
  }
};

function showFieldError(input, msg) {
  const wrap = input.closest('.form-group');
  const errEl = wrap.querySelector('.field-error');
  if (msg) {
    input.classList.add('error');
    errEl.textContent = msg;
  } else {
    input.classList.remove('error');
    errEl.textContent = '';
  }
}

function clearFormErrors(form) {
  form.querySelectorAll('input').forEach(i => i.classList.remove('error'));
  form.querySelectorAll('.field-error').forEach(e => e.textContent = '');
}

function showMsg(elId, type, text) {
  const el = document.getElementById(elId);
  el.className = `message show ${type}`;
  el.textContent = text;
}

function hideMsg(elId) {
  document.getElementById(elId).className = 'message';
}

// ============ TAB SWITCHING ============
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.auth-form').forEach(f => {
      f.classList.toggle('active', f.id === `${target}-form`);
    });
    hideMsg('login-message');
    hideMsg('register-message');
  });
});

// ============ TOGGLE PASSWORD ============
document.querySelectorAll('.toggle-pwd').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

// ============ REAL-TIME VALIDATION ============
const regForm = document.getElementById('register-form');
regForm.querySelectorAll('input').forEach(input => {
  input.addEventListener('blur', () => {
    const v = input.value.trim();
    let err = null;
    if (input.name === 'full_name') err = validators.fullName(v);
    if (input.name === 'phone') err = validators.phone(v);
    if (input.name === 'email') err = validators.email(v);
    if (input.name === 'username') err = validators.username(v);
    if (input.name === 'password') err = validators.password(v);
    if (input.name === 'confirm_password') {
      const pwd = regForm.password.value;
      if (!v) err = 'Vui lòng nhập lại mật khẩu';
      else if (v !== pwd) err = 'Mật khẩu nhập lại không khớp';
    }
    showFieldError(input, err);
  });
});

// Auto: phone chỉ cho nhập số
regForm.phone.addEventListener('input', e => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
});
// Auto: username viết thường
regForm.username.addEventListener('input', e => {
  e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, '');
});

// ============ LOGIN ============
let loginLockTimer = null;
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMsg('login-message');
  const form = e.target;
  clearFormErrors(form);

  const username = form.username.value.trim().toLowerCase();
  const password = form.password.value;

  if (!username) {
    showFieldError(form.username, 'Vui lòng nhập tên đăng nhập');
    return;
  }
  if (!password) {
    showFieldError(form.password, 'Vui lòng nhập mật khẩu');
    return;
  }

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Đang đăng nhập...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok) {
      localStorage.setItem('token', data.token);
      // data.user đã có role từ server
      localStorage.setItem('user', JSON.stringify(data.user));
      // Xoá cache app state cũ để bootstrap fresh
      localStorage.removeItem('app_state_v1');
      window.location.href = '/dashboard.html';
      return;
    }

    if (data.not_found) {
      // Tài khoản chưa tồn tại - gợi ý chuyển sang đăng ký
      showMsg('login-message', 'warning',
        '⚠ Tài khoản chưa tồn tại. Vui lòng đăng ký tài khoản mới.');
      setTimeout(() => {
        document.querySelector('.tab[data-tab="register"]').click();
        document.getElementById('register-form').username.value = username;
      }, 1500);
    } else if (data.locked) {
      // Khoá đăng nhập
      startLockoutCountdown(data.seconds_left, btn);
      showMsg('login-message', 'error', `🔒 ${data.error}`);
    } else {
      showMsg('login-message', 'error', data.error || 'Đăng nhập thất bại');
    }
  } catch (err) {
    showMsg('login-message', 'error', 'Không thể kết nối máy chủ');
  } finally {
    if (!loginLockTimer) {
      btn.disabled = false;
      btn.textContent = 'Đăng nhập';
    }
  }
});

function startLockoutCountdown(seconds, btn) {
  let left = seconds;
  btn.disabled = true;
  loginLockTimer = setInterval(() => {
    left--;
    btn.textContent = `Khoá... ${left}s`;
    if (left <= 0) {
      clearInterval(loginLockTimer);
      loginLockTimer = null;
      btn.disabled = false;
      btn.textContent = 'Đăng nhập';
      hideMsg('login-message');
    }
  }, 1000);
  btn.textContent = `Khoá... ${left}s`;
}

// ============ REGISTER ============
regForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMsg('register-message');
  clearFormErrors(regForm);

  const data = {
    full_name: regForm.full_name.value.trim(),
    phone: regForm.phone.value.trim(),
    email: regForm.email.value.trim().toLowerCase(),
    username: regForm.username.value.trim().toLowerCase(),
    password: regForm.password.value,
    confirm_password: regForm.confirm_password.value
  };

  // Validate client-side
  const errors = {
    full_name: validators.fullName(data.full_name),
    phone: validators.phone(data.phone),
    email: validators.email(data.email),
    username: validators.username(data.username),
    password: validators.password(data.password)
  };
  if (!data.confirm_password) errors.confirm_password = 'Vui lòng nhập lại mật khẩu';
  else if (data.password !== data.confirm_password) errors.confirm_password = 'Mật khẩu nhập lại không khớp';

  let hasError = false;
  for (const key in errors) {
    if (errors[key]) {
      hasError = true;
      showFieldError(regForm[key], errors[key]);
    }
  }
  if (hasError) return;

  const btn = regForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Đang đăng ký...';

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const body = await res.json();

    if (res.ok) {
      showMsg('register-message', 'success', '✓ Đăng ký thành công! Vui lòng đăng nhập.');
      regForm.reset();
      setTimeout(() => {
        document.querySelector('.tab[data-tab="login"]').click();
        document.getElementById('login-form').username.value = data.username;
      }, 1500);
    } else {
      if (body.fields) {
        Object.entries(body.fields).forEach(([k, v]) => {
          if (regForm[k]) showFieldError(regForm[k], v);
        });
      }
      showMsg('register-message', 'error', body.error || 'Đăng ký thất bại');
    }
  } catch (err) {
    showMsg('register-message', 'error', 'Không thể kết nối máy chủ');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Tạo tài khoản';
  }
});
