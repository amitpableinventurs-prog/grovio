const { Coupon } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');

const createCoupon = catchAsync(async (req, res) => {
  const coupon = await Coupon.create(req.body);
  new ApiResponse(201, coupon, 'Coupon created').send(res);
});

const listCoupons = catchAsync(async (req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 });
  new ApiResponse(200, coupons).send(res);
});

const updateCoupon = catchAsync(async (req, res) => {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!coupon) throw new ApiError(404, 'Coupon not found');
  new ApiResponse(200, coupon, 'Coupon updated').send(res);
});

const deleteCoupon = catchAsync(async (req, res) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) throw new ApiError(404, 'Coupon not found');
  new ApiResponse(200, null, 'Coupon deleted').send(res);
});

module.exports = { createCoupon, listCoupons, updateCoupon, deleteCoupon };
