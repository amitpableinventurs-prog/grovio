const { Wallet, WalletTransaction, PocketTransfer, DeliveryProfile, Order, User } = require('../models');
const ApiError = require('../utils/apiError');
const t = require('../utils/localTime');
const { getSetting } = require('./settings.service');
const { notifyUser } = require('./notification.service');

// A delivery partner's pocket: their wallet, used as a running account with the platform.
//   + trip earnings, incentives, other earnings, cash deposits, reversed transfers
//   - COD cash collected (they now hold the platform's cash), withdrawals, weekly payouts, deductions
// The balance can go negative (more cash in hand than earnings). Every entry is a
// WalletTransaction with a category; bank transfers and deposits also have a PocketTransfer.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const TITLES = {
  order_earning: 'Trip Earning',
  incentive: 'Incentive',
  other_earning: 'Other earning',
  cash_collected: 'Cash collected',
  cash_deposit: 'Cash Deposit',
  withdrawal: 'Pocket Withdrawal',
  withdrawal_reversal: 'Pocket Withdrawal reversed',
  payout: 'Weekly payout',
  payout_reversal: 'Weekly payout reversed',
  deduction: 'Deduction',
};
const TRANSFER_LABELS = { withdrawal: 'Pocket withdrawal', weekly_payout: 'Weekly payout', cash_deposit: 'Cash deposit' };
const STATUS_LABELS = { initiated: 'Initiated', in_process: 'In Process', completed: 'Completed', failed: 'Failed' };

// Posts one pocket entry atomically. With requireBalance, a debit only goes through if the
// balance covers it (returns null otherwise).
async function post({ userId, type, amount, category, reason, title = null, description = null, refOrderId = null, refOfferId = null, refTransferId = null, refId = null, requireBalance = false }) {
  amount = round2(amount);
  if (!(amount > 0)) throw new ApiError(400, 'Amount must be above 0');
  const delta = type === 'credit' ? amount : -amount;
  let wallet;
  if (requireBalance) {
    wallet = await Wallet.findOneAndUpdate({ user: userId, balance: { $gte: amount } }, { $inc: { balance: delta } }, { new: true });
    if (!wallet) return null;
  } else {
    wallet = await Wallet.findOneAndUpdate({ user: userId }, { $inc: { balance: delta } }, { new: true, upsert: true, setDefaultsOnInsert: true });
  }
  wallet.balance = round2(wallet.balance);
  return WalletTransaction.create({
    user: userId, type, amount, reason: reason || title || TITLES[category] || category, category, title, description,
    refOrderId, refOfferId, refTransferId, refId, balanceAfter: wallet.balance,
  });
}

// ---- Settings / bank ------------------------------------------------------------------------

async function pocketConfig() {
  const min = Number(await getSetting('riderMinWithdrawal', 'RIDER_MIN_WITHDRAWAL'));
  const hour = Number(await getSetting('riderWeeklyPayoutHour', 'RIDER_WEEKLY_PAYOUT_HOUR'));
  return {
    minWithdrawal: Number.isFinite(min) && min > 0 ? min : 100,
    weeklyPayoutEnabled: ((await getSetting('riderWeeklyPayoutEnabled', 'RIDER_WEEKLY_PAYOUT_ENABLED')) ?? 'true') !== 'false',
    // Local hour on Monday when weekly payouts are started.
    weeklyPayoutHour: Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : 7,
  };
}

function bankOf(profile) {
  const b = profile?.bankDetails;
  if (!b?.accountNumber || !b?.ifsc) return null;
  return { bankName: b.bankName || null, accountHolderName: b.accountHolderName || null, accountNumberLast4: String(b.accountNumber).slice(-4), ifsc: b.ifsc };
}
const maskedAccount = (last4) => (last4 ? `XXXXXXX${last4}` : null);

// ---- Views ----------------------------------------------------------------------------------

// '06:24 PM • 10 Feb'
const whenLabel = (d) => `${t.timeLabel(d).replace(/(am|pm)$/, (m) => ` ${m.toUpperCase()}`).padStart(8, '0')} • ${t.dayLabel(d).padStart(6, '0')}`;

