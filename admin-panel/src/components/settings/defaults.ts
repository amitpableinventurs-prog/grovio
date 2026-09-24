// Values the backend falls back to when a setting was never saved — shown pre-selected.
export const INTEGRATION_DEFAULTS: Record<string, string> = {
  codEnabled: 'true',
  razorpayEnabled: 'true',
  payuEnabled: 'true',
  payuMode: 'test',
  phonepeEnabled: 'true',
  phonepeEnv: 'sandbox',
  phonepeClientVersion: '1',
  ivrProvider: 'none',
  exotelSubdomain: 'api.exotel.com',
  ivrAutoCallEvents: 'out_for_delivery,delivery_failed,rider_arrived',
  ivrMissedCallCallback: 'true',
};
