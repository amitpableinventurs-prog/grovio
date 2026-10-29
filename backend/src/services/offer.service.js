const mongoose = require('mongoose');
const { IncentiveOffer, OfferPayout, Order, RiderSession, GigBooking, User } = require('../models');
const ApiError = require('../utils/apiError');
const t = require('../utils/localTime');
const sessions = require('./riderSession.service');
const gigs = require('./gig.service');
const { deliveredStats, round2 } = require('./riderEarnings.service');
const { creditWallet } = require('./payment.service');
const { logServerError } = require('./errorLog.service');

// Incentive offers for delivery partners (models/incentiveOffer.model.js). While an offer runs,
// a partner's progress is computed live from their gigs, delivered orders, order earnings,
// rejections and login sessions. When it ends, settleOffer() pays each partner the incentive of
// the highest tier they reached — unless they broke a "Don't do" condition or missed a compulsory
// login window — as an 'incentive' wallet credit.

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const rupees = (n) => `₹${Number.isInteger(n) ? n : round2(n)}`;

function offerStatus(offer, now = new Date()) {
  if (offer.status === 'cancelled') return 'cancelled';
  if (now < offer.startAt) return 'upcoming';
  if (now < offer.endAt) return 'live';
  return 'expired';
}

const forRider = (offer, riderId) => !offer.riders?.length || offer.riders.some((r) => String(r) === String(riderId));
const riderFilter = (riderId) => ({ $or: [{ riders: { $size: 0 } }, { riders: oid(riderId) }] });

