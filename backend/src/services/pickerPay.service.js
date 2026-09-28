const mongoose = require('mongoose');
const { Order, Product, Category, PickerProfile, PickerDay, PickerError, Setting, WalletTransaction, RiderSession, Store } = require('../models');
const ApiError = require('../utils/apiError');
const t = require('../utils/localTime');
const { getSetting, invalidateSettingsCache } = require('./settings.service');
const sessions = require('./riderSession.service');
const pocket = require('./pocket.service');

// GoGrovio picker product-based pay policy.
//
//   Total picker earning = product picking pay + order bonus + speed/peak incentive
//                          + productivity bonus + quality bonus + eligible attendance bonus
//                          (+ packing incentive, Sunday/holiday option, minimum-guarantee top-up)
//                          - confirmed error fines
//
// Per order (a picker's portion, when they press "Ready for pickup" — payTask): item pay by
// product type, peak +₹/item, order completion bonus by item count, speed bonus against the target
// time, packing incentive. Credited to the pocket straight away as "Picking pay".
// Per day (settleDay, once the day is over + settleDelayHours for error reports): productivity
// bonus, quality (accuracy) bonus, Sunday/holiday option, and the minimum guarantee top-up.
// Per week (settleWeek): attendance bonus. Error fines (confirmError) are deducted when confirmed,
// and a confirmed error also takes back that order's speed bonus.
// Every number lives in the `pickerPayPolicy` setting (GET/PUT /admin/picker-pay/policy).

const DEFAULT_POLICY = {
  itemRates: { normal: 0.6, small: 0.5, fruits_veg: 0.8, dairy: 0.8, frozen: 1, fragile: 1, heavy_5_10: 1.5, heavy_10_plus: 2, special: 2 },
  orderBonus: [{ minItems: 1, amount: 1 }, { minItems: 6, amount: 2 }, { minItems: 11, amount: 3 }, { minItems: 21, amount: 4 }, { minItems: 31, amount: 5 }, { minItems: 51, amount: 7 }],
  // Target time for a portion = baseMinutes + secondsPerItem x items (from Start to Ready).
  speed: { baseMinutes: 3, secondsPerItem: 30, tiers: [{ fasterPct: 0, amount: 1 }, { fasterPct: 10, amount: 2 }, { fasterPct: 20, amount: 3 }] },
  packing: { normal: 1, fragile: 2, large: 3, special: 5, largeOrderItems: 20 },
  peak: { perItem: 0.5, windows: [{ from: '07:00', to: '10:00' }, { from: '18:00', to: '22:00' }] },
  productivity: [{ items: 50, amount: 10 }, { items: 100, amount: 30 }, { items: 150, amount: 60 }, { items: 200, amount: 100 }, { items: 250, amount: 150 }, { items: 300, amount: 200 }, { items: 400, amount: 300 }, { items: 500, amount: 400 }, { items: 600, amount: 500 }],
  quality: { minItems: 50, tiers: [{ minAccuracy: 97, amount: 20 }, { minAccuracy: 99, amount: 40 }, { minAccuracy: 99.5, amount: 60 }] },
  attendance: { weeklyBonus: 150, days: 6, minHours: 4 },
  // Sunday / holiday: ₹perDay OR ₹perItem (mode), not both.
  holiday: { sundays: true, dates: [], mode: 'per_item', perDay: 100, perItem: 0.5, minHours: 4 },
  // Minimum guarantee per day, for eligible shifts: training (first trainingDays after joining) vs active.
  guarantee: { trainingDays: 7, training: 300, active: 350, minHours: 8, minItemsTraining: 0, minItemsActive: 100, minAccuracy: 97 },
  // Fines per error: default, and the range an admin may set when confirming.
  errorFines: {
    wrong_product: { amount: 10, min: 10, max: 10 },
    missing_product: { amount: 10, min: 10, max: 10 },
    wrong_quantity: { amount: 5, min: 5, max: 10 },
    damaged: { amount: 10, min: 10, max: 30 },
  },
  settleDelayHours: 12,
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isPlainObject(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isPlainObject(v) && isPlainObject(base[k]) ? merge(base[k], v) : v;
  return out;
}

async function globalPolicy() {
  try {
    const raw = await getSetting('pickerPayPolicy');
    return merge(DEFAULT_POLICY, raw ? JSON.parse(raw) : {});
  } catch {
    return DEFAULT_POLICY;
  }
}

// Effective policy: default -> the picker's store -> the picker's own rates. Everyone can be paid
// differently; each level only holds what it changes. `level` says which applied (audit).
async function getPolicy(pickerId = null) {
  const base = await globalPolicy();
  if (!pickerId) return base;
  const profile = await PickerProfile.findOne({ user: pickerId }).select('store payPolicy').lean();
  const store = profile?.store ? await Store.findById(profile.store).select('pickerPayPolicy').lean() : null;
  let policy = base;
  let level = 'default';
  if (store?.pickerPayPolicy) { policy = merge(policy, store.pickerPayPolicy); level = 'store'; }
  if (profile?.payPolicy) { policy = merge(policy, profile.payPolicy); level = 'picker'; }
  return { ...policy, level };
}

// Checks a policy change / override: known sections only, no negative amounts.
function validatePolicyPatch(patch) {
  if (!isPlainObject(patch)) throw new ApiError(422, 'Send the policy parts to change as an object');
  const unknown = Object.keys(patch).filter((k) => !(k in DEFAULT_POLICY));
  if (unknown.length) throw new ApiError(422, `Unknown policy section(s): ${unknown.join(', ')}`);
  const walk = (v, where) => {
    if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) throw new ApiError(422, `${where} must be 0 or more`);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (isPlainObject(v)) Object.entries(v).forEach(([k, x]) => walk(x, `${where}.${k}`));
  };
  walk(patch, 'policy');
  if (patch.itemRates) {
    const bad = Object.keys(patch.itemRates).filter((k) => !(k in DEFAULT_POLICY.itemRates));
    if (bad.length) throw new ApiError(422, `Unknown product type(s): ${bad.join(', ')}`);
  }
  return patch;
}

