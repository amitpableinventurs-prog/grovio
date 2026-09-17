const { Product, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { resolveStoreScope } = require('../../utils/storeScope');

// GET /admin/inventory?storeId=&lowStock=true&threshold=5
const listInventory = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { lowStock, threshold } = req.query;

  const where = {};
  const scopedStoreId = resolveStoreScope(req.user, req.query.storeId);
  if (scopedStoreId) where.store = scopedStoreId;
  if (lowStock === 'true') where.stockQty = { $lte: Number(threshold) || 5 };

  const [rows, count] = await Promise.all([
    Product.find(where)
      .populate('store', 'name')
      .select('name sku stockQty variants isAvailable status store')
      .sort({ stockQty: 1 })
      .skip(offset)
      .limit(limit),
    Product.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

module.exports = { listInventory };