// '26 Sep • 4am - 4am'
const shortTime = (d) => t.timeLabel(d).replace(':00', '');
const windowLabel = (offer) => `${t.dayLabel(offer.startAt)} • ${shortTime(offer.startAt)} - ${shortTime(offer.endAt)}`;
// '5 Dec - 6 Dec • 4am - 4am' (condition sheets)
const spanLabel = (offer) => {
  const end = t.dayLabel(new Date(offer.endAt.getTime() - 1));
  const days = t.dayLabel(offer.startAt) === end ? end : `${t.dayLabel(offer.startAt)} - ${t.dayLabel(offer.endAt)}`;
  return `${days} • ${shortTime(offer.startAt)} - ${shortTime(offer.endAt)}`;
};
// 520 -> '8 hrs 40 mins'
const durationLabel = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} hr${h === 1 ? '' : 's'}` : null, m ? `${m} min${m === 1 ? '' : 's'}` : null].filter(Boolean).join(' ') || '0 mins';
};
// Compulsory login card icon, by the window's start hour.
const windowIcon = (d) => { const h = t.localHour(d); return h >= 4 && h < 15 ? 'sun' : h >= 15 && h < 18 ? 'evening' : 'night'; };

// Compulsory login windows as real instants: from the first `from` at/after the offer start.
function loginWindows(offer) {
  return (offer.compulsoryLogin || []).map((w) => {
    let from = t.atTime(offer.startAt, w.from);
    if (from < offer.startAt) from = t.addDays(from, 1);
    let to = t.atTime(from, w.to);
    if (to <= from) to = t.addDays(to, 1);
    return { ...(w.toObject ? w.toObject() : w), fromAt: from, toAt: to };
  });
}

// Which progress rows the tiers use ('gigs', 'orders', 'earnings'), in display order.
function tierRows(offer) {
  const rows = [];
  if (offer.tiers.some((x) => x.minGigs !== null && x.minGigs !== undefined)) rows.push('gigs');
  if (offer.tiers.some((x) => x.minOrders !== null && x.minOrders !== undefined)) rows.push('orders');
  if (offer.tiers.some((x) => x.minEarnings !== null && x.minEarnings !== undefined)) rows.push('earnings');
  return rows;
}

const tierMet = (tier, p) =>
  (tier.minGigs === null || tier.minGigs === undefined || p.gigs >= tier.minGigs)
  && (tier.minOrders === null || tier.minOrders === undefined || p.orders >= tier.minOrders)
  && (tier.minEarnings === null || tier.minEarnings === undefined || p.earnings >= tier.minEarnings);

// Rejections by kind inside [from, to).
async function rejectionCounts(riderId, from, to) {
  const rows = await Order.aggregate([
    { $match: { 'deliveryRejections.rider': oid(riderId) } },
    { $unwind: '$deliveryRejections' },
    { $match: { 'deliveryRejections.rider': oid(riderId), 'deliveryRejections.at': { $gte: from, $lt: to } } },
    { $group: { _id: '$deliveryRejections.kind', n: { $sum: 1 } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  return { denials: by.denial || 0, cancellations: by.cancellation || 0 };
}

// Raw figures for one partner in an offer, up to now (or the offer end).
async function measure(offer, riderId, now = new Date()) {
  const to = new Date(Math.min(offer.endAt.getTime(), now.getTime()));
  if (to <= offer.startAt) {
    return { gigs: 0, orders: 0, earnings: 0, orderDenials: 0, cancellations: 0, incompleteGigs: 0, login: loginWindows(offer).map(() => 0) };
  }
  const windows = loginWindows(offer);
  const [gigCounts, delivered, rejections, windowSessions] = await Promise.all([
    gigs.gigCounts(riderId, offer.startAt, offer.endAt),
    deliveredStats(riderId, offer.startAt, to),
    rejectionCounts(riderId, offer.startAt, to),
    windows.length ? sessions.sessionsBetween(riderId, windows[0].fromAt, windows.reduce((m, w) => (w.toAt > m ? w.toAt : m), windows[0].toAt)) : [],
  ]);
  return {
    gigs: gigCounts.completed,
    incompleteGigs: gigCounts.incomplete,
    orders: delivered.trips,
    earnings: delivered.earnings,
    orderDenials: rejections.denials,
    cancellations: rejections.cancellations,
    login: windows.map((w) => sessions.minutesIn(windowSessions, w.fromAt, w.toAt < now ? w.toAt : now, now)),
  };
}

const CONDITIONS = [
  { key: 'orderDenials', limit: 'maxOrderDenials', noun: 'order denial', audio: 'orderDenials' },
  { key: 'cancellations', limit: 'maxCancellations', noun: 'order cancellation', audio: 'cancellations' },
  { key: 'incompleteGigs', limit: 'maxIncompleteGigs', noun: 'incomplete gig', audio: 'incompleteGigs' },
];

// Everything the offer screens show for one partner.
function evaluate(offer, m, now = new Date()) {
  const status = offerStatus(offer, now);
  const progress = { gigs: m.gigs, orders: m.orders, earnings: m.earnings, orderDenials: m.orderDenials, cancellations: m.cancellations, incompleteGigs: m.incompleteGigs };

  const tiers = offer.tiers.map((tier) => {
    const achieved = tierMet(tier, progress);
    return {
      incentive: tier.incentive,
      gigs: tier.minGigs ?? null,
      orders: tier.minOrders ?? null,
      earnings: tier.minEarnings ?? null,
      achieved,
      // The tier's lock icon: it unlocks once all of its requirements are met.
      locked: !achieved,
    };
  });
  let tierIndex = -1;
  tiers.forEach((tier, i) => { if (tier.achieved && (tierIndex < 0 || tier.incentive > tiers[tierIndex].incentive)) tierIndex = i; });

  const conditions = CONDITIONS
    .filter((c) => offer.conditions?.[c.limit] !== null && offer.conditions?.[c.limit] !== undefined)
    .map((c) => {
      const limit = offer.conditions[c.limit];
      const used = m[c.key];
      return {
        key: c.key,
        noun: c.noun,
        limit,
        used,
        violated: used > limit,
        remaining: Math.max(0, limit - used),
        title: limit === 0 ? `No ${c.noun}s` : `No more than ${plural(limit, c.noun)}`,
        prefix: limit === 0 ? 'No' : 'No more than',
        label: limit === 0 ? `${c.noun}s` : plural(limit, c.noun),
        sheetTitle: `No ${c.noun}s`,
        audioUrl: offer.conditionAudio?.[c.audio] || null,
      };
    });

  const login = loginWindows(offer).map((w, i) => {
    const minutes = m.login[i] || 0;
    const met = minutes >= w.minMinutes;
    return {
      from: w.from,
      to: w.to,
      fromAt: w.fromAt,
      toAt: w.toAt,
      label: `${t.timeLabel(w.fromAt).replace(':00', '')} - ${t.timeLabel(w.toAt).replace(':00', '')}`,
      minMinutes: w.minMinutes,
      requiredLabel: w.minMinutes % 60 ? `${Math.floor(w.minMinutes / 60)}:${String(w.minMinutes % 60).padStart(2, '0')} hrs` : `${w.minMinutes / 60} hrs`,
      icon: windowIcon(w.fromAt),
      loginMinutes: minutes,
      progress: Math.min(1, minutes / w.minMinutes),
      remainingMinutes: Math.max(0, w.minMinutes - minutes),
      // '8 hrs 40 mins left' while it can still be done
      remainingLabel: !met && now < w.toAt ? `${durationLabel(w.minMinutes - minutes)} left` : null,
      status: met ? 'met' : now < w.fromAt ? 'upcoming' : now < w.toAt ? 'in_progress' : 'missed',
    };
  });

  const violation = conditions.find((c) => c.violated);
  const missedLogin = login.find((l) => l.status === 'missed');
  const disqualified = violation ? `Broke the condition: ${violation.title.toLowerCase()}` : missedLogin ? `Missed compulsory login ${missedLogin.label}` : null;
  // Banner line: 'More than 1 order denial', 'Order cancellation done', 'Compulsory login missed (3pm - 1:59am)'
  const lostBecause = violation
    ? (violation.limit === 0 ? `${violation.noun.charAt(0).toUpperCase()}${violation.noun.slice(1)} done` : `More than ${plural(violation.limit, violation.noun)}`)
    : missedLogin ? `Compulsory login missed (${missedLogin.label})` : null;

  // Next tier to aim for.
  const nextIdx = tiers.findIndex((tier) => !tier.achieved && (tierIndex < 0 || tier.incentive > tiers[tierIndex].incentive));
  let nextTier = null;
  if (nextIdx >= 0 && status !== 'expired') {
    const tier = tiers[nextIdx];
    const need = {
      gigs: tier.gigs !== null ? Math.max(0, tier.gigs - m.gigs) : 0,
      orders: tier.orders !== null ? Math.max(0, tier.orders - m.orders) : 0,
      earnings: tier.earnings !== null ? round2(Math.max(0, tier.earnings - m.earnings)) : 0,
    };
    const parts = [];
    if (need.gigs) parts.push(plural(need.gigs, 'Gig'));
    if (need.orders) parts.push(plural(need.orders, 'Order'));
    const message = need.earnings && !parts.length
      ? `Earn ${rupees(need.earnings)} more to unlock ${rupees(tier.incentive)} incentive`
      : `Do ${parts.join(' & ')}${need.earnings ? ` and earn ${rupees(need.earnings)} more` : ''} to unlock ${rupees(tier.incentive)}`;
    nextTier = { index: nextIdx, incentive: tier.incentive, need, message };
  }

  // Carousel tips under the tiers.
  const tips = [];
  if (nextTier) tips.push({ type: 'info', text: nextTier.message });
  conditions.filter((c) => c.limit === 0).forEach((c) => tips.push({ type: 'warning', text: `Please don't do any ${c.noun}s` }));
  conditions.filter((c) => c.limit > 0 && !c.violated && c.remaining <= 1)
    .forEach((c) => tips.push({ type: 'warning', text: c.remaining ? `Only 1 more ${c.noun} allowed in this offer` : `No more ${c.noun}s allowed in this offer` }));
  if (disqualified && status !== 'expired') tips.unshift({ type: 'error', text: `Offer lost: ${disqualified.charAt(0).toLowerCase()}${disqualified.slice(1)}` });

  const earned = !disqualified && tierIndex >= 0 ? tiers[tierIndex].incentive : 0;
  const maxIncentive = tiers.reduce((mx, tier) => Math.max(mx, tier.incentive), 0);
  return {
    progress,
    // '₹371 Order Earnings | ₹0 Incentive Unlocked'
    summary: { orderEarnings: m.earnings, incentiveUnlocked: earned },
    // 'You have missed ₹339 incentive — More than 1 order denial' (red banner)
    missed: disqualified ? {
      amount: tierIndex >= 0 ? tiers[tierIndex].incentive : maxIncentive,
      title: `You have missed ${rupees(tierIndex >= 0 ? tiers[tierIndex].incentive : maxIncentive)} incentive`,
      reason: lostBecause,
    } : null,
    tiers,
    rows: tierRows(offer),
    achievedTierIndex: tierIndex,
    earnedSoFar: earned,
    nextTier,
    conditions,
    compulsoryLogin: login,
    disqualified,
    tips,
  };
}

