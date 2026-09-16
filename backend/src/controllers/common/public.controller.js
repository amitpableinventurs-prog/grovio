const { Banner } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');

const listActiveBanners = catchAsync(async (req, res) => {
  const banners = await Banner.find({ isActive: true }).sort({ position: 1 });
  new ApiResponse(200, banners).send(res);
});

const uploadFile = catchAsync(async (req, res) => {
  if (!req.file) return new ApiResponse(400, null, 'No file uploaded').send(res);
  new ApiResponse(200, { url: `/uploads/${req.file.filename}` }, 'File uploaded').send(res);
});

module.exports = { listActiveBanners, uploadFile };
