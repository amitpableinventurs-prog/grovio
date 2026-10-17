const {
  envelope, paginated, errorResponse,
  RESPONSES_401, RESPONSES_403, RESPONSES_404, RESPONSES_422,
  jsonBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

// Delivery partner programs: home feed, gigs, incentive offers, earnings, sessions, trips — and
// the admin endpoints that create the gigs and offers. Times are local (IST) unless ISO.
const paths = {};
const TAG = ['Delivery - Gigs, Offers & Earnings'];
const ADMIN_TAG = ['Admin - Delivery Programs'];

const S = (type, example, extra = {}) => ({ type, example, ...extra });
const str = (example) => S('string', example);
const num = (example) => S('number', example);
const int = (example) => S('integer', example);
const bool = (example) => S('boolean', example);
const dt = { type: 'string', format: 'date-time' };
const obj = (properties) => ({ type: 'object', properties });
const arr = (items) => ({ type: 'array', items });
const dateQ = (desc = 'YYYY-MM-DD (default today)') => q('date', desc);

// ---- Schemas --------------------------------------------------------------------------------
const GIG = obj({
  id: str('6ab797ec9242940ac222608d'),
  startAt: dt,
  endAt: dt,
  timeLabel: str('1:00pm - 2:00pm'),
  payPerHour: obj({ min: num(52), max: num(74) }),
  payLabel: str('₹52 - ₹74 per hour'),
  minLoginMinutes: int(50),
  isFree: bool(true),
  isPriority: bool(false),
  note: str('Free Gig: No min. login hours required'),
  seatsLeft: { type: 'integer', nullable: true, example: 12 },
  state: S('string', 'open', { enum: ['open', 'booked', 'full', 'closed'] }),
  bookingStatus: { type: 'string', nullable: true, example: null },
  canCancel: bool(false),
});
const CURRENT_GIG = obj({
  gig: {
    ...obj({
      bookingId: str(''), gigId: str(''), startAt: dt, endAt: dt,
      timeLabel: str('2pm - 3pm'), status: str('in_progress'), isFree: bool(false),
      loginMinutes: int(14), loginLabel: str('0:14 hrs'), minLoginMinutes: int(50),
      requirementLabel: str('Complete minimum 50 mins'), requirementMet: bool(false),
      progress: S('number', 0.23, { description: 'Login so far, as a fraction of the gig (progress bar fill)' }),
      requirementMark: S('number', 0.83, { description: 'Where the minimum sits on the bar (the lock marker)' }),
      trips: int(1), earnings: num(21.54),
    }),
    nullable: true,
  },
  nextGig: { ...obj({ bookingId: str(''), gigId: str(''), startAt: dt, endAt: dt, label: str('Sep 26, Sat | 3pm - 4pm') }), nullable: true },
});
const HISTORY_GIG = obj({
  bookingId: str(''), gigId: str(''), startAt: dt, endAt: dt,
  timeLabel: str('1pm - 2pm'),
  status: S('string', 'incomplete', { enum: ['completed', 'incomplete', 'in_progress', 'upcoming'] }),
  exempted: bool(true), exemptReason: str('Free gig'),
  isPriority: bool(false), isFree: bool(true),
  trips: int(2), loginMinutes: int(43), summaryLabel: str('2 trips • 0:43 hrs'), earnings: num(96),
});
const TIER = obj({ incentive: num(130), gigs: { type: 'integer', nullable: true, example: 1 }, orders: { type: 'integer', nullable: true, example: 13 }, earnings: { type: 'number', nullable: true, example: null }, achieved: bool(false) });
const OFFER = obj({
  id: str(''),
  title: str('Welcome_back_offer_wk_39_Fullday'),
  description: { type: 'string', nullable: true },
  startAt: dt, endAt: dt,
  windowLabel: str('26 Sep • 4am - 4am'),
  status: S('string', 'live', { enum: ['live', 'upcoming', 'expired'] }),
  maxIncentive: num(640),
  headline: str('Earn upto ₹640 extra'),
  videoUrl: { type: 'string', nullable: true, description: '"How does this offer work?" video' },
  rows: { ...arr(S('string', 'gigs', { enum: ['gigs', 'orders', 'earnings'] })), description: 'Which requirement rows to draw under the Incentive row, in order' },
  tiers: arr(TIER),
  progress: obj({ gigs: int(0), orders: int(0), earnings: num(0), orderDenials: int(0), cancellations: int(0), incompleteGigs: int(0) }),
  achievedTierIndex: int(-1),
  earnedSoFar: num(0),
  summary: obj({ orderEarnings: num(371), incentiveUnlocked: num(0) }),
  missed: { ...obj({ amount: num(339), title: str('You have missed ₹339 incentive'), reason: str('More than 1 order denial') }), nullable: true, description: 'Red banner once the offer is lost' },
  spanLabel: str('5 Dec - 6 Dec • 4am - 4am'),
  nextTier: { ...obj({ index: int(0), incentive: num(130), need: obj({ gigs: int(1), orders: int(13), earnings: num(0) }), message: str('Do 1 Gig & 13 Orders to unlock ₹130') }), nullable: true },
  conditions: arr(obj({
    key: S('string', 'orderDenials', { enum: ['orderDenials', 'cancellations', 'incompleteGigs'] }),
    noun: str('order denial'), limit: int(1), used: int(0), remaining: int(1), violated: bool(false),
    title: str('No more than 1 order denial'), prefix: str('No more than'), label: str('1 order denial'),
    sheetTitle: str('No order denials'), audioUrl: { type: 'string', nullable: true },
  })),
  compulsoryLogin: arr(obj({
    from: str('13:00'), to: str('22:59'), fromAt: dt, toAt: dt, label: str('1pm - 10:59pm'),
    minMinutes: int(540), requiredLabel: str('9 hrs'), icon: S('string', 'evening', { enum: ['sun', 'evening', 'night'] }), loginMinutes: int(20), progress: num(0.04),
    remainingMinutes: int(520), remainingLabel: { type: 'string', nullable: true, example: '8 hrs 40 mins left' },
    status: S('string', 'in_progress', { enum: ['upcoming', 'in_progress', 'met', 'missed'] }),
  })),
  disqualified: { type: 'string', nullable: true, example: null, description: 'Why the offer is lost (a broken condition or missed compulsory login)' },
  tips: { ...arr(obj({ type: S('string', 'info', { enum: ['info', 'warning', 'error'] }), text: str("Please don't do any order cancellations"), subtext: { type: 'string', nullable: true } })), description: 'Carousel under the tiers' },
  payout: { ...obj({ status: S('string', 'paid', { enum: ['paid', 'disqualified', 'not_achieved'] }), amount: num(130), reason: { type: 'string', nullable: true }, paidAt: dt }), nullable: true, description: 'Set once an expired offer is settled' },
});
const EARNINGS = obj({
  period: S('string', 'week', { enum: ['day', 'week', 'month'] }),
  from: dt, to: dt,
  label: str('21 Sep - 27 Sep'),
  chartTitle: { type: 'string', nullable: true, example: '21 Sep - 27 Sep 2026' },
  prevDate: str('2026-09-14'),
  nextDate: { type: 'string', nullable: true, example: null, description: 'null when the next period is in the future (disable the > arrow)' },
  total: S('number', 5261.54, { description: 'Order earning + incentive + other earnings - deductions' }),
  orders: int(116),
  loginMinutes: int(3842),
  loginHoursLabel: str('64:02'),
  earningsPerHour: num(82.15),
  chart: { ...arr(obj({ label: str('21'), date: str('2026-09-21'), amount: num(1214) })), description: 'Empty for a day; 7 days for a week; Mon–Sun weeks for a month (e.g. 1-6, 7-13, …)' },
  breakdown: obj({
    orderEarning: obj({ total: num(4131.54), items: { ...arr({ type: 'object' }), description: 'Day: one row per order { orderId, orderNumber, amount, at }. Week/month: one per day { date, label, orders, amount }' } }),
    incentive: obj({ total: num(1130), items: arr(obj({ offerId: str(''), title: str('AF - LN | Ultra Marathon'), amount: num(268), at: dt })) }),
    other: obj({ total: num(0), items: arr(obj({ reason: str('Referral bonus'), orderId: { type: 'string', nullable: true }, amount: num(500), at: dt })) }),
    deductions: obj({ total: num(534), items: arr(obj({ title: str('Temp Manual Pay'), description: str('Cold Bag Fraud 27th Jan'), orderId: { type: 'string', nullable: true }, amount: num(100), at: dt })) }),
  }),
});
const TRIP = obj({
  orderId: str(''), orderNumber: str('GRV-MFX1AB2C-4043'), storeName: str('Super Store Bhopal Kotra ES21'),
  status: S('string', 'delivered', { enum: ['delivered', 'delivery_failed', 'returned'] }),
  at: dt, timeLabel: str('1:46pm'), earning: num(75.22), cashCollected: num(0), distanceKm: { type: 'number', nullable: true, example: 3.4 },
});

// ---- Rider endpoints ------------------------------------------------------------------------
const get = (summary, parameters, data, extra = {}) => ({ get: { tags: TAG, summary, ...bearer(), parameters, responses: { 200: envelope(data), 401: RESPONSES_401, ...extra } } });

paths['/delivery/dashboard'] = get('Feed screen: online toggle state, gig in progress + next gig, today\'s progress, live offers, store card, popups', [q('lat', 'For the store card'), q('lng', '')], obj({
  online: bool(true),
  accountStatus: str('approved'),
  gig: CURRENT_GIG.properties.gig,
  nextGig: CURRENT_GIG.properties.nextGig,
  today: obj({ earnings: num(96.76), trips: int(2), tripKm: num(8.39), sessionMinutes: int(58), sessionHoursLabel: str('00:58'), gigs: int(2) }),
  offers: arr(OFFER),
  store: { description: 'Same as GET /delivery/home-store (pass lat/lng)', type: 'object', nullable: true },
  map: { description: 'Same as GET /delivery/map (pass lat/lng)', type: 'object' },
  account: { description: 'Same as GET /delivery/account-status — show the "Account on hold" screen when account.onHold', type: 'object' },
  coldBags: { type: 'array', items: { type: 'object' }, description: 'Cold bags still to return (as GET /delivery/cold-bags)' },
  notices: { type: 'object', properties: { unread: { type: 'integer' }, toAcknowledge: { type: 'integer' } }, description: 'Updates tab badge' },
  alerts: arr(obj({
    transferId: str(''), type: str('transfer_failed'), amount: num(260), title: str('Failed to transfer amount'), heading: str('Pocket withdrawal failed'),
    message: str('If money was deducted from the pocket, it will be added back in sometime.'), date: dt, dateLabel: str('02 Oct 2025'), reference: str('527510490016'), referenceLabel: str('IMPS ref no.'),
  })),
}));

paths['/delivery/gigs'] = get('Gigs for a day, grouped Morning/Lunch/Evening/Dinner/Night', [
  dateQ(), q('filter', 'all (default) | open | booked'), q('storeId', 'Only gigs for this hub (plus zone-wide ones)'),
], obj({
  date: str('2026-09-26'),
  title: str('Gigs, 26 Sep'),
  filter: str('open'),
  dates: arr(obj({ date: str('2026-09-26'), label: str('26 Sep'), weekday: str('Sat') })),
  groups: arr(obj({ key: str('lunch'), title: str('Lunch Gigs'), icon: S('string', 'sun', { enum: ['sunrise', 'sun', 'sunset', 'moon', 'night'] }), rangeLabel: str('11:00am - 3:00pm'), count: int(2), subtitle: str('11:00am - 3:00pm • 2 Gigs'), gigs: arr(GIG) })),
}));
paths['/delivery/gigs/book'] = {
  post: {
    tags: TAG, summary: 'Book the ticked gigs ("Book now"). Books what it can; overlapping, full or too-late gigs come back in `failed`. A gig can be booked until minLoginMinutes before it ends (a free gig until it ends). Account must be approved.',
    ...bearer(), requestBody: jsonBody({ gigIds: arr(str('6ab797ec9242940ac222608d')) }, ['gigIds']),
    responses: { 201: envelope(obj({ booked: arr(GIG), failed: arr(obj({ gigId: str(''), timeLabel: str('11:30am - 12:30pm'), reason: str('Overlaps another gig you booked') })) })), 400: errorResponse('Nothing could be booked (errors list why)'), 401: RESPONSES_401, 403: errorResponse('Account not approved') },
  },
};
paths['/delivery/gigs/{id}/cancel'] = {
  post: { tags: TAG, summary: 'Cancel my booking of gig {id}, before it starts', ...bearer(), parameters: [idParam('id', 'Gig id')], responses: { 200: envelope({ type: 'object' }), 400: errorResponse('Already started'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/gigs/current'] = get('Home "Gig details": gig in progress with login progress, and the next booked gig', [], CURRENT_GIG);
paths['/delivery/gigs/history'] = get('"Select a Gig": my gigs, newest first, grouped by day. Default: the last 7 days', [q('from', 'YYYY-MM-DD'), q('to', 'YYYY-MM-DD')], obj({
  from: dt, to: dt,
  days: arr(obj({ date: str('2026-09-26'), label: str('Sep 26, SAT'), gigs: arr(HISTORY_GIG) })),
}));
paths['/delivery/gigs/history/{bookingId}'] = get('One of my gigs with the orders delivered during it', [{ name: 'bookingId', in: 'path', required: true, schema: { type: 'string' } }],
  { allOf: [HISTORY_GIG, obj({ minLoginMinutes: int(50), payPerHour: obj({ min: num(52), max: num(74) }), orders: arr(obj({ orderId: str(''), orderNumber: str(''), storeName: str(''), deliveredAt: dt, earning: num(21.54) })) })] },
  { 404: RESPONSES_404 });

paths['/delivery/offers'] = get('"Your offers" for a week (Mon–Sun): live first, then upcoming, then expired, each with my progress', [q('week', 'this (default) | next | YYYY-MM-DD (any day in the week)')], obj({
  week: obj({ from: dt, to: dt, key: str('2026-09-21'), label: str('21 Sep - 27 Sep') }),
  items: arr(OFFER),
}));
paths['/delivery/offers/weeks'] = get('"Select week" options: this week, next week and past weeks (last 12) that had offers for me', [], arr(obj({ week: str('2026-09-07'), label: str('07 Sep - 13 Sep'), range: str('07 Sep - 13 Sep'), offerCount: int(2) })));
paths['/delivery/offers/{id}'] = get('Offer detail: tiers, my progress, tips carousel, "Don\'t do" conditions (with audio), compulsory login, video', [idParam()], OFFER, { 404: RESPONSES_404 });

paths['/delivery/earnings/summary'] = get('Earnings screen (Day / Week / Month): total, earnings/hour, orders, login hours, chart, and Order earning / Incentive / Other earnings breakdowns', [
  q('period', 'day (default) | week | month'), dateQ('Any day inside the period, YYYY-MM-DD (default today). Use prevDate / nextDate from the response for the arrows.'),
], EARNINGS);
const PAY_LINE = obj({ key: str('daily_incentive'), label: str('Daily incentive · Gold'), amount: num(175) });
const PERIOD_STATUS = S('string', 'pending', { enum: ['pending', 'settling', 'paid', 'nothing_due', 'not_eligible', 'withheld'], description: 'pending = not settled yet (amounts are an estimate)' });
const ELIGIBILITY = obj({ eligible: bool(true), checks: obj({ deliveryProof: bool(true), cancellationRate: bool(true) }), reasons: arr(str('Cancellation rate 14% is above 10%')) });
paths['/delivery/earnings/incentives'] = get("KM earning + incentives screen: the day's deliveries, daily slab reached and performance tier (Bronze 10+, Silver 15+, Gold 20+, Platinum 25+, Diamond 30+), deliveries to the next slab, the week's slab progress, minimum guarantee status, eligibility, and the rate card. Settled after the day / week ends (+ settleDelayHours).", [dateQ()], obj({
  day: obj({
    key: str('2026-09-28'), label: str('28 Sep, Mon'), deliveries: int(21), orderEarnings: num(684), unpaidDeliveries: int(1), cancellations: int(0), cancellationRatePct: num(0),
    onlineMinutes: int(540), onlineHoursLabel: str('09:00'), gigsCompleted: int(6),
    dailySlab: { ...obj({ deliveries: int(20), amount: num(175), tier: str('Gold') }), nullable: true }, tier: { type: 'string', nullable: true, example: 'Gold' },
    nextSlab: { ...obj({ deliveries: int(25), amount: num(275), tier: str('Platinum'), deliveriesToGo: int(4) }), nullable: true },
    eligibility: ELIGIBILITY,
    guarantee: obj({ enabled: bool(true), amount: num(300), eligible: bool(true), checks: obj({ shift: bool(true), activity: bool(true), serviceQuality: bool(true) }), topUp: num(0) }),
    lines: arr(PAY_LINE), incentives: num(175), total: num(859),
    payoutStatus: PERIOD_STATUS, estimate: bool(true), settledAt: { ...dt, nullable: true }, withheld: { ...obj({ reason: str(''), at: dt }), nullable: true },
  }),
  week: obj({
    key: str('2026-09-28'), label: str('28 Sep - 4 Oct'), deliveries: int(96), orderEarnings: num(3120),
    weeklySlab: { ...obj({ deliveries: int(90), amount: num(300) }), nullable: true },
    nextSlab: { ...obj({ deliveries: int(120), amount: num(500), deliveriesToGo: int(24) }), nullable: true },
    eligibility: ELIGIBILITY, lines: arr(PAY_LINE), incentives: num(300), total: num(3420), payoutStatus: PERIOD_STATUS, estimate: bool(true),
  }),
  rateCard: obj({
    km: arr(obj({ fromKm: num(2), toKm: { type: 'number', nullable: true, example: 3 }, label: str('2–3 km'), amount: num(22), perKmBeyond: S('number', 8, { description: 'Last row only (10 km+)' }) })),
    peak: obj({ amount: num(5), highSurgeAmount: num(10), windows: arr(obj({ from: str('18:00'), to: str('22:00') })) }),
    rain: obj({ normal: num(5), heavy: num(10), severe: num(15) }),
    heavyLoad: arr(obj({ minKg: num(10), amount: num(5) })),
    waiting: { ...obj({ freeMinutes: int(10), perMinute: num(1), maxPay: { type: 'number', nullable: true } }), nullable: true },
    cancellation: { ...obj({ arrivedAtPickup: num(10), pickedUp: num(20) }), nullable: true },
    daily: arr(obj({ deliveries: int(20), amount: num(175), tier: { type: 'string', nullable: true, example: 'Gold' } })),
    weekly: arr(obj({ deliveries: int(90), amount: num(300) })),
    guarantee: { ...obj({ amount: num(300), minOnlineMinutes: int(480), minDeliveries: int(8), requireGig: bool(false) }), nullable: true },
    eligibility: obj({ maxCancellationRatePct: num(10), minOrdersForRate: int(5) }),
  }),
}));
paths['/delivery/sessions'] = get('Session History: my online sessions on a day, clipped to an optional time window ("Select Time")', [
  dateQ(), q('from', 'HH:mm'), q('to', 'HH:mm'),
], obj({
  date: str('2026-09-26'), dateLabel: str('Today'), from: dt, to: dt,
  totalMinutes: int(62), totalLabel: str('01:02'),
  sessions: arr(obj({ index: int(1), startedAt: dt, endedAt: { ...dt, nullable: true }, inProgress: bool(true), minutes: int(62), hoursLabel: str('01:02'), rangeLabel: str('01:16PM - In Progress') })),
}));
const CANCELLATION = { ...obj({ tag: str('CANCELLATION'), cancelledBy: S('string', 'customer', { enum: ['customer', 'customer_care', 'you', 'system'] }), label: str('Cancelled by customer'), reason: { type: 'string', nullable: true, example: 'Long delivery distance' } }), nullable: true };
const TRIP_CARD = obj({
  id: str(''), tripId: { type: 'string', nullable: true }, orderIds: arr(str('')), orderNumbers: arr(str('GRV-1839551406')), orderId: str(''), orderNumber: str('GRV-1839551406'),
  storeName: str('Super Store Bhopal Kotra ES21'),
  status: S('string', 'delivered', { enum: ['delivered', 'cancelled', 'delivery_failed', 'returned'] }),
  isMultiOrder: bool(false), tag: { type: 'string', nullable: true, example: 'MULTI ORDER', description: "'MULTI ORDER' | 'CANCELLATION' | null" },
  cancellation: CANCELLATION,
  at: dt, timeLabel: str('11:26pm'), earning: num(43.45), payPending: S('boolean', false, { description: 'Multi-order trip still out: paid when all its orders are done' }),
  cashCollected: num(0), distanceKm: num(5.37),
});
paths['/delivery/trips'] = get('Trip History (Daily / Weekly / Monthly): one card per trip — a multi-order trip is one card — newest first, grouped by day. Cancelled trips (by the customer, customer care, or me after accepting) show ₹0.', [
  q('period', 'day (default) | week | month'), dateQ('Any day inside the period'), q('type', 'all (default, "ALL TRIPS") | delivered | cancelled | failed | returned'),
], obj({
  period: str('day'), from: dt, to: dt, label: str('7 February'), prevDate: str('2026-02-06'), nextDate: { type: 'string', nullable: true },
  type: str('all'), types: arr(obj({ key: str('all'), label: str('ALL TRIPS') })),
  totals: obj({ trips: int(14), orders: int(16), earnings: num(391.48), cashCollected: num(0), distanceKm: num(45.85) }),
  days: arr(obj({ date: str('2026-02-07'), label: str('07 Feb, 2026'), trips: arr(TRIP_CARD) })),
}));
const ORDER_SECTION = obj({
  orderId: str(''), orderNumber: str('GRV-1839551406'), label: str('Order 1: GRV-1839551406'),
  status: str('delivered'), cancellation: CANCELLATION, earning: num(52.83), cashCollected: num(0),
  pickup: obj({ name: str('Super Store Bhopal Kotra ES21'), address: str(''), assignedAt: dt }),
  drop: obj({ name: str('Dr Ruchi Dwivedi'), line1: str(''), landmark: str(''), city: str(''), pincode: str(''), pickedAt: dt, deliveredAt: { ...dt, nullable: true } }),
  distanceKm: { type: 'number', nullable: true, example: 5.7 }, distanceLabel: { type: 'string', nullable: true, example: '5.7 km' },
  failureReason: { type: 'string', nullable: true },
  pay: { type: 'object', nullable: true, description: "This order's pay once its trip is finished — see Order.riderPay (mapped km, KM slab, bonuses, waiting / cancellation pay)" },
  payQuote: { type: 'object', nullable: true, description: 'Until then, the quote shown before accepting — see Order.riderPayQuote' },
});
paths['/delivery/trips/{id}'] = get('Trip details, by trip id or any of its order ids. Total earnings with pay lines (Order pay (KM), Peak incentive, Rain incentive, Heavy load bonus, Waiting pay, Cancellation pay, anything added later for these orders, minus order-linked deductions), then each order (Order 1, Order 2… for a MULTI ORDER trip) with pickup / drop / times / distance, or a CANCELLATION with who cancelled and why (₹0). "Need help on this trip?" -> POST /common/support with help.', [idParam('id', 'Trip id or order id')], obj({
  id: str(''), tripId: { type: 'string', nullable: true }, isMultiOrder: bool(true), tag: { type: 'string', nullable: true, example: 'MULTI ORDER' },
  status: str('delivered'), totalEarnings: num(62.83),
  payLines: arr(obj({ label: str('Order pay'), description: { type: 'string', nullable: true }, amount: num(46.79) })),
  payPending: bool(false), cashCollected: num(0),
  orders: arr(ORDER_SECTION),
  orderId: str(''), orderNumber: str(''), storeName: str(''), customerName: str('Bhavesh'), cancellation: CANCELLATION,
  pickup: ORDER_SECTION.properties.pickup, drop: ORDER_SECTION.properties.drop,
  assignedAt: dt, pickedAt: dt, deliveredAt: { ...dt, nullable: true }, distanceKm: num(5.37), distanceLabel: str('5.4 km'),
  help: obj({ category: str('past_order'), orderId: str('') }),
}), { 404: RESPONSES_404 });

// ---- Account hold, selfie checks ------------------------------------------------------------
const HOLD_CASE = obj({ id: str(''), reason: S('string', 'face_mismatch', { enum: ['face_mismatch', 'cold_bag_not_returned', 'cash_not_deposited', 'fraud', 'misconduct', 'documents', 'other'] }), title: str('Face not matching'), details: { type: 'string', nullable: true }, startedAt: dt, releaseAt: { ...dt, nullable: true, description: 'null = until support unlocks it' }, releasedAt: { ...dt, nullable: true }, releaseType: { type: 'string', nullable: true, enum: [null, 'auto', 'manual'] }, byAdmin: bool(false) });
paths['/delivery/account-status'] = get('"Account on hold" screen: while on hold the partner can\'t go online (423), check in at a hub or claim orders. Holds lift themselves at releaseAt, or support unlocks them. lastCase = "View last case".', [], obj({
  status: S('string', 'on_hold', { enum: ['active', 'on_hold'] }), onHold: bool(true),
  hold: { ...obj({ ...HOLD_CASE.properties, heading: str('Account on hold'), remainingLabel: str('Lifts in 23 hrs 10 mins') }), nullable: true },
  lastCase: { ...HOLD_CASE, nullable: true },
}));
paths['/delivery/selfie-checks'] = {
  post: {
    tags: TAG, summary: 'Upload a selfie (e.g. when going online). Compared with the onboarding selfie; a mismatch puts the account on hold ("Face not matching") for riderFaceMismatchHoldHours.',
    ...bearer(), requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { selfie: { type: 'string', format: 'binary' } }, required: ['selfie'] } } } },
    responses: { 201: envelope(obj({ id: str(''), status: str('pending'), createdAt: dt }), 'Selfie submitted'), 401: RESPONSES_401, 422: RESPONSES_422 },
  },
};

// ---- Cold bags ------------------------------------------------------------------------------
const BAG = obj({ issueId: str(''), code: str('CB-4F2A91'), label: { type: 'string', nullable: true }, orders: arr(obj({ orderId: str(''), orderNumber: str(''), orderStatus: str('') })), issuedAt: dt, dueAt: dt, dueLabel: str('Return by 3:30pm'), overdue: bool(false), status: str('issued') });
paths['/delivery/jobs/{id}/cold-bag'] = {
  post: {
    tags: TAG, summary: 'Frozen-items order (needsColdBag): scan a cold bag\'s QR at the store before pickup — the handover OTP / QR is refused until then. One bag can carry several orders of the same trip.',
    ...bearer(), parameters: [idParam()], requestBody: jsonBody({ code: str('CB-4F2A91') }, ['code']),
    responses: { 200: envelope(BAG, 'Cold bag linked to the order'), 400: errorResponse('No frozen items / already picked up / bag of another store / out of service'), 401: RESPONSES_401, 404: RESPONSES_404, 409: errorResponse('Bag is with someone else') },
  },
};
paths['/delivery/cold-bags'] = get('Cold bags I still have to return (with due time / overdue)', [], arr(BAG));
paths['/delivery/cold-bags/return'] = {
  post: {
    tags: TAG, summary: 'Scan a cold bag back in at a store (the hub I\'m checked in at, or any store within ~150 m of lat/lng), after its orders are delivered',
    ...bearer(), requestBody: jsonBody({ code: str('CB-4F2A91'), lat: num(23.2332), lng: num(77.4043) }, ['code']),
    responses: { 200: envelope(obj({ code: str(''), returnedAt: dt, storeId: str(''), message: str('Cold bag returned. Thank you!') })), 400: errorResponse('Orders not delivered yet / not at a store'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};

// ---- Collect at the door --------------------------------------------------------------------
const COLLECT = obj({
  orderId: str(''), orderNumber: str(''), amount: num(228), title: str('Collect ₹228 via UPI'), subtitle: str('Payment goes directly to Grovio'),
  qr: obj({ provider: S('string', 'razorpay', { enum: ['razorpay', 'static'] }), imageUrl: { type: 'string', nullable: true, description: 'razorpay: QR image to show' }, upiString: { type: 'string', nullable: true, description: 'static: upi://pay?... (also as qrDataUrl)' }, qrDataUrl: { type: 'string', nullable: true }, expiresAt: { ...dt, nullable: true } }),
  verifiable: S('boolean', true, { description: 'razorpay QR: payment is checked; static: partner confirms' }),
  paid: bool(false),
});
paths['/delivery/jobs/{id}/collect'] = get('Drop order screen, COD: "Collect ₹228 via UPI" QR — payment goes straight to the company. Razorpay single-use UPI QR when available (then completing with collectionMethod=upi requires it paid), else a UPI QR to the company VPA (setting upiVpa), else 503 = collect cash. "Order delivered" slide = POST /delivery/jobs/{id}/complete.', [idParam()], COLLECT, { 400: errorResponse('Prepaid / not at the door yet'), 503: errorResponse('UPI not set up — collect cash') });
paths['/delivery/jobs/{id}/collect/status'] = get('Poll while the customer pays: paid = true once the Razorpay QR received the amount', [idParam()], COLLECT);

paths['/delivery/offers/{id}/conditions/{key}'] = get('Condition sheet ("Order Denials"): the rule, its audio, and each time it was broken — denied / cancelled orders with the customer\'s name and order ID, or incomplete gigs', [
  idParam(), { name: 'key', in: 'path', required: true, schema: { type: 'string', enum: ['orderDenials', 'cancellations', 'incompleteGigs'] } },
], obj({
  key: str('orderDenials'), title: str('Order Denials'), spanLabel: str('5 Dec - 6 Dec • 4am - 4am'), audioUrl: { type: 'string', nullable: true },
  limit: int(1), used: int(2), violated: bool(true),
  events: arr(obj({ name: str('Sunny Dutt'), id: str('GRV-1539610275'), orderId: str(''), reason: { type: 'string', nullable: true }, at: dt, atLabel: str('5 Dec • 6:29pm') })),
}), { 404: RESPONSES_404 });

const NAV = { googleMapsUrl: str('https://www.google.com/maps/dir/?api=1&destination=23.2332%2C77.4043&travelmode=two-wheeler&origin=…'), androidIntent: str('google.navigation:q=23.2332,77.4043&mode=l') };
const ACTION = obj({ key: S('string', 'scan_qr', { enum: ['go_online', 'navigate', 'scan_qr', 'hub_orders', 'scan_package', 'pickup_otp', 'call_customer', 'arrived', 'complete'] }), label: str('Scan QR to get orders'), method: str('POST'), path: str('/delivery/hub/checkin'), body: { type: 'object', nullable: true } });
paths['/delivery/map'] = get('Home map (Feed): where to head right now, with the road route and the buttons to show. Send the phone\'s lat/lng; refetch on the \'order:updated\' socket event and as the rider moves.\n\n' +
  '| mode | when | destination |\n|---|---|---|\n' +
  '| offline | toggle off | hub |\n| to_store | online, no order, away from the hub ("Reach the store to pick orders") | hub |\n| at_store | at the hub, not checked in ("Scan QR to get orders") | hub |\n| waiting_at_store | checked in with the hub QR | hub |\n' +
  '| to_pickup / at_pickup | order assigned, still to collect | hub |\n| to_customer / at_customer | order picked up | customer (name, address, cash to collect — no phone) |\n\n' +
  'After delivering, with no other active order, the mode goes back to to_store. With several orders the next stop comes from the route planner (pickups before their drops).',
[q('lat', 'Phone position (default: last GPS fix, marked stale if old)'), q('lng', '')], obj({
  online: bool(true),
  mode: S('string', 'to_store', { enum: ['offline', 'no_store', 'to_store', 'at_store', 'waiting_at_store', 'to_pickup', 'at_pickup', 'to_customer', 'at_customer'] }),
  rider: { ...obj({ lat: num(23.205), lng: num(77.43), stale: bool(false), updatedAt: dt }), nullable: true },
  topAction: { ...ACTION, nullable: true, description: 'The pill at the top of the map ("Scan QR to get orders")' },
  banner: { ...obj({ text: str('Reach the store to pick orders'), tone: S('string', 'warning', { enum: ['info', 'warning', 'success', 'muted'] }) }), nullable: true },
  destination: {
    ...obj({
      type: S('string', 'store', { enum: ['store', 'customer'] }), id: str(''), name: str('Super Store Bhopal Malviya Nagar ES4'), address: str('Plot No. 3 Malviya Nagar Bhopal. 462003'),
      lat: num(23.2332), lng: num(77.4043), distanceLabel: str('4.3 km away'),
      orderId: { type: 'string', nullable: true }, orderNumber: { type: 'string', nullable: true }, landmark: { type: 'string', nullable: true },
      cashToCollect: { type: 'number', nullable: true, description: 'Customer destination: COD amount' },
      ...NAV,
    }),
    nullable: true,
  },
  route: {
    ...obj({
      distanceKm: num(4.3), etaMinutes: int(13), label: str('13 mins | 4.3 km away'),
      polyline: { type: 'string', nullable: true, description: 'Google encoded polyline for the blue line (only with a Google Maps key); decode with PolyUtil.decode' },
      source: S('string', 'google', { enum: ['google', 'estimate'] }),
    }),
    nullable: true,
  },
  actions: arr(ACTION),
  orders: { ...arr(obj({ orderId: str(''), orderNumber: str('') })), description: 'On a job: orders at this stop' },
  remainingStops: int(2),
  totalKm: num(6.1),
  fullRouteUrl: { type: 'string', nullable: true, description: 'All remaining stops in Google Maps' },
}));

paths['/delivery/home-store'] = get('Map card: the hub to go to (checked-in hub, else nearest active store) with road distance / time, and the banner hint', [q('lat', 'My position (default: last GPS fix)'), q('lng', '')], {
  ...obj({
    id: str(''), name: str('Super Store Bhopal Malviya Nagar ES4'), address: str('Plot No. 3 Malviya Nagar Bhopal. 462003'), lat: num(23.23), lng: num(77.40),
    distanceKm: num(4.3), etaMinutes: int(13), distanceLabel: str('4.3 km away'), etaLabel: str('13 mins | 4.3 km away'), polyline: { type: 'string', nullable: true }, ...NAV,
    checkedIn: bool(false), atStore: bool(false),
    hint: { type: 'string', nullable: true, example: 'Reach the store to pick orders', description: "'Reach the store to pick orders' | 'Scan QR to get orders' | null when checked in" },
    mapsUrl: str('https://www.google.com/maps/dir/?api=1&destination=23.23,77.40'),
  }),
  nullable: true,
});

// ---- Pocket ---------------------------------------------------------------------------------
const TRANSFER = obj({
  id: str(''),
  type: S('string', 'weekly_payout', { enum: ['withdrawal', 'weekly_payout', 'cash_deposit'] }),
  title: str('Weekly payout'), amount: num(1516.2), direction: S('string', 'out', { enum: ['in', 'out'] }),
  status: S('string', 'initiated', { enum: ['initiated', 'in_process', 'completed', 'failed'] }), statusLabel: str('Initiated'),
  timeline: arr(obj({ key: str('initiated'), label: str('Initiated'), at: { ...dt, nullable: true }, done: bool(true), atLabel: { type: 'string', nullable: true, example: 'On 07:16 AM, 02 February, Mon' } })),
  bank: { ...obj({ bankName: str('State Bank of India'), accountNumber: str('XXXXXXX9411'), ifsc: str('SBIN0001234') }), nullable: true },
  reference: { type: 'string', nullable: true, example: '527510490016' }, referenceLabel: str('IMPS ref no.'),
  method: { type: 'string', nullable: true }, failureReason: { type: 'string', nullable: true }, createdAt: dt,
});
const POCKET_ENTRY = obj({
  id: str(''),
  category: S('string', 'order_earning', { enum: ['order_earning', 'incentive', 'other_earning', 'cash_collected', 'cash_deposit', 'withdrawal', 'withdrawal_reversal', 'payout', 'payout_reversal', 'deduction'] }),
  title: str('Trip Earning'), subtitle: { type: 'string', nullable: true, example: 'Order ID: 1744348424' },
  status: { type: 'string', nullable: true, example: null, description: 'Withdrawals / payouts: initiated | in_process | completed | failed' },
  statusLabel: { type: 'string', nullable: true, example: 'Initiated' },
  amount: S('number', 26.18, { description: 'Signed: + into the pocket, - out of it' }),
  at: dt, atLabel: str('05:59 PM • 10 Feb'), orderId: { type: 'string', nullable: true }, transferId: { type: 'string', nullable: true }, balanceAfter: num(412.5),
});
const WEEK = obj({ key: str('2026-02-09'), label: str('09 Feb - 15 Feb'), from: dt, to: dt });
paths['/delivery/pocket'] = get('Pocket tab: balance (negative = COD cash to deposit), withdrawable amount, bank, transfers in progress', [], obj({
  balance: num(412.5), cashToDeposit: num(0), withdrawable: num(412.5), minWithdrawal: num(100),
  canWithdraw: bool(true), cannotWithdrawReason: { type: 'string', nullable: true },
  bank: { ...obj({ bankName: str('State Bank of India'), accountNumber: str('XXXXXXX9411'), ifsc: str('') }), nullable: true },
  pendingTransfers: arr(TRANSFER), deductionsThisWeek: num(200),
}));
paths['/delivery/pocket/statement'] = get('Pocket statement for a week (This week / Last week / Select week), newest first', [
  q('week', 'this (default) | last | YYYY-MM-DD (any day in the week)'), q('filter', 'all (default) | earnings | cash | transfers | deductions'),
], obj({ week: WEEK, filter: str('all'), filters: arr(obj({ key: str('cash'), label: str('Cash') })), totals: obj({ in: num(285.25), out: num(583) }), items: arr(POCKET_ENTRY) }));
paths['/delivery/pocket/deductions'] = get('Deduction statement for a week', [q('week', 'this (default) | last | YYYY-MM-DD')], obj({ week: WEEK, total: num(200), items: arr({ ...POCKET_ENTRY, example: { title: 'Temp Manual Pay', subtitle: 'Cold Bag Fraud 27th Jan', amount: -100, atLabel: '07:26 PM • 28 Jan' } }) }));
paths['/delivery/pocket/weeks'] = get('"Select week" options (last 12 weeks)', [], arr(obj({ week: str('2026-01-26'), label: str('26 Jan - 01 Feb'), range: str('26 Jan - 01 Feb') })));
paths['/delivery/pocket/withdraw'] = {
  post: {
    tags: TAG, summary: 'Withdraw from the pocket to my bank account (min ₹100, one at a time). The amount leaves the pocket now; if the transfer fails it is put back.',
    ...bearer(), requestBody: jsonBody({ amount: num(375) }, ['amount']),
    responses: { 201: envelope(TRANSFER, 'Withdrawal initiated'), 400: errorResponse('Below minimum / not enough balance / no bank details / one already in progress'), 401: RESPONSES_401, 403: errorResponse('Account not approved') },
  },
};
paths['/delivery/pocket/transfers'] = get('My withdrawals, weekly payouts and deposits', [q('type', 'withdrawal | weekly_payout | cash_deposit')], arr(TRANSFER));
paths['/delivery/pocket/transfers/{id}'] = get('Transaction Details: Initiated / In Process / Completed timeline and the bank account. "Raise a ticket" -> POST /common/support with transferId.', [idParam()], TRANSFER, { 404: RESPONSES_404 });
paths['/delivery/pocket/transfers/{id}/dismiss'] = {
  post: { tags: TAG, summary: 'Dismiss the "Failed to transfer amount" popup (dashboard alerts[])', ...bearer(), parameters: [idParam()], responses: { 200: envelope(TRANSFER), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/pocket/deposit'] = {
  post: {
    tags: TAG, summary: 'Deposit collected COD cash online: creates a Razorpay order. Open Razorpay checkout with razorpayKeyId + razorpayOrderId, then call /pocket/deposit/verify.',
    ...bearer(), requestBody: jsonBody({ amount: num(200) }, ['amount']),
    responses: { 201: envelope(obj({ transferId: str(''), amount: num(200), razorpayOrderId: str('order_...'), razorpayKeyId: str('rzp_live_...'), currency: str('INR') })), 401: RESPONSES_401, 503: errorResponse('Razorpay not configured — deposit at the hub') },
  },
};
paths['/delivery/pocket/deposit/verify'] = {
  post: {
    tags: TAG, summary: 'Confirm a Razorpay cash deposit; credits the pocket (once)',
    ...bearer(), requestBody: jsonBody({ razorpayOrderId: str(''), razorpayPaymentId: str(''), razorpaySignature: str('') }, ['razorpayOrderId', 'razorpayPaymentId', 'razorpaySignature']),
    responses: { 200: envelope(TRANSFER, 'Cash deposit received'), 400: errorResponse('Signature verification failed'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};

// ---- Admin ----------------------------------------------------------------------------------
const admin = (method, summary, { parameters = [], body, data = { type: 'object' }, status = 200, extra = {} } = {}) => ({
  [method]: {
    tags: ADMIN_TAG, summary, ...bearer(), parameters,
    ...(body ? { requestBody: body } : {}),
    responses: { [status]: envelope(data), 401: RESPONSES_401, 403: RESPONSES_403, ...extra },
  },
});
const SLOT_INPUT = obj({
  from: str('11:00'), to: str('12:00'),
  payPerHourMin: num(52), payPerHourMax: num(74),
  capacity: { type: 'integer', nullable: true, example: 20, description: 'null = unlimited' },
  minLoginMinutes: int(50), isFree: bool(false), isPriority: bool(false), note: str(''),
});
const OFFER_INPUT = {
  title: str('Welcome_back_offer_wk_39_Fullday'),
  description: str(''),
  startAt: { ...dt, example: '2026-09-25T22:30:00.000Z', description: '26 Sep 4:00am IST' },
  endAt: { ...dt, example: '2026-09-26T22:30:00.000Z' },
  riders: { ...arr(str('')), description: 'Delivery partner ids; empty = everyone' },
  tiers: { ...arr(obj({ incentive: num(130), minGigs: int(1), minOrders: int(13), minEarnings: { type: 'number', nullable: true } })), description: 'Each needs at least one of minGigs / minOrders / minEarnings. The highest tier reached is paid.' },
  conditions: obj({ maxOrderDenials: int(1), maxCancellations: int(0), maxIncompleteGigs: int(3) }),
  conditionAudio: obj({ orderDenials: str('https://…/denials.mp3'), cancellations: str(''), incompleteGigs: str('') }),
  compulsoryLogin: arr(obj({ from: str('13:00'), to: str('22:59'), minMinutes: int(480) })),
  videoUrl: str('https://…/how-offers-work.mp4'),
};

paths['/admin/gigs'] = admin('get', 'Gigs from a day for `days` days (1–14), with bookings per gig and a per-day summary (gigs, booked, seats) for a week strip', { parameters: [dateQ(), q('days', '1 (default) … 14'), q('storeId', "Hub, or 'none' for any-zone gigs"), q('status', 'active | cancelled')] });
paths['/admin/gigs/bulk'] = admin('post', 'Create gigs: every slot on every date. An identical active gig is skipped. `to` 00:00 = midnight.', {
  body: jsonBody({ storeId: { type: 'string', nullable: true, description: 'null = any zone' }, dates: arr(str('2026-09-27')), slots: arr(SLOT_INPUT) }, ['dates', 'slots']),
  data: obj({ created: int(18), skipped: int(0), items: arr({ type: 'object' }) }), status: 201, extra: { 422: RESPONSES_422 },
});
paths['/admin/gigs/{id}'] = {
  ...admin('patch', 'Edit a gig (pay, capacity, minimum login, free/priority, note)', { parameters: [idParam()], body: jsonBody(SLOT_INPUT.properties), extra: { 404: RESPONSES_404, 422: RESPONSES_422 } }),
  ...admin('delete', 'Cancel a gig; its bookings are cancelled and the partners notified', { parameters: [idParam()], extra: { 404: RESPONSES_404 } }),
};
paths['/admin/gigs/{id}/bookings'] = admin('get', 'Who booked a gig', { parameters: [idParam()] });
paths['/admin/gig-bookings/{id}/exempt'] = admin('patch', 'Exempt an incomplete gig so it doesn\'t count against offer conditions (or undo with exempted: false)', {
  parameters: [idParam()], body: jsonBody({ exempted: bool(true), reason: str('App outage 1pm-2pm') }), extra: { 404: RESPONSES_404 },
});
paths['/admin/offers'] = {
  ...admin('get', 'Incentive offers', { parameters: [...PAGE_QS, q('status', 'live | upcoming | expired | cancelled')], data: paginated({ type: 'object' }) }),
  ...admin('post', 'Create an incentive offer', { body: jsonBody(OFFER_INPUT, ['title', 'startAt', 'endAt', 'tiers']), status: 201, extra: { 422: RESPONSES_422 } }),
};
paths['/admin/offers/{id}'] = {
  ...admin('get', 'One offer', { parameters: [idParam()], extra: { 404: RESPONSES_404 } }),
  ...admin('put', 'Edit an offer (not once paid out)', { parameters: [idParam()], body: jsonBody(OFFER_INPUT, ['title', 'startAt', 'endAt', 'tiers']), extra: { 400: errorResponse('Already paid out'), 404: RESPONSES_404, 422: RESPONSES_422 } }),
  ...admin('delete', 'Cancel an offer (nobody is paid)', { parameters: [idParam()], extra: { 400: errorResponse('Already paid out'), 404: RESPONSES_404 } }),
};
paths['/admin/offers/{id}/riders'] = admin('get', 'Each partner\'s live progress, or their payout once settled', { parameters: [idParam()] });
paths['/admin/offers/{id}/settle'] = admin('post', 'Pay out an ended offer now (otherwise the background job does it within ~5 min). Never pays anyone twice.', {
  parameters: [idParam()], data: obj({ riders: int(40), paid: int(12), total: num(3120) }), extra: { 400: errorResponse('Not ended yet / cancelled') },
});
paths['/admin/delivery-partners/{id}/earnings'] = admin('post', 'Add an "Other earnings" credit to a partner\'s pocket (referral bonus, adjustment, …). With orderId it also appears as a pay line on that trip (e.g. "Long Distance Return Pay").', {
  parameters: [idParam()], body: jsonBody({ amount: num(12.5), reason: str('Long Distance Return Pay'), orderId: { type: 'string', nullable: true } }, ['amount', 'reason']), status: 201, extra: { 404: RESPONSES_404, 422: RESPONSES_422 },
});
paths['/admin/delivery-partners/{id}/deductions'] = admin('post', 'Deduct from a partner\'s pocket (Deduction statement; may take the pocket negative; the partner is notified)', {
  parameters: [idParam()], body: jsonBody({ amount: num(100), title: str('Temp Manual Pay'), description: str('Cold Bag Fraud 27th Jan'), orderId: { type: 'string', nullable: true } }, ['amount', 'title']), status: 201, extra: { 404: RESPONSES_404, 422: RESPONSES_422 },
});
paths['/admin/delivery-partners/{id}/cash-deposits'] = admin('post', 'Record COD cash the partner handed in at the hub (credits the pocket)', {
  parameters: [idParam()], body: jsonBody({ amount: num(200), reference: str('404022778') }, ['amount']), status: 201, extra: { 404: RESPONSES_404, 422: RESPONSES_422 },
});
paths['/admin/pocket-transfers'] = admin('get', 'Withdrawals / weekly payouts / deposits to process', { parameters: [...PAGE_QS, q('status', 'initiated | in_process | completed | failed'), q('type', 'withdrawal | weekly_payout | cash_deposit'), q('riderId', '')], data: paginated(TRANSFER) });
paths['/admin/pocket-transfers/{id}'] = admin('patch', 'Move a bank transfer along: in_process, completed (with the IMPS/UTR reference) or failed (the amount goes back into the pocket and the partner sees the "Failed to transfer" popup). A pending deposit can only be completed.', {
  parameters: [idParam()], body: jsonBody({ status: S('string', 'completed', { enum: ['in_process', 'completed', 'failed'] }), reference: str('527510490016'), failureReason: str('Account closed') }, ['status']), data: TRANSFER, extra: { 400: errorResponse('Not allowed from the current status'), 404: RESPONSES_404, 409: errorResponse('Updated concurrently') },
});
paths['/admin/pocket-transfers/weekly-payouts'] = admin('post', 'Start this week\'s payouts now: each approved partner with bank details and a positive balance, once per week (otherwise automatic on Monday at riderWeeklyPayoutHour)', { data: obj({ created: int(40), total: num(52340.5), weekKey: str('2026-02-02') }) });

paths['/admin/delivery-partners/{id}/hold'] = admin('post', 'Put an account on hold (the partner goes offline and can\'t take orders). durationHours blank = until unlocked; otherwise it lifts itself.', {
  parameters: [idParam()], body: jsonBody({ reason: S('string', 'face_mismatch', { enum: ['face_mismatch', 'cold_bag_not_returned', 'cash_not_deposited', 'fraud', 'misconduct', 'documents', 'other'] }), title: str('Face not matching'), details: str(''), durationHours: num(24) }, ['reason']), status: 201, extra: { 404: RESPONSES_404, 422: RESPONSES_422 },
});
paths['/admin/delivery-partners/{id}/unhold'] = admin('post', 'Unlock a held account now', { parameters: [idParam()], body: jsonBody({ note: str('Verified on call') }), extra: { 400: errorResponse('Not on hold'), 404: RESPONSES_404 } });
paths['/admin/delivery-partners/{id}/holds'] = admin('get', 'Hold cases for a partner (current + history)', { parameters: [idParam()] });
paths['/admin/selfie-checks'] = admin('get', 'Selfie checks to review, with the partner\'s onboarding selfie (profileSelfie) to compare', { parameters: [...PAGE_QS, q('status', 'pending (default) | match | mismatch')], data: paginated({ type: 'object' }) });
paths['/admin/selfie-checks/{id}'] = admin('patch', 'Mark a selfie: mismatch puts the account on hold ("Face not matching") for riderFaceMismatchHoldHours (default 24)', { parameters: [idParam()], body: jsonBody({ result: S('string', 'mismatch', { enum: ['match', 'mismatch'] }) }, ['result']), extra: { 400: errorResponse('Already reviewed'), 404: RESPONSES_404 } });
paths['/admin/cold-bags'] = {
  ...admin('post', 'Create cold bags for a store; each comes with a QR label (qrDataUrl) to print and stick on the bag', { body: jsonBody({ storeId: str(''), count: int(10), prefix: str('CB') }, ['storeId', 'count']), status: 201, extra: { 404: RESPONSES_404 } }),
  ...admin('get', 'Cold bags', { parameters: [q('storeId', ''), q('status', 'available | issued | lost | retired')] }),
};
paths['/admin/cold-bags/overdue'] = admin('get', 'Bags not returned in time (coldBagReturnHours, default 4)');
paths['/admin/cold-bag-issues/{id}/lost'] = admin('patch', 'Mark an unreturned bag lost; with amount, deduct it from the partner\'s pocket (Deduction statement)', { parameters: [idParam()], body: jsonBody({ amount: num(100), title: str('Temp Manual Pay'), description: str('Cold Bag Fraud 27th Jan') }), extra: { 400: errorResponse('Already returned / lost'), 404: RESPONSES_404 } });
const RIDER_POLICY_BODY = jsonBody({
  kmSlabs: arr(obj({ upToKm: num(1), amount: num(12) })),
  perKmBeyond: num(8),
  peak: obj({ amount: num(5), highSurgeAmount: num(10), windows: arr(obj({ from: str('18:00'), to: str('22:00') })) }),
  rain: obj({ normal: num(5), heavy: num(10), severe: num(15) }),
  heavyLoad: arr(obj({ minKg: num(10), amount: num(5) })),
  waiting: obj({ freeMinutes: int(10), perMinute: num(1), maxPay: { type: 'number', nullable: true, example: 30 } }),
  cancellation: obj({ arrivedAtPickup: num(10), pickedUp: num(20) }),
  daily: arr(obj({ deliveries: int(10), amount: num(50), tier: { type: 'string', nullable: true, example: 'Bronze' } })),
  weekly: arr(obj({ deliveries: int(60), amount: num(150) })),
  guarantee: obj({ enabled: bool(true), amount: num(300), minOnlineMinutes: int(480), minDeliveries: int(8), requireGig: bool(false) }),
  eligibility: obj({ maxCancellationRatePct: num(10), minOrdersForRate: int(5) }),
  settleDelayHours: int(12),
});
const PERIOD_PARAMS = [idParam(), {"name":"kind","in":"path","required":true,"schema":{"type":"string","enum":["day","week"]}}, {"name":"key","in":"path","required":true,"schema":{"type":"string","example":"2026-09-28"}}];
paths['/admin/rider-pay/policy'] = {
  ...admin('get', 'Delivery partner rate card (KM slabs, peak / rain / heavy-load, waiting / cancellation pay, daily + weekly slabs with tiers, minimum guarantee, eligibility) and the built-in defaults'),
  ...admin('put', 'Change the rate card — only the sections that change (a table like kmSlabs is replaced whole). Customer order value never affects KM pay.', { body: RIDER_POLICY_BODY, extra: { 422: RESPONSES_422 } }),
};
paths['/admin/rider-pay/preview'] = admin('get', 'What one order would pay (as quoted to the partner before accepting)', { parameters: [q('km', 'Mapped hub -> drop distance'), q('kg', 'Order weight, for the heavy-load bonus'), q('time', 'HH:mm, for the peak window'), q('storeId', "Use this hub's current rain / surge"), q('rain', 'none | normal | heavy | severe (instead of the hub)'), q('surge', 'none | high'), q('riderId', "Use this partner's own rates")], data: obj({ mappedDistanceKm: num(4.2), kmSlab: str('4–5 km'), basePayout: num(38), peakBonus: num(5), rainBonus: num(10), heavyLoadBonus: num(5), total: num(58) }) });
paths['/admin/rider-pay/settle'] = admin('post', 'Settle finished days / weeks now (the background job does this every 5 minutes, settleDelayHours after each period ends)', { data: obj({ settled: int(12) }) });
paths['/admin/rider-pay/periods'] = admin('get', 'Incentive periods across partners — e.g. status=withheld to review holds', { parameters: [q('status', 'pending | paid | nothing_due | not_eligible | withheld'), q('kind', 'day | week'), q('riderId', ''), q('limit', 'default 50')] });
paths['/admin/rider-pay/conditions'] = admin('get', "Every active hub's rain / surge for partner pay");
paths['/admin/stores/{id}/rider-conditions'] = admin('put', "Set a hub's rain level and/or high surge — applies to deliveries from now until `until` (or until switched off). Both none clears it. Only turn on severe-weather pay where riding is safely permitted.", { parameters: [idParam()], body: jsonBody({ rain: S('string', 'heavy', { enum: ['none', 'normal', 'heavy', 'severe'] }), surge: S('string', 'none', { enum: ['none', 'high'] }), until: { ...dt, nullable: true } }), extra: { 404: RESPONSES_404, 422: RESPONSES_422 } });
paths['/admin/delivery-partners/{id}/pay-periods'] = admin('get', "A partner's live day / week figures and settled or withheld periods, with eligibility, payout status and audit log", { parameters: [idParam(), q('kind', 'day | week'), q('limit', 'default 30')] });
paths['/admin/delivery-partners/{id}/pay-periods/{kind}/{key}/withhold'] = admin('post', "Withhold a day's / week's incentives (GPS or payment manipulation, verified customer complaint, …) before they're paid. key = YYYY-MM-DD (a week's Monday).", { parameters: PERIOD_PARAMS, body: jsonBody({ reason: str('Verified customer complaint — ticket #812') }, ['reason']), extra: { 400: errorResponse('Already paid — add a deduction instead'), 404: RESPONSES_404, 422: RESPONSES_422 } });
paths['/admin/delivery-partners/{id}/pay-periods/{kind}/{key}/release'] = admin('post', 'Lift a withhold: paid straight away (if still eligible) when the period is over, else settled normally', { parameters: PERIOD_PARAMS, body: jsonBody({ note: str('Checked GPS trail — fine') }), extra: { 400: errorResponse('This period is not withheld'), 404: RESPONSES_404 } });

// ---- Notices (Updates tab) -------------------------------------------------------------------
const NTAG = ['Notices (Updates tab)'];
const NOTICE_ITEM = obj({
  id: str(''), title: str('महत्वपूर्ण सूचना: COD Orders'), summary: str('प्रिय डिलीवरी पार्टनर्स, COD (Cash on Delivery) Orders से संबंधित…'),
  image: { type: 'string', nullable: true }, category: S('string', 'payments', { enum: ['important', 'payments', 'process', 'earnings', 'safety', 'general'] }),
  pinned: bool(true), publishedAt: dt, publishedLabel: str('2:02pm, 23 Sep'), requireAck: bool(true), read: bool(false), acknowledged: bool(false),
});
const BLOCK = obj({
  type: S('string', 'bullet', { enum: ['heading', 'paragraph', 'bullet'] }),
  text: str('Customer से Cash प्राप्त करें।'),
  spans: { ...arr(obj({ text: str(''), bold: bool(false) })), description: 'Same text split into bold / normal runs' },
});
const nget = (summary, parameters, data, extra = {}) => ({ get: { tags: NTAG, summary, ...bearer(), parameters, responses: { 200: envelope(data), 401: RESPONSES_401, ...extra } } });
paths['/common/announcements'] = nget('Notices for me (delivery partner / picker / customer), pinned first then newest', [...PAGE_QS, q('category', 'important | payments | process | earnings | safety | general')], paginated(NOTICE_ITEM));
paths['/common/announcements/unread-count'] = nget('Updates tab badge', [], obj({ unread: int(2), toAcknowledge: int(1) }));
paths['/common/announcements/{id}'] = nget('Details page — marks it read. Render `blocks` in order (heading = bold line, bullet = "•" row, paragraph keeps line breaks); `body` is the raw text. Show the ackLabel button when requireAck and not yet acknowledged.', [idParam()], { allOf: [NOTICE_ITEM, obj({ body: str('प्रिय डिलीवरी पार्टनर्स,\n\n**1. Cash Payment**\n* Customer से Cash प्राप्त करें।'), blocks: arr(BLOCK), cta: { ...obj({ label: str(''), url: str('') }), nullable: true }, ackLabel: { type: 'string', nullable: true, example: 'Okay, I understand' }, acknowledgedAt: { ...dt, nullable: true } })] }, { 404: RESPONSES_404 });
paths['/common/announcements/{id}/ack'] = {
  post: { tags: NTAG, summary: '"Okay, I understand" — confirm I have read it', ...bearer(), parameters: [idParam()], responses: { 200: envelope(obj({ id: str(''), acknowledged: bool(true), acknowledgedAt: dt })), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
const NOTICE_INPUT = {
  title: str('महत्वपूर्ण सूचना: COD Orders'),
  body: { type: 'string', description: 'Plain text: **bold**, lines starting with "* " / "• " / "- " are bullets, a line that is all **bold** is a heading, blank line = new paragraph' },
  summary: { type: 'string', description: 'List preview; default = start of the body' },
  image: { type: 'string', description: "Banner at the top ('/uploads/…' from POST /common/upload)" },
  category: S('string', 'payments', { enum: ['important', 'payments', 'process', 'earnings', 'safety', 'general'] }),
  audience: obj({ roles: arr(S('string', 'delivery', { enum: ['delivery', 'picker', 'customer'] })), stores: { ...arr(str('')), description: 'Only partners at these stores (empty = all)' }, users: { ...arr(str('')), description: 'Only these people (empty = everyone in roles)' } }),
  pinned: bool(false), requireAck: bool(true), ackLabel: str('Okay, I understand'),
  cta: obj({ label: str('Watch video'), url: str('https://…') }),
  publishAt: { ...dt, description: 'Schedule it; pushed when the time comes' }, expiresAt: { ...dt, nullable: true },
  sendPush: bool(true), publish: S('boolean', false, { description: 'POST only: publish straight away instead of saving a draft' }),
};
paths['/admin/announcements'] = {
  ...admin('get', 'Notices', { parameters: [...PAGE_QS, q('status', 'draft | published | archived'), q('category', ''), q('role', 'delivery | picker | customer')], data: paginated({ type: 'object' }) }),
  ...admin('post', 'Write a notice (draft, or publish: true to send now / at publishAt)', { body: jsonBody(NOTICE_INPUT, ['title', 'body']), status: 201, extra: { 422: RESPONSES_422 } }),
};
paths['/admin/announcements/{id}'] = {
  ...admin('get', 'One notice with a preview of how it renders (blocks)', { parameters: [idParam()], extra: { 404: RESPONSES_404 } }),
  ...admin('put', 'Edit a notice (send only the fields to change); edits show straight away', { parameters: [idParam()], body: jsonBody(NOTICE_INPUT), extra: { 404: RESPONSES_404, 422: RESPONSES_422 } }),
  ...admin('delete', 'Archive (hide from the apps)', { parameters: [idParam()], extra: { 404: RESPONSES_404 } }),
};
paths['/admin/announcements/{id}/publish'] = admin('post', 'Publish a draft: visible now (or at publishAt) and pushed to its audience', { parameters: [idParam()], extra: { 400: errorResponse('Already published'), 404: RESPONSES_404 } });
paths['/admin/announcements/{id}/stats'] = admin('get', 'Reach: audience size, read, confirmed, and who has not read / confirmed yet', { parameters: [idParam()], data: obj({ audience: int(120), read: int(85), acknowledged: int(60), pendingCount: int(60), pending: arr(obj({ _id: str(''), name: str('Ravi'), phone: str(''), role: str('delivery') })) }) });

// ---- Picker product-based pay -----------------------------------------------------------------
const PTAG = ['Picker - Earnings'];
const TASK_PAY = obj({
  items: int(12), byType: obj({ fruits_veg: int(4), dairy: int(2), normal: int(6) }),
  itemPay: num(8.4), peak: bool(false), peakPay: num(0), orderBonus: num(3),
  targetMinutes: num(9), actualMinutes: num(7.2), fasterPct: num(20), speedBonus: num(3),
  packing: S('string', 'normal', { enum: ['normal', 'fragile', 'large', 'special'] }), packingBonus: num(1), total: num(15.4),
});
const DAY = obj({
  date: str('2026-09-23'), orders: int(3), items: int(150), itemsByType: obj({ normal: int(150) }), avgSecondsPerItem: int(12),
  loginMinutes: int(540), loginHoursLabel: str('09:00'), accuracy: { type: 'number', nullable: true, example: 99.33 },
  errors: obj({ reported: int(0), confirmed: int(1), errorItems: int(1), fines: num(5) }),
  pickingPay: obj({ total: num(120), itemPay: num(90), peakPay: num(0), orderBonus: num(21), speedBonus: num(0), packingBonus: num(9) }),
  productivityBonus: num(60), nextProductivityTier: { ...obj({ items: int(200), amount: num(100), itemsToGo: int(50) }), nullable: true },
  qualityBonus: num(40), holiday: bool(false), holidayBonus: num(0), trainee: bool(false),
  guarantee: obj({ amount: num(350), eligible: bool(true), checks: obj({ shift: bool(true), productivity: bool(true), accuracy: bool(true), conduct: bool(true) }), topUp: num(130) }),
  calculated: num(220), total: S('number', 345, { description: 'max(calculated, guarantee) − confirmed fines' }),
});
const pget = (summary, parameters, data) => ({ get: { tags: PTAG, summary, ...bearer(), parameters, responses: { 200: envelope(data), 401: RESPONSES_401 } } });
paths['/picker/earnings/today'] = pget("Picker dashboard: today's orders, items (by product type), speed, accuracy, picking pay so far, productivity progress to the next tier, quality bonus, guarantee status, this week's attendance. Day bonuses are an estimate until the day is settled.", [dateQ('Another day (YYYY-MM-DD) — settled days show final figures')], { allOf: [DAY, obj({ settled: bool(false), estimate: bool(true), attendance: obj({ daysThisWeek: int(4), needed: int(6), bonus: num(150), minHours: num(4) }) })] });
paths['/picker/earnings/orders'] = pget('Pay per order portion on a day (item pay by product type, peak, order bonus, speed, packing)', [dateQ()], arr({ allOf: [obj({ orderId: str(''), orderNumber: str(''), completedAt: dt, timeLabel: str('2:10pm') }), TASK_PAY] }));
paths['/picker/earnings/summary'] = pget('What was credited in a day / week / month, by kind (Picking pay, Productivity bonus, Quality bonus, Sunday bonus, Minimum guarantee top-up, Weekly attendance bonus, fines)', [q('period', 'day | week | month'), dateQ()], obj({ total: num(4520), orders: int(210), loginHoursLabel: str('52:10'), earningsPerHour: num(86.6), breakdown: arr(obj({ label: str('Picking pay'), amount: num(3100) })) }));
paths['/picker/errors'] = pget('My picking errors (reported / confirmed / waived)', [], arr({ type: 'object' }));
paths['/picker/pocket'] = pget('My pocket balance', [], obj({ balance: num(1250) }));
paths['/picker/pocket/statement'] = pget('My pocket statement for a week', [q('week', 'this | last | YYYY-MM-DD'), q('filter', 'all | earnings | deductions')], { type: 'object' });

paths['/admin/picker-pay/policy'] = {
  ...admin('get', 'Picker pay policy: item rates by product type, order bonus brackets, speed target & tiers, packing, peak windows, productivity tiers, quality tiers, attendance, Sunday/holiday option, minimum guarantee, error fines, settle delay'),
  ...admin('put', 'Change the policy — send only what changes; it is merged into the current one', { body: jsonBody({ itemRates: obj({ normal: num(0.6), frozen: num(1) }), peak: obj({ perItem: num(0.5), windows: arr(obj({ from: str('18:00'), to: str('22:00') })) }), guarantee: obj({ active: num(350) }) }) }),
};
const RATES_BODY = jsonBody({ itemRates: obj({ normal: num(0.7) }), guarantee: obj({ active: num(400) }), reset: S('boolean', false, { description: 'true = remove these rates (back to store / default)' }) });
paths['/admin/pickers/{id}/pay-policy'] = {
  ...admin('get', "A picker's own rates, their store's rates, and the effective policy (level: default | store | picker)", { parameters: [idParam()] }),
  ...admin('put', "Set this picker's own rates — only what differs; merged into what's there. Everyone can be paid differently.", { parameters: [idParam()], body: RATES_BODY, extra: { 404: RESPONSES_404, 422: RESPONSES_422 } }),
};
paths['/admin/stores/{id}/picker-pay-policy'] = {
  ...admin('get', 'Picker rates for a store (and the default they build on)', { parameters: [idParam()] }),
  ...admin('put', 'Set picker rates for every picker at this store — only what differs from the default', { parameters: [idParam()], body: RATES_BODY, extra: { 404: RESPONSES_404, 422: RESPONSES_422 } }),
};
paths['/admin/delivery-partners/{id}/pay'] = {
  ...admin('get', "A delivery partner's own rate card values and the effective rate card (level: default | partner)", { parameters: [idParam()] }),
  ...admin('put', "Set this partner's own rate card sections — same shape as PUT /admin/rider-pay/policy, merged into what's there; { reset: true } clears all.", { parameters: [idParam()], body: jsonBody({ perKmBeyond: num(10), peak: obj({ amount: num(8) }), reset: bool(false) }), extra: { 404: RESPONSES_404, 422: RESPONSES_422 } }),
};
paths['/admin/picker-pay/settle'] = admin('post', 'Settle day bonuses now: one picker + date, or everything due', { body: jsonBody({ pickerId: str(''), date: str('2026-09-23') }), data: DAY });
paths['/admin/pickers/{id}/earnings'] = admin('get', "A picker's day with pay per order (audit)", { parameters: [idParam(), dateQ()] });
paths['/admin/pickers/{id}/earning-days'] = admin('get', "A picker's settled days (audit trail)", { parameters: [idParam(), q('from', 'YYYY-MM-DD'), q('to', 'YYYY-MM-DD')] });
paths['/admin/picker-errors'] = {
  ...admin('get', 'Picking errors', { parameters: [...PAGE_QS, q('status', 'reported | confirmed | waived'), q('pickerId', '')], data: paginated({ type: 'object' }) }),
  ...admin('post', 'Report a picking error on an order (not deducted until confirmed). Stock-outs and customer cancellations are never errors.', { body: jsonBody({ orderId: str(''), pickerId: str(''), type: S('string', 'missing_product', { enum: ['wrong_product', 'missing_product', 'wrong_quantity', 'damaged'] }), quantity: int(1), amount: S('number', 10, { description: 'Default per policy; wrong quantity ₹5–10, damaged ₹10–30' }), note: str('') }, ['orderId', 'pickerId', 'type']), status: 201, extra: { 422: RESPONSES_422 } }),
};
paths['/admin/picker-errors/{id}'] = admin('patch', 'Confirm (fine deducted + that order\'s speed bonus taken back) or waive', { parameters: [idParam()], body: jsonBody({ status: S('string', 'confirmed', { enum: ['confirmed', 'waived'] }), amount: num(20) }, ['status']), extra: { 400: errorResponse('Already reviewed'), 422: RESPONSES_422 } });
paths['/admin/order-economics'] = {
  ...admin('get', 'Assumptions for the contribution report'),
  ...admin('put', 'Change them', { body: jsonBody({ defaultMarginPct: num(18), packagingCostPerOrder: num(4), gatewayPct: num(2), otherCostPerOrder: num(0), lowContributionBelow: num(0) }) }),
};
paths['/admin/reports/order-contribution'] = admin('get', 'Per-order contribution = gross margin − picker cost − delivery cost − packaging − gateway − refund/wastage − other. Lowest first; lossOnly=true lists only orders below lowContributionBelow.', {
  parameters: [q('from', 'YYYY-MM-DD'), q('to', 'YYYY-MM-DD'), q('storeId', ''), q('lossOnly', 'true | false')],
  data: obj({ totals: { type: 'object' }, items: arr(obj({ orderNumber: str(''), grandTotal: num(240), grossMargin: num(62), costs: obj({ picker: num(10), delivery: num(30), packaging: num(4), gateway: num(4.8), refundWastage: num(0), other: num(0) }), contribution: num(13.2), marginPct: num(5.5), lowContribution: bool(false) })) }),
});

module.exports = paths;
