// Vehicles offered on the Delivery app's "Select vehicle" screen.
const VEHICLE_TYPES = [
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'bicycle', label: 'Bicycle' },
  { value: 'electric_scooter', label: 'Electric scooter' },
];

// The app's onboarding screens, in order.
const STEPS = ['vehicle', 'identity', 'addressProof', 'selfie', 'bank'];

// Where a delivery partner is in onboarding, so the app knows which screen to open (and how far
// to fill the progress ring):
//   blocked          — admin blocked this partner; show a "contact support" screen
//   home             — approved, can take jobs
//   vehicle          — PUT  /delivery/onboarding/vehicle
//   identity         — POST /delivery/onboarding/identity      (PAN or Aadhaar + photo)
//   addressProof     — POST /delivery/onboarding/address-proof (front + back photo)
//   selfie           — POST /delivery/onboarding/selfie
//   bank             — POST /delivery/onboarding/bank          (payout account)
//   pending_approval — everything submitted, waiting on PATCH /admin/delivery-partners/:id/status
// An approved partner always goes home, even one created before these steps existed.
function deliveryOnboarding(profile) {
  const kyc = profile?.kyc || {};
  const address = profile?.addressProof || {};
  const bank = profile?.bankDetails || {};
  const steps = {
    vehicle: !!profile?.vehicleType,
    identity: !!(kyc.idType && kyc.idNumber && kyc.document),
    addressProof: !!(address.frontImage && address.backImage),
    selfie: !!profile?.selfie?.image,
    bank: !!(bank.accountHolderName && bank.accountNumber && bank.ifsc),
  };

  let nextStep;
  if (profile?.status === 'blocked') nextStep = 'blocked';
  else if (profile?.status === 'approved') nextStep = 'home';
  else nextStep = STEPS.find((s) => !steps[s]) || 'pending_approval';

  return {
    status: profile?.status || 'pending',
    steps,
    completedSteps: STEPS.filter((s) => steps[s]).length,
    totalSteps: STEPS.length,
    nextStep,
  };
}

module.exports = { VEHICLE_TYPES, STEPS, deliveryOnboarding };