function baseView(offer, now) {
  const maxIncentive = offer.tiers.reduce((m, tier) => Math.max(m, tier.incentive), 0);
  return {
    id: offer._id,
    title: offer.title,
    description: offer.description,
    startAt: offer.startAt,
    endAt: offer.endAt,
    windowLabel: windowLabel(offer),
    spanLabel: spanLabel(offer),
    status: offerStatus(offer, now),
    maxIncentive,
    headline: `Earn upto ${rupees(maxIncentive)} extra`,
    videoUrl: offer.videoUrl,
  };
}

// Offer + this partner's progress (or, once settled, their payout).
async function riderView(offer, riderId, now = new Date()) {
  const view = baseView(offer, now);
  const payout = offer.settledAt ? await OfferPayout.findOne({ offer: offer._id, rider: riderId }).lean() : null;
  const m = payout?.progress || await measure(offer, riderId, now);
  const ev = evaluate(offer, m, now);
  if (view.status === 'expired') {
    ev.tips = [{ type: 'warning', text: 'Offer expired', subtext: 'Explore other offers to earn more' }];
    ev.nextTier = null;
  }
  return {
    ...view,
    ...ev,
    payout: payout ? { status: payout.status, amount: payout.amount, reason: payout.reason, paidAt: payout.createdAt } : null,
  };
}

