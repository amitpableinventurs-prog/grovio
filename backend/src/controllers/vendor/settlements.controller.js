const { Vendor, Settlement } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');

// GET /vendor/settlements?status=
const listSettlements = catchAsync(async (req, res) => {
  const vendor = await Vendor.findOne({ user: req.user.id });
  if (!vendor) throw new ApiError(404, 'Vendor profile not found');

  const { page, limit, offset } = getPagination(req.query);
  const { status } = req.query;

  const where = { vendor: vendor._id };
  if (status) where.status = status;

  const [rows, count] = await Promise.all([
    Settlement.find(where).sort({ createdAt: -1 }).skip(offset).limit(limit),
    Settlement.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

module.exports = { listSettlements };
