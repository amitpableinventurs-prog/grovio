// Delivery app onboarding, one endpoint per screen after OTP signup:
//   Select vehicle -> Verify PAN / Aadhaar -> Submit address documents -> Take selfie -> Bank details
// Every response carries `onboarding` (utils/deliveryOnboarding.js) so the app can route to the
// next screen and fill its progress ring. The partner stays 'pending' until an admin approves
// them (PATCH /admin/delivery-partners/:id/status); until then they can't be assigned jobs.
const { DeliveryProfile } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { VEHICLE_TYPES, deliveryOnboarding } = require('../../utils/deliveryOnboarding');
const { PLACEHOLDER_NAME } = require('../../utils/pickerOnboarding');

const fileUrl = (file) => (file ? `/uploads/${file.filename}` : null);

// Documents can only be changed while the application is still under review — once approved or
// blocked, changes go through support/admin.
async function editableProfile(userId) {
  const profile = await DeliveryProfile.findOne({ user: userId });
  if (!profile) throw new ApiError(404, 'Delivery profile not found');
  if (profile.status !== 'pending') {
    throw new ApiError(400, 'Your documents are already reviewed. Please contact support to change them.');
  }
  return profile;
}

async function saveAndRespond(res, profile, message) {
  const onboarding = deliveryOnboarding(profile);
  if (onboarding.nextStep === 'pending_approval' && !profile.onboardingCompletedAt) {
    profile.onboardingCompletedAt = new Date();
  }
  await profile.save();
  new ApiResponse(200, { profile, onboarding }, message).send(res);
}

// GET /delivery/onboarding -> which step to open, plus the vehicle options for the first screen
const getOnboarding = catchAsync(async (req, res) => {
  const profile = await DeliveryProfile.findOne({ user: req.user.id });
  if (!profile) throw new ApiError(404, 'Delivery profile not found');
  new ApiResponse(200, { profile, onboarding: deliveryOnboarding(profile), vehicleTypes: VEHICLE_TYPES }).send(res);
});

// PUT /delivery/onboarding/vehicle  { vehicleType }
const saveVehicle = catchAsync(async (req, res) => {
  const profile = await editableProfile(req.user.id);
  profile.vehicleType = req.body.vehicleType;
  await saveAndRespond(res, profile, 'Vehicle saved');
});

// POST /delivery/onboarding/identity  (multipart)
//   idType: pan | aadhaar, idNumber, fullName, gender, fatherName, dateOfBirth (YYYY-MM-DD),
//   document: photo of the card (required the first time; optional when correcting the details)
const saveIdentity = catchAsync(async (req, res) => {
  const profile = await editableProfile(req.user.id);
  const document = fileUrl(req.file) || profile.kyc?.document;
  if (!document) throw new ApiError(422, 'Validation failed', [{ field: 'document', message: 'Upload a photo of your PAN / Aadhaar card' }]);

  const { idType, idNumber, fullName, gender, fatherName, dateOfBirth } = req.body;
  profile.kyc = {
    idType, idNumber, fullName, gender, fatherName,
    dateOfBirth: new Date(`${dateOfBirth}T00:00:00Z`),
    document,
    submittedAt: new Date(),
  };

  // The account was created by OTP signup with a placeholder name — use the one from the card.
  const user = req.user;
  if (!user.name || user.name === PLACEHOLDER_NAME) user.name = fullName;
  if (!user.gender) user.gender = gender;
  if (!user.dateOfBirth) user.dateOfBirth = profile.kyc.dateOfBirth;
  if (user.isModified()) await user.save();

  await saveAndRespond(res, profile, `${idType === 'pan' ? 'PAN' : 'Aadhaar'} details saved`);
});

// POST /delivery/onboarding/address-proof  (multipart) frontImage, backImage
// Voter ID, driving licence or ration card (not PAN). Each side can be uploaded on its own as the
// user takes the photo; the step is complete once both are in.
const saveAddressProof = catchAsync(async (req, res) => {
  const profile = await editableProfile(req.user.id);
  const front = fileUrl(req.files?.frontImage?.[0]);
  const back = fileUrl(req.files?.backImage?.[0]);
  if (!front && !back) {
    throw new ApiError(422, 'Validation failed', [{ field: 'frontImage', message: 'Upload the front and/or back photo of your address document' }]);
  }

  if (front) profile.addressProof.frontImage = front;
  if (back) profile.addressProof.backImage = back;
  profile.addressProof.submittedAt = new Date();
  await saveAndRespond(res, profile, 'Address document saved');
});

// POST /delivery/onboarding/selfie  (multipart) selfie
const saveSelfie = catchAsync(async (req, res) => {
  const profile = await editableProfile(req.user.id);
  if (!req.file) throw new ApiError(422, 'Validation failed', [{ field: 'selfie', message: 'Take a selfie to continue' }]);

  profile.selfie = { image: fileUrl(req.file), submittedAt: new Date() };
  await saveAndRespond(res, profile, 'Selfie saved');
});

// POST /delivery/onboarding/bank  (JSON or multipart)
//   accountHolderName, accountNumber, confirmAccountNumber?, ifsc, bankName?,
//   document?: photo of a cancelled cheque / passbook
const saveBankDetails = catchAsync(async (req, res) => {
  const profile = await editableProfile(req.user.id);
  const { accountHolderName, accountNumber, ifsc, bankName } = req.body;
  profile.bankDetails = {
    accountHolderName,
    accountNumber,
    ifsc,
    bankName: bankName || null,
    document: fileUrl(req.file) || profile.bankDetails?.document || null,
    submittedAt: new Date(),
  };
  await saveAndRespond(res, profile, 'Bank details saved');
});

module.exports = { getOnboarding, saveVehicle, saveIdentity, saveAddressProof, saveSelfie, saveBankDetails };