function transferView(tr) {
  const steps = [
    { key: 'initiated', label: 'Initiated', at: tr.initiatedAt, done: true },
    { key: 'in_process', label: 'In Process', at: tr.processingAt, done: ['in_process', 'completed'].includes(tr.status) || !!tr.processingAt },
    tr.status === 'failed'
      ? { key: 'failed', label: 'Failed', at: tr.failedAt, done: true }
      : { key: 'completed', label: 'Completed', at: tr.completedAt, done: tr.status === 'completed' },
  ];
  return {
    id: tr._id,
    type: tr.type,
    title: TRANSFER_LABELS[tr.type],
    amount: tr.amount,
    direction: tr.type === 'cash_deposit' ? 'in' : 'out',
    status: tr.status,
    statusLabel: STATUS_LABELS[tr.status],
    timeline: steps.map((s) => ({ ...s, atLabel: s.at ? `On ${t.timeLabel(s.at).replace(/(am|pm)$/, (m) => ` ${m.toUpperCase()}`).padStart(8, '0')}, ${String(t.dayOfMonth(s.at)).padStart(2, '0')} ${t.monthLabel(s.at)}, ${t.weekdayLabel(s.at)}` : null })),
    bank: tr.type === 'cash_deposit' ? null : { bankName: tr.bank?.bankName || null, accountNumber: maskedAccount(tr.bank?.accountNumberLast4), ifsc: tr.bank?.ifsc || null },
    reference: tr.reference,
    referenceLabel: tr.type === 'cash_deposit' ? 'Transaction ID' : 'IMPS ref no.',
    method: tr.method,
    failureReason: tr.failureReason,
    createdAt: tr.createdAt,
  };
}

function entryView(txn, orderNumbers, transfers) {
  const transfer = txn.refTransferId ? transfers.get(String(txn.refTransferId)) : null;
  let subtitle = txn.description || null;
  if (txn.refOrderId && ['order_earning', 'cash_collected'].includes(txn.category)) subtitle = `Order ID: ${orderNumbers.get(String(txn.refOrderId)) || txn.refOrderId}`;
  else if (txn.category === 'cash_deposit') subtitle = txn.refId ? `Transaction ID: ${txn.refId}` : 'Deposited at hub';
  else if (['incentive', 'other_earning'].includes(txn.category)) subtitle = txn.reason.replace(/^Incentive:\s*/, '');
  const status = ['withdrawal', 'payout'].includes(txn.category) && transfer ? transfer.status : null;
  return {
    id: txn._id,
    category: txn.category || 'order_earning',
    title: txn.title || TITLES[txn.category] || txn.reason,
    subtitle,
    status,
    statusLabel: status ? STATUS_LABELS[status] : null,
    amount: round2(txn.type === 'credit' ? txn.amount : -txn.amount),
    at: txn.createdAt,
    atLabel: whenLabel(txn.createdAt),
    orderId: txn.refOrderId,
    transferId: txn.refTransferId,
    balanceAfter: txn.balanceAfter,
  };
}

async function entryViews(txns) {
  const orderIds = txns.map((x) => x.refOrderId).filter(Boolean);
  const transferIds = txns.map((x) => x.refTransferId).filter(Boolean);
  const [orders, transfers] = await Promise.all([
    orderIds.length ? Order.find({ _id: { $in: orderIds } }).select('orderNumber').lean() : [],
    transferIds.length ? PocketTransfer.find({ _id: { $in: transferIds } }).select('status').lean() : [],
  ]);
  const orderNumbers = new Map(orders.map((o) => [String(o._id), o.orderNumber]));
  const transferMap = new Map(transfers.map((x) => [String(x._id), x]));
  return txns.map((x) => entryView(x, orderNumbers, transferMap));
}

// ---- Weeks ----------------------------------------------------------------------------------

// ?week=this|last|YYYY-MM-DD (any day in it). Mon–Sun, '09 Feb - 15 Feb'.
function weekRange(week) {
  let from = t.startOfWeek();
  if (week === 'last') from = t.addDays(from, -7);
  else if (t.parseDateKey(week)) from = t.startOfWeek(t.parseDateKey(week));
  const to = t.addDays(from, 7);
  const label = (d) => t.dayLabel(d).padStart(6, '0');
  return { key: t.dateKey(from), from, to, label: `${label(from)} - ${label(t.addDays(to, -1))}` };
}

