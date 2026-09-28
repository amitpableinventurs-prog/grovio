const { GigSlot, GigBooking, DeliveryProfile, Order } = require('../models');
const ApiError = require('../utils/apiError');
const t = require('../utils/localTime');
const sessions = require('./riderSession.service');
const { deliveredStats, orderEarning, round2 } = require('./riderEarnings.service');

// Gigs: bookable delivery shifts (models/gigSlot.model.js). A delivery partner books gigs for a
// day, is online during them, and each booked gig ends up completed (online >= its minimum login
// minutes) or incomplete. Completed gigs count toward incentive offers; incomplete ones count
// against an offer's "no more than N incomplete gigs" condition — unless exempted, which free
// gigs are automatically (and admins can do by hand).

// How the app groups a day's gigs. Keyed by the local hour a gig starts in.
const PERIODS = [
  { key: 'morning', title: 'Morning Gigs', icon: 'sunrise', fromHour: 4, toHour: 11 },
  { key: 'lunch', title: 'Lunch Gigs', icon: 'sun', fromHour: 11, toHour: 15 },
  { key: 'evening', title: 'Evening Gigs', icon: 'sunset', fromHour: 15, toHour: 19 },
  { key: 'dinner', title: 'Dinner Gigs', icon: 'moon', fromHour: 19, toHour: 23 },
  { key: 'night', title: 'Night Gigs', icon: 'night', fromHour: 23, toHour: 28 },
];
const periodOf = (date) => {
  const h = t.localHour(date);
  const hour = h < 4 ? h + 24 : h;
  return PERIODS.find((p) => hour >= p.fromHour && hour < p.toHour) || PERIODS[0];
};
const hourLabel = (h) => { const hh = h % 24; return `${hh % 12 || 12}:00${hh < 12 ? 'am' : 'pm'}`; };

// '1pm - 2pm' (history), '1:00pm - 2:00pm' (booking list)
const shortTime = (d) => t.timeLabel(d).replace(':00', '');
const rangeLabel = (a, b, short = false) => (short ? `${shortTime(a)} - ${shortTime(b)}` : `${t.timeLabel(a)} - ${t.timeLabel(b)}`);

// A gig can be booked until there's no longer time to complete it.
const bookableUntil = (slot) => new Date(slot.endAt.getTime() - (slot.isFree ? 0 : slot.minLoginMinutes) * 60000);
const hasSeat = (slot) => slot.capacity === null || slot.capacity === undefined || slot.bookedCount < slot.capacity;

function slotView(slot, booking, now) {
  const booked = !!booking && booking.status !== 'cancelled';
  let state;
  if (booked) state = 'booked';
  else if (now >= bookableUntil(slot)) state = 'closed';
  else if (!hasSeat(slot)) state = 'full';
  else state = 'open';
  return {
    id: slot._id,
    startAt: slot.startAt,
    endAt: slot.endAt,
    timeLabel: rangeLabel(slot.startAt, slot.endAt),
    payPerHour: { min: slot.payPerHourMin, max: slot.payPerHourMax },
    payLabel: slot.payPerHourMin !== null ? `₹${slot.payPerHourMin}${slot.payPerHourMax !== null && slot.payPerHourMax !== slot.payPerHourMin ? ` - ₹${slot.payPerHourMax}` : ''} per hour` : null,
    minLoginMinutes: slot.minLoginMinutes,
    isFree: slot.isFree,
    isPriority: slot.isPriority,
    note: slot.isFree ? 'Free Gig: No min. login hours required' : slot.note,
    seatsLeft: slot.capacity === null || slot.capacity === undefined ? null : Math.max(0, slot.capacity - slot.bookedCount),
    state,
    bookingStatus: booking?.status || null,
    canCancel: booked && booking.status === 'booked' && slot.startAt > now,
  };
}

function slotQuery({ from, to, storeId }) {
  const where = { status: 'active', startAt: { $gte: from, $lt: to } };
  if (storeId) where.store = { $in: [storeId, null] };
  return where;
}

