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

// Validates the code the Delivery Boy enters against the hub picker's handover OTP. On success
// this is the ONLY path that transitions an order to 'picked_up' (see TRANSITIONS above) — the
// mobile app itself never sets that status directly, the backend does after verifying here.
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

// Validates the QR token the Delivery Boy scanned against the hub picker's handover QR — the
// other path (alongside verifyHandoverOtp above) that can transition an order to 'picked_up'.
// Every attempt, successful or not, is written to ScannerLog first, so a failed/rejected scan is
// never silently dropped.
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
  // confirm delivery; the OTP/QR are used by the hub picker and Delivery Boy at pickup time —
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

  // Auto IVR call for this status, if switched on (services/ivr.service.js). Fire and forget —
  // a telephony problem must never fail the status change itself. Required lazily (cycle).
  require('./ivr.service').triggerOrderEvent(order, toStatus)
    .catch((err) => console.error(`IVR call for ${order.orderNumber} (${toStatus}) failed:`, err.message));

  // Only the hub picker(s) — the ones working order.store — ever meet the delivery partner, so
  // only they need the handover code.
  if (handoverOtp && order.pickTasks?.length) {
    const hubPickerIds = [...new Set(
      order.pickTasks.filter((t) => t.store.toString() === order.store.toString()).map((t) => t.picker.toString())
    )];
    await Promise.all(hubPickerIds.map((pickerId) => notifyUser(pickerId, {
      title: `Order ${order.orderNumber}`,
      body: `Give this handover OTP to the delivery partner when they arrive: ${handoverOtp}`,
      type: 'handover_otp',
      data: { orderId: order._id, handoverOtp },
    })));
  }

  return order;
}

// Called after a picker marks their own pickTask 'completed' (i.e. presses "Ready for Pickup" —
// see picker.controller.js#completeMyPicking). Rolls the order-level status up based on how many
// of the pickTasks are done: the first completion (with others still pending) moves the order to
// 'partially_picked'; the last one moves it straight to 'packed' ("fully ready for pickup").
// Non-hub pickers still need to physically get their portion to the hub (order.store) themselves —
// that hand-off isn't tracked here, it's on the pickers to coordinate.
async function advancePickingStatus({ order, changedBy }) {
  const allCompleted = order.pickTasks.every((t) => t.status === 'completed');
  const anyCompleted = order.pickTasks.some((t) => t.status === 'completed');

  if (allCompleted && order.orderStatus !== 'packed') {
    await transitionOrder({ order, toStatus: 'packed', changedBy, note: 'All pickers completed — order packed' });
  } else if (anyCompleted && order.orderStatus === 'picking') {
    await transitionOrder({ order, toStatus: 'partially_picked', changedBy, note: 'Some pickers completed' });
  }
}

module.exports = {
  transitionOrder,
  TRANSITIONS,
  ensureHandoverOtp,
  verifyHandoverOtp,
  ensureHandoverQrToken,
  verifyHandoverQr,
  advancePickingStatus,
};