// ---- Rider endpoints ------------------------------------------------------------------------

// ?week=this|next|YYYY-MM-DD (any day in the week). Mon–Sun.
function weekRange(week) {
  const now = new Date();
  let from = t.startOfWeek(now);
  if (week === 'next') from = t.addDays(from, 7);
  else if (t.parseDateKey(week)) from = t.startOfWeek(t.parseDateKey(week));
  const to = t.addDays(from, 7);
  // '07 Sep - 13 Sep'
  const label = (d) => t.dayLabel(d).padStart(6, '0');
  return { from, to, label: `${label(from)} - ${label(t.addDays(to, -1))}`, key: t.dateKey(from) };
}

const STATUS_ORDER = { live: 0, upcoming: 1, expired: 2 };

// GET /delivery/offers?week=
async function listForRider(riderId, query = {}) {
  const week = weekRange(query.week);
  const now = new Date();
  const offers = await IncentiveOffer.find({ status: 'active', startAt: { $lt: week.to }, endAt: { $gt: week.from }, ...riderFilter(riderId) }).sort({ startAt: -1 });
  const items = await Promise.all(offers.map((o) => riderView(o, riderId, now)));
  items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.startAt - a.startAt);
  return { week: { from: week.from, to: week.to, key: week.key, label: week.label }, items };
}

// GET /delivery/offers/weeks -> "Select week" options: weeks (last 12) that had offers for me.
async function weeksForRider(riderId) {
  const now = new Date();
  const from = t.addDays(t.startOfWeek(now), -7 * 12);
  const offers = await IncentiveOffer.find({ status: 'active', startAt: { $gte: from, $lt: t.addDays(t.startOfWeek(now), 14) }, ...riderFilter(riderId) }).select('startAt');
  const keys = new Set(offers.map((o) => t.dateKey(t.startOfWeek(o.startAt))));
  keys.add(t.dateKey(t.startOfWeek(now)));
  keys.add(t.dateKey(t.addDays(t.startOfWeek(now), 7)));
  const thisKey = t.dateKey(t.startOfWeek(now));
  const nextKey = t.dateKey(t.addDays(t.startOfWeek(now), 7));
  return [...keys].sort().reverse().map((key) => {
    const w = weekRange(key);
    return { week: key, label: key === thisKey ? 'This week' : key === nextKey ? 'Next week' : w.label, range: w.label, offerCount: offers.filter((o) => t.dateKey(t.startOfWeek(o.startAt)) === key).length };
  });
}