// GET /delivery/gigs?date=&filter=all|open|booked&storeId=
async function listGigs(riderId, query = {}) {
  const now = new Date();
  const day = t.dayFromQuery(query.date);
  const slots = await GigSlot.find(slotQuery({ from: day, to: t.addDays(day, 1), storeId: query.storeId })).sort({ startAt: 1 });
  const bookings = await GigBooking.find({ rider: riderId, slot: { $in: slots.map((s) => s._id) } });
  const bySlot = new Map(bookings.map((b) => [String(b.slot), b]));

  const filter = ['open', 'booked'].includes(query.filter) ? query.filter : 'all';
  const views = slots
    .map((s) => slotView(s, bySlot.get(String(s._id)), now))
    .filter((v) => filter === 'all' || v.state === filter);

  const groups = PERIODS.map((p) => {
    const gigs = views.filter((v) => periodOf(v.startAt).key === p.key);
    return {
      key: p.key,
      title: p.title,
      icon: p.icon,
      rangeLabel: `${hourLabel(p.fromHour)} - ${hourLabel(p.toHour)}`,
      count: gigs.length,
      subtitle: `${hourLabel(p.fromHour)} - ${hourLabel(p.toHour)} • ${gigs.length} Gig${gigs.length === 1 ? '' : 's'}`,
      gigs,
    };
  }).filter((g) => g.count);

  // Date chips: today + the next 6 days.
  const today = t.startOfDay(now);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = t.addDays(today, i);
    return { date: t.dateKey(d), label: t.dayLabel(d), weekday: t.weekdayLabel(d) };
  });

  return { date: t.dateKey(day), title: `Gigs, ${t.dayLabel(day)}`, filter, dates, groups };
}

