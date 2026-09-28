// Business-day arithmetic in the platform's local time (IST by default), independent of the
// server's own timezone. Riders' days, weeks (Mon–Sun), months and gig hours are all local.
// India has no DST, so a fixed offset is exact; APP_UTC_OFFSET_MINUTES overrides it.
const OFFSET_MIN = Number(process.env.APP_UTC_OFFSET_MINUTES ?? 330);
const OFFSET_MS = OFFSET_MIN * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// A Date shifted so its UTC fields read as local wall-clock time. Internal only.
const shifted = (date) => new Date(new Date(date).getTime() + OFFSET_MS);
const unshift = (ms) => new Date(ms - OFFSET_MS);

// 'YYYY-MM-DD' of `date` in local time.
function dateKey(date = new Date()) {
  return shifted(date).toISOString().slice(0, 10);
}

// Local midnight at the start of `date`'s day, as a real instant.
function startOfDay(date = new Date()) {
  const s = shifted(date);
  return unshift(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
}

// 'YYYY-MM-DD' -> local midnight, or null if it isn't a valid date.
function parseDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return null;
  const [y, m, d] = key.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  if (Number.isNaN(ms) || new Date(ms).getUTCDate() !== d) return null;
  return unshift(ms);
}

// `?date=` query value -> local midnight of that day (today when missing/invalid).
function dayFromQuery(value) {
  return parseDateKey(value) || startOfDay();
}

const addDays = (date, n) => new Date(date.getTime() + n * DAY_MS);

// Monday 00:00 of `date`'s week.
function startOfWeek(date = new Date()) {
  const day = startOfDay(date);
  const weekday = (shifted(day).getUTCDay() + 6) % 7; // Mon = 0
  return addDays(day, -weekday);
}

function startOfMonth(date = new Date()) {
  const s = shifted(date);
  return unshift(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));
}

function addMonths(date, n) {
  const s = shifted(date);
  return unshift(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + n, 1));
}

// Local hour (0–23) and minutes past midnight of an instant.
const localHour = (date) => shifted(date).getUTCHours();
const localMinutes = (date) => { const s = shifted(date); return s.getUTCHours() * 60 + s.getUTCMinutes(); };

// 'HH:mm' on the local day starting at `day` -> instant.
function atTime(day, hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return new Date(startOfDay(day).getTime() + ((h || 0) * 60 + (m || 0)) * 60 * 1000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// '26 Sep'
function dayLabel(date) {
  const s = shifted(date);
  return `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}`;
}
// 'Sat'
const weekdayLabel = (date) => WEEKDAYS[shifted(date).getUTCDay()];
// 'September'
const monthLabel = (date) => MONTHS_LONG[shifted(date).getUTCMonth()];
const dayOfMonth = (date) => shifted(date).getUTCDate();
const year = (date) => shifted(date).getUTCFullYear();

// '1:00pm', '11:30am'
function timeLabel(date) {
  const s = shifted(date);
  const h = s.getUTCHours();
  const m = s.getUTCMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

// Overlap of [aFrom, aTo) and [bFrom, bTo) in milliseconds.
function overlapMs(aFrom, aTo, bFrom, bTo) {
  return Math.max(0, Math.min(aTo.getTime(), bTo.getTime()) - Math.max(aFrom.getTime(), bFrom.getTime()));
}

module.exports = {
  OFFSET_MIN,
  DAY_MS,
  dateKey,
  startOfDay,
  parseDateKey,
  dayFromQuery,
  addDays,
  startOfWeek,
  startOfMonth,
  addMonths,
  localHour,
  localMinutes,
  atTime,
  dayLabel,
  weekdayLabel,
  monthLabel,
  dayOfMonth,
  year,
  timeLabel,
  overlapMs,
};
