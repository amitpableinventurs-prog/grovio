const { Product, Vendor, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');

async function getVendorId(userId) {
  const vendor = await Vendor.findOne({ user: userId });
  if (!vendor) throw new ApiError(404, 'Vendor profile not found');
  return vendor._id;
}

// A product belongs to one of this vendor's stores — verify the storeId is actually theirs
// before letting them create/see products under it.
async function assertOwnsStore(vendorId, storeId) {
  const store = await Store.findOne({ _id: storeId, vendor: vendorId });
  if (!store) throw new ApiError(403, 'You do not own this store');
  return store;
}

async function getOwnedStoreIds(vendorId) {
  const stores = await Store.find({ vendor: vendorId }).select('_id');
  return stores.map((s) => s._id);
}

const createProduct = catchAsync(async (req, res) => {
  const vendorId = await getVendorId(req.user.id);
  const { storeId, name, description, categoryId, unit, price, discountPrice, stockQty, sku } = req.body;
  if (!storeId) throw new ApiError(400, 'storeId is required');
  await assertOwnsStore(vendorId, storeId);

  const images = (req.files || []).map((f) => `/uploads/${f.filename}`);

  const product = await Product.create({
    store: storeId,
    category: categoryId,
    name,
    description,
    unit,
    price,
    discountPrice: discountPrice || null,
    stockQty: stockQty || 0,
    sku,
    images,
  });

  new ApiResponse(201, product, 'Product created').send(res);
});

// GET /vendor/products?storeId=&status=&search=  -> storeId optional (defaults to all of the vendor's stores)
const listMyProducts = catchAsync(async (req, res) => {
  const vendorId = await getVendorId(req.user.id);
  const { page, limit, offset } = getPagination(req.query);
  const { storeId, status, search } = req.query;

  let where;
  if (storeId) {
    await assertOwnsStore(vendorId, storeId);
    where = { store: storeId };
  } else {
    where = { store: { $in: await getOwnedStoreIds(vendorId) } };
  }
  if (status) where.status = status;
  if (search) where.name = new RegExp(search, 'i');

  const [rows, count] = await Promise.all([
    Product.find(where).populate('store', 'name').sort({ createdAt: -1 }).skip(offset).limit(limit),
    Product.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

async function findOwnedProduct(req) {
  const vendorId = await getVendorId(req.user.id);
  const storeIds = await getOwnedStoreIds(vendorId);
  const product = await Product.findOne({ _id: req.params.id, store: { $in: storeIds } });
  if (!product) throw new ApiError(404, 'Product not found');
  return product;
}

const updateProduct = catchAsync(async (req, res) => {
  const product = await findOwnedProduct(req);

  const fields = ['name', 'description', 'unit', 'sku', 'isAvailable', 'status'];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) product[f] = req.body[f];
  });
  if (req.body.categoryId !== undefined) product.category = req.body.categoryId;

  if (req.files?.length) {
    product.images = req.files.map((f) => `/uploads/${f.filename}`);
  }

  await product.save();
  new ApiResponse(200, product, 'Product updated').send(res);
});

const updateStock = catchAsync(async (req, res) => {
  const product = await findOwnedProduct(req);
  const { stockQty, isAvailable } = req.body;

  if (stockQty !== undefined) product.stockQty = stockQty;
  if (isAvailable !== undefined) product.isAvailable = isAvailable;
  await product.save();

  new ApiResponse(200, product, 'Stock updated').send(res);
});

// PATCH /vendor/products/:id/price  { price, discountPrice }
const updatePrice = catchAsync(async (req, res) => {
  const product = await findOwnedProduct(req);
  const { price, discountPrice } = req.body;

  if (price !== undefined) product.price = price;
  if (discountPrice !== undefined) product.discountPrice = discountPrice;
  await product.save();

  new ApiResponse(200, product, 'Price updated').send(res);
});

const deleteProduct = catchAsync(async (req, res) => {
  const product = await findOwnedProduct(req);
  await product.deleteOne();
  new ApiResponse(200, null, 'Product deleted').send(res);
});

// ---------- Variants ----------

// POST /vendor/products/:id/variants  { label, price, discountPrice, stockQty, sku }
const addVariant = catchAsync(async (req, res) => {
  const product = await findOwnedProduct(req);
  const { label, price, discountPrice, stockQty, sku } = req.body;

  product.variants.push({ label, price, discountPrice: discountPrice || null, stockQty: stockQty || 0, sku });
  await product.save();

  new ApiResponse(201, product, 'Variant added').send(res);
});

const updateVariant = catchAsync(async (req, res) => {
  const product = await findOwnedProduct(req);
  const variant = product.variants.id(req.params.variantId);
  if (!variant) throw new ApiError(404, 'Variant not found');

  const fields = ['label', 'price', 'discountPrice', 'stockQty', 'sku', 'isAvailable'];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) variant[f] = req.body[f];
  });
  await product.save();

  new ApiResponse(200, product, 'Variant updated').send(res);
});

const deleteVariant = catchAsync(async (req, res) => {
  const product = await findOwnedProduct(req);
  const variant = product.variants.id(req.params.variantId);
  if (!variant) throw new ApiError(404, 'Variant not found');

  product.variants.pull({ _id: req.params.variantId });
  await product.save();

  new ApiResponse(200, product, 'Variant removed').send(res);
});

module.exports = {
  createProduct,
  listMyProducts,
  updateProduct,
  updateStock,
  updatePrice,
  deleteProduct,
  addVariant,
  updateVariant,
  deleteVariant,
};
