const { Banner, Category, Product, Coupon } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');

// GET /customer/home  -> single aggregate payload for the app's landing screen
const getHome = catchAsync(async (req, res) => {
  const [banners, categories, featuredProducts, offers] = await Promise.all([
    Banner.find({ isActive: true }).sort({ position: 1 }).limit(10),
    Category.find({ parent: null, status: 'active' }).sort({ _id: 1 }).limit(20),
    Product.find({ status: 'active', isAvailable: true })
      .populate('store', 'name isOpen')
      .sort({ createdAt: -1 })
      .limit(20),
    Coupon.find({ isActive: true, vendor: null }).sort({ createdAt: -1 }).limit(10),
  ]);

  new ApiResponse(200, { banners, categories, featuredProducts, offers }).send(res);
});

module.exports = { getHome };
