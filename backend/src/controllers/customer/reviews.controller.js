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

  // order.store is the hub a multi-store order consolidates at — if the review is for a specific
  // product, attribute it to that product's own store rather than blanket-crediting the hub.
  const reviewedItem = productId ? order.items.find((i) => i.product.toString() === productId) : null;
  const storeId = reviewedItem?.pickupStore || order.store;

  const review = await Review.create({
    order: order._id,
    customer: req.user.id,
    store: storeId,
    product: productId || null,
    rating,
    comment,
    deliveryPartnerRating: deliveryPartnerRating || null,
  });

  new ApiResponse(201, review, 'Review submitted').send(res);
});

module.exports = { submitReview };
