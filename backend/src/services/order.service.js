const crypto = require('crypto');
const { ScannerLog } = require('../models');
const { emitOrderEvent } = require('../sockets');
const { notifyUser } = require('./notification.service');
const ApiError = require('../utils/apiError');

// Allowed forward transitions. Cancellation is handled separately (allowed from most pre-delivery states).
// 'assigned' -> 'picked_up' is gated behind every pickTask's pickup being verified (see
// verifyPickupOtp/verifyPickupQr and advanceAfterPickup below) — there is no other path to
// 'picked_up', per the business rule that the delivery app must never self-report a pickup
// without backend validation.
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

// A secure opaque token, not customer data, to embed in a pickup QR code (see
// order.model.js#pickTaskSchema.pickupQrToken).
function generateQrToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Ensures `task` (one pickTask, i.e. one pickup point/store) has a live pickup OTP for its
// picker to read out to the delivery partner in person when they arrive at that store. Returns
// the code only when it actually generated a new one, so callers can tell "freshly generated"
// apart from "already had a valid one" without re-reading the field. Caller is responsible for
// persisting (order.save()).
function ensurePickupOtp(task) {
  const expired = !task.pickupOtp || !task.pickupOtpExpiresAt || task.pickupOtpExpiresAt < new Date();
  if (!expired) return null;
  task.pickupOtp = generateOtpCode();
  task.pickupOtpExpiresAt = new Date(Date.now() + HANDOVER_OTP_EXPIRY_MINUTES * 60 * 1000);
  task.pickupOtpAttempts = 0;
  return task.pickupOtp;
}

// Same idea as ensurePickupOtp, for the QR alternative.
function ensurePickupQrToken(task) {
  const expired = !task.pickupQrToken || !task.pickupQrTokenExpiresAt || task.pickupQrTokenExpiresAt < new Date();
  if (!expired) return null;
  task.pickupQrToken = generateQrToken();
  task.pickupQrTokenExpiresAt = new Date(Date.now() + HANDOVER_QR_EXPIRY_MINUTES * 60 * 1000);
  return task.pickupQrToken;
}

// Validates the code the Delivery Boy enters against ONE specific pickTask's pickup OTP — i.e.
// confirms collection from that one store. Every pickup point is verified independently; the
// order only reaches 'picked_up' once all of them are (see advanceAfterPickup below).
async function verifyPickupOtp({ order, taskId, code, changedBy }) {
  const task = order.pickTasks.id(taskId);
  if (!task) return { valid: false, reason: 'not_found' };
  if (task.pickedUpAt) return { valid: false, reason: 'already_picked_up' };
  if (!task.pickupOtp) return { valid: false, reason: 'not_generated' };
  if (task.pickupOtpExpiresAt < new Date()) return { valid: false, reason: 'expired' };
  if (task.pickupOtpAttempts >= MAX_HANDOVER_OTP_ATTEMPTS) return { valid: false, reason: 'max_attempts' };

  if (task.pickupOtp !== String(code)) {
    task.pickupOtpAttempts += 1;
    await order.save();
    const attemptsLeft = MAX_HANDOVER_OTP_ATTEMPTS - task.pickupOtpAttempts;
    return { valid: false, reason: attemptsLeft <= 0 ? 'max_attempts' : 'invalid', attemptsLeft: Math.max(attemptsLeft, 0) };
  }

  // Clear both pickup methods on success — QR and OTP verify the same physical pickup, so once
  // either one completes it, the other should stop being valid too.
  task.pickedUpAt = new Date();
  task.pickupOtp = null;
  task.pickupOtpExpiresAt = null;
  task.pickupQrToken = null;
  task.pickupQrTokenExpiresAt = null;
  await order.save();

  await advanceAfterPickup({ order, changedBy });
  return { valid: true, task };
}

