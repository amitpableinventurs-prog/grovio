const fs = require('fs');
const path = require('path');
const {
  User, Order, Wallet, Address, Cart, Wishlist, UserDevice, RefreshToken, Notification, Otp,
  PickerProfile, DeliveryProfile, Settlement, PocketTransfer, ColdBag, GigBooking, GigSlot, RiderSession, SelfieCheck,
} = require('../models');
const ApiError = require('../utils/apiError');

// Deleting a customer, picker or delivery partner account — by the person from their app
// (DELETE /customer/account, /picker/account, /delivery/account) or, for a customer or picker, by an
// admin (DELETE /admin/customers/:id, /admin/pickers/:id). Their personal data goes: devices, sessions, notifications and the
// name/phone/email/photo on the user, plus per role — a customer's addresses, cart and wishlist; a
// picker's ID proof, address and emergency contact; a delivery partner's KYC, address proof, selfies,
// bank details and emergency contact (uploaded documents are removed from disk too). The user
// document itself stays, anonymised as "Deleted user", because orders, payments, earnings, payouts
// and support tickets point at it — a hard delete would leave those pointing at nothing. With the
// phone cleared, signing up again with the same number makes a fresh account.

// An order in any other status is still going (or being returned).
const CLOSED_ORDER_STATUSES = ['delivered', 'cancelled', 'returned', 'rejected'];
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

const rupees = (n) => `₹${Math.round(Math.abs(n) * 100) / 100}`;
const openOrdersBlocker = (orders, waitFor) => (orders.length
  ? [{ code: 'open_orders', message: `${orders.length} order(s) still in progress (${orders.map((o) => o.orderNumber).join(', ')}). Try again once they are ${waitFor}.` }]
  : []);
const pendingSettlementBlocker = (count) => (count
  ? [{ code: 'pending_settlement', message: 'A payout is still being processed. Try again once it is paid.' }]
  : []);

// What has to be finished before the account can go, per role: [{ code, message }].
const BLOCKERS = {
  async customer(user) {
    const open = await Order.find({ customer: user._id, orderStatus: { $nin: CLOSED_ORDER_STATUSES } }).select('orderNumber');
    return openOrdersBlocker(open, 'delivered or cancelled');
  },

  async picker(user) {
    const [open, settlements] = await Promise.all([
      Order.find({
        orderStatus: { $nin: CLOSED_ORDER_STATUSES },
        pickTasks: { $elemMatch: { picker: user._id, status: { $in: ['assigned', 'picking'] } } },
      }).select('orderNumber'),
      Settlement.countDocuments({ payeeUser: user._id, status: 'pending' }),
    ]);
    return [...openOrdersBlocker(open, 'picked or handed to another picker'), ...pendingSettlementBlocker(settlements)];
  },

  async delivery(user, walletBalance) {
    const [open, transfers, bags, settlements] = await Promise.all([
      Order.find({ delivery: user._id, orderStatus: { $nin: CLOSED_ORDER_STATUSES } }).select('orderNumber'),
      PocketTransfer.countDocuments({ rider: user._id, type: { $in: ['withdrawal', 'weekly_payout'] }, status: { $in: ['initiated', 'in_process'] } }),
      ColdBag.find({ issuedTo: user._id, status: 'issued' }).select('code'),
      Settlement.countDocuments({ payeeUser: user._id, status: 'pending' }),
    ]);
    const blockers = openOrdersBlocker(open, 'delivered or returned');
    // A negative pocket means they hold COD cash that belongs to the company (services/pocket.service.js).
    if (walletBalance < 0) blockers.push({ code: 'cash_in_hand', message: `You still hold ${rupees(walletBalance)} of collected cash. Deposit it first.` });
    if (transfers) blockers.push({ code: 'pending_transfer', message: 'A transfer to your bank account is still in process. Try again once it is completed.' });
    if (bags.length) blockers.push({ code: 'cold_bag', message: `Return cold bag ${bags.map((b) => b.code).join(', ')} at a store first.` });
    return [...blockers, ...pendingSettlementBlocker(settlements)];
  },
};

