const { Coupon, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');

// GET /customer/coupons?storeId=  -> platform-wide coupons + that store's vendor's own offers (if given)
const listAvailableCoupons = catchAsync(async (req, res) => {
  const { storeId } = req.query;
  const now = new Date();

  let vendorId = null;
  if (storeId) {
    const store = await Store.findById(storeId).select('vendor');
    vendorId = store?.vendor || null;
  }

  const coupons = await Coupon.find({
    isActive: true,
    vendor: vendorId ? { $in: [null, vendorId] } : null,
    $and: [
      { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
      { $or: [{ validTo: null }, { validTo: { $gte: now } }] },
    ],
  });
  new ApiResponse(200, coupons).send(res);
});

module.exports = { listAvailableCoupons };
