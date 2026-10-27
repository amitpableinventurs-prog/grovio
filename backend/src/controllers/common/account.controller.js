const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const { getDeletionCheck, deleteAccount: deleteUserAccount } = require('../../services/accountDeletion.service');

// Account deletion from the customer, picker and delivery apps — mounted as /customer/account,
// /picker/account and /delivery/account (services/accountDeletion.service.js).

// GET .../account/delete-check — for the app's "Delete account" screen before it confirms: what
// still has to be finished (blockers), and any wallet / pocket balance that will be lost.
const deletionCheck = catchAsync(async (req, res) => {
  new ApiResponse(200, await getDeletionCheck(req.user)).send(res);
});

// DELETE .../account — the access/refresh tokens stop working straight away; the app should
// clear them and go back to login.
const deleteAccount = catchAsync(async (req, res) => {
  await deleteUserAccount(req.user);
  new ApiResponse(200, null, 'Your account has been deleted').send(res);
});

module.exports = { deletionCheck, deleteAccount };