// Keep tiers sorted so "highest tier reached" logic stays simple.
const sortTiers = (p) => {
  if (p.orderBonus) p.orderBonus = [...p.orderBonus].sort((a, b) => a.minItems - b.minItems);
  if (p.productivity) p.productivity = [...p.productivity].sort((a, b) => a.items - b.items);
  if (p.quality?.tiers) p.quality.tiers = [...p.quality.tiers].sort((a, b) => a.minAccuracy - b.minAccuracy);
  if (p.speed?.tiers) p.speed.tiers = [...p.speed.tiers].sort((a, b) => a.fasterPct - b.fasterPct);
  return p;
};

// Store / picker rates: merged into what's already there; null clears them.
async function setStorePolicy(storeId, patch) {
  const store = await Store.findById(storeId).select('pickerPayPolicy');
  if (!store) throw new ApiError(404, 'Store not found');
  store.pickerPayPolicy = patch === null ? null : sortTiers(merge(store.pickerPayPolicy || {}, validatePolicyPatch(patch)));
  store.markModified('pickerPayPolicy');
  await store.save();
  return store.pickerPayPolicy;
}
async function setPickerPolicy(pickerId, patch) {
  const profile = await PickerProfile.findOne({ user: pickerId }).select('payPolicy');
  if (!profile) throw new ApiError(404, 'Picker not found');
  profile.payPolicy = patch === null ? null : sortTiers(merge(profile.payPolicy || {}, validatePolicyPatch(patch)));
  profile.markModified('payPolicy');
  await profile.save();
  return profile.payPolicy;
}

async function savePolicy(changes) {
  const merged = sortTiers(merge(await globalPolicy(), validatePolicyPatch(changes)));
  await Setting.findOneAndUpdate({ key: 'pickerPayPolicy' }, { value: JSON.stringify(merged) }, { upsert: true });
  invalidateSettingsCache();
  return merged;
}

// ---- Per order ------------------------------------------------------------------------------

const tierAmount = (tiers, value, key) => tiers.reduce((amt, tier) => (value >= tier[key] ? tier.amount : amt), 0);
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
function inWindows(windows, at) {
  const m = t.localMinutes(at);
  return (windows || []).some((w) => { const a = toMin(w.from); const b = toMin(w.to); return a <= b ? m >= a && m < b : m >= a || m < b; });
}

// Pick type of each product: its own, else frozen (cold bag), fruits & veg / dairy by category name.
async function pickTypes(productIds) {
  const products = await Product.find({ _id: { $in: productIds } }).select('pickType requiresColdBag category').lean();
  const cats = await Category.find({ _id: { $in: products.map((p) => p.category).filter(Boolean) } }).select('name').lean();
  const catName = new Map(cats.map((c) => [String(c._id), c.name || '']));
  return new Map(products.map((p) => {
    let type = p.pickType;
    if (!type && p.requiresColdBag) type = 'frozen';
    if (!type) {
      const name = catName.get(String(p.category)) || '';
      if (/fruit|vegetable|veggie/i.test(name)) type = 'fruits_veg';
      else if (/dairy|milk/i.test(name)) type = 'dairy';
    }
    return [String(p._id), type || 'normal'];
  }));
}

