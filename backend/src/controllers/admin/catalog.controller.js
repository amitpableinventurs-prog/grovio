const { Category, Product, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');

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

// ---------- Products (admin moderation view across all vendors) ----------

const listAllProducts = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status, storeId, vendorId } = req.query;

  const where = {};
  if (status) where.status = status;
  if (storeId) where.store = storeId;
  else if (vendorId) {
    const stores = await Store.find({ vendor: vendorId }).select('_id');
    where.store = { $in: stores.map((s) => s._id) };
  }

  const [rows, count] = await Promise.all([
    Product.find(where)
      .populate('store', 'name vendor')
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

  product.status = status;
  await product.save();

  new ApiResponse(200, product, 'Product status updated').send(res);
});

module.exports = {
  createCategory,
  listCategories,
  updateCategory,
  deleteCategory,
  listAllProducts,
  setProductStatus,
};
