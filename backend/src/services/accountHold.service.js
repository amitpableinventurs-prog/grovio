const { AccountHold, DeliveryProfile, SelfieCheck } = require('../models');
const ApiError = require('../utils/apiError');
const t = require('../utils/localTime');
const { getSetting } = require('./settings.service');
const { notifyUser } = require('./notification.service');

// "Account on hold": the system (e.g. a selfie that doesn't match — see reviewSelfie) or an admin
// holds a delivery partner's account for a set time. While on hold they're offline and can't go
// online, check in at a hub or claim orders. It lifts itself when the time is up (checked on every
// read and by services/riderJobs.service.js), or an admin unlocks it early.

const TITLES = {
  face_mismatch: 'Face not matching',
  cold_bag_not_returned: 'Cold bag not returned',
  cash_not_deposited: 'Cash not deposited',
  fraud: 'Suspicious activity',
  misconduct: 'Complaint under review',
  documents: 'Documents need attention',
  other: 'Account under review',
};

async function faceMismatchHours() {
  const h = Number(await getSetting('riderFaceMismatchHoldHours', 'RIDER_FACE_MISMATCH_HOLD_HOURS'));
  return Number.isFinite(h) && h > 0 ? h : 24;
}

function remainingLabel(releaseAt) {
  if (!releaseAt) return 'Until support reviews it';
  const mins = Math.max(0, Math.ceil((releaseAt - Date.now()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `Lifts in ${[h ? `${h} hr${h === 1 ? '' : 's'}` : null, m || !h ? `${m} min${m === 1 ? '' : 's'}` : null].filter(Boolean).join(' ')}`;
}

// Put on hold. durationHours null = until an admin unlocks it.
async function placeHold(riderId, { reason = 'other', title, details = null, evidence = [], durationHours = null, createdBy = null }) {
  if (!TITLES[reason]) throw new ApiError(422, `reason must be one of: ${Object.keys(TITLES).join(', ')}`);
  const releaseAt = durationHours ? new Date(Date.now() + Number(durationHours) * 3600000) : null;
  const hold = await AccountHold.create({ rider: riderId, reason, title: title || TITLES[reason], details, evidence, releaseAt, createdBy });

  // Supersede any earlier open case.
  await AccountHold.updateMany({ rider: riderId, _id: { $ne: hold._id }, releasedAt: null }, { $set: { releasedAt: new Date(), releaseType: 'manual', releaseNote: 'Replaced by a newer hold' } });
  await DeliveryProfile.updateOne({ user: riderId }, { $set: { isAvailable: false, hold: { active: true, case: hold._id, title: hold.title, releaseAt } } });
  await require('./riderSession.service').goOffline(riderId);
  await notifyUser(riderId, {
    title: 'Account on hold',
    body: `${hold.title}. ${releaseAt ? `It will be lifted at ${t.timeLabel(releaseAt)}, ${t.dayLabel(releaseAt)}.` : 'Contact support to resolve it.'}`,
    type: 'account_hold',
    data: { holdId: hold._id },
  }).catch(() => {});
  return hold;
}

async function releaseHold(riderId, { type = 'manual', by = null, note = null } = {}) {
  const profile = await DeliveryProfile.findOne({ user: riderId }).select('hold');
  if (!profile?.hold?.active) return null;
  const caseId = profile.hold.case;
  await DeliveryProfile.updateOne({ user: riderId }, { $set: { hold: { active: false, case: caseId, title: null, releaseAt: null } } });
  const hold = await AccountHold.findOneAndUpdate({ _id: caseId, releasedAt: null }, { $set: { releasedAt: new Date(), releaseType: type, releasedBy: by, releaseNote: note } }, { new: true });
  await notifyUser(riderId, { title: 'Account active again', body: 'Your account is no longer on hold. You can go online.', type: 'account_hold_released' }).catch(() => {});
  return hold;
}

// Current hold, lifting it first if its time is up. null = not on hold.
async function activeHold(riderId) {
  const profile = await DeliveryProfile.findOne({ user: riderId }).select('hold');
  if (!profile?.hold?.active) return null;
  if (profile.hold.releaseAt && profile.hold.releaseAt <= new Date()) {
    await releaseHold(riderId, { type: 'auto' });
    return null;
  }
  return AccountHold.findById(profile.hold.case);
}

// Throws while on hold (going online, hub check-in, claiming orders).
async function assertNotOnHold(riderId) {
  const hold = await activeHold(riderId);
  if (hold) throw new ApiError(423, `Account on hold: ${hold.title}. ${remainingLabel(hold.releaseAt)}.`, [{ holdId: hold._id, releaseAt: hold.releaseAt }]);
}

const caseView = (h) => h && ({
  id: h._id,
  reason: h.reason,
  title: h.title,
  details: h.details,
  startedAt: h.startedAt,
  releaseAt: h.releaseAt,
  releasedAt: h.releasedAt,
  releaseType: h.releaseType,
  byAdmin: !!h.createdBy,
});

// GET /delivery/account-status
async function accountStatus(riderId) {
  const hold = await activeHold(riderId);
  const lastCase = hold || await AccountHold.findOne({ rider: riderId }).sort({ createdAt: -1 });
  return {
    status: hold ? 'on_hold' : 'active',
    onHold: !!hold,
    hold: hold ? { ...caseView(hold), remainingLabel: remainingLabel(hold.releaseAt), heading: 'Account on hold' } : null,
    // "View last case"
    lastCase: caseView(lastCase),
  };
}

// Auto-release sweep (background job).
async function releaseDueHolds() {
  const due = await DeliveryProfile.find({ 'hold.active': true, 'hold.releaseAt': { $ne: null, $lte: new Date() } }).select('user');
  for (const p of due) await releaseHold(p.user, { type: 'auto' });
  return due.length;
}

// ---- Selfie checks ---------------------------------------------------------------------------

// POST /delivery/selfie-checks (photo) — reviewed by an admin (or a face-match service).
async function submitSelfie(riderId, imagePath) {
  return SelfieCheck.create({ rider: riderId, image: imagePath });
}

// Admin verdict. A mismatch holds the account for riderFaceMismatchHoldHours.
async function reviewSelfie(checkId, { result, adminId = null, score = null }) {
  if (!['match', 'mismatch'].includes(result)) throw new ApiError(422, "result must be 'match' or 'mismatch'");
  const check = await SelfieCheck.findById(checkId);
  if (!check) throw new ApiError(404, 'Selfie check not found');
  if (check.status !== 'pending') throw new ApiError(400, `Already marked ${check.status}`);
  check.status = result;
  check.reviewedBy = adminId;
  check.reviewedAt = new Date();
  if (score !== null) check.score = score;
  if (result === 'mismatch') {
    const hold = await placeHold(check.rider, {
      reason: 'face_mismatch',
      details: `Selfie taken ${t.dayLabel(check.createdAt)}, ${t.timeLabel(check.createdAt)} did not match your profile photo.`,
      evidence: [check.image],
      durationHours: await faceMismatchHours(),
      createdBy: null,
    });
    check.hold = hold._id;
  }
  await check.save();
  return check;
}

module.exports = { TITLES, placeHold, releaseHold, activeHold, assertNotOnHold, accountStatus, releaseDueHolds, submitSelfie, reviewSelfie, remainingLabel };