// Removes what's specific to the role; returns the uploaded files ('/uploads/<file>') to delete.
const CLEANUP = {
  async customer(user) {
    await Promise.all([
      Address.deleteMany({ user: user._id }),
      Cart.deleteMany({ user: user._id }),
      Wishlist.deleteMany({ user: user._id }),
    ]);
    return [];
  },

  async picker(user) {
    const profile = await PickerProfile.findOne({ user: user._id }).lean();
    await PickerProfile.updateOne({ user: user._id }, {
      $set: { status: 'blocked', isAvailable: false, onlineStatus: 'offline', store: null },
      $unset: { address: 1, idProofType: 1, idProofNumber: 1, idProofDocument: 1, emergencyContactName: 1, emergencyContactPhone: 1, currentLat: 1, currentLng: 1, locationUpdatedAt: 1 },
    });
    return [profile?.idProofDocument];
  },

  async delivery(user) {
    const now = new Date();
    const [profile, selfies, upcomingGigs] = await Promise.all([
      DeliveryProfile.findOne({ user: user._id }).lean(),
      SelfieCheck.find({ rider: user._id }).select('image').lean(),
      GigBooking.find({ rider: user._id, status: 'booked', startAt: { $gt: now } }).select('slot').lean(),
    ]);
    await Promise.all([
      DeliveryProfile.updateOne({ user: user._id }, {
        $set: { status: 'blocked', isAvailable: false },
        $unset: {
          kyc: 1, addressProof: 1, selfie: 1, bankDetails: 1, hubCheckin: 1, vehicleNumber: 1, licenseNumber: 1,
          emergencyContactName: 1, emergencyContactPhone: 1, currentLat: 1, currentLng: 1, locationUpdatedAt: 1,
        },
      }),
      SelfieCheck.deleteMany({ rider: user._id }),
      // Offline now; booked gigs that haven't started are cancelled and their places freed.
      RiderSession.updateMany({ rider: user._id, endedAt: null }, { endedAt: now }),
      GigBooking.updateMany({ _id: { $in: upcomingGigs.map((b) => b._id) } }, { status: 'cancelled', cancelledAt: now }),
      ...upcomingGigs.map((b) => GigSlot.updateOne({ _id: b.slot, bookedCount: { $gt: 0 } }, { $inc: { bookedCount: -1 } })),
    ]);
    return [
      profile?.kyc?.document, profile?.addressProof?.frontImage, profile?.addressProof?.backImage, profile?.selfie?.image,
      profile?.bankDetails?.document, ...selfies.map((s) => s.image),
    ];
  },
};

// Only our own '/uploads/<file>' paths; basename() keeps it inside the uploads folder.
function removeUploads(files) {
  return Promise.all(files
    .filter((f) => typeof f === 'string' && f.startsWith('/uploads/'))
    .map((f) => fs.promises.unlink(path.join(UPLOADS_DIR, path.basename(f))).catch(() => {})));
}

async function getDeletionCheck(user) {
  const blockersFor = BLOCKERS[user.role];
  if (!blockersFor) throw new ApiError(400, 'This account cannot be deleted from the app');
  const wallet = await Wallet.findOne({ user: user._id }).lean();
  const walletBalance = wallet?.balance || 0;
  const blockers = await blockersFor(user, walletBalance);
  // A positive balance isn't paid out on deletion — the app should warn that it will be lost.
  return { canDelete: blockers.length === 0, blockers, walletBalance };
}

async function deleteAccount(user) {
  const check = await getDeletionCheck(user);
  if (!check.canDelete) throw new ApiError(400, check.blockers.map((b) => b.message).join(' '), check.blockers);

  const files = await CLEANUP[user.role](user);
  await Promise.all([
    UserDevice.deleteMany({ user: user._id }),
    RefreshToken.deleteMany({ user: user._id }),
    Notification.deleteMany({ user: user._id }),
    user.phone ? Otp.deleteMany({ phone: user.phone }) : null,
  ]);

  // $unset rather than null: phone and email have sparse unique indexes, which still index null.
  await User.updateOne({ _id: user._id }, {
    $set: { name: 'Deleted user', isActive: false, deletedAt: new Date(), profileImage: null, fcmToken: null, gender: null, dateOfBirth: null },
    $unset: { phone: 1, email: 1, password: 1 },
  });
  await removeUploads([user.profileImage, ...files]);

  return { walletBalance: check.walletBalance };
}

module.exports = { getDeletionCheck, deleteAccount };
