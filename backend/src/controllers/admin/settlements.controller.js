const { Order, Vendor, Settlement } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { debitWallet } = require('../../services/payment.service');
const { notifyUser } = require('../../services/notification.service');
const { logAdminActivity } = require('../../services/audit.service');

// POST /admin/settlements/generate  { vendorId, from, to }
// Bundles all not-yet-settled delivered orders for a vendor in a date range into a payable settlement record.
const generateVendorSettlement = catchAsync(async (req, res) => {
  const { vendorId, from, to } = req.body;

  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw new ApiError(404, 'Vendor not found');

  const where = {
    vendor: vendorId,
    orderStatus: 'delivered',
    settled: false,
  };
  if (from || to) {
    where.deliveredAt = {};
    if (from) where.deliveredAt.$gte = new Date(from);
    if (to) where.deliveredAt.$lte = new Date(to);
  }

  const orders = await Order.find(where);
  if (!orders.length) throw new ApiError(400, 'No unsettled delivered orders found for this vendor in this period');

  const grossAmount = orders.reduce((sum, o) => sum + Number(o.itemTotal), 0);
  const commissionAmount = Number(((grossAmount * Number(vendor.commissionPercent)) / 100).toFixed(2));
  const payoutAmount = Number((grossAmount - commissionAmount).toFixed(2));

  const settlement = await Settlement.create({
    payeeRole: 'vendor',
    payeeUser: vendor.user,
    vendor: vendor._id,
    periodFrom: from ? new Date(from) : orders[0].deliveredAt,
    periodTo: to ? new Date(to) : new Date(),
    orderCount: orders.length,
    grossAmount,
    commissionAmount,
    payoutAmount,
    status: 'pending',
  });

  await Order.updateMany(
    { _id: { $in: orders.map((o) => o._id) } },
    { settled: true, settlementId: settlement._id }
  );

  await logAdminActivity({
    adminId: req.user.id,
    action: 'settlement.generate',
    entityType: 'Settlement',
    entityId: settlement._id,
    metadata: { vendorId, orderCount: orders.length, payoutAmount },
  });

  new ApiResponse(201, settlement, 'Settlement generated').send(res);
});

const listSettlements = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status, payeeRole, vendorId } = req.query;

  const where = {};
  if (status) where.status = status;
  if (payeeRole) where.payeeRole = payeeRole;
  if (vendorId) where.vendor = vendorId;

  const [rows, count] = await Promise.all([
    Settlement.find(where)
      .populate('payeeUser', 'name phone email')
      .populate('vendor', 'businessName')
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit),
    Settlement.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// PATCH /admin/settlements/:id/pay  -> marks paid and debits the payee's wallet by the payout amount
const markSettlementPaid = catchAsync(async (req, res) => {
  const settlement = await Settlement.findById(req.params.id);
  if (!settlement) throw new ApiError(404, 'Settlement not found');
  if (settlement.status === 'paid') throw new ApiError(400, 'Settlement is already marked as paid');

  await debitWallet({
    userId: settlement.payeeUser,
    amount: settlement.payoutAmount,
    reason: `Settlement payout (${settlement.periodFrom.toISOString().slice(0, 10)} to ${settlement.periodTo.toISOString().slice(0, 10)})`,
    refOrderId: null,
  });

  settlement.status = 'paid';
  settlement.paidAt = new Date();
  await settlement.save();

  await logAdminActivity({
    adminId: req.user.id,
    action: 'settlement.pay',
    entityType: 'Settlement',
    entityId: settlement._id,
    metadata: { payoutAmount: settlement.payoutAmount },
  });

  await notifyUser(settlement.payeeUser, {
    title: 'Payout processed',
    body: `Your settlement of ${settlement.payoutAmount} has been paid out.`,
    type: 'settlement_paid',
    data: { settlementId: settlement._id },
  });

  new ApiResponse(200, settlement, 'Settlement marked as paid').send(res);
});

module.exports = { generateVendorSettlement, listSettlements, markSettlementPaid };
