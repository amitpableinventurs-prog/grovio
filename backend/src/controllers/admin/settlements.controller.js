const { Settlement } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { debitWallet } = require('../../services/payment.service');
const { notifyUser } = require('../../services/notification.service');
const { logAdminActivity } = require('../../services/audit.service');

const listSettlements = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status, payeeRole } = req.query;

  const where = {};
  if (status) where.status = status;
  if (payeeRole) where.payeeRole = payeeRole;

  const [rows, count] = await Promise.all([
    Settlement.find(where)
      .populate('payeeUser', 'name phone email')
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

module.exports = { listSettlements, markSettlementPaid };
