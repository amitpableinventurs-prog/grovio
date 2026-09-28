const QRCode = require('qrcode');
const { Order } = require('../models');
const ApiError = require('../utils/apiError');
const { getSetting } = require('./settings.service');

// "Collect ₹228 via UPI — Payment goes directly to Grovio": the Drop order screen shows a UPI QR
// for a cash-on-delivery order, so the customer pays the company, not the delivery partner.
//   razorpay  single-use Razorpay UPI QR for the exact amount — we can check it was paid, and the
//             partner can then complete the delivery with collectionMethod 'upi'
//   static    plain UPI QR to the company's VPA (setting upiVpa) when Razorpay isn't set up — it
//             can't be checked automatically, the partner confirms it
// Otherwise the partner collects cash as before.

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const QR_MINUTES = 120;

async function brandName() {
  return (await getSetting('upiPayeeName', 'UPI_PAYEE_NAME')) || 'Grovio';
}

async function createRazorpayQr(order, amount) {
  const { getRazorpayInstance } = require('../config/razorpay');
  const razorpay = await getRazorpayInstance();
  if (!razorpay) return null;
  const qr = await razorpay.qrCode.create({
    type: 'upi_qr',
    name: (await brandName()).slice(0, 40),
    usage: 'single_use',
    fixed_amount: true,
    payment_amount: Math.round(amount * 100),
    description: `Order ${order.orderNumber}`,
    close_by: Math.floor(Date.now() / 1000) + QR_MINUTES * 60,
    notes: { orderId: String(order._id), orderNumber: order.orderNumber, purpose: 'cod_collection' },
  });
  return { provider: 'razorpay', id: qr.id, imageUrl: qr.image_url, upiString: null, amount, closeBy: new Date(qr.close_by * 1000) };
}

async function createStaticQr(order, amount) {
  const vpa = await getSetting('upiVpa', 'UPI_VPA');
  if (!vpa) return null;
  const params = new URLSearchParams({ pa: vpa, pn: await brandName(), am: amount.toFixed(2), cu: 'INR', tn: `Order ${order.orderNumber}`, tr: order.orderNumber });
  return { provider: 'static', id: null, imageUrl: null, upiString: `upi://pay?${params.toString()}`, amount, closeBy: null };
}

async function findOrder(riderId, orderId) {
  const order = await Order.findOne({ _id: orderId, delivery: riderId }).select('orderNumber orderStatus paymentMethod paymentStatus grandTotal upiQr');
  if (!order) throw new ApiError(404, 'Order not found or not assigned to you');
  return order;
}

// Has the Razorpay QR been paid? Records it on the order when it has.
async function refreshPaid(order) {
  const qr = order.upiQr;
  if (!qr || qr.provider !== 'razorpay' || qr.paidAt) return !!qr?.paidAt;
  const { getRazorpayInstance } = require('../config/razorpay');
  const razorpay = await getRazorpayInstance();
  if (!razorpay) return false;
  const res = await razorpay.qrCode.fetchAllPayments(qr.id, {});
  const paid = (res.items || []).filter((p) => ['captured', 'authorized'].includes(p.status));
  const total = paid.reduce((s, p) => s + p.amount, 0) / 100;
  if (total + 0.001 < qr.amount) return false;
  order.upiQr.paidAt = new Date();
  order.upiQr.paymentId = paid[0]?.id || null;
  await Order.updateOne({ _id: order._id }, { $set: { 'upiQr.paidAt': order.upiQr.paidAt, 'upiQr.paymentId': order.upiQr.paymentId } });
  return true;
}

function view(order, paid) {
  const qr = order.upiQr;
  return {
    orderId: order._id,
    orderNumber: order.orderNumber,
    amount: qr?.amount ?? round2(order.grandTotal),
    title: `Collect ₹${qr?.amount ?? round2(order.grandTotal)} via UPI`,
    qr: qr ? {
      provider: qr.provider,
      // razorpay: an image URL; static: render qrDataUrl (or open upiString on the phone).
      imageUrl: qr.imageUrl,
      upiString: qr.upiString,
      expiresAt: qr.closeBy,
    } : null,
    // Only a Razorpay QR can be confirmed automatically.
    verifiable: qr?.provider === 'razorpay',
    paid,
  };
}

// GET /delivery/jobs/:id/collect — the Drop order screen's UPI QR (made once, then reused).
async function collectInfo(riderId, orderId) {
  const order = await findOrder(riderId, orderId);
  if (order.paymentMethod !== 'COD') throw new ApiError(400, 'This order is prepaid — nothing to collect');
  if (!['picked_up', 'out_for_delivery'].includes(order.orderStatus)) throw new ApiError(400, 'Collect payment at the customer’s door');
  const amount = round2(order.grandTotal);

  const stillValid = order.upiQr && order.upiQr.amount === amount && (!order.upiQr.closeBy || order.upiQr.closeBy > new Date(Date.now() + 5 * 60000));
  if (!stillValid) {
    let qr = null;
    try {
      qr = await createRazorpayQr(order, amount);
    } catch (err) {
      console.warn(`Razorpay UPI QR for ${order.orderNumber} failed, trying static UPI:`, err?.error?.description || err.message);
    }
    if (!qr) qr = await createStaticQr(order, amount);
    if (!qr) throw new ApiError(503, 'UPI collection is not set up. Collect cash.');
    order.upiQr = qr;
    await Order.updateOne({ _id: order._id }, { $set: { upiQr: { ...qr, createdAt: new Date() } } });
  }
  const result = view(order, await refreshPaid(order).catch(() => false));
  result.subtitle = `Payment goes directly to ${await brandName()}`;
  if (order.upiQr.provider === 'static') result.qr.qrDataUrl = await QRCode.toDataURL(order.upiQr.upiString, { margin: 1, width: 360 });
  return result;
}

// GET /delivery/jobs/:id/collect/status — poll while the customer pays.
async function collectStatus(riderId, orderId) {
  const order = await findOrder(riderId, orderId);
  return view(order, await refreshPaid(order).catch(() => false));
}

// completeJob with collectionMethod 'upi': when a Razorpay QR was shown, it must be paid.
// Returns the gateway payment id (or null).
async function assertUpiPaid(order) {
  if (order.upiQr?.provider !== 'razorpay') return null;
  if (!(await refreshPaid(order).catch(() => false))) {
    throw new ApiError(400, 'UPI payment not received yet. Ask the customer to scan the QR, or collect cash.');
  }
  return order.upiQr.paymentId;
}

module.exports = { collectInfo, collectStatus, assertUpiPaid };
