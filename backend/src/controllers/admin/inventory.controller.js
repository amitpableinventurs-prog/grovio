const { Product } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { hasFullAccess, resolveStoreScope } = require('../../utils/storeScope');
const { PERMISSIONS } = require('../../utils/permissions');
const { toCsv, parseCsv } = require('../../utils/csv');
const { logAdminActivity } = require('../../services/audit.service');

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

const EXPORT_COLUMNS = [
  { label: 'productId', value: (p) => p._id.toString() },
  { label: 'sku', value: (p) => p.sku || '' },
  { label: 'name', value: (p) => p.name },
  { label: 'store', value: (p) => p.store?.name || '' },
  { label: 'category', value: (p) => p.category?.name || '' },
  { label: 'price', value: (p) => p.price },
  { label: 'discountPrice', value: (p) => (p.discountPrice ?? '') },
  { label: 'stockQty', value: (p) => p.stockQty },
  { label: 'isAvailable', value: (p) => p.isAvailable },
  { label: 'status', value: (p) => p.status },
];

// GET /admin/inventory/export?storeId=
// Store/category/name are included for readability but ignored on import — only productId is
// used to match a row back to a product, so a stray edit to those columns can't relocate it.
const exportInventory = catchAsync(async (req, res) => {
  const where = {};
  const scopedStoreId = resolveStoreScope(req.user, req.query.storeId);
  if (scopedStoreId) where.store = scopedStoreId;

  const products = await Product.find(where).populate('store', 'name').populate('category', 'name').sort({ name: 1 });
  const csv = toCsv(products, EXPORT_COLUMNS);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="grovio-inventory-${Date.now()}.csv"`);
  res.send(csv);
});

// POST /admin/inventory/import  (multipart, field name "file")
// Only ever touches stockQty/price/discountPrice/isAvailable/status — never name/store/category —
// so a bad or malicious row can't rename a product or move it to a different store. Rows are
// matched by productId; anything wrong with a row is collected as a per-row error and the import
// keeps going rather than failing the whole file over one bad line.
const importInventory = catchAsync(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'A CSV file is required (field name "file")');

  const rows = parseCsv(req.file.buffer.toString('utf8'));
  if (!rows.length) throw new ApiError(400, 'CSV file has no data rows');

  const canManageAny = hasFullAccess(req.user, PERMISSIONS.MANAGE_CATALOG);
  const results = { updated: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const rowNum = index + 2; // header is row 1
    const productId = (row.productId || '').trim();
    if (!productId) {
      results.errors.push({ row: rowNum, message: 'Missing productId' });
      continue;
    }

    const product = await Product.findById(productId).catch(() => null);
    if (!product) {
      results.errors.push({ row: rowNum, productId, message: 'Product not found' });
      continue;
    }

    if (!canManageAny && product.store.toString() !== req.user.assignedStore?.toString()) {
      results.errors.push({ row: rowNum, productId, message: 'Not in your assigned store' });
      continue;
    }

    if (row.stockQty !== undefined && row.stockQty !== '') {
      const qty = Number(row.stockQty);
      if (Number.isNaN(qty) || qty < 0) {
        results.errors.push({ row: rowNum, productId, message: 'Invalid stockQty' });
        continue;
      }
      product.stockQty = qty;
    }
    if (row.price !== undefined && row.price !== '') {
      const price = Number(row.price);
      if (Number.isNaN(price) || price < 0) {
        results.errors.push({ row: rowNum, productId, message: 'Invalid price' });
        continue;
      }
      product.price = price;
    }
    if (row.discountPrice !== undefined && row.discountPrice !== '') {
      const dp = Number(row.discountPrice);
      product.discountPrice = Number.isNaN(dp) ? null : dp;
    }
    if (row.isAvailable !== undefined && row.isAvailable !== '') {
      product.isAvailable = String(row.isAvailable).trim().toLowerCase() === 'true';
    }
    if (row.status !== undefined && ['active', 'inactive'].includes(row.status.trim())) {
      product.status = row.status.trim();
    }

    await product.save();
    results.updated += 1;
  }

  await logAdminActivity({
    adminId: req.user.id,
    action: 'inventory.import',
    entityType: 'Product',
    metadata: { updated: results.updated, errorCount: results.errors.length },
  });

  new ApiResponse(
    200,
    results,
    `Imported ${results.updated} row(s)${results.errors.length ? `, ${results.errors.length} error(s)` : ''}`
  ).send(res);
});

module.exports = { listInventory, exportInventory, importInventory };
