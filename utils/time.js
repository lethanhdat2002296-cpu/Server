// Time utilities - dùng chung cho checkin và admin reports
const config = require('../config');

// Lấy ngày + giờ hiện tại theo TIMEZONE (Vercel chạy UTC, app dùng giờ VN)
function nowInTimezone() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const obj = {};
  for (const p of parts) obj[p.type] = p.value;
  const hour = obj.hour === '24' ? '00' : obj.hour;
  return {
    date: `${obj.year}-${obj.month}-${obj.day}`,
    time: `${hour}:${obj.minute}:${obj.second}`,
    hour: parseInt(hour, 10),
    minute: parseInt(obj.minute, 10)
  };
}

// Cộng/trừ ngày dạng YYYY-MM-DD
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Số ngày giữa 2 ngày (inclusive)
function daysBetween(startDate, endDate) {
  const s = new Date(`${startDate}T12:00:00Z`);
  const e = new Date(`${endDate}T12:00:00Z`);
  return Math.round((e - s) / 86400000) + 1;
}

// Đổi 1 timestamp về ngày + giờ trong timezone
function toLocalDateHour(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false
  }).formatToParts(new Date(timestamp));
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  const hour = o.hour === '24' ? '00' : o.hour;
  return {
    date: `${o.year}-${o.month}-${o.day}`,
    hour: parseInt(hour, 10)
  };
}

module.exports = { nowInTimezone, addDays, daysBetween, toLocalDateHour };