// Pay for one picker's completed portion of an order. Pure given the policy and pick types.
function computeTaskPay(policy, { items, types, startedAt, completedAt }) {
  // items: [{ product, qty }] actually picked (stock-outs excluded)
  const byType = {};
  let count = 0;
  let itemPay = 0;
  for (const it of items) {
    const type = types.get(String(it.product)) || 'normal';
    byType[type] = (byType[type] || 0) + it.qty;
    count += it.qty;
    itemPay += it.qty * (policy.itemRates[type] ?? policy.itemRates.normal);
  }
  const peak = completedAt && inWindows(policy.peak.windows, completedAt);
  const peakPay = peak ? count * policy.peak.perItem : 0;
  const orderBonus = count ? tierAmount(policy.orderBonus, count, 'minItems') : 0;

  const targetMinutes = round2(policy.speed.baseMinutes + (policy.speed.secondsPerItem * count) / 60);
  const actualMinutes = startedAt && completedAt ? round2((completedAt - startedAt) / 60000) : null;
  let speedBonus = 0;
  let fasterPct = null;
  if (count && actualMinutes !== null && actualMinutes <= targetMinutes) {
    fasterPct = round2(((targetMinutes - actualMinutes) / targetMinutes) * 100);
    speedBonus = tierAmount(policy.speed.tiers, fasterPct, 'fasterPct');
  }

  let packing = 'normal';
  if (byType.special) packing = 'special';
  else if (count >= policy.packing.largeOrderItems || byType.heavy_5_10 || byType.heavy_10_plus) packing = 'large';
  else if (byType.fragile) packing = 'fragile';
  const packingBonus = count ? policy.packing[packing] : 0;

  const total = round2(itemPay + peakPay + orderBonus + speedBonus + packingBonus);
  return {
    // Which rates applied: default, store or picker.
    rates: policy.level || 'default',
    items: count, byType, itemPay: round2(itemPay), peak: !!peak, peakPay: round2(peakPay), orderBonus,
    targetMinutes, actualMinutes, fasterPct, speedBonus, packing, packingBonus, total,
  };
}

// Picker pressed "Ready for pickup": pay their portion (once) and credit it.
async function payTask(order, pickerId) {
  const task = order.pickTasks.find((x) => String(x.picker) === String(pickerId));
  if (!task || task.status !== 'completed' || task.pay) return task?.pay || null;
  const mine = order.items.filter((i) => String(i.assignedPicker) === String(pickerId) && i.isAvailable !== false);
  const items = mine.map((i) => ({ product: i.product, qty: Math.max(0, Number(i.pickedQty ?? i.qty) || 0) })).filter((i) => i.qty > 0);
  const policy = await getPolicy(pickerId);
  const pay = computeTaskPay(policy, { items, types: await pickTypes(items.map((i) => i.product)), startedAt: task.startedAt, completedAt: task.completedAt || new Date() });

  // Claim atomically so a double tap can't pay twice.
  const res = await Order.updateOne(
    { _id: order._id, pickTasks: { $elemMatch: { picker: oid(pickerId), status: 'completed', pay: null } } },
    { $set: { 'pickTasks.$.pay': pay } },
  );
  if (!res.modifiedCount) return null;
  task.pay = pay;
  if (pay.total > 0) {
    await pocket.post({ userId: pickerId, type: 'credit', amount: pay.total, category: 'order_earning', title: 'Picking pay', reason: 'Picking pay', refOrderId: order._id });
  }
  return pay;
}

// ---- Per day ---------------------------------------------------------------------------------

// My completed portions in [from, to).
async function tasksBetween(pickerId, from, to) {
  const rows = await Order.aggregate([
    { $match: { 'pickTasks.picker': oid(pickerId) } },
    { $unwind: '$pickTasks' },
    { $match: { 'pickTasks.picker': oid(pickerId), 'pickTasks.status': 'completed', 'pickTasks.completedAt': { $gte: from, $lt: to } } },
    { $project: { orderNumber: 1, task: '$pickTasks' } },
    { $sort: { 'task.completedAt': 1 } },
  ]);
  return rows;
}

