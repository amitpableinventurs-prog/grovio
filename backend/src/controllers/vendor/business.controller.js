const { Vendor, Store, Order, Product, Wallet, WalletTransaction } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');

async function getVendor(userId) {
  const vendor = await Vendor.findOne({ user: userId });
  if (!vendor) throw new ApiError(404, 'Vendor profile not found');
  return vendor;
}

const getBusinessProfile = catchAsync(async (req, res) => {
  const vendor = await getVendor(req.user.id);
  new ApiResponse(200, vendor).send(res);
});

const updateBusinessProfile = catchAsync(async (req, res) => {
  const vendor = await getVendor(req.user.id);
  const { businessName } = req.body;
  if (req.files?.documents) vendor.documents = req.files.documents.map((f) => `/uploads/${f.filename}`);
  if (businessName !== undefined) vendor.businessName = businessName;
  await vendor.save();
  new ApiResponse(200, vendor, 'Business profile updated').send(res);
});

// GET /vendor/dashboard  -> KPIs aggregated across all of this vendor's stores
const getDashboard = catchAsync(async (req, res) => {
  const vendor = await getVendor(req.user.id);
  const storeIds = (await Store.find({ vendor: vendor._id }).select('_id')).map((s) => s._id);

  const [totalStores, totalProducts, pendingOrders, activeOrders, deliveredAgg] = await Promise.all([
    Store.countDocuments({ vendor: vendor._id }),
    Product.countDocuments({ store: { $in: storeIds } }),
    Order.countDocuments({ vendor: vendor._id, orderStatus: 'placed' }),
    Order.countDocuments({ vendor: vendor._id, orderStatus: { $in: ['accepted', 'picking', 'packed', 'assigned', 'out_for_delivery'] } }),
    Order.aggregate([
      { $match: { vendor: vendor._id, orderStatus: 'delivered' } },
      { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: '$grandTotal' } } },
    ]),
  ]);

  new ApiResponse(200, {
    totalStores,
    totalProducts,
    pendingOrders,
    activeOrders,
    deliveredOrders: deliveredAgg[0]?.totalOrders || 0,
    totalRevenue: deliveredAgg[0]?.totalRevenue || 0,
  }).send(res);
});

const getEarnings = catchAsync(async (req, res) => {
  const wallet = await Wallet.findOne({ user: req.user.id });
  const transactions = await WalletTransaction.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(50);
  new ApiResponse(200, { balance: wallet ? wallet.balance : 0, transactions }).send(res);
});

module.exports = { getBusinessProfile, updateBusinessProfile, getDashboard, getEarnings };
