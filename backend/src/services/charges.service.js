const { Setting } = require('../models');
const ApiError = require('../utils/apiError');
const { getSetting, invalidateSettingsCache } = require('./settings.service');

// Order charges the admin configures on the Charges page (GET/PUT /admin/charges), applied ONCE
// per order at checkout on top of the item total:
//   delivery  — optionally waived when the item total reaches `freeAbove`
//   handling, packing
//   surcharge — an on/off "surge" switch (rain, peak hours) with a customer-facing label
// Each is either a fixed ₹ amount or a % of the item total (before any coupon discount).
// Stored as one JSON value under the `orderCharges` Setting key.
const SETTING_KEY = 'orderCharges';
const CHARGE_TYPES = ['fixed', 'percent'];
const MAX_LABEL_LENGTH = 40;

const round2 = (n) => Math.round(Number(n) * 100) / 100;

async function defaultConfig() {
  // Before this page existed the only charge was the flat `deliveryFee` setting — carry it over
  // so the first load of the Charges page shows what customers are actually being charged.
  const legacyDeliveryFee = Number(await getSetting('deliveryFee', 'DEFAULT_DELIVERY_FEE')) || 25;
  return {
    delivery: { enabled: true, type: 'fixed', value: legacyDeliveryFee, freeAbove: 0 },
    handling: { enabled: false, type: 'fixed', value: 0 },
    packing: { enabled: false, type: 'fixed', value: 0 },
    surcharge: { enabled: false, type: 'fixed', value: 0, label: 'Surcharge' },
  };
}

async function getChargeConfig() {
  const defaults = await defaultConfig();
  const raw = await getSetting(SETTING_KEY);
  if (!raw) return defaults;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return defaults;
  }
  return Object.fromEntries(Object.entries(defaults).map(([key, def]) => [key, { ...def, ...(saved[key] || {}) }]));
}

function validateCharge(name, input, { withFreeAbove = false, withLabel = false } = {}) {
  const fail = (message) => { throw new ApiError(422, 'Validation failed', [{ field: `${name}.${message.field}`, message: message.text }]); };
  if (!input || typeof input !== 'object') fail({ field: 'value', text: `${name} settings are required` });

  const type = input.type ?? 'fixed';
  if (!CHARGE_TYPES.includes(type)) fail({ field: 'type', text: 'type must be fixed or percent' });
  const value = Number(input.value ?? 0);
  if (!Number.isFinite(value) || value < 0) fail({ field: 'value', text: 'Enter an amount of 0 or more' });
  if (type === 'percent' && value > 100) fail({ field: 'value', text: 'A percentage can be at most 100' });

  const charge = { enabled: Boolean(input.enabled), type, value: round2(value) };

  if (withFreeAbove) {
    const freeAbove = Number(input.freeAbove ?? 0);
    if (!Number.isFinite(freeAbove) || freeAbove < 0) fail({ field: 'freeAbove', text: 'Enter an amount of 0 or more (0 = never free)' });
    charge.freeAbove = round2(freeAbove);
  }
  if (withLabel) {
    const label = String(input.label ?? '').trim() || 'Surcharge';
    if (label.length > MAX_LABEL_LENGTH) fail({ field: 'label', text: `Keep the label under ${MAX_LABEL_LENGTH} characters` });
    charge.label = label;
  }
  return charge;
}

async function saveChargeConfig(input) {
  const config = {
    delivery: validateCharge('delivery', input.delivery, { withFreeAbove: true }),
    handling: validateCharge('handling', input.handling),
    packing: validateCharge('packing', input.packing),
    surcharge: validateCharge('surcharge', input.surcharge, { withLabel: true }),
  };
  await Setting.findOneAndUpdate({ key: SETTING_KEY }, { value: JSON.stringify(config) }, { upsert: true });
  invalidateSettingsCache();
  return config;
}

function chargeAmount(charge, itemTotal) {
  if (!charge.enabled) return 0;
  return charge.type === 'percent' ? round2((itemTotal * charge.value) / 100) : round2(charge.value);
}

// Returns every charge for a cart whose item total is `itemTotal`. `deliveryPartnerEarning` is the
// delivery charge BEFORE any free-delivery waiver — the rider is still paid on a free-delivery
// order (see delivery.controller.js#completeJob).
function computeCharges(itemTotal, config) {
  const deliveryBase = chargeAmount(config.delivery, itemTotal);
  const freeDeliveryAbove = config.delivery.enabled && config.delivery.freeAbove > 0 ? config.delivery.freeAbove : null;
  const freeDeliveryApplied = freeDeliveryAbove !== null && itemTotal >= freeDeliveryAbove;
  const surcharge = chargeAmount(config.surcharge, itemTotal);

  return {
    deliveryFee: freeDeliveryApplied ? 0 : deliveryBase,
    deliveryPartnerEarning: deliveryBase,
    freeDeliveryAbove,
    freeDeliveryApplied,
    handlingCharge: chargeAmount(config.handling, itemTotal),
    packingCharge: chargeAmount(config.packing, itemTotal),
    surcharge,
    surchargeLabel: surcharge > 0 ? config.surcharge.label : null,
  };
}

module.exports = { getChargeConfig, saveChargeConfig, computeCharges, round2 };
