// Dashboard chính

const token = localStorage.getItem('token');
if (!token) {
  window.location.href = '/';
}
const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

// ============ API HELPER ============
async function api(method, url, body) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
    return;
  }
  return { ok: res.ok, status: res.status, data };
}

// ============ COMMON ============
function showMsg(elId, type, text) {
  const el = document.getElementById(elId);
  el.className = `message show ${type}`;
  el.textContent = text;
  if (type === 'success') setTimeout(() => { el.className = 'message'; }, 4000);
}

function showFieldError(input, msg) {
  const wrap = input.closest('.form-group');
  if (!wrap) return;
  const errEl = wrap.querySelector('.field-error');
  if (msg) { input.classList.add('error'); if (errEl) errEl.textContent = msg; }
  else { input.classList.remove('error'); if (errEl) errEl.textContent = ''; }
}

function formatDateVi(dateStr) {
  // dateStr: YYYY-MM-DD
  const [y, m, d] = dateStr.split('-');
  const date = new Date(+y, +m - 1, +d);
  const days = ['Chủ Nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];
  return `${days[date.getDay()]}, ${d}/${m}/${y}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

// ============ TOPBAR ============
const cachedUser = JSON.parse(localStorage.getItem('user') || '{}');
document.getElementById('topbar-username').textContent = cachedUser.full_name || cachedUser.username || '';
document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/';
});

// ============ NAV ============
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.page;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.page').forEach(p => {
      p.classList.toggle('active', p.id === `page-${target}`);
    });
    if (target === 'home') loadStats();
    if (target === 'checkin') { loadCheckinStatus(); loadHistory(true); }
    if (target === 'history') loadHistory(false);
    if (target === 'settings') loadProfileForm();
  });
});

// ============ HOME / STATS ============
async function loadStats() {
  const r = await api('GET', '/api/checkin/stats');
  if (!r || !r.ok) return;
  const { user, checked_this_month, missed_this_month, total_all_time } = r.data;
  document.getElementById('home-fullname').textContent = user.full_name;
  document.getElementById('stat-checked').textContent = checked_this_month;
  document.getElementById('stat-missed').textContent = missed_this_month;
  document.getElementById('stat-total').textContent = total_all_time;
  document.getElementById('info-fullname').value = user.full_name;
  document.getElementById('info-email').value = user.email;
  document.getElementById('info-phone').value = user.phone;
  document.getElementById('info-username').value = cachedUser.username || '';
}

// ============ CHECK-IN ============
let checkinState = null;

function updateClock() {
  const now = new Date();
  document.getElementById('checkin-clock').textContent =
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  document.getElementById('checkin-date').textContent =
    formatDateVi(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`);
}
setInterval(updateClock, 1000);
updateClock();

function applyCheckinStatus(status, checkTime) {
  const btn = document.getElementById('checkin-btn');
  const icon = document.getElementById('checkin-icon');
  const label = document.getElementById('checkin-label');
  const msg = document.getElementById('checkin-msg');

  btn.classList.remove('active', 'done', 'missed', 'disabled');

  if (status === 'active') {
    btn.classList.add('active');
    btn.disabled = false;
    icon.textContent = '🌅';
    label.textContent = 'CHECK-IN';
    msg.textContent = 'Đang trong giờ vàng - hãy check-in ngay!';
  } else if (status === 'done') {
    btn.classList.add('done');
    btn.disabled = true;
    icon.textContent = '✓';
    label.textContent = 'ĐÃ CHECK-IN';
    msg.textContent = checkTime
      ? `Bạn đã check-in lúc ${checkTime.slice(0,5)} hôm nay. Chúc một ngày tuyệt vời!`
      : 'Đã check-in hôm nay';
  } else if (status === 'missed') {
    btn.classList.add('missed');
    btn.disabled = true;
    icon.textContent = '⏱';
    label.textContent = 'QUÊN CHECK-IN';
    msg.textContent = 'Đã quá 6:00 sáng. Hẹn gặp lại bạn vào ngày mai!';
  } else {
    btn.classList.add('disabled');
    btn.disabled = true;
    icon.textContent = '⏰';
    label.textContent = 'NGOÀI GIỜ';
    msg.textContent = 'Check-in chỉ hoạt động từ 5:00 - 6:00 sáng';
  }
}

async function loadCheckinStatus() {
  const r = await api('GET', '/api/checkin/status');
  if (!r || !r.ok) return;
  checkinState = r.data;
  applyCheckinStatus(r.data.status, r.data.check_time);
}

// Tự refresh trạng thái mỗi 30s khi đang ở tab check-in
setInterval(() => {
  if (document.getElementById('page-checkin').classList.contains('active')) {
    loadCheckinStatus();
  }
}, 30000);

