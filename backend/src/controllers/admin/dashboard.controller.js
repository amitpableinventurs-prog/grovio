const { Order, User, Vendor, Store, Product, PickerProfile, DeliveryProfile } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');

const getStats = catchAsync(async (req, res) => {
  const [
    totalOrders,
    totalCustomers,
    totalVendors,
    pendingVendors,
    activeStores,
    activePickers,
    activeDeliveryPartners,
    totalProducts,
    deliveredOrders,
    cancelledOrders,
    gmvAgg,
  ] = await Promise.all([
    Order.countDocuments(),
    User.countDocuments({ role: 'customer' }),
    User.countDocuments({ role: 'vendor' }),
    Vendor.countDocuments({ status: 'pending' }),
    Store.countDocuments({ status: 'active' }),
    PickerProfile.countDocuments({ status: 'approved', isAvailable: true }),
    DeliveryProfile.countDocuments({ status: 'approved', isAvailable: true }),
    Product.countDocuments(),
    Order.countDocuments({ orderStatus: 'delivered' }),
    Order.countDocuments({ orderStatus: 'cancelled' }),
    Order.aggregate([
      { $match: { orderStatus: { $nin: ['rejected', 'cancelled'] } } },
      { $group: { _id: null, gmv: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
    ]),
  ]);

  const gmv = gmvAgg[0]?.gmv || 0;
  const gmvOrderCount = gmvAgg[0]?.count || 0;

  new ApiResponse(200, {
    totalOrders,
    totalCustomers,
    totalVendors,
    pendingVendors,
    activeStores,
    activePickers,
    activeDeliveryPartners,
    totalProducts,
    deliveredOrders,
    cancelledOrders,
    gmv,
    averageOrderValue: gmvOrderCount ? Number((gmv / gmvOrderCount).toFixed(2)) : 0,
  }).send(res);
});

module.exports = { getStats };
