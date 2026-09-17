const { Coupon } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');

// GET /customer/coupons  -> all active, currently-valid platform coupons
const listAvailableCoupons = catchAsync(async (req, res) => {
  const now = new Date();

  const coupons = await Coupon.find({
    isActive: true,
    $and: [
      { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
      { $or: [{ validTo: null }, { validTo: { $gte: now } }] },
    ],
  });
  new ApiResponse(200, coupons).send(res);
});

module.exports = { listAvailableCoupons };
