const { Schema, model } = require('mongoose');

const deliveryProfileSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  vehicleType: { type: String, default: null },
  vehicleNumber: { type: String, default: null },
  licenseNumber: { type: String, default: null },
  status: { type: String, enum: ['pending', 'approved', 'blocked'], default: 'pending' },

  // Delivery app onboarding (see controllers/delivery/onboarding.controller.js and
  // utils/deliveryOnboarding.js): identity proof, address proof and a selfie, all submitted from
  // the app after OTP signup and reviewed by an admin before approval. Image fields hold
  // '/uploads/<file>' paths.
  kyc: {
    idType: { type: String, enum: ['pan', 'aadhaar'], default: null },
    idNumber: { type: String, default: null },
    fullName: { type: String, default: null },
    gender: { type: String, enum: ['male', 'female', 'other'], default: null },
    fatherName: { type: String, default: null },
    dateOfBirth: { type: Date, default: null },
    document: { type: String, default: null },
    submittedAt: { type: Date, default: null },
  },
  addressProof: {
    frontImage: { type: String, default: null },
    backImage: { type: String, default: null },
    submittedAt: { type: Date, default: null },
  },
  selfie: {
    image: { type: String, default: null },
    submittedAt: { type: Date, default: null },
  },
  // Where the partner's payouts (settlements) go. Entered in the app's last onboarding step, or by
  // an admin on the Delivery Partners page. `document` is an optional cancelled cheque / passbook.
  bankDetails: {
    accountHolderName: { type: String, default: null },
    accountNumber: { type: String, default: null },
    ifsc: { type: String, default: null },
    bankName: { type: String, default: null },
    document: { type: String, default: null },
    submittedAt: { type: Date, default: null },
  },
  // Set once every onboarding step is done — when it landed in the admin's approval queue.
  onboardingCompletedAt: { type: Date, default: null },

  // Texted with the live location when the partner raises an SOS (services/sos.service.js).
  emergencyContactName: { type: String, default: null },
  emergencyContactPhone: { type: String, default: null },

  isAvailable: { type: Boolean, default: false },
  // This partner's own pay rate card — only the policy sections that differ from the default
  // riderPayPolicy (services/riderPay.service.js).
  payOverride: { type: Schema.Types.Mixed, default: null },
  // Account on hold (services/accountHold.service.js): can't go online or take orders until
  // releaseAt (then it lifts itself) or an admin unlocks it. Details live in the AccountHold case.
  hold: {
    active: { type: Boolean, default: false },
    case: { type: Schema.Types.ObjectId, ref: 'AccountHold', default: null },
    title: { type: String, default: null },
    releaseAt: { type: Date, default: null },
  },
  currentLat: { type: Number, default: null },
  currentLng: { type: Number, default: null },
  // When currentLat/currentLng were last reported — a stale fix isn't used for ETA/tracking
  // (see services/tracking.service.js).
  locationUpdatedAt: { type: Date, default: null },
  // Set by scanning a Hub Center screen's check-in QR (POST /delivery/hub/checkin) — proof the
  // partner is physically at that hub, required to see/claim its ready orders under
  // /delivery/hub/*. Expires after HUB_CHECKIN_MINUTES; see services/hubDisplay.service.js.
  hubCheckin: {
    store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
    display: { type: Schema.Types.ObjectId, ref: 'HubDisplay', default: null },
    at: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
}, { timestamps: true });

// A full Aadhaar number (12 digits) or Virtual ID (16 digits) is never sent back out (UIDAI
// masking rule) — only its last 4 digits, e.g. "XXXX XXXX 1234" / "XXXX XXXX XXXX 1234". The
// stored value stays complete for verification against the uploaded document.
function maskAadhaar(doc, ret) {
  if (ret.kyc?.idType === 'aadhaar' && ret.kyc.idNumber) {
    const hiddenGroups = Math.max(1, Math.ceil(ret.kyc.idNumber.length / 4) - 1);
    ret.kyc.idNumber = `${'XXXX '.repeat(hiddenGroups)}${ret.kyc.idNumber.slice(-4)}`;
  }
  return ret;
}
deliveryProfileSchema.set('toJSON', { transform: maskAadhaar });
deliveryProfileSchema.set('toObject', { transform: maskAadhaar });

module.exports = model('DeliveryProfile', deliveryProfileSchema);