// Validates the QR token the Delivery Boy scanned against ONE specific pickTask's pickup QR —
// the other path (alongside verifyPickupOtp above) that can confirm a single pickup point. Every
// attempt, successful or not, is written to ScannerLog first, so a failed/rejected scan is never
// silently dropped.
async function verifyPickupQr({ order, taskId, qrToken, scannedBy, deviceId, location }) {
  const task = order.pickTasks.id(taskId);

  let reason = null;
  if (!task) reason = 'not_found';
  else if (task.pickedUpAt) reason = 'already_picked_up';
  else if (!task.pickupQrToken) reason = 'not_generated';
  else if (task.pickupQrTokenExpiresAt < new Date()) reason = 'expired';
  else if (task.pickupQrToken !== qrToken) reason = 'invalid';

  await ScannerLog.create({
    order: order._id,
    qrType: 'handover',
    qrToken: qrToken || null,
    scannedBy,
    userType: 'delivery',
    deviceId: deviceId || null,
    location: location || undefined,
    status: reason ? 'failed' : 'success',
    failureReason: reason,
  });

  if (reason) return { valid: false, reason };

  task.pickedUpAt = new Date();
  task.pickupQrToken = null;
  task.pickupQrTokenExpiresAt = null;
  task.pickupOtp = null;
  task.pickupOtpExpiresAt = null;
  await order.save();

  await advanceAfterPickup({ order, changedBy: scannedBy });
  return { valid: true, task };
}

// Once every pickTask (every pickup point) has been collected by the delivery partner, the order
// moves 'assigned' -> 'picked_up' — the whole multi-stop collection run is complete and the
// partner can now head to the customer. Called after each individual pickup is verified.
async function advanceAfterPickup({ order, changedBy }) {
  const allPickedUp = order.pickTasks.every((t) => t.pickedUpAt);
  if (allPickedUp && order.orderStatus === 'assigned') {
    await transitionOrder({ order, toStatus: 'picked_up', changedBy, note: 'All pickup points collected' });
  }
}

async function transitionOrder({ order, toStatus, changedBy, note }) {
  const allowed = TRANSITIONS[order.orderStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new ApiError(400, `Cannot move order from '${order.orderStatus}' to '${toStatus}'`);
  }

  order.orderStatus = toStatus;
  if (toStatus === 'delivered') order.deliveredAt = new Date();
  if (toStatus === 'picked_up') order.pickerHandoverAt = order.pickerHandoverAt || new Date();

  // Generate the customer hand-off PIN, and a pickup OTP+QR per pickup point, as soon as a
  // delivery partner is assigned. Every pickTask is already 'completed' by the time an order
  // reaches 'assigned' (see advancePickingStatus below), so all pickup points get their codes at
  // once here. The PIN is collected from the customer at the doorstep to confirm delivery; each
  // pickup OTP/QR is used by that store's picker and the Delivery Boy when they arrive there —
  // whichever method is used first completes that one pickup (see verifyPickupOtp/verifyPickupQr).
  let pin = null;
  if (toStatus === 'assigned' && !order.deliveryPin) {
    pin = generatePin();
    order.deliveryPin = pin;
  }
  const freshPickupCodes = [];
  if (toStatus === 'assigned') {
    order.pickTasks.forEach((task) => {
      const code = ensurePickupOtp(task);
      ensurePickupQrToken(task);
      if (code) freshPickupCodes.push({ task, code });
    });
  }

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

  // Each pickup point's own picker gets their own code, not a single shared one.
  await Promise.all(freshPickupCodes.map(({ task, code }) => notifyUser(task.picker, {
    title: `Order ${order.orderNumber}`,
    body: `Give this pickup code to the delivery partner when they arrive: ${code}`,
    type: 'pickup_otp',
    data: { orderId: order._id, taskId: task._id, pickupOtp: code },
  })));

  return order;
}

// Called after a picker marks their own pickTask 'completed' (i.e. presses "Ready for Pickup" —
// see picker.controller.js#completeMyPicking). Rolls the order-level status up based on how many
// of the pickTasks are done: the first completion (with others still pending) moves the order to
// 'partially_picked'; the last one moves it straight to 'packed' ("fully ready for pickup") —
// picking is independent per store/picker, so there's nothing else to wait on.
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
  ensurePickupOtp,
  ensurePickupQrToken,
  verifyPickupOtp,
  verifyPickupQr,
  advanceAfterPickup,
  advancePickingStatus,
};
