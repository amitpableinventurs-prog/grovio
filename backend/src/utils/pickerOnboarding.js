// Default name given to an account created by OTP signup before the picker fills in the Register
// screen — same placeholder auth.controller.js#verifyOtp uses.
const PLACEHOLDER_NAME = 'User';

// Where a picker is in onboarding. Shared by the Picker app (auth/picker/* responses, to decide
// which screen to open) and the admin panel (GET /admin/pickers, to show what a pending picker
// still has to submit before approval), so both always agree.
//   blocked          — admin blocked this picker; show a "contact support" screen
//   home             — approved, can work
//   profile          — fill in name/email/gender/DOB via POST /auth/picker/register
//   kyc              — upload ID proof via PATCH /picker/kyc-upload
//   pending_approval — everything submitted, waiting on PATCH /admin/pickers/:id/status
// An approved picker always goes home, even if admin onboarding skipped a KYC document.
function pickerOnboarding(user, profile) {
  const profileComplete = !!user.name && user.name !== PLACEHOLDER_NAME
    && !!user.email && !!user.gender && !!user.dateOfBirth;
  const kycComplete = !!(profile?.idProofType && profile?.idProofNumber && profile?.idProofDocument);

  let nextStep;
  if (profile?.status === 'blocked') nextStep = 'blocked';
  else if (profile?.status === 'approved') nextStep = 'home';
  else if (!profileComplete) nextStep = 'profile';
  else if (!kycComplete) nextStep = 'kyc';
  else nextStep = 'pending_approval';

  return { status: profile?.status || 'pending', profileComplete, kycComplete, nextStep };
}

module.exports = { pickerOnboarding, PLACEHOLDER_NAME };
