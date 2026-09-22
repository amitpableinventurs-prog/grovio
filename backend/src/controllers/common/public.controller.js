const { Banner, ContentPage, Wishlist } = require('../../models');
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

// GET /common/wishlist/:shareToken — public (no auth): a read-only view of a customer's shared
// wishlist. Only reachable once the owner opts in via POST /customer/wishlist/share — the token
// is unguessable (16 random bytes), and only the owner's first name is exposed, not phone/email.
const getSharedWishlist = catchAsync(async (req, res) => {
  const wishlist = await Wishlist.findOne({ shareToken: req.params.shareToken })
    .populate('user', 'name')
    .populate({
      path: 'items.product',
      select: 'name images price discountPrice unit isAvailable status store',
      populate: { path: 'store', select: 'name' },
    });
  if (!wishlist) throw new ApiError(404, 'Shared wishlist not found');

  new ApiResponse(200, {
    ownerName: wishlist.user?.name?.split(' ')[0] || 'A Grovio user',
    items: wishlist.items,
  }).send(res);
});

module.exports = { listActiveBanners, uploadFile, getContentPage, getSharedWishlist };