document.getElementById('checkin-btn').addEventListener('click', async () => {
  if (!checkinState || checkinState.status !== 'active') return;
  const btn = document.getElementById('checkin-btn');
  btn.disabled = true;
  const r = await api('POST', '/api/checkin/check-in');
  if (r && r.ok) {
    applyCheckinStatus('done', r.data.check_time);
    loadHistory(true);
  } else {
    alert(r?.data?.error || 'Check-in thất bại');
    btn.disabled = false;
  }
});

// ============ HISTORY ============
async function loadHistory(recentOnly) {
  const r = await api('GET', '/api/checkin/history');
  if (!r || !r.ok) return;
  const items = r.data.history || [];
  const listEl = document.getElementById(recentOnly ? 'checkin-recent-list' : 'history-list');
  if (!listEl) return;

  if (items.length === 0) {
    listEl.innerHTML = `<li class="empty-state">
      <div class="ico">📅</div>
      <div>Chưa có check-in nào</div>
    </li>`;
    return;
  }

  const slice = recentOnly ? items.slice(0, 5) : items;
  listEl.innerHTML = slice.map(item => `
    <li class="history-item">
      <div>
        <div class="history-date">${formatDateVi(item.check_date)}</div>
        <div class="history-date-sub">${item.check_date}</div>
      </div>
      <div class="history-time">⏰ ${item.check_time.slice(0,5)}</div>
    </li>
  `).join('');
}

// ============ SETTINGS - PROFILE ============
async function loadProfileForm() {
  const r = await api('GET', '/api/settings/me');
  if (!r || !r.ok) return;
  const form = document.getElementById('profile-form');
  form.full_name.value = r.data.user.full_name;
  form.email.value = r.data.user.email;
}

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  form.querySelectorAll('input').forEach(i => showFieldError(i, null));

  const data = {
    full_name: form.full_name.value.trim(),
    email: form.email.value.trim().toLowerCase()
  };

  const r = await api('PUT', '/api/settings/profile', data);
  if (r && r.ok) {
    showMsg('profile-msg', 'success', '✓ Cập nhật thành công');
    // Cập nhật cache
    cachedUser.full_name = data.full_name;
    cachedUser.email = data.email;
    localStorage.setItem('user', JSON.stringify(cachedUser));
    document.getElementById('topbar-username').textContent = data.full_name;
    loadStats();
  } else {
    if (r?.data?.fields) {
      Object.entries(r.data.fields).forEach(([k, v]) => {
        if (form[k]) showFieldError(form[k], v);
      });
    }
    showMsg('profile-msg', 'error', r?.data?.error || 'Cập nhật thất bại');
  }
});

// ============ SETTINGS - PASSWORD ============
document.getElementById('btn-request-code').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = 'Đang gửi...';
  const r = await api('POST', '/api/settings/password/request-code');
  if (r && r.ok) {
    document.getElementById('password-form').style.display = 'block';
    showMsg('password-msg', 'success', '✓ ' + r.data.message + (r.data.dev_mode ? ' (DEV mode - xem console server)' : ''));
    btn.textContent = 'Gửi lại mã';
  } else {
    showMsg('password-msg', 'error', r?.data?.error || 'Không gửi được mã');
    btn.textContent = 'Gửi mã xác nhận đến email';
  }
  btn.disabled = false;
});

// Toggle password visibility
document.querySelectorAll('.toggle-pwd').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  form.querySelectorAll('input').forEach(i => showFieldError(i, null));

  const data = {
    code: form.code.value.trim(),
    new_password: form.new_password.value,
    confirm_password: form.confirm_password.value
  };

  if (!data.code) return showFieldError(form.code, 'Vui lòng nhập mã');
  if (data.new_password.length < 8) return showFieldError(form.new_password, 'Tối thiểu 8 ký tự');
  if (data.new_password !== data.confirm_password) {
    return showFieldError(form.confirm_password, 'Mật khẩu nhập lại không khớp');
  }

  const r = await api('POST', '/api/settings/password/change', data);
  if (r && r.ok) {
    showMsg('password-msg', 'success', '✓ Đổi mật khẩu thành công!');
    form.reset();
    document.getElementById('password-form').style.display = 'none';
    document.getElementById('btn-request-code').textContent = 'Gửi mã xác nhận đến email';
  } else {
    if (r?.data?.fields) {
      Object.entries(r.data.fields).forEach(([k, v]) => {
        if (form[k]) showFieldError(form[k], v);
      });
    }
    showMsg('password-msg', 'error', r?.data?.error || 'Đổi mật khẩu thất bại');
  }
});

// ============ INIT ============
loadStats();
loadCheckinStatus();
loadHistory(true);