// "Select week" options: the last 12 weeks.
function weekOptions() {
  const thisWeek = t.startOfWeek();
  return Array.from({ length: 12 }, (_, i) => {
    const w = weekRange(t.dateKey(t.addDays(thisWeek, -7 * i)));
    return { week: w.key, label: i === 0 ? 'This week' : i === 1 ? 'Last week' : w.label, range: w.label };
  });
}

// ---- Rider endpoints ------------------------------------------------------------------------

const FILTERS = {
  earnings: ['order_earning', 'incentive', 'other_earning'],
  cash: ['cash_collected', 'cash_deposit'],
  transfers: ['withdrawal', 'withdrawal_reversal', 'payout', 'payout_reversal'],
  deductions: ['deduction'],
};
const POCKET_CATEGORIES = Object.values(FILTERS).flat();
// Pocket entries only (older earning credits had no category but reason 'Delivery earning').
const pocketMatch = (riderId) => ({ user: riderId, $or: [{ category: { $in: POCKET_CATEGORIES } }, { category: null, reason: 'Delivery earning' }] });

// GET /delivery/pocket — Pocket tab
async function summary(riderId) {
  const [wallet, profile, cfg, pending, weekDeductions] = await Promise.all([
    Wallet.findOne({ user: riderId }),
    DeliveryProfile.findOne({ user: riderId }).select('bankDetails status'),
    pocketConfig(),
    PocketTransfer.find({ rider: riderId, type: { $ne: 'cash_deposit' }, status: { $in: ['initiated', 'in_process'] } }).sort({ createdAt: -1 }),
    WalletTransaction.find({ user: riderId, category: 'deduction', createdAt: { $gte: t.startOfWeek() } }).select('amount').lean(),
  ]);
  const balance = round2(wallet?.balance || 0);
  const bank = bankOf(profile);
  let cannotWithdraw = null;
  if (!bank) cannotWithdraw = 'Add your bank details to withdraw';
  else if (balance < cfg.minWithdrawal) cannotWithdraw = `You need at least ₹${cfg.minWithdrawal} in your pocket to withdraw`;
  else if (pending.some((p) => p.type === 'withdrawal')) cannotWithdraw = 'A withdrawal is already in progress';
  return {
    balance,
    // Negative balance = cash the partner holds and must deposit.
    cashToDeposit: balance < 0 ? round2(-balance) : 0,
    withdrawable: balance > 0 ? balance : 0,
    minWithdrawal: cfg.minWithdrawal,
    canWithdraw: !cannotWithdraw,
    cannotWithdrawReason: cannotWithdraw,
    bank: bank ? { bankName: bank.bankName, accountNumber: maskedAccount(bank.accountNumberLast4), ifsc: bank.ifsc } : null,
    pendingTransfers: pending.map(transferView),
    deductionsThisWeek: round2(weekDeductions.reduce((sum, d) => sum + d.amount, 0)),
  };
}

// GET /delivery/pocket/statement?week=&filter=all|earnings|cash|transfers|deductions
async function statement(riderId, query = {}) {
  const week = weekRange(query.week);
  const cats = FILTERS[query.filter];
  const where = { user: riderId, createdAt: { $gte: week.from, $lt: week.to } };
  if (!cats) Object.assign(where, pocketMatch(riderId));
  else if (query.filter === 'earnings') where.$or = [{ category: { $in: cats } }, { category: null, reason: 'Delivery earning' }];
  else where.category = { $in: cats };
  const txns = await WalletTransaction.find(where).sort({ createdAt: -1 }).lean();
  const items = await entryViews(txns);
  return {
    week: { key: week.key, label: week.label, from: week.from, to: week.to },
    filter: FILTERS[query.filter] ? query.filter : 'all',
    filters: [{ key: 'all', label: 'All' }, { key: 'earnings', label: 'Earnings' }, { key: 'cash', label: 'Cash' }, { key: 'transfers', label: 'Withdrawals & payouts' }, { key: 'deductions', label: 'Deductions' }],
    totals: { in: round2(items.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0)), out: round2(-items.filter((i) => i.amount < 0).reduce((s, i) => s + i.amount, 0)) },
    items,
  };
}

