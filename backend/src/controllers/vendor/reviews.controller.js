const { Review, Vendor } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');

const listReviews = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ user: req.user.id });
  if (!vendor) throw new ApiError(404, 'Vendor profile not found');

  const { page, limit, offset } = getPagination(req.query);

  const [rows, count] = await Promise.all([
    Review.find({ vendor: vendor._id })
      .populate('customer', 'name')
      .populate('store', 'name')
      .populate('product', 'name')
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit),
    Review.countDocuments({ vendor: vendor._id }),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

module.exports = { listReviews };