async function isTrainee(pickerId, day, policy) {
  const profile = await PickerProfile.findOne({ user: pickerId }).select('joiningDate createdAt status').lean();
  const joined = profile?.joiningDate || profile?.createdAt;
  const trainee = !!joined && t.addDays(t.startOfDay(joined), policy.guarantee.trainingDays) > day;
  return { trainee, blocked: profile?.status === 'blocked' };
}

const isHoliday = (policy, day) => (policy.holiday.sundays && t.weekdayLabel(day) === 'Sun') || (policy.holiday.dates || []).includes(t.dateKey(day));

// Everything about one day — live for today, final when settled.
async function dayFigures(pickerId, dateKey, policy) {
  policy = policy || await getPolicy(pickerId);
  const day = t.parseDateKey(dateKey) || t.startOfDay();
  const next = t.addDays(day, 1);
  const [tasks, loginMinutes, errors, { trainee, blocked }] = await Promise.all([
    tasksBetween(pickerId, day, next),
    sessions.onlineMinutes(pickerId, day, next),
    PickerError.find({ picker: pickerId, pickedAt: { $gte: day, $lt: next }, status: { $ne: 'waived' } }).lean(),
    isTrainee(pickerId, day, policy),
  ]);

  const paid = tasks.map((r) => r.task.pay).filter(Boolean);
  const items = paid.reduce((s, p) => s + p.items, 0);
  const itemsByType = {};
  paid.forEach((p) => Object.entries(p.byType || {}).forEach(([k, v]) => { itemsByType[k] = (itemsByType[k] || 0) + v; }));
  const sum = (key) => round2(paid.reduce((s, p) => s + (p[key] || 0), 0));
  const confirmed = errors.filter((e) => e.status === 'confirmed');
  const errorItems = confirmed.reduce((s, e) => s + (e.quantity || 1), 0);
  const accuracy = items ? round2(Math.max(0, (1 - errorItems / items) * 100)) : null;

  const productivityBonus = tierAmount(policy.productivity, items, 'items');
  const nextTier = policy.productivity.find((tier) => items < tier.items) || null;
  const qualityBonus = items >= policy.quality.minItems && accuracy !== null ? tierAmount(policy.quality.tiers, accuracy, 'minAccuracy') : 0;

  const holiday = isHoliday(policy, day);
  let holidayBonus = 0;
  if (holiday && loginMinutes >= policy.holiday.minHours * 60) {
    holidayBonus = policy.holiday.mode === 'per_day' ? policy.holiday.perDay : round2(items * policy.holiday.perItem);
  }

  const pickingPay = sum('total');
  const calculated = round2(pickingPay + productivityBonus + qualityBonus + holidayBonus);
  const g = policy.guarantee;
  const guaranteeAmount = trainee ? g.training : g.active;
  const minItems = trainee ? g.minItemsTraining : g.minItemsActive;
  const guaranteeChecks = {
    shift: loginMinutes >= g.minHours * 60,
    productivity: items >= minItems,
    accuracy: accuracy === null ? items === 0 && minItems === 0 : accuracy >= g.minAccuracy,
    conduct: !blocked,
  };
  const guaranteeEligible = Object.values(guaranteeChecks).every(Boolean);
  const guaranteeTopUp = guaranteeEligible ? round2(Math.max(0, guaranteeAmount - calculated)) : 0;
  const fines = round2(confirmed.reduce((s, e) => s + (e.amount || 0), 0));
  const avgSecondsPerItem = items ? Math.round(paid.reduce((s, p) => s + (p.actualMinutes || 0) * 60, 0) / items) : null;

  return {
    date: t.dateKey(day),
    rates: policy.level || 'default',
    orders: paid.length,
    items,
    itemsByType,
    avgSecondsPerItem,
    loginMinutes,
    loginHoursLabel: sessions.hhmm(loginMinutes),
    accuracy,
    errors: { reported: errors.filter((e) => e.status === 'reported').length, confirmed: confirmed.length, errorItems, fines },
    pickingPay: { total: pickingPay, itemPay: sum('itemPay'), peakPay: sum('peakPay'), orderBonus: sum('orderBonus'), speedBonus: sum('speedBonus'), packingBonus: sum('packingBonus') },
    productivityBonus,
    nextProductivityTier: nextTier ? { items: nextTier.items, amount: nextTier.amount, itemsToGo: nextTier.items - items } : null,
    qualityBonus,
    holiday,
    holidayBonus,
    trainee,
    guarantee: { amount: guaranteeAmount, eligible: guaranteeEligible, checks: guaranteeChecks, topUp: guaranteeTopUp },
    calculated,
    // Earned for the day: the higher of calculated and guarantee, less confirmed fines.
    total: round2(calculated + guaranteeTopUp - fines),
  };
}

