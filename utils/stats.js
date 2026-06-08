// Logic thuần (pure) cho streak + gộp archive — tách ra để unit-test & tái dùng.
const { addDays } = require('./time');

// Gộp 1 loạt ngày điểm danh MỚI vào entry archive cũ {count,last_date,tail_streak}.
// Trả entry mới. Nối "đuôi liên tiếp" (tail_streak) nếu ngày mới liền kề last_date cũ.
// Dùng ở POST /archive (gom theo member_id).
function foldDatesIntoEntry(oldEntry, rawDates) {
  const oldE = oldEntry || { count: 0, last_date: null, tail_streak: 0 };
  const dates = [...new Set(rawDates || [])].sort();
  if (!dates.length) return { count: oldE.count || 0, last_date: oldE.last_date || null, tail_streak: oldE.tail_streak || 0 };
  const newCount = dates.length;
  const newMax = dates[dates.length - 1];
  // đếm chuỗi liền kề ở ĐUÔI của đợt mới
  let run = 1, i = dates.length - 1;
  while (i > 0 && dates[i - 1] === addDays(dates[i], -1)) { run++; i--; }
  const newTailStart = dates[i];
  let tail = run;
  // nếu đợt mới bắt đầu ngay sau last_date cũ → nối tiếp tail cũ
  if (oldE.last_date && newTailStart === addDays(oldE.last_date, 1)) tail = run + (oldE.tail_streak || 0);
  return { count: (oldE.count || 0) + newCount, last_date: newMax, tail_streak: tail };
}

// Tính streak hiện tại của 1 member từ: tập ngày live (Set/array) + entry archive + ngày "hôm nay".
// windowEnded = true nếu khung giờ điểm danh hôm nay đã đóng (qua giờ kết thúc).
// Streak nối liền xuyên mốc backup nhờ "đuôi liên tiếp" đã lưu (tail_streak).
function computeMemberStreak(liveDates, archEntry, date, windowEnded) {
  const set = liveDates instanceof Set ? liveDates : new Set(liveDates || []);
  const arch = archEntry || { count: 0, last_date: null, tail_streak: 0 };
  const archTailStart = arch.last_date ? addDays(arch.last_date, -((arch.tail_streak || 1) - 1)) : null;
  const isChecked = (d) => set.has(d) || (arch.last_date && archTailStart && d <= arch.last_date && d >= archTailStart);

  let cursor;
  if (isChecked(date)) cursor = date;
  else if (!windowEnded) cursor = addDays(date, -1); // hôm nay chưa đóng cửa sổ → chưa tính là trượt
  else cursor = null;

  let streak = 0;
  while (cursor && isChecked(cursor)) { streak++; cursor = addDays(cursor, -1); }
  return streak;
}

module.exports = { foldDatesIntoEntry, computeMemberStreak };
