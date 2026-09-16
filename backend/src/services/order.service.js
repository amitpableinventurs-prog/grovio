const { emitOrderEvent } = require('../sockets');
const { notifyUser } = require('./notification.service');
const ApiError = require('../utils/apiError');

// Allowed forward transitions. Cancellation is handled separately (allowed from most pre-delivery states).
const TRANSITIONS = {
  placed: ['accepted', 'rejected', 'cancelled'],
  accepted: ['picking', 'cancelled'],
  picking: ['packed', 'cancelled'],
  packed: ['assigned', 'cancelled'],
  assigned: ['out_for_delivery', 'cancelled'],
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
  packed: 'Your order has been packed and is awaiting pickup.',
  assigned: 'A delivery partner has been assigned to your order.',
  out_for_delivery: 'Your order is out for delivery.',
  delivery_failed: 'We could not deliver your order. Our team will follow up shortly.',
  delivered: 'Your order has been delivered. Enjoy!',
  cancelled: 'Your order has been cancelled.',
  returned: 'Your order has been marked as returned.',
};

function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

async function transitionOrder({ order, toStatus, changedBy, note }) {
  const allowed = TRANSITIONS[order.orderStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new ApiError(400, `Cannot move order from '${order.orderStatus}' to '${toStatus}'`);
  }

  order.orderStatus = toStatus;
  if (toStatus === 'delivered') order.deliveredAt = new Date();

  // Generate the hand-off PIN as soon as a delivery partner is assigned; the delivery
  // partner must collect this from the customer at the doorstep to confirm delivery.
  let pin = null;
  if (toStatus === 'assigned' && !order.deliveryPin) {
    pin = generatePin();
    order.deliveryPin = pin;
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

  return order;
}

module.exports = { transitionOrder, TRANSITIONS };