// Credit the day-level bonuses once (each with its own refId, so a retry never pays twice).
async function settleDay(pickerId, dateKey) {
  if (await PickerDay.exists({ picker: pickerId, date: dateKey })) return null;
  const f = await dayFigures(pickerId, dateKey);
  const lines = [
    ['productivity', 'Productivity bonus', f.productivityBonus],
    ['quality', 'Quality bonus', f.qualityBonus],
    ['holiday', f.holiday && t.weekdayLabel(t.parseDateKey(dateKey)) === 'Sun' ? 'Sunday bonus' : 'Holiday bonus', f.holidayBonus],
    ['guarantee', 'Minimum guarantee top-up', f.guarantee.topUp],
  ];
  try {
    await PickerDay.create({ picker: pickerId, date: dateKey, figures: f, total: f.total });
  } catch (err) {
    if (err.code === 11000) return null;
    throw err;
  }
  for (const [kind, title, amount] of lines) {
    const refId = `pday:${dateKey}:${kind}`;
    if (amount > 0 && !(await WalletTransaction.exists({ user: pickerId, refId }))) {
      await pocket.post({ userId: pickerId, type: 'credit', amount, category: kind === 'guarantee' ? 'other_earning' : 'incentive', title, reason: title, description: t.dayLabel(t.parseDateKey(dateKey)), refId });
    }
  }
  return f;
}

// Weekly attendance bonus: days (Mon–Sun) with at least minHours online.
async function settleWeek(pickerId, weekKey) {
  const policy = await getPolicy(pickerId);
  const refId = `pweek:${weekKey}`;
  if (await WalletTransaction.exists({ user: pickerId, refId })) return null;
  const from = t.parseDateKey(weekKey);
  let days = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = t.addDays(from, i);
    if (await sessions.onlineMinutes(pickerId, d, t.addDays(d, 1)) >= policy.attendance.minHours * 60) days += 1;
  }
  if (days < policy.attendance.days) return { days, paid: 0 };
  await pocket.post({ userId: pickerId, type: 'credit', amount: policy.attendance.weeklyBonus, category: 'incentive', title: 'Weekly attendance bonus', reason: 'Weekly attendance bonus', description: `${days} days, week of ${t.dayLabel(from)}`, refId });
  return { days, paid: policy.attendance.weeklyBonus };
}

// Background job: settle every picker's finished days (last 7) and weeks (last 3).
async function settleDue() {
  const policy = await getPolicy();
  const now = new Date();
  const pickers = await PickerProfile.find({ status: { $ne: 'pending' } }).select('user').lean();
  let settled = 0;
  for (const { user } of pickers) {
    for (let i = 1; i <= 7; i += 1) {
      const day = t.addDays(t.startOfDay(now), -i);
      if (t.addDays(day, 1).getTime() + policy.settleDelayHours * 3600000 > now.getTime()) continue;
      const key = t.dateKey(day);
      if (await PickerDay.exists({ picker: user, date: key })) continue;
      const active = await RiderSession.exists({ rider: user, startedAt: { $lt: t.addDays(day, 1) }, $or: [{ endedAt: null }, { endedAt: { $gt: day } }] })
        || (await tasksBetween(user, day, t.addDays(day, 1))).length;
      if (!active) continue;
      if (await settleDay(user, key)) settled += 1;
    }
    for (let w = 1; w <= 3; w += 1) {
      const weekStart = t.addDays(t.startOfWeek(now), -7 * w);
      if (t.addDays(weekStart, 7).getTime() + policy.settleDelayHours * 3600000 > now.getTime()) continue;
      await settleWeek(user, t.dateKey(weekStart));
    }
  }
  return settled;
}

// ---- Errors ----------------------------------------------------------------------------------

function fineFor(policy, type, amount) {
  const rule = policy.errorFines[type];
  if (!rule) throw new ApiError(422, 'Unknown error type');
  const value = amount === undefined || amount === null || amount === '' ? rule.amount : Number(amount);
  if (!(value >= rule.min && value <= rule.max)) throw new ApiError(422, `Fine for ${type.replace(/_/g, ' ')} must be ₹${rule.min}${rule.max !== rule.min ? `–₹${rule.max}` : ''}`);
  return value;
}

