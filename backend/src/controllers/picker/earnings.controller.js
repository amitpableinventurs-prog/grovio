const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const { PickerError, Order } = require('../../models');
const t = require('../../utils/localTime');
const pickerPay = require('../../services/pickerPay.service');
const pocket = require('../../services/pocket.service');
const { creditsBetween, periodRange } = require('../../services/riderEarnings.service');
const sessions = require('../../services/riderSession.service');

// Picker app: today's earning and progress, pay per order, earnings by period, errors, pocket.

// GET /picker/earnings/today?date= — dashboard
const today = catchAsync(async (req, res) => {
  new ApiResponse(200, await pickerPay.today(req.user.id, req.query.date)).send(res);
});

// GET /picker/earnings/orders?date= — pay breakdown per order portion
const orders = catchAsync(async (req, res) => {
  new ApiResponse(200, await pickerPay.orderEarnings(req.user.id, req.query.date)).send(res);
});

// GET /picker/earnings/summary?period=day|week|month&date= — what was credited, by kind
const summary = catchAsync(async (req, res) => {
  const range = periodRange(req.query.period, req.query.date);
  const [credits, loginMs, taskCount] = await Promise.all([
    creditsBetween(req.user.id, range.from, range.to),
    sessions.onlineMs(req.user.id, range.from, range.to),
    Order.countDocuments({ pickTasks: { $elemMatch: { picker: req.user._id, status: 'completed', completedAt: { $gte: range.from, $lt: range.to } } } }),
  ]);
  const by = {};
  credits.forEach((c) => {
    const key = c.title || c.reason;
    by[key] = Math.round(((by[key] || 0) + c.signed) * 100) / 100;
  });
  const total = Math.round(credits.reduce((s, c) => s + c.signed, 0) * 100) / 100;
  new ApiResponse(200, {
    period: range.period, from: range.from, to: range.to, label: range.label, prevDate: range.prevDate, nextDate: range.nextDate,
    total,
    orders: taskCount,
    loginHoursLabel: sessions.hhmm(Math.floor(loginMs / 60000)),
    earningsPerHour: loginMs >= 60000 ? Math.round((total / (loginMs / 3600000)) * 100) / 100 : 0,
    // e.g. { "Picking pay": 412.5, "Productivity bonus": 150, "Picking error: Missing product": -10 }
    breakdown: Object.entries(by).map(([label, amount]) => ({ label, amount })),
  }).send(res);
});

// GET /picker/errors — my reported / confirmed / waived picking errors
const errors = catchAsync(async (req, res) => {
  const rows = await PickerError.find({ picker: req.user.id }).populate('order', 'orderNumber').sort({ createdAt: -1 }).limit(100).lean();
  new ApiResponse(200, rows.map((e) => ({ ...e, pickedLabel: e.pickedAt ? `${t.dayLabel(e.pickedAt)}, ${t.timeLabel(e.pickedAt)}` : null }))).send(res);
});

// GET /picker/pocket, /picker/pocket/statement?week=&filter=
const pocketSummary = catchAsync(async (req, res) => {
  const s = await pocket.summary(req.user.id);
  new ApiResponse(200, { balance: s.balance, pendingTransfers: s.pendingTransfers, deductionsThisWeek: s.deductionsThisWeek }).send(res);
});
const pocketStatement = catchAsync(async (req, res) => new ApiResponse(200, await pocket.statement(req.user.id, req.query)).send(res));

module.exports = { today, orders, summary, errors, pocketSummary, pocketStatement };
