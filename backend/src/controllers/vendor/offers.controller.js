const { Coupon, Vendor } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');

async function getVendorId(userId) {
  const vendor = await Vendor.findOne({ user: userId });
  if (!vendor) throw new ApiError(404, 'Vendor profile not found');
  return vendor._id;
}

// POST /vendor/offers  { code, discountType, discountValue, minOrderAmount, maxDiscount, validFrom, validTo, usageLimit, perUserLimit }
const createOffer = catchAsync(async (req, res) => {
  const vendorId = await getVendorId(req.user.id);
  const offer = await Coupon.create({ ...req.body, vendor: vendorId });
  new ApiResponse(201, offer, 'Offer created').send(res);
});

const listOffers = catchAsync(async (req, res) => {
  const vendorId = await getVendorId(req.user.id);
  const offers = await Coupon.find({ vendor: vendorId }).sort({ createdAt: -1 });
  new ApiResponse(200, offers).send(res);
});

async function findOwnedOffer(req) {
  const vendorId = await getVendorId(req.user.id);
  const offer = await Coupon.findOne({ _id: req.params.id, vendor: vendorId });
  if (!offer) throw new ApiError(404, 'Offer not found');
  return offer;
}

const updateOffer = catchAsync(async (req, res) => {
  const offer = await findOwnedOffer(req);
  const fields = ['discountType', 'discountValue', 'minOrderAmount', 'maxDiscount', 'validFrom', 'validTo', 'usageLimit', 'perUserLimit', 'isActive'];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) offer[f] = req.body[f];
  });
  await offer.save();
  new ApiResponse(200, offer, 'Offer updated').send(res);
});

const deleteOffer = catchAsync(async (req, res) => {
  const offer = await findOwnedOffer(req);
  await offer.deleteOne();
  new ApiResponse(200, null, 'Offer deleted').send(res);
});

module.exports = { createOffer, listOffers, updateOffer, deleteOffer };
