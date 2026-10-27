const {
  Order, Payment, Refund, CouponUsage, Review, ScannerLog, IvrCall, VoipCall, PickerError,
  SosAlert, SupportTicket, WalletTransaction, DeliveryTrip, ColdBagIssue,
} = require('../models');

// Deleting orders for good (DELETE /admin/orders/:id, POST /admin/orders/delete). What only exists
// because of the order goes with it: its payments, refunds, coupon usage (so the coupon can be used
// again), review, scanner logs, IVR / masked calls and picker errors. What stands on its own just
// loses the link: SOS alerts, support tickets, and wallet transactions (a wallet's history has to keep
// adding up to its balance). Trips drop the order, and a trip left with no orders is removed.
// Not undone: stock taken when the order was placed (cancelling doesn't return it either), wallet
// money spent on it, and rider pay already paid for a trip.
async function deleteOrders(orderIds) {
  const ids = orderIds;
  const byOrder = { order: { $in: ids } };
  const tripIds = await DeliveryTrip.find({ orders: { $in: ids } }).distinct('_id');

  await Promise.all([
    Payment.deleteMany(byOrder),
    Refund.deleteMany(byOrder),
    CouponUsage.deleteMany(byOrder),
    Review.deleteMany(byOrder),
    ScannerLog.deleteMany(byOrder),
    IvrCall.deleteMany(byOrder),
    VoipCall.deleteMany(byOrder),
    PickerError.deleteMany(byOrder),
    SosAlert.updateMany(byOrder, { order: null }),
    SupportTicket.updateMany(byOrder, { order: null }),
    WalletTransaction.updateMany({ refOrderId: { $in: ids } }, { refOrderId: null }),
    DeliveryTrip.updateMany({ _id: { $in: tripIds } }, { $pull: { orders: { $in: ids } } }),
    ColdBagIssue.updateMany({ orders: { $in: ids } }, { $pull: { orders: { $in: ids } } }),
  ]);
  await DeliveryTrip.deleteMany({ _id: { $in: tripIds }, orders: { $size: 0 } });

  const { deletedCount } = await Order.deleteMany({ _id: { $in: ids } });
  return deletedCount;
}

module.exports = { deleteOrders };