// GET /delivery/offers/:id
async function detailForRider(riderId, offerId) {
  const offer = await IncentiveOffer.findOne({ _id: offerId, status: { $ne: 'cancelled' } });
  if (!offer || !forRider(offer, riderId)) throw new ApiError(404, 'Offer not found');
  return riderView(offer, riderId);
}

// GET /delivery/offers/:id/conditions/:key — the condition sheet ("Order Denials"): what the
// rule is and each time it was broken, e.g. the orders I denied with the customer's name.
const CONDITION_SHEETS = {
  orderDenials: { kind: 'denial', title: 'Order Denials', limit: 'maxOrderDenials', audio: 'orderDenials' },
  cancellations: { kind: 'cancellation', title: 'Order Cancellations', limit: 'maxCancellations', audio: 'cancellations' },
  incompleteGigs: { title: 'Incomplete Gigs', limit: 'maxIncompleteGigs', audio: 'incompleteGigs' },
};
async function conditionDetail(riderId, offerId, key) {
  const sheet = CONDITION_SHEETS[key];
  if (!sheet) throw new ApiError(404, 'Unknown condition');
  const offer = await IncentiveOffer.findOne({ _id: offerId, status: { $ne: 'cancelled' } });
  if (!offer || !forRider(offer, riderId)) throw new ApiError(404, 'Offer not found');
  const to = new Date(Math.min(offer.endAt.getTime(), Date.now()));
  const at = (d) => `${t.dayLabel(d)} • ${t.timeLabel(d)}`;

  let events = [];
  if (sheet.kind) {
    const orders = await Order.find({ 'deliveryRejections.rider': oid(riderId), 'deliveryRejections.at': { $gte: offer.startAt, $lt: to } })
      .select('orderNumber customer deliveryRejections').populate('customer', 'name').lean();
    orders.forEach((o) => o.deliveryRejections
      .filter((r) => String(r.rider) === String(riderId) && r.kind === sheet.kind && r.at >= offer.startAt && r.at < to)
      .forEach((r) => events.push({ name: o.customer?.name || 'Customer', id: o.orderNumber, orderId: o._id, reason: r.reason, at: r.at, atLabel: at(r.at) })));
  } else {
    const incomplete = await GigBooking.find({ rider: riderId, status: 'incomplete', exempted: false, startAt: { $gte: offer.startAt }, endAt: { $lte: offer.endAt } }).lean();
    events = incomplete.map((b) => ({ name: gigs.rangeLabel(b.startAt, b.endAt, true), id: null, bookingId: b._id, loginMinutes: b.loginMinutes, at: b.startAt, atLabel: `${t.dayLabel(b.startAt)} • ${b.loginMinutes || 0} min online` }));
  }
  events.sort((a2, b2) => b2.at - a2.at);
  const limit = offer.conditions?.[sheet.limit] ?? null;
  return {
    key,
    title: sheet.title,
    spanLabel: spanLabel(offer),
    audioUrl: offer.conditionAudio?.[sheet.audio] || null,
    limit,
    used: events.length,
    violated: limit !== null && events.length > limit,
    events,
  };
}

// Home screen: offers running now.
async function liveForRider(riderId) {
  const now = new Date();
  const offers = await IncentiveOffer.find({ status: 'active', startAt: { $lte: now }, endAt: { $gt: now }, ...riderFilter(riderId) }).sort({ endAt: 1 }).limit(5);
  return Promise.all(offers.map((o) => riderView(o, riderId, now)));
}

// ---- Settlement -----------------------------------------------------------------------------

// Partners who could have earned something: the targeted list, or anyone active in the window.
async function candidateRiders(offer) {
  if (offer.riders?.length) return offer.riders.map(String);
  const [online, delivered, booked] = await Promise.all([
    RiderSession.distinct('rider', { startedAt: { $lt: offer.endAt }, $or: [{ endedAt: null }, { endedAt: { $gt: offer.startAt } }] }),
    Order.distinct('delivery', { orderStatus: 'delivered', deliveredAt: { $gte: offer.startAt, $lt: offer.endAt } }),
    GigBooking.distinct('rider', { status: { $ne: 'cancelled' }, startAt: { $gte: offer.startAt, $lt: offer.endAt } }),
  ]);
  return [...new Set([...online, ...delivered, ...booked].filter(Boolean).map(String))];
}