// GET /delivery/pocket/deductions?week=
async function deductions(riderId, query = {}) {
  const week = weekRange(query.week);
  const txns = await WalletTransaction.find({ user: riderId, category: 'deduction', createdAt: { $gte: week.from, $lt: week.to } }).sort({ createdAt: -1 }).lean();
  const items = await entryViews(txns);
  return { week: { key: week.key, label: week.label, from: week.from, to: week.to }, total: round2(-items.reduce((s, i) => s + i.amount, 0)), items };
}

// POST /delivery/pocket/withdraw { amount }
async function requestWithdrawal(riderId, amount) {
  amount = round2(amount);
  const [profile, cfg] = await Promise.all([DeliveryProfile.findOne({ user: riderId }).select('bankDetails status'), pocketConfig()]);
  if (profile?.status !== 'approved') throw new ApiError(403, 'Your account must be approved to withdraw');
  const bank = bankOf(profile);
  if (!bank) throw new ApiError(400, 'Add your bank details to withdraw');
  if (!(amount >= cfg.minWithdrawal)) throw new ApiError(400, `You can withdraw ₹${cfg.minWithdrawal} or more`);
  if (await PocketTransfer.exists({ rider: riderId, type: 'withdrawal', status: { $in: ['initiated', 'in_process'] } })) {
    throw new ApiError(400, 'A withdrawal is already in progress');
  }

  const transfer = await PocketTransfer.create({ rider: riderId, type: 'withdrawal', amount, bank });
  const txn = await post({ userId: riderId, type: 'debit', amount, category: 'withdrawal', refTransferId: transfer._id, requireBalance: true });
  if (!txn) {
    await transfer.deleteOne();
    throw new ApiError(400, 'Not enough balance in your pocket');
  }
  return transferView(transfer);
}

// GET /delivery/pocket/transfers, GET /delivery/pocket/transfers/:id
async function listTransfers(riderId, query = {}) {
  const where = { rider: riderId };
  if (['withdrawal', 'weekly_payout', 'cash_deposit'].includes(query.type)) where.type = query.type;
  const rows = await PocketTransfer.find(where).sort({ createdAt: -1 }).limit(50);
  return rows.map(transferView);
}
async function getTransfer(riderId, id) {
  const tr = await PocketTransfer.findOne({ _id: id, rider: riderId });
  if (!tr) throw new ApiError(404, 'Transaction not found');
  return transferView(tr);
}

// Failed withdrawals/payouts the partner hasn't dismissed yet — the "Failed to transfer amount"
// popup on the home screen.
async function failedTransferAlerts(riderId) {
  const rows = await PocketTransfer.find({ rider: riderId, type: { $ne: 'cash_deposit' }, status: 'failed', failureSeenAt: null }).sort({ failedAt: -1 }).limit(3);
  return rows.map((tr) => ({
    transferId: tr._id,
    type: 'transfer_failed',
    amount: tr.amount,
    title: 'Failed to transfer amount',
    heading: tr.type === 'weekly_payout' ? 'Weekly payout failed' : 'Pocket withdrawal failed',
    message: 'If money was deducted from the pocket, it will be added back in sometime.',
    date: tr.failedAt,
    dateLabel: `${String(t.dayOfMonth(tr.failedAt)).padStart(2, '0')} ${t.dayLabel(tr.failedAt).split(' ')[1]} ${t.year(tr.failedAt)}`,
    reference: tr.reference,
    referenceLabel: 'IMPS ref no.',
  }));
}
async function dismissFailure(riderId, id) {
  const tr = await PocketTransfer.findOneAndUpdate({ _id: id, rider: riderId, status: 'failed' }, { $set: { failureSeenAt: new Date() } }, { new: true });
  if (!tr) throw new ApiError(404, 'Transaction not found');
  return transferView(tr);
}

// ---- Cash deposit via Razorpay -------------------------------------------------------------

