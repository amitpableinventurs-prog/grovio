const { Banner } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');

const createBanner = catchAsync(async (req, res) => {
  const { title, linkType, linkValue, position } = req.body;
  if (!req.file) throw new ApiError(400, 'Banner image is required');

  const banner = await Banner.create({
    title,
    linkType,
    linkValue,
    position,
    image: `/uploads/${req.file.filename}`,
  });
  new ApiResponse(201, banner, 'Banner created').send(res);
});

const listBanners = catchAsync(async (req, res) => {
  const banners = await Banner.find().sort({ position: 1 });
  new ApiResponse(200, banners).send(res);
});

const updateBanner = catchAsync(async (req, res) => {
  const banner = await Banner.findById(req.params.id);
  if (!banner) throw new ApiError(404, 'Banner not found');

  if (req.file) banner.image = `/uploads/${req.file.filename}`;
  ['title', 'linkType', 'linkValue', 'position', 'isActive'].forEach((field) => {
    if (req.body[field] !== undefined) banner[field] = req.body[field];
  });
  await banner.save();

  new ApiResponse(200, banner, 'Banner updated').send(res);
});

const deleteBanner = catchAsync(async (req, res) => {
  const banner = await Banner.findByIdAndDelete(req.params.id);
  if (!banner) throw new ApiError(404, 'Banner not found');
  new ApiResponse(200, null, 'Banner deleted').send(res);
});

module.exports = { createBanner, listBanners, updateBanner, deleteBanner };
