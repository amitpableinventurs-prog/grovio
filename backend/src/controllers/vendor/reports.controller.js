const mongoose = require('mongoose');
const { Order, Vendor } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');

async function getVendorId(userId) {
  const vendor = await Vendor.findOne({ user: userId });
  if (!vendor) throw new ApiError(404, 'Vendor profile not found');
  return vendor._id;
}

// GET /vendor/reports/sales?from=&to=&storeId=
const salesReport = catchAsync(async (req, res) => {
  const vendorId = await getVendorId(req.user.id);
  const { from, to, storeId } = req.query;

  const match = { vendor: vendorId, orderStatus: 'delivered' };
  if (storeId) match.store = new mongoose.Types.ObjectId(storeId);
  if (from || to) {
    match.deliveredAt = {};
    if (from) match.deliveredAt.$gte = new Date(from);
    if (to) match.deliveredAt.$lte = new Date(to);
  }

  const [summary] = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$grandTotal' },
        totalItemSales: { $sum: '$itemTotal' },
      },
    },
  ]);

  const topProducts = await Order.aggregate([
    { $match: match },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        name: { $first: '$items.nameSnapshot' },
        qtySold: { $sum: '$items.qty' },
        revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } },
      },
    },
    { $sort: { qtySold: -1 } },
    { $limit: 10 },
  ]);

  new ApiResponse(200, {
    totalOrders: summary?.totalOrders || 0,
    totalRevenue: summary?.totalRevenue || 0,
    totalItemSales: summary?.totalItemSales || 0,
    topProducts,
  }).send(res);
});

module.exports = { salesReport };
