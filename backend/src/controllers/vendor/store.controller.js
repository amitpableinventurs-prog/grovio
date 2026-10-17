const { Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');

// GET /vendor/store -> my store. Read-only here: name, location, hours and approval
// (status: 'inactive' until an admin activates it) are set by the admin (PATCH /admin/stores/:id).
const getMyStore = catchAsync(async (req, res) => {
  const store = await Store.findById(req.user.assignedStore);
  if (!store) throw new ApiError(404, 'Store not found');
  new ApiResponse(200, store).send(res);
});

// The admin hub-screen handlers take the store from req.params.id; on /vendor/hub-displays it's
// always the vendor's own store.
const useMyStore = (req, res, next) => {
  req.params.id = req.user.assignedStore.toString();
  next();
};

module.exports = { getMyStore, useMyStore };
