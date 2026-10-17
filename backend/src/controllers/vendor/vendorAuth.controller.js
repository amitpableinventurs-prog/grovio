const bcrypt = require('bcryptjs');
const { User, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const tokenService = require('../../services/token.service');
const { PERMISSIONS } = require('../../utils/permissions');
const { isVendorAccount } = require('../../middleware/vendor.middleware');

const STORE_FIELDS = 'name address lat lng status openTime closeTime serviceRadiusKm';

function safeUserOf(user) {
  const safe = user.toObject();
  delete safe.password;
  return safe;
}

// ---------- Self-registration ----------
// POST /vendor/auth/register (also the older POST /auth/register-vendor, used by /vendor-signup)
// Public signup, as an alternative to an admin manually creating one via POST /admin/admins.
// Produces the exact same kind of account (role: 'admin', MANAGE_OWN_STORE_INVENTORY permission,
// assignedStore) — just self-initiated. The store starts status: 'inactive', so it never shows up
// to customers (see customer/catalog.controller.js) until an admin reviews and activates it via
// PATCH /admin/stores/:id — THAT is the actual approval gate, not the account's permissions.
const register = catchAsync(async (req, res) => {
  const { name, email, password, phone, storeName, address, lat, lng, deviceId, platform } = req.body;

  const existingEmail = await User.findOne({ email });
  if (existingEmail) throw new ApiError(409, 'Email already registered');

  if (phone) {
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) throw new ApiError(409, 'Phone number already registered');
  }

  const store = await Store.create({
    name: storeName,
    address: address || null,
    lat: lat ?? null,
    lng: lng ?? null,
    status: 'inactive',
  });

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email,
    phone: phone || undefined,
    password: hashed,
    role: 'admin',
    permissions: [PERMISSIONS.MANAGE_OWN_STORE_INVENTORY],
    assignedStore: store._id,
    isVerified: true,
  });

  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, { deviceId, platform });
  new ApiResponse(201, { accessToken, refreshToken, user: safeUserOf(user), store }, 'Vendor registered successfully. Your store is pending admin approval.').send(res);
});

// ---------- Login ----------
// POST /vendor/auth/login { email, password } — the Vendor Panel's sign-in. Same credentials as
// POST /auth/login, but only vendor (store) accounts get in; admins use the admin panel. Refresh
// and logout are the shared POST /auth/refresh and /auth/logout.
const login = catchAsync(async (req, res) => {
  const { email, password, deviceId, platform } = req.body;

  const user = await User.findOne({ email }).select('+password');
  if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
    throw new ApiError(401, 'Invalid email or password');
  }
  if (!user.isActive) throw new ApiError(403, 'Your account has been disabled');
  if (!isVendorAccount(user)) throw new ApiError(403, 'This login is for vendors only. Admins sign in on the admin panel.');

  const [{ accessToken, refreshToken }, store] = await Promise.all([
    tokenService.issueTokenPair(user, { deviceId, platform }),
    Store.findById(user.assignedStore).select(STORE_FIELDS),
  ]);
  new ApiResponse(200, { accessToken, refreshToken, user: safeUserOf(user), store }, 'Login successful').send(res);
});

// GET /vendor/me -> my account and my store (its status says whether it's approved yet).
const me = catchAsync(async (req, res) => {
  const store = await Store.findById(req.user.assignedStore).select(STORE_FIELDS);
  new ApiResponse(200, { user: safeUserOf(req.user), store }).send(res);
});

module.exports = { register, login, me };