// POST /delivery/gigs/book { gigIds: [] } -> books each; returns what was booked and what wasn't.
async function bookGigs(riderId, gigIds) {
  const ids = [...new Set((Array.isArray(gigIds) ? gigIds : []).map(String))].filter((id) => /^[a-f\d]{24}$/i.test(id));
  if (!ids.length) throw new ApiError(400, 'Select at least one gig');

  const profile = await DeliveryProfile.findOne({ user: riderId }).select('status');
  if (profile?.status !== 'approved') throw new ApiError(403, 'Your account must be approved before you can book gigs');

  const now = new Date();
  const slots = await GigSlot.find({ _id: { $in: ids } }).sort({ startAt: 1 });
  const failed = ids.filter((id) => !slots.some((s) => String(s._id) === id)).map((gigId) => ({ gigId, reason: 'Gig not found' }));

  // Existing bookings, to refuse overlaps (including between the gigs picked together).
  const taken = await GigBooking.find({ rider: riderId, status: 'booked', endAt: { $gt: now } }).select('slot startAt endAt');
  const busy = taken.map((b) => ({ slot: String(b.slot), startAt: b.startAt, endAt: b.endAt }));
  const overlaps = (s) => busy.find((b) => b.slot !== String(s._id) && b.startAt < s.endAt && s.startAt < b.endAt);

  const booked = [];
  for (const slot of slots) {
    const fail = (reason) => failed.push({ gigId: slot._id, timeLabel: rangeLabel(slot.startAt, slot.endAt), reason });
    if (slot.status !== 'active') { fail('This gig was cancelled'); continue; }
    if (now >= bookableUntil(slot)) { fail('Too late to book this gig'); continue; }
    if (busy.some((b) => b.slot === String(slot._id))) { fail('Already booked'); continue; }
    if (overlaps(slot)) { fail('Overlaps another gig you booked'); continue; }

    // Take a seat atomically.
    const seat = await GigSlot.findOneAndUpdate(
      { _id: slot._id, status: 'active', $or: [{ capacity: null }, { $expr: { $lt: ['$bookedCount', '$capacity'] } }] },
      { $inc: { bookedCount: 1 } },
      { new: true },
    );
    if (!seat) { fail('This gig is full'); continue; }

    try {
      const booking = await GigBooking.findOneAndUpdate(
        { slot: slot._id, rider: riderId },
        {
          $set: { startAt: slot.startAt, endAt: slot.endAt, status: 'booked', cancelledAt: null, exempted: false, exemptReason: null, loginMinutes: null, trips: null, earnings: null, finalizedAt: null },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      busy.push({ slot: String(slot._id), startAt: slot.startAt, endAt: slot.endAt });
      booked.push(slotView(seat, booking, now));
    } catch (err) {
      await GigSlot.updateOne({ _id: slot._id }, { $inc: { bookedCount: -1 } });
      fail(err.code === 11000 ? 'Already booked' : 'Could not book this gig');
    }
  }

  if (!booked.length) throw new ApiError(400, failed[0]?.reason || 'No gigs were booked', failed);
  return { booked, failed };
}

// POST /delivery/gigs/:id/cancel — only before the gig starts.
async function cancelBooking(riderId, slotId) {
  const booking = await GigBooking.findOne({ rider: riderId, slot: slotId, status: 'booked' });
  if (!booking) throw new ApiError(404, 'You have not booked this gig');
  if (booking.startAt <= new Date()) throw new ApiError(400, 'This gig has already started and can no longer be cancelled');
  booking.status = 'cancelled';
  booking.cancelledAt = new Date();
  await booking.save();
  await GigSlot.updateOne({ _id: slotId, bookedCount: { $gt: 0 } }, { $inc: { bookedCount: -1 } });
  return booking;
}

// ---- Completion -----------------------------------------------------------------------------

// Freezes the result of every booked gig that has ended (optionally one partner's). Run on read
// and every few minutes by services/riderJobs.service.js.
async function finalizeDue({ riderId = null } = {}) {
  const where = { status: 'booked', endAt: { $lte: new Date() } };
  if (riderId) where.rider = riderId;
  const due = await GigBooking.find(where).populate('slot', 'minLoginMinutes isFree').limit(500);
  for (const b of due) {
    const [loginMinutes, stats] = await Promise.all([
      sessions.onlineMinutes(b.rider, b.startAt, b.endAt),
      deliveredStats(b.rider, b.startAt, b.endAt),
    ]);
    const completed = loginMinutes >= (b.slot?.minLoginMinutes ?? 50);
    // A free gig that falls short is exempted: it doesn't count against offer conditions.
    const autoExempt = !completed && !!b.slot?.isFree;
    await GigBooking.updateOne(
      { _id: b._id, status: 'booked' },
      {
        $set: {
          status: completed ? 'completed' : 'incomplete',
          ...(autoExempt ? { exempted: true, exemptReason: 'Free gig' } : {}),
          loginMinutes,
          trips: stats.trips,
          earnings: stats.earnings,
          finalizedAt: new Date(),
        },
      },
    );
  }
  return due.length;
}

// Live figures for a gig that hasn't been finalized yet.
async function liveStats(booking) {
  const end = new Date(Math.min(booking.endAt.getTime(), Date.now()));
  const [loginMinutes, stats] = await Promise.all([
    sessions.onlineMinutes(booking.rider, booking.startAt, end),
    deliveredStats(booking.rider, booking.startAt, end),
  ]);
  return { loginMinutes, trips: stats.trips, earnings: stats.earnings };
}

// Home screen "Gig details": the gig in progress (with login progress) and the next one.
async function currentGig(riderId) {
  const now = new Date();
  const [current, next] = await Promise.all([
    GigBooking.findOne({ rider: riderId, status: 'booked', startAt: { $lte: now }, endAt: { $gt: now } }).populate('slot', 'minLoginMinutes isFree isPriority'),
    GigBooking.findOne({ rider: riderId, status: 'booked', startAt: { $gt: now } }).sort({ startAt: 1 }),
  ]);

  let gig = null;
  if (current) {
    const live = await liveStats(current);
    const minLoginMinutes = current.slot?.minLoginMinutes ?? 50;
    const gigMinutes = Math.round((current.endAt - current.startAt) / 60000);
    gig = {
      bookingId: current._id,
      gigId: current.slot?._id,
      startAt: current.startAt,
      endAt: current.endAt,
      timeLabel: rangeLabel(current.startAt, current.endAt, true),
      status: 'in_progress',
      isFree: !!current.slot?.isFree,
      loginMinutes: live.loginMinutes,
      loginLabel: `${sessions.hmm(live.loginMinutes)} hrs`,
      minLoginMinutes,
      requirementLabel: `Complete minimum ${minLoginMinutes} mins${current.slot?.isFree ? ' (free gig: no penalty if you miss it)' : ''}`,
      requirementMet: live.loginMinutes >= minLoginMinutes,
      // For the progress bar: login so far and where the minimum sits, as fractions of the gig.
      progress: Math.min(1, live.loginMinutes / gigMinutes),
      requirementMark: Math.min(1, minLoginMinutes / gigMinutes),
      trips: live.trips,
      earnings: live.earnings,
    };
  }

  return {
    gig,
    nextGig: next ? {
      bookingId: next._id,
      gigId: next.slot,
      startAt: next.startAt,
      endAt: next.endAt,
      label: `${t.dayLabel(next.startAt).split(' ').reverse().join(' ')}, ${t.weekdayLabel(next.startAt)} | ${rangeLabel(next.startAt, next.endAt, true)}`,
    } : null,
  };
}

// ---- History ("Select a Gig") -----------------------------------------------------------------

async function historyRow(b, now) {
  const inProgress = b.status === 'booked';
  const stats = inProgress ? await liveStats(b) : { loginMinutes: b.loginMinutes || 0, trips: b.trips || 0, earnings: b.earnings || 0 };
  return {
    bookingId: b._id,
    gigId: b.slot?._id || b.slot,
    startAt: b.startAt,
    endAt: b.endAt,
    timeLabel: rangeLabel(b.startAt, b.endAt, true),
    status: inProgress ? (b.startAt <= now ? 'in_progress' : 'upcoming') : b.status,
    exempted: b.exempted,
    exemptReason: b.exemptReason,
    isPriority: !!b.slot?.isPriority,
    isFree: !!b.slot?.isFree,
    trips: stats.trips,
    loginMinutes: stats.loginMinutes,
    summaryLabel: `${stats.trips} trip${stats.trips === 1 ? '' : 's'} • ${sessions.hmm(stats.loginMinutes)} hrs`,
    earnings: round2(stats.earnings),
  };
}

// GET /delivery/gigs/history?from=&to=  (default: last 7 days incl. today). Newest first, by day.
async function history(riderId, query = {}) {
  await finalizeDue({ riderId });
  const now = new Date();
  const to = query.to ? t.addDays(t.dayFromQuery(query.to), 1) : t.addDays(t.startOfDay(now), 1);
  const from = query.from ? t.dayFromQuery(query.from) : t.addDays(t.startOfDay(now), -6);
  const bookings = await GigBooking.find({ rider: riderId, status: { $ne: 'cancelled' }, startAt: { $gte: from, $lt: to, $lte: now } })
    .populate('slot', 'isPriority isFree')
    .sort({ startAt: -1 });

  const days = new Map();
  for (const b of bookings) {
    const key = t.dateKey(b.startAt);
    if (!days.has(key)) days.set(key, { date: key, label: `${t.dayLabel(b.startAt).split(' ').reverse().join(' ')}, ${t.weekdayLabel(b.startAt).toUpperCase()}`, gigs: [] });
    days.get(key).gigs.push(await historyRow(b, now));
  }
  return { from, to, days: [...days.values()] };
}

// GET /delivery/gigs/history/:bookingId — one gig with the orders delivered in it.
async function historyDetail(riderId, bookingId) {
  await finalizeDue({ riderId });
  const b = await GigBooking.findOne({ _id: bookingId, rider: riderId }).populate('slot', 'isPriority isFree minLoginMinutes payPerHourMin payPerHourMax');
  if (!b) throw new ApiError(404, 'Gig not found');
  const now = new Date();
  const orders = await Order.find({ delivery: riderId, orderStatus: 'delivered', deliveredAt: { $gte: b.startAt, $lt: b.endAt } })
    .select('orderNumber deliveredAt deliveryPartnerEarning deliveryFee orderStatus trip riderPay')
    .populate('store', 'name')
    .sort({ deliveredAt: 1 });
  return {
    ...(await historyRow(b, now)),
    minLoginMinutes: b.slot?.minLoginMinutes,
    payPerHour: { min: b.slot?.payPerHourMin ?? null, max: b.slot?.payPerHourMax ?? null },
    orders: orders.map((o) => ({ orderId: o._id, orderNumber: o.orderNumber, storeName: o.store?.name || null, deliveredAt: o.deliveredAt, earning: orderEarning(o) })),
  };
}

// Counts for offers (services/offer.service.js): gigs inside [from, to).
async function gigCounts(riderId, from, to) {
  await finalizeDue({ riderId });
  const where = { rider: riderId, startAt: { $gte: from }, endAt: { $lte: to } };
  const [completed, incomplete] = await Promise.all([
    GigBooking.countDocuments({ ...where, status: 'completed' }),
    GigBooking.countDocuments({ ...where, status: 'incomplete', exempted: false }),
  ]);
  return { completed, incomplete };
}

module.exports = { PERIODS, listGigs, bookGigs, cancelBooking, finalizeDue, currentGig, history, historyDetail, gigCounts, rangeLabel };
