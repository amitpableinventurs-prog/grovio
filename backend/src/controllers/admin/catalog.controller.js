const { Category, Product, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { logAdminActivity } = require('../../services/audit.service');
const { resolveStoreScope } = require('../../utils/storeScope');
const { generateProductQrToken } = require('../../utils/productQr');

// ---------- Categories ----------

const createCategory = catchAsync(async (req, res) => {
  const { name, parentId } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image;
  const category = await Category.create({ name, parent: parentId || null, image });
  new ApiResponse(201, category, 'Category created').send(res);
});

const listCategories = catchAsync(async (req, res) => {
  const parents = await Category.find({ parent: null }).sort({ _id: 1 });
  const children = await Category.find({ parent: { $ne: null } });
  const childMap = new Map();
  children.forEach((c) => {
    const key = c.parent.toString();
    if (!childMap.has(key)) childMap.set(key, []);
    childMap.get(key).push(c);
  });

  const categories = parents.map((p) => ({ ...p.toObject(), children: childMap.get(p._id.toString()) || [] }));
  new ApiResponse(200, categories).send(res);
});

const updateCategory = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new ApiError(404, 'Category not found');

  const { name, parentId, status } = req.body;
  if (req.file) category.image = `/uploads/${req.file.filename}`;
  if (name !== undefined) category.name = name;
  if (parentId !== undefined) category.parent = parentId || null;
  if (status !== undefined) category.status = status;
  await category.save();

  new ApiResponse(200, category, 'Category updated').send(res);
});

const deleteCategory = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new ApiError(404, 'Category not found');
  await category.deleteOne();
  new ApiResponse(200, null, 'Category deleted').send(res);
});

// ---------- Products ----------
// A full MANAGE_CATALOG admin sees/edits any store's products. A restricted
// MANAGE_OWN_STORE_INVENTORY admin (assignedStore set) is locked to their one store —
// see utils/storeScope.js.

const listAllProducts = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status } = req.query;

  const where = {};
  const scopedStoreId = resolveStoreScope(req.user, req.query.storeId);
  if (scopedStoreId) where.store = scopedStoreId;
  if (status) where.status = status;

  const [rows, count] = await Promise.all([
    Product.find(where)
      .populate('store', 'name')
      .populate('category', 'name')
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit),
    Product.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

const setProductStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) throw new ApiError(400, 'Invalid status');

  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found');
  resolveStoreScope(req.user, product.store);

  product.status = status;
  await product.save();

  new ApiResponse(200, product, 'Product status updated').send(res);
});

// POST /admin/products  (full admin can create under any store; a store-scoped
// inventory-manager may omit storeId — it defaults to their assigned store)
const createProduct = catchAsync(async (req, res) => {
  const { name, description, categoryId, unit, price, discountPrice, stockQty, sku } = req.body;
  const storeId = resolveStoreScope(req.user, req.body.storeId);
  if (!storeId) throw new ApiError(400, 'storeId is required');

  const store = await Store.findById(storeId);
  if (!store) throw new ApiError(404, 'Store not found');

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
    qrToken: generateProductQrToken(),
  });

  await logAdminActivity({ adminId: req.user.id, action: 'product.create', entityType: 'Product', entityId: product._id, metadata: { storeId } });

  new ApiResponse(201, product, 'Product created').send(res);
});

// PATCH /admin/products/:id  (full edit — separate from the quick status-only toggle above)
const updateProduct = catchAsync(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found');
  resolveStoreScope(req.user, product.store);

  const fields = ['name', 'description', 'unit', 'price', 'discountPrice', 'stockQty', 'sku', 'isAvailable', 'status'];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) product[f] = req.body[f];
  });
  if (req.body.categoryId !== undefined) product.category = req.body.categoryId;
  // Only a full MANAGE_CATALOG admin may move a product to a different store.
  if (req.body.storeId !== undefined) product.store = resolveStoreScope(req.user, req.body.storeId);
  if (req.files?.length) product.images = req.files.map((f) => `/uploads/${f.filename}`);

  await product.save();

  await logAdminActivity({ adminId: req.user.id, action: 'product.update', entityType: 'Product', entityId: product._id, metadata: req.body });

  new ApiResponse(200, product, 'Product updated').send(res);
});

const deleteProduct = catchAsync(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found');
  resolveStoreScope(req.user, product.store);
  await product.deleteOne();

  await logAdminActivity({ adminId: req.user.id, action: 'product.delete', entityType: 'Product', entityId: product._id });

  new ApiResponse(200, null, 'Product deleted').send(res);
});

module.exports = {
  createCategory,
  listCategories,
  updateCategory,
  deleteCategory,
  listAllProducts,
  setProductStatus,
  createProduct,
  updateProduct,
  deleteProduct,
};
