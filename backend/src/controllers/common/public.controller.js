const { Banner, ContentPage } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');

const listActiveBanners = catchAsync(async (req, res) => {
  const banners = await Banner.find({ isActive: true }).sort({ position: 1 });
  new ApiResponse(200, banners).send(res);
});

const uploadFile = catchAsync(async (req, res) => {
  if (!req.file) return new ApiResponse(400, null, 'No file uploaded').send(res);
  new ApiResponse(200, { url: `/uploads/${req.file.filename}` }, 'File uploaded').send(res);
});

// GET /common/content/:slug — public (no auth): About Us, Privacy Policy, Terms & Conditions.
// Admin-authored HTML, edited from Admin > Settings > Content Pages (see admin/contentPages.controller.js).
const getContentPage = catchAsync(async (req, res) => {
  const page = await ContentPage.findOne({ slug: req.params.slug });
  if (!page) throw new ApiError(404, 'Page not found');
  new ApiResponse(200, page).send(res);
});

module.exports = { listActiveBanners, uploadFile, getContentPage };