// Report a mistake on an order (defaults to the picker(s) whose items were affected).
async function reportError({ orderId, pickerId, type, quantity = 1, amount, note, reportedBy }) {
  const policy = await getPolicy(pickerId);
  const order = await Order.findById(orderId).select('pickTasks store orderStatus');
  if (!order) throw new ApiError(404, 'Order not found');
  const task = order.pickTasks.find((x) => String(x.picker) === String(pickerId));
  if (!task || task.status !== 'completed') throw new ApiError(400, "That picker didn't complete a portion of this order");
  const fine = fineFor(policy, type, amount);
  return PickerError.create({ picker: pickerId, order: order._id, store: task.store || order.store, type, quantity, amount: fine, note, reportedBy, pickedAt: task.completedAt });
}

// Confirm (fine + speed bonus taken back) or waive.
async function reviewError(errorId, { status, amount, reviewedBy }) {
  const err = await PickerError.findById(errorId);
  if (!err) throw new ApiError(404, 'Error report not found');
  const policy = await getPolicy(err.picker);
  if (err.status !== 'reported') throw new ApiError(400, `Already ${err.status}`);
  if (!['confirmed', 'waived'].includes(status)) throw new ApiError(422, "status must be 'confirmed' or 'waived'");
  if (status === 'confirmed') {
    err.amount = fineFor(policy, err.type, amount ?? err.amount);
    const order = await Order.findById(err.order).select('orderNumber pickTasks');
    const label = err.type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    const fine = await pocket.post({ userId: err.picker, type: 'debit', amount: err.amount, category: 'deduction', title: `Picking error: ${label}`, description: `Order ${order?.orderNumber || ''}${err.note ? ` — ${err.note}` : ''}`.trim(), refOrderId: err.order });
    err.fineTxn = fine._id;
    // Speed incentive is subject to accuracy: take it back for this order (once).
    const task = order?.pickTasks.find((x) => String(x.picker) === String(err.picker));
    const speed = task?.pay?.speedBonus || 0;
    const reversedAlready = await PickerError.exists({ order: err.order, picker: err.picker, speedReversalTxn: { $ne: null } });
    if (speed > 0 && !reversedAlready) {
      const rev = await pocket.post({ userId: err.picker, type: 'debit', amount: speed, category: 'deduction', title: 'Speed bonus reversed', description: `Order ${order.orderNumber} had a picking error`, refOrderId: err.order });
      err.speedReversalTxn = rev._id;
    }
  }
  err.status = status;
  err.reviewedBy = reviewedBy;
  err.reviewedAt = new Date();
  await err.save();
  return err;
}

// ---- Picker app ------------------------------------------------------------------------------

// GET /picker/earnings/today (or ?date=) — dashboard: orders, items, category-wise items, speed,
// accuracy, earning so far, productivity progress, guarantee status, this week's attendance.
async function today(pickerId, dateKey) {
  const policy = await getPolicy(pickerId);
  const key = dateKey && t.parseDateKey(dateKey) ? dateKey : t.dateKey(new Date());
  const settled = await PickerDay.findOne({ picker: pickerId, date: key }).lean();
  const f = settled?.figures || await dayFigures(pickerId, key, policy);
  const weekStart = t.startOfWeek(t.parseDateKey(key));
  let attendanceDays = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = t.addDays(weekStart, i);
    if (d > new Date()) break;
    if (await sessions.onlineMinutes(pickerId, d, t.addDays(d, 1)) >= policy.attendance.minHours * 60) attendanceDays += 1;
  }
  return {
    ...f,
    settled: !!settled,
    // Until settled, day bonuses are an estimate from progress so far.
    estimate: !settled,
    attendance: { daysThisWeek: attendanceDays, needed: policy.attendance.days, bonus: policy.attendance.weeklyBonus, minHours: policy.attendance.minHours },
  };
}

// GET /picker/earnings/orders?date= — pay per order portion.
async function orderEarnings(pickerId, dateKey) {
  const day = t.dayFromQuery(dateKey);
  const rows = await tasksBetween(pickerId, day, t.addDays(day, 1));
  return rows.reverse().map((r) => ({ orderId: r._id, orderNumber: r.orderNumber, completedAt: r.task.completedAt, timeLabel: t.timeLabel(r.task.completedAt), ...(r.task.pay || {}) }));
}

module.exports = { DEFAULT_POLICY, getPolicy, globalPolicy, savePolicy, setStorePolicy, setPickerPolicy, validatePolicyPatch, pickTypes, computeTaskPay, payTask, dayFigures, settleDay, settleWeek, settleDue, reportError, reviewError, today, orderEarnings };