// Pays out an ended offer. Safe to run repeatedly: the unique (offer, rider) payout row is written
// before the wallet credit, so a partner can never be paid twice.
async function settleOffer(offer) {
  const now = new Date();
  if (offer.endAt > now) throw new ApiError(400, 'This offer has not ended yet');
  if (offer.status === 'cancelled') throw new ApiError(400, 'This offer was cancelled');

  const riderIds = await candidateRiders(offer);
  const activeRiders = new Set((await User.find({ _id: { $in: riderIds }, role: 'delivery' }).select('_id')).map((u) => String(u._id)));
  let paid = 0;
  let total = 0;
  for (const riderId of riderIds.filter((id) => activeRiders.has(id))) {
    if (await OfferPayout.exists({ offer: offer._id, rider: riderId })) continue;
    const m = await measure(offer, riderId, offer.endAt);
    const ev = evaluate(offer, m, offer.endAt);
    const tier = ev.achievedTierIndex >= 0 ? ev.tiers[ev.achievedTierIndex] : null;
    const status = ev.disqualified ? 'disqualified' : tier ? 'paid' : 'not_achieved';
    try {
      await OfferPayout.create({
        offer: offer._id,
        rider: riderId,
        status,
        tierIndex: tier ? ev.achievedTierIndex : null,
        amount: status === 'paid' ? tier.incentive : 0,
        reason: ev.disqualified,
        progress: m,
      });
    } catch (err) {
      if (err.code === 11000) continue; // settled concurrently
      throw err;
    }
    if (status === 'paid') {
      await creditWallet({ userId: riderId, amount: tier.incentive, reason: `Incentive: ${offer.title}`, category: 'incentive', refOfferId: offer._id });
      paid += 1;
      total += tier.incentive;
    }
  }
  offer.settledAt = now;
  await offer.save();
  return { riders: riderIds.length, paid, total: round2(total) };
}

async function settleDueOffers() {
  const due = await IncentiveOffer.find({ status: 'active', settledAt: null, endAt: { $lte: new Date() } }).limit(20);
  for (const offer of due) {
    try {
      await settleOffer(offer);
    } catch (err) {
      logServerError(`Settling offer ${offer.id} failed`, err);
    }
  }
  return due.length;
}

// Each tier's lock state for a partner's progress: [{ incentive, locked }].
const tierLocks = (offer, p) => offer.tiers.map((tier) => ({ incentive: tier.incentive, locked: !p || !tierMet(tier, p) }));

// Admin: live progress (or settled payouts) for every partner in an offer.
async function ridersProgress(offer) {
  const now = new Date();
  if (offer.settledAt) {
    const payouts = await OfferPayout.find({ offer: offer._id }).populate('rider', 'name phone').sort({ amount: -1 }).lean();
    return payouts.map((p) => ({ rider: p.rider, status: p.status, amount: p.amount, tierIndex: p.tierIndex, tiers: tierLocks(offer, p.progress), reason: p.reason, progress: p.progress }));
  }
  const riderIds = (await candidateRiders({ ...offer.toObject(), endAt: offerStatus(offer, now) === 'live' ? now : offer.endAt })).slice(0, 200);
  const users = await User.find({ _id: { $in: riderIds }, role: 'delivery' }).select('name phone');
  const rows = await Promise.all(users.map(async (u) => {
    const ev = evaluate(offer, await measure(offer, u._id, now), now);
    return { rider: u, status: ev.disqualified ? 'disqualified' : 'in_progress', amount: ev.earnedSoFar, tierIndex: ev.achievedTierIndex, tiers: tierLocks(offer, ev.progress), reason: ev.disqualified, progress: ev.progress };
  }));
  return rows.sort((a, b) => b.amount - a.amount);
}

module.exports = {
  offerStatus,
  conditionDetail,
  listForRider,
  weeksForRider,
  detailForRider,
  liveForRider,
  settleOffer,
  settleDueOffers,
  ridersProgress,
  baseView,
  windowLabel,
};