// POST /delivery/pocket/deposit { amount } -> Razorpay order for the app's checkout.
async function createDeposit(riderId, amount) {
  amount = round2(amount);
  if (!(amount >= 1)) throw new ApiError(400, 'Enter an amount of ₹1 or more');
  const { getRazorpayInstance } = require('../config/razorpay');
  const razorpay = await getRazorpayInstance();
  if (!razorpay) throw new ApiError(503, 'Online deposits are not available right now. Deposit the cash at your hub.');
  const transfer = await PocketTransfer.create({ rider: riderId, type: 'cash_deposit', amount, method: 'razorpay' });
  const rzpOrder = await razorpay.orders.create({ amount: Math.round(amount * 100), currency: 'INR', receipt: `dep_${transfer.id}`, notes: { purpose: 'rider_cash_deposit', transferId: transfer.id } });
  transfer.gatewayOrderId = rzpOrder.id;
  await transfer.save();
  return { transferId: transfer._id, amount, razorpayOrderId: rzpOrder.id, razorpayKeyId: await getSetting('razorpayKeyId', 'RAZORPAY_KEY_ID'), currency: 'INR' };
}

// Marks a cash deposit received and credits the pocket (once).
async function completeDeposit(transfer, { reference, processedBy = null } = {}) {
  const claimed = await PocketTransfer.findOneAndUpdate(
    { _id: transfer._id, status: { $in: ['initiated', 'in_process'] } },
    { $set: { status: 'completed', completedAt: new Date(), reference: reference || transfer.reference, processedBy } },
    { new: true },
  );
  if (!claimed) return PocketTransfer.findById(transfer._id);
  await post({ userId: claimed.rider, type: 'credit', amount: claimed.amount, category: 'cash_deposit', refTransferId: claimed._id, refId: claimed.reference });
  return claimed;
}

// POST /delivery/pocket/deposit/verify { razorpayOrderId, razorpayPaymentId, razorpaySignature }
async function verifyDeposit(riderId, { razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const { verifySignature } = require('./payment.service');
  if (!(await verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }))) throw new ApiError(400, 'Payment verification failed');
  const transfer = await PocketTransfer.findOne({ rider: riderId, type: 'cash_deposit', gatewayOrderId: razorpayOrderId });
  if (!transfer) throw new ApiError(404, 'Deposit not found');
  return transferView(await completeDeposit(transfer, { reference: razorpayPaymentId }));
}

// ---- Admin ----------------------------------------------------------------------------------

// Cash handed over at the hub. Capped at what the partner owes — anything above it would turn into
// pocket money they could withdraw.
async function recordHubDeposit(riderId, amount, reference, adminId) {
  const wallet = await Wallet.findOne({ user: riderId }).select('balance').lean();
  const due = round2(-(wallet?.balance || 0));
  if (due <= 0) throw new ApiError(400, 'This delivery partner has no cash to deposit');
  if (round2(amount) > due) throw new ApiError(400, `Only ₹${due} is due from this delivery partner`);
  const transfer = await PocketTransfer.create({ rider: riderId, type: 'cash_deposit', amount: round2(amount), method: 'hub', reference: reference || null });
  return transferView(await completeDeposit(transfer, { reference, processedBy: adminId }));
}

const CASH_CATEGORIES = ['cash_collected', 'cash_deposit'];

// Delivery partners with their pocket balance (0 without a wallet yet).
const riderBalances = (match) => [
  { $match: { role: 'delivery', ...match } },
  { $lookup: { from: Wallet.collection.collectionName, localField: '_id', foreignField: 'user', as: 'wallet' } },
  { $addFields: { balance: { $ifNull: [{ $arrayElemAt: ['$wallet.balance', 0] }, 0] } } },
];

