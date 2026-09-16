const { Review, Order } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');

// POST /customer/orders/:orderId/rating  { rating, comment, productId, deliveryPartnerRating }
const submitReview = catchAsync(async (req, res) => {
  const { rating, comment, productId, deliveryPartnerRating } = req.body;

  const order = await Order.findOne({ _id: req.params.orderId, customer: req.user.id, orderStatus: 'delivered' });
  if (!order) throw new ApiError(404, 'Delivered order not found');

  const existing = await Review.findOne({ order: order._id });
  if (existing) throw new ApiError(409, 'You have already reviewed this order');

  const review = await Review.create({
    order: order._id,
    customer: req.user.id,
    vendor: order.vendor,
    store: order.store,
    product: productId || null,
    rating,
    comment,
    deliveryPartnerRating: deliveryPartnerRating || null,
  });

  new ApiResponse(201, review, 'Review submitted').send(res);
});

module.exports = { submitReview };
