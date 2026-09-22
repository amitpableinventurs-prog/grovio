const crypto = require('crypto');
const { ScannerLog } = require('../models');
const { emitOrderEvent } = require('../sockets');
const { notifyUser } = require('./notification.service');
const ApiError = require('../utils/apiError');

// Allowed forward transitions. Cancellation is handled separately (allowed from most pre-delivery states).
// 'assigned' -> 'picked_up' is gated behind a verified handover OTP (see verifyHandoverOtp below) —
// there is no other path to 'picked_up', per the business rule that the delivery app must never
// self-report a pickup without backend validation.
const TRANSITIONS = {
  placed: ['accepted', 'rejected', 'cancelled'],
  accepted: ['picking', 'cancelled'],
  picking: ['partially_picked', 'packed', 'cancelled'],
  partially_picked: ['packed', 'cancelled'],
  packed: ['assigned', 'cancelled'],
  assigned: ['picked_up', 'cancelled'],
  picked_up: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'delivery_failed', 'returned'],
  delivery_failed: ['out_for_delivery', 'returned', 'cancelled'],
  delivered: [],
  rejected: [],
  cancelled: [],
  returned: [],
};

const STATUS_MESSAGES = {
  accepted: 'Your order has been accepted by the store.',
  rejected: 'Your order was rejected by the store.',
  picking: 'Your order is being picked and packed.',
  partially_picked: 'Part of your order has been picked — the rest is on its way.',
  packed: 'Your order has been packed and is awaiting pickup.',
  assigned: 'A delivery partner has been assigned to your order.',
  picked_up: 'Your order has been picked up and will be out for delivery shortly.',
  out_for_delivery: 'Your order is out for delivery.',
  delivery_failed: 'We could not deliver your order. Our team will follow up shortly.',
  delivered: 'Your order has been delivered. Enjoy!',
  cancelled: 'Your order has been cancelled.',
  returned: 'Your order has been marked as returned.',
};

const HANDOVER_OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 5);
const MAX_HANDOVER_OTP_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS || 5);
// QR tokens aren't a short digit code someone might brute-force by hand like an OTP, so there's
// no attempts cap here — just a longer expiry window than the OTP (the picker's screen may sit
// displayed for a while before the delivery partner physically arrives to scan it).
const HANDOVER_QR_EXPIRY_MINUTES = Number(process.env.HANDOVER_QR_EXPIRY_MINUTES || 60);

