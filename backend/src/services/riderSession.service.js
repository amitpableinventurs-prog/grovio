const { RiderSession } = require('../models');
const t = require('../utils/localTime');

// Login hours: a RiderSession runs from when a delivery partner goes online
// (PATCH /delivery/availability { isAvailable: true }) until they go offline. Gig completion,
// offers' compulsory login, earnings per hour and Session History are all measured from these.

async function goOnline(riderId) {
  const open = await RiderSession.findOne({ rider: riderId, endedAt: null });
  if (open) return open;
  return RiderSession.create({ rider: riderId, startedAt: new Date() });
}

async function goOffline(riderId) {
  await RiderSession.updateMany({ rider: riderId, endedAt: null }, { $set: { endedAt: new Date() } });
}

// Sessions that overlap [from, to).
function sessionsBetween(riderId, from, to) {
  return RiderSession.find({
    rider: riderId,
    startedAt: { $lt: to },
    $or: [{ endedAt: null }, { endedAt: { $gt: from } }],
  }).sort({ startedAt: 1 });
}

// Minutes of `sessions` inside [from, to), counting an open session up to now.
function minutesIn(sessions, from, to, now = new Date()) {
  const ms = sessions.reduce((sum, s) => sum + t.overlapMs(s.startedAt, s.endedAt || now, from, to), 0);
  return Math.floor(ms / 60000);
}

async function onlineMinutes(riderId, from, to) {
  return minutesIn(await sessionsBetween(riderId, from, to), from, to);
}

// Exact online time in [from, to), in milliseconds (earnings per hour uses this, not whole minutes).
async function onlineMs(riderId, from, to, now = new Date()) {
  const rows = await sessionsBetween(riderId, from, to);
  return rows.reduce((sum, s) => sum + t.overlapMs(s.startedAt, s.endedAt || now, from, to), 0);
}

// 62 -> '01:02'
const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
// 43 -> '0:43'
const hmm = (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

// GET /delivery/sessions?date=&from=HH:mm&to=HH:mm — Session History. from/to narrow the day
// ("Select Time"); session minutes are clipped to that window.
async function sessionHistory(riderId, query = {}) {
  const day = t.dayFromQuery(query.date);
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  const from = timeRe.test(query.from || '') ? t.atTime(day, query.from) : day;
  const to = timeRe.test(query.to || '') ? t.atTime(day, query.to) : t.addDays(day, 1);
  const now = new Date();

  // Newest first: "Session 1" is the latest, like the app.
  const sessions = (await sessionsBetween(riderId, from, to)).reverse();
  const rows = sessions.map((s, i) => {
    const minutes = minutesIn([s], from, to, now);
    const inProgress = !s.endedAt;
    return {
      index: i + 1,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      inProgress,
      minutes,
      hoursLabel: hhmm(minutes),
      rangeLabel: `${t.timeLabel(s.startedAt).toUpperCase()} - ${inProgress ? 'In Progress' : t.timeLabel(s.endedAt).toUpperCase()}`,
    };
  });
  const totalMinutes = rows.reduce((sum, r) => sum + r.minutes, 0);

  return {
    date: t.dateKey(day),
    dateLabel: t.dateKey(day) === t.dateKey(now) ? 'Today' : t.dayLabel(day),
    from,
    to,
    totalMinutes,
    totalLabel: hhmm(totalMinutes),
    // Ring fill: share of the selected window spent online (a whole day by default).
    progress: Math.min(1, totalMinutes / Math.max(1, (to - from) / 60000)),
    sessions: rows,
  };
}

module.exports = { goOnline, goOffline, sessionsBetween, minutesIn, onlineMinutes, onlineMs, sessionHistory, hhmm, hmm };
