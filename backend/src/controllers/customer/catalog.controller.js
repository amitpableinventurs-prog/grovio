const { Category, Product, Store, Vendor } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { distanceKm } = require('../../utils/geo');

const listCategories = catchAsync(async (req, res) => {
  const parents = await Category.find({ parent: null, status: 'active' }).sort({ _id: 1 });
  const children = await Category.find({ parent: { $ne: null }, status: 'active' });
  const childMap = new Map();
  children.forEach((c) => {
    const key = c.parent.toString();
    if (!childMap.has(key)) childMap.set(key, []);
    childMap.get(key).push(c);
  });

  const categories = parents.map((p) => ({ ...p.toObject(), children: childMap.get(p._id.toString()) || [] }));
  new ApiResponse(200, categories).send(res);
});

// GET /customer/stores?lat=&lng=&radiusKm=&search=  -> only stores whose vendor is approved
const listStores = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { search, lat, lng, radiusKm } = req.query;

  const approvedVendorIds = (await Vendor.find({ status: 'approved' }).select('_id')).map((v) => v._id);
  const where = { vendor: { $in: approvedVendorIds }, status: 'active' };
  if (search) where.name = new RegExp(search, 'i');

  if (lat && lng) {
    // Location filter: fetch the candidate set, then filter/sort in-memory by real
    // distance — store counts are small enough per query that this beats maintaining
    // a 2dsphere index for now.
    const stores = await Store.find(where).populate('vendor', 'businessName');
    const withDistance = stores
      .map((s) => ({ store: s, distance: distanceKm(Number(lat), Number(lng), s.lat, s.lng) }))
      .filter((s) => !radiusKm || s.distance <= Number(radiusKm))
      .sort((a, b) => a.distance - b.distance);

    const paged = withDistance.slice(offset, offset + limit);
    return new ApiResponse(200, {
      items: paged.map((s) => ({ ...s.store.toObject(), distanceKm: Number(s.distance.toFixed(2)) })),
      meta: buildPageMeta({ page, limit, count: withDistance.length }),
    }).send(res);
  }

  const [rows, count] = await Promise.all([
    Store.find(where).populate('vendor', 'businessName').sort({ name: 1 }).skip(offset).limit(limit),
    Store.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

const getStoreDetail = catchAsync(async (req, res) => {
  const store = await Store.findOne({ _id: req.params.id, status: 'active' }).populate('vendor', 'businessName status');
  if (!store || store.vendor?.status !== 'approved') throw new ApiError(404, 'Store not found');
  new ApiResponse(200, store).send(res);
});

// GET /customer/products?storeId=&categoryId=&search=
const listProducts = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { storeId, categoryId, search } = req.query;

  const where = { status: 'active', isAvailable: true };
  if (storeId) where.store = storeId;
  if (categoryId) where.category = categoryId;
  if (search) where.name = new RegExp(search, 'i');

  const [rows, count] = await Promise.all([
    Product.find(where)
      .populate({ path: 'store', select: 'name isOpen status', match: { status: 'active' } })
      .populate('category', 'name')
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit),
    Product.countDocuments(where),
  ]);

  const items = rows.filter((p) => p.store);
  new ApiResponse(200, { items, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

const getProductDetail = catchAsync(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, status: 'active' })
    .populate('store', 'name isOpen')
    .populate('category', 'name');
  if (!product) throw new ApiError(404, 'Product not found');
  new ApiResponse(200, product).send(res);
});

module.exports = { listCategories, listStores, getStoreDetail, listProducts, getProductDetail };
