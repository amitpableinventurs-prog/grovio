const { Order, Vendor, User, WalletTransaction } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');

// GET /admin/reports/sales?from=&to=
const salesReport = catchAsync(async (req, res) => {
  const { from, to } = req.query;
  const match = { orderStatus: 'delivered' };
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

  new ApiResponse(200, {
    totalOrders: summary?.totalOrders || 0,
    totalRevenue: summary?.totalRevenue || 0,
    totalItemSales: summary?.totalItemSales || 0,
  }).send(res);
});

// GET /admin/reports/vendor-commission
const vendorCommissionReport = catchAsync(async (req, res) => {
  const vendors = await Vendor.find().select('businessName commissionPercent');

  const results = [];
  for (const vendor of vendors) {
    const [summary] = await Order.aggregate([
      { $match: { vendor: vendor._id, orderStatus: 'delivered' } },
      { $group: { _id: null, totalSales: { $sum: '$grandTotal' }, totalOrders: { $sum: 1 } } },
    ]);

    const totalSales = summary?.totalSales || 0;
    results.push({
      vendorId: vendor._id,
      businessName: vendor.businessName,
      totalOrders: summary?.totalOrders || 0,
      totalSales,
      commissionPercent: vendor.commissionPercent,
      commissionAmount: Number(((totalSales * vendor.commissionPercent) / 100).toFixed(2)),
      payoutAmount: Number((totalSales - (totalSales * vendor.commissionPercent) / 100).toFixed(2)),
    });
  }

  new ApiResponse(200, results).send(res);
});

// GET /admin/reports/products?limit=20  -> best-sellers platform-wide
const productReport = catchAsync(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const topProducts = await Order.aggregate([
    { $match: { orderStatus: 'delivered' } },
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
    { $limit: limit },
  ]);

  new ApiResponse(200, topProducts).send(res);
});

// GET /admin/reports/customers?limit=20  -> top customers by spend
const customerReport = catchAsync(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const topCustomers = await Order.aggregate([
    { $match: { orderStatus: 'delivered' } },
    { $group: { _id: '$customer', totalOrders: { $sum: 1 }, totalSpend: { $sum: '$grandTotal' } } },
    { $sort: { totalSpend: -1 } },
    { $limit: limit },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'customer' } },
    { $unwind: '$customer' },
    { $project: { customerId: '$_id', name: '$customer.name', phone: '$customer.phone', totalOrders: 1, totalSpend: 1, _id: 0 } },
  ]);

  new ApiResponse(200, topCustomers).send(res);
});

// GET /admin/reports/delivery-partners  -> completed deliveries + earnings per partner
const deliveryReport = catchAsync(async (req, res) => {
  const results = await Order.aggregate([
    { $match: { orderStatus: 'delivered', delivery: { $ne: null } } },
    { $group: { _id: '$delivery', totalDeliveries: { $sum: 1 }, totalDeliveryFees: { $sum: '$deliveryFee' } } },
    { $sort: { totalDeliveries: -1 } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'partner' } },
    { $unwind: '$partner' },
    { $project: { deliveryPartnerId: '$_id', name: '$partner.name', phone: '$partner.phone', totalDeliveries: 1, totalDeliveryFees: 1, _id: 0 } },
  ]);

  new ApiResponse(200, results).send(res);
});

module.exports = { salesReport, vendorCommissionReport, productReport, customerReport, deliveryReport };