function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function generateOtpCode() {
  if (process.env.OTP_FIXED_CODE) return process.env.OTP_FIXED_CODE;
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// A secure opaque token, not customer data, to embed in the handover QR code (see
// order.model.js#handoverQrToken).
function generateQrToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Ensures `order` has a live (non-expired) handover OTP, generating a fresh one if there isn't
// one yet or the existing one has expired. Returns the code only when it actually generated a
// new one, so callers can tell "freshly generated" apart from "already had a valid one" without
// re-reading the field. Caller is responsible for persisting (order.save()).
function ensureHandoverOtp(order) {
  const expired = !order.handoverOtp || !order.handoverOtpExpiresAt || order.handoverOtpExpiresAt < new Date();
  if (!expired) return null;
  order.handoverOtp = generateOtpCode();
  order.handoverOtpExpiresAt = new Date(Date.now() + HANDOVER_OTP_EXPIRY_MINUTES * 60 * 1000);
  order.handoverOtpAttempts = 0;
  return order.handoverOtp;
}

// Same idea as ensureHandoverOtp, for the QR alternative — see order.model.js#handoverQrToken.
function ensureHandoverQrToken(order) {
  const expired = !order.handoverQrToken || !order.handoverQrTokenExpiresAt || order.handoverQrTokenExpiresAt < new Date();
  if (!expired) return null;
  order.handoverQrToken = generateQrToken();
  order.handoverQrTokenExpiresAt = new Date(Date.now() + HANDOVER_QR_EXPIRY_MINUTES * 60 * 1000);
  return order.handoverQrToken;
}

// Validates the code the Delivery Boy enters against the Picker's handover OTP. On success this
// is the ONLY path that transitions an order to 'picked_up' (see TRANSITIONS above) — the mobile
// app itself never sets that status directly, the backend does after verifying here.
async function verifyHandoverOtp({ order, code, changedBy }) {
  if (!order.handoverOtp) return { valid: false, reason: 'not_generated' };
  if (order.handoverOtpExpiresAt < new Date()) return { valid: false, reason: 'expired' };
  if (order.handoverOtpAttempts >= MAX_HANDOVER_OTP_ATTEMPTS) return { valid: false, reason: 'max_attempts' };

  if (order.handoverOtp !== String(code)) {
    order.handoverOtpAttempts += 1;
    await order.save();
    const attemptsLeft = MAX_HANDOVER_OTP_ATTEMPTS - order.handoverOtpAttempts;
    return { valid: false, reason: attemptsLeft <= 0 ? 'max_attempts' : 'invalid', attemptsLeft: Math.max(attemptsLeft, 0) };
  }

  // Clear both handover methods on success — QR and OTP verify the same physical handover, so
  // once either one completes it, the other should stop being valid too.
  order.handoverOtp = null;
  order.handoverOtpExpiresAt = null;
  order.handoverQrToken = null;
  order.handoverQrTokenExpiresAt = null;
  await transitionOrder({ order, toStatus: 'picked_up', changedBy, note: 'Handover OTP verified' });
  return { valid: true };
}

// Validates the QR token the Delivery Boy scanned against the Picker's handover QR — the other
// path (alongside verifyHandoverOtp above) that can transition an order to 'picked_up'. Every
// attempt, successful or not, is written to ScannerLog first, so a failed/rejected scan is never
// silently dropped (see the "current implementation" delivery-panel spec, section 9/18).
async function verifyHandoverQr({ order, qrToken, scannedBy, userType, deviceId, location }) {
  let reason = null;
  if (!order.handoverQrToken) reason = 'not_generated';
  else if (order.handoverQrTokenExpiresAt < new Date()) reason = 'expired';
  else if (order.handoverQrToken !== qrToken) reason = 'invalid';

  await ScannerLog.create({
    order: order._id,
    qrType: 'handover',
    qrToken: qrToken || null,
    scannedBy,
    userType,
    deviceId: deviceId || null,
    location: location || undefined,
    status: reason ? 'failed' : 'success',
    failureReason: reason,
  });

  if (reason) return { valid: false, reason };

  order.handoverQrToken = null;
  order.handoverQrTokenExpiresAt = null;
  order.handoverOtp = null;
  order.handoverOtpExpiresAt = null;
  await transitionOrder({ order, toStatus: 'picked_up', changedBy: scannedBy, note: 'Handover QR scanned' });
  return { valid: true };
}

async function transitionOrder({ order, toStatus, changedBy, note }) {
  const allowed = TRANSITIONS[order.orderStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new ApiError(400, `Cannot move order from '${order.orderStatus}' to '${toStatus}'`);
  }

  order.orderStatus = toStatus;
  if (toStatus === 'delivered') order.deliveredAt = new Date();
  if (toStatus === 'picked_up') order.pickerHandoverAt = order.pickerHandoverAt || new Date();

  // Generate the customer hand-off PIN and both handover methods (OTP + QR) as soon as a
  // delivery partner is assigned. The PIN is collected from the customer at the doorstep to
  // confirm delivery; the OTP/QR are used by the Picker and Delivery Boy at pickup time —
  // whichever one is used first completes the handover (see verifyHandoverOtp/verifyHandoverQr).
  let pin = null;
  if (toStatus === 'assigned' && !order.deliveryPin) {
    pin = generatePin();
    order.deliveryPin = pin;
  }
  const handoverOtp = toStatus === 'assigned' ? ensureHandoverOtp(order) : null;
  if (toStatus === 'assigned') ensureHandoverQrToken(order);

  order.statusLogs.push({ status: toStatus, changedBy, note });
  await order.save();

  emitOrderEvent(order._id.toString(), 'order:status', { orderId: order._id, status: toStatus, note });

  const message = STATUS_MESSAGES[toStatus];
  if (message) {
    await notifyUser(order.customer, {
      title: `Order ${order.orderNumber}`,
      body: pin ? `${message} Share this PIN with the delivery partner to confirm delivery: ${pin}` : message,
      type: 'order_status',
      data: { orderId: order._id, status: toStatus, ...(pin ? { deliveryPin: pin } : {}) },
    });
  }

  // Any picker who worked this order can hand it over (see getHandoverOtp/getHandoverQr's
  // authorization, which checks pickTasks the same way) — notify all of them, not just one.
  if (handoverOtp && order.pickTasks?.length) {
    const pickerIds = [...new Set(order.pickTasks.map((t) => t.picker.toString()))];
    await Promise.all(pickerIds.map((pickerId) => notifyUser(pickerId, {
      title: `Order ${order.orderNumber}`,
      body: `Give this handover OTP to the delivery partner when they arrive: ${handoverOtp}`,
      type: 'handover_otp',
      data: { orderId: order._id, handoverOtp },
    })));
  }

  return order;
}

// Called after a picker marks their own pickTask 'completed' (see picker.controller.js#completeMyPicking)
// or after a hub handoff is verified (see verifyHandoffOtp below). Rolls the order-level status up:
// the first completion (with others still pending) moves the order to 'partially_picked'; it only
// reaches 'packed' once every pickTask is done picking AND, for a cart that spanned multiple
// stores, every non-hub store's picker has handed their portion off at the hub (handoffStatus) —
// "fully picked" and "ready for dispatch" are the same automatic transition for a single-store
// order, but for a multi-store one, dispatch also needs consolidation to have actually happened.
async function advancePickingStatus({ order, changedBy }) {
  const allCompleted = order.pickTasks.every((t) => t.status === 'completed');
  const allHandedOff = order.pickTasks.every((t) => t.handoffStatus !== 'pending');
  const anyCompleted = order.pickTasks.some((t) => t.status === 'completed');

  if (allCompleted && allHandedOff && order.orderStatus !== 'packed') {
    await transitionOrder({ order, toStatus: 'packed', changedBy, note: 'All pickers completed and consolidated at the hub — order packed' });
  } else if (anyCompleted && order.orderStatus === 'picking') {
    await transitionOrder({ order, toStatus: 'partially_picked', changedBy, note: 'Some pickers completed' });
  }
}

// Ensures `task` (a non-hub pickTask, i.e. handoffStatus !== 'not_required') has a live handoff
// OTP for its picker to read out to whoever receives it at the hub — same idea as
// ensureHandoverOtp above, just scoped to one pickTask instead of the whole order. Returns the
// code only when it actually generated a new one. Caller is responsible for persisting (order.save()).
function ensureHandoffOtp(task) {
  const expired = !task.handoffOtp || !task.handoffOtpExpiresAt || task.handoffOtpExpiresAt < new Date();
  if (!expired) return null;
  task.handoffOtp = generateOtpCode();
  task.handoffOtpExpiresAt = new Date(Date.now() + HANDOVER_OTP_EXPIRY_MINUTES * 60 * 1000);
  task.handoffOtpAttempts = 0;
  return task.handoffOtp;
}

// Validates the code a hub-store picker was given by another store's picker in person. Finds
// whichever pending pickTask it belongs to (the receiving picker doesn't need to know in advance
// which store it's from) — on success marks that task handed off and re-runs advancePickingStatus,
// since this may be the last thing the order was waiting on to reach 'packed'.
async function verifyHandoffOtp({ order, code, changedBy }) {
  const candidates = order.pickTasks.filter((t) => t.handoffStatus === 'pending' && t.handoffOtp);
  if (!candidates.length) return { valid: false, reason: 'not_generated' };

  const task = candidates.find((t) => t.handoffOtp === String(code));
  if (!task) {
    // Attribute the failed attempt to every candidate task so a max-attempts lockout can't be
    // dodged by spreading guesses across them — same spirit as the single-OTP case, just fanned out.
    candidates.forEach((t) => { t.handoffOtpAttempts += 1; });
    await order.save();
    const attemptsLeft = Math.max(...candidates.map((t) => MAX_HANDOVER_OTP_ATTEMPTS - t.handoffOtpAttempts));
    if (candidates.some((t) => t.handoffOtpExpiresAt < new Date())) return { valid: false, reason: 'expired' };
    return { valid: false, reason: attemptsLeft <= 0 ? 'max_attempts' : 'invalid', attemptsLeft: Math.max(attemptsLeft, 0) };
  }

  if (task.handoffOtpExpiresAt < new Date()) return { valid: false, reason: 'expired' };
  if (task.handoffOtpAttempts >= MAX_HANDOVER_OTP_ATTEMPTS) return { valid: false, reason: 'max_attempts' };

  task.handoffStatus = 'delivered_to_hub';
  task.handoffAt = new Date();
  task.handoffOtp = null;
  task.handoffOtpExpiresAt = null;
  await order.save();

  await advancePickingStatus({ order, changedBy });
  return { valid: true, task };
}

module.exports = {
  transitionOrder,
  TRANSITIONS,
  ensureHandoverOtp,
  verifyHandoverOtp,
  ensureHandoverQrToken,
  verifyHandoverQr,
  advancePickingStatus,
  ensureHandoffOtp,
  verifyHandoffOtp,
};