// GET /admin/cash-collection?search=&holding=true -> every partner's COD cash position, most cash in
// hand first. "To deposit" is the figure the delivery app shows: a negative pocket balance, i.e. cash
// collected minus deposits and minus earnings already in the pocket.
async function adminCashBook(query = {}, { offset = 0, limit = 20 } = {}) {
  const match = {};
  if (query.search) {
    const rx = new RegExp(String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    match.$or = [{ name: rx }, { phone: rx }];
  }
  const [[page], [totals], today] = await Promise.all([
    User.aggregate([
      ...riderBalances(match),
      ...(query.holding === 'true' ? [{ $match: { balance: { $lt: 0 } } }] : []),
      { $sort: { balance: 1, name: 1 } },
      { $facet: { rows: [{ $skip: offset }, { $limit: limit }, { $project: { name: 1, phone: 1, isActive: 1, balance: 1 } }], count: [{ $count: 'n' }] } },
    ]),
    User.aggregate([
      ...riderBalances({}),
      { $match: { balance: { $lt: 0 } } },
      { $group: { _id: null, cashWithRiders: { $sum: { $multiply: ['$balance', -1] } }, ridersHolding: { $sum: 1 } } },
    ]),
    WalletTransaction.aggregate([
      { $match: { category: { $in: CASH_CATEGORIES }, createdAt: { $gte: t.startOfDay() } } },
      { $group: { _id: '$category', amount: { $sum: '$amount' } } },
    ]),
  ]);

  const stats = page.rows.length
    ? await WalletTransaction.aggregate([
      { $match: { user: { $in: page.rows.map((r) => r._id) }, category: { $in: CASH_CATEGORIES } } },
      { $group: { _id: { user: '$user', category: '$category' }, amount: { $sum: '$amount' }, last: { $max: '$createdAt' } } },
    ])
    : [];
  const stat = (userId, category) => stats.find((s) => String(s._id.user) === String(userId) && s._id.category === category);

  return {
    items: page.rows.map((r) => {
      const collected = stat(r._id, 'cash_collected');
      const deposited = stat(r._id, 'cash_deposit');
      return {
        rider: { _id: r._id, name: r.name, phone: r.phone, isActive: r.isActive },
        balance: round2(r.balance),
        cashToDeposit: r.balance < 0 ? round2(-r.balance) : 0,
        cashCollected: round2(collected?.amount),
        deposited: round2(deposited?.amount),
        lastCollectedAt: collected?.last || null,
        lastDepositAt: deposited?.last || null,
      };
    }),
    count: page.count[0]?.n || 0,
    totals: {
      cashWithRiders: round2(totals?.cashWithRiders),
      ridersHolding: totals?.ridersHolding || 0,
      collectedToday: round2(today.find((c) => c._id === 'cash_collected')?.amount),
      depositedToday: round2(today.find((c) => c._id === 'cash_deposit')?.amount),
    },
  };
}

// GET /admin/delivery-partners/:id/cash-ledger -> cash collected per order and deposits, newest first.
async function adminCashLedger(riderId, { offset = 0, limit = 20 } = {}) {
  const where = { user: riderId, category: { $in: CASH_CATEGORIES } };
  const [txns, count] = await Promise.all([
    WalletTransaction.find(where).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    WalletTransaction.countDocuments(where),
  ]);
  return { items: await entryViews(txns), count };
}

async function addDeduction(riderId, { amount, title, description, orderId = null }) {
  const txn = await post({ userId: riderId, type: 'debit', amount, category: 'deduction', title, description, refOrderId: orderId });
  await notifyUser(riderId, { title: 'Deduction', body: `₹${round2(amount)} deducted: ${title}${description ? ` — ${description}` : ''}`, type: 'pocket_deduction' }).catch(() => {});
  return txn;
}

// PATCH /admin/pocket-transfers/:id { status: in_process|completed|failed, reference, failureReason }
async function updateTransfer(id, { status, reference, failureReason }, adminId) {
  const tr = await PocketTransfer.findById(id);
  if (!tr) throw new ApiError(404, 'Transfer not found');
  if (tr.type === 'cash_deposit') {
    if (status !== 'completed') throw new ApiError(400, 'A pending deposit can only be marked completed');
    return transferView(await completeDeposit(tr, { reference, processedBy: adminId }));
  }
  const allowed = { initiated: ['in_process', 'completed', 'failed'], in_process: ['completed', 'failed'] }[tr.status] || [];
  if (!allowed.includes(status)) throw new ApiError(400, `Can't move a ${STATUS_LABELS[tr.status].toLowerCase()} transfer to ${status}`);

  const now = new Date();
  const set = { status, processedBy: adminId };
  if (reference) set.reference = reference;
  if (status === 'in_process') set.processingAt = now;
  if (status === 'completed') { set.completedAt = now; if (!tr.processingAt) set.processingAt = now; }
  if (status === 'failed') { set.failedAt = now; set.failureReason = failureReason || 'Bank transfer failed'; }
  const updated = await PocketTransfer.findOneAndUpdate({ _id: tr._id, status: tr.status }, { $set: set }, { new: true });
  if (!updated) throw new ApiError(409, 'This transfer was just updated by someone else');

  const label = TRANSFER_LABELS[tr.type].toLowerCase();
  if (status === 'failed') {
    await post({ userId: tr.rider, type: 'credit', amount: tr.amount, category: tr.type === 'withdrawal' ? 'withdrawal_reversal' : 'payout_reversal', refTransferId: tr._id, description: set.failureReason });
    await notifyUser(tr.rider, { title: 'Failed to transfer amount', body: `Your ${label} of ₹${tr.amount} failed. The amount is back in your pocket.`, type: 'pocket_transfer_failed', data: { transferId: tr._id } }).catch(() => {});
  } else if (status === 'completed') {
    await notifyUser(tr.rider, { title: 'Money sent to your bank', body: `Your ${label} of ₹${tr.amount} has been credited${updated.reference ? ` (ref ${updated.reference})` : ''}.`, type: 'pocket_transfer_completed', data: { transferId: tr._id } }).catch(() => {});
  }
  return transferView(updated);
}

// Weekly payout: each approved partner with bank details and a positive balance gets it sent to
// their bank, once per week (Monday, from riderWeeklyPayoutHour local time).
async function runWeeklyPayouts({ force = false } = {}) {
  const cfg = await pocketConfig();
  const now = new Date();
  if (!force) {
    if (!cfg.weeklyPayoutEnabled) return { created: 0 };
    const monday = t.startOfWeek(now);
    if (t.dateKey(monday) !== t.dateKey(now) || t.localHour(now) < cfg.weeklyPayoutHour) return { created: 0 };
  }
  const weekKey = t.dateKey(t.startOfWeek(now));
  const profiles = await DeliveryProfile.find({ status: 'approved', 'bankDetails.accountNumber': { $ne: null } }).select('user bankDetails');
  const wallets = await Wallet.find({ user: { $in: profiles.map((p) => p.user) }, balance: { $gt: 0 } });
  const byUser = new Map(profiles.map((p) => [String(p.user), p]));
  let created = 0;
  let total = 0;
  for (const w of wallets) {
    const amount = round2(w.balance);
    if (amount < 1) continue;
    let transfer;
    try {
      transfer = await PocketTransfer.create({ rider: w.user, type: 'weekly_payout', amount, bank: bankOf(byUser.get(String(w.user))), weekKey });
    } catch (err) {
      if (err.code === 11000) continue; // already made this week
      throw err;
    }
    const txn = await post({ userId: w.user, type: 'debit', amount, category: 'payout', refTransferId: transfer._id, requireBalance: true });
    if (!txn) { await transfer.deleteOne(); continue; }
    created += 1;
    total += amount;
    await notifyUser(w.user, { title: 'Weekly payout initiated', body: `₹${amount} is on its way to your bank.`, type: 'weekly_payout', data: { transferId: transfer._id } }).catch(() => {});
  }
  return { created, total: round2(total), weekKey };
}

async function adminListTransfers(query = {}, { offset = 0, limit = 20 } = {}) {
  const where = {};
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.riderId) where.rider = query.riderId;
  const [rows, count] = await Promise.all([
    PocketTransfer.find(where).populate('rider', 'name phone').sort({ createdAt: -1 }).skip(offset).limit(limit),
    PocketTransfer.countDocuments(where),
  ]);
  return { items: rows.map((r) => ({ ...transferView(r), rider: r.rider })), count };
}

module.exports = {
  TITLES,
  post,
  pocketConfig,
  summary,
  statement,
  deductions,
  weekOptions,
  requestWithdrawal,
  listTransfers,
  getTransfer,
  failedTransferAlerts,
  dismissFailure,
  createDeposit,
  verifyDeposit,
  recordHubDeposit,
  addDeduction,
  updateTransfer,
  runWeeklyPayouts,
  adminListTransfers,
  adminCashBook,
  adminCashLedger,
};
