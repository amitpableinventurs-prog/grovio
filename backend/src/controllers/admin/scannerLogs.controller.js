const { ScannerLog } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');

// GET /admin/scanner-logs?orderId=&status=&userType=
const listScannerLogs = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { orderId, status, userType } = req.query;

  const where = {};
  if (orderId) where.order = orderId;
  if (status) where.status = status;
  if (userType) where.userType = userType;

  const [rows, count] = await Promise.all([
    ScannerLog.find(where)
      .populate('scannedBy', 'name phone')
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit),
    ScannerLog.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

module.exports = { listScannerLogs };
