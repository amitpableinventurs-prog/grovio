const { Address } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');

const listAddresses = catchAsync(async (req, res) => {
  const addresses = await Address.find({ user: req.user.id }).sort({ isDefault: -1 });
  new ApiResponse(200, addresses).send(res);
});

const createAddress = catchAsync(async (req, res) => {
  const { label, line1, landmark, city, state, pincode, lat, lng, isDefault } = req.body;

  if (isDefault) {
    await Address.updateMany({ user: req.user.id }, { isDefault: false });
  }

  const address = await Address.create({
    user: req.user.id,
    label,
    line1,
    landmark,
    city,
    state,
    pincode,
    lat,
    lng,
    isDefault: !!isDefault,
  });

  new ApiResponse(201, address, 'Address added').send(res);
});

const updateAddress = catchAsync(async (req, res) => {
  const address = await Address.findOne({ _id: req.params.id, user: req.user.id });
  if (!address) throw new ApiError(404, 'Address not found');

  if (req.body.isDefault) {
    await Address.updateMany({ user: req.user.id }, { isDefault: false });
  }

  const fields = ['label', 'line1', 'landmark', 'city', 'state', 'pincode', 'lat', 'lng', 'isDefault'];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) address[f] = req.body[f];
  });
  await address.save();

  new ApiResponse(200, address, 'Address updated').send(res);
});

const deleteAddress = catchAsync(async (req, res) => {
  const address = await Address.findOneAndDelete({ _id: req.params.id, user: req.user.id });
  if (!address) throw new ApiError(404, 'Address not found');
  new ApiResponse(200, null, 'Address deleted').send(res);
});

module.exports = { listAddresses, createAddress, updateAddress, deleteAddress };
