const { body } = require('express-validator');

// Admin input for delivery partner gigs, incentive offers and earning adjustments.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const optionalNumber = (field, msg) => body(field).optional({ values: 'null' }).isFloat({ min: 0 }).withMessage(msg).toFloat();
const optionalInt = (field, min, msg) => body(field).optional({ values: 'null' }).isInt({ min }).withMessage(msg).toInt();

// POST /admin/gigs/bulk — every date × every slot.
const gigBulkRules = [
  body('storeId').optional({ values: 'null' }).isMongoId().withMessage('storeId must be a store id'),
  body('dates').isArray({ min: 1, max: 31 }).withMessage('dates must list 1–31 days (YYYY-MM-DD)'),
  body('dates.*').matches(DATE).withMessage('Each date must be YYYY-MM-DD'),
  body('slots').isArray({ min: 1, max: 48 }).withMessage('slots must list 1–48 gigs per day'),
  body('slots.*.from').matches(HHMM).withMessage('slot from must be HH:mm'),
  body('slots.*.to').matches(HHMM).withMessage('slot to must be HH:mm (00:00 = midnight)'),
  optionalNumber('slots.*.payPerHourMin', 'payPerHourMin must be a positive number'),
  optionalNumber('slots.*.payPerHourMax', 'payPerHourMax must be a positive number'),
  optionalInt('slots.*.capacity', 1, 'capacity must be at least 1 (or null for unlimited)'),
  optionalInt('slots.*.minLoginMinutes', 0, 'minLoginMinutes must be 0 or more'),
  body('slots.*.isFree').optional().isBoolean().toBoolean(),
  body('slots.*.isPriority').optional().isBoolean().toBoolean(),
];

// PATCH /admin/gigs/:id
const gigUpdateRules = [
  optionalNumber('payPerHourMin', 'payPerHourMin must be a positive number'),
  optionalNumber('payPerHourMax', 'payPerHourMax must be a positive number'),
  optionalInt('capacity', 1, 'capacity must be at least 1 (or null for unlimited)'),
  optionalInt('minLoginMinutes', 0, 'minLoginMinutes must be 0 or more'),
  body('isFree').optional().isBoolean().toBoolean(),
  body('isPriority').optional().isBoolean().toBoolean(),
  body('note').optional({ values: 'null' }).isString().isLength({ max: 120 }),
];

// POST/PUT /admin/offers
const offerRules = [
  body('title').trim().isLength({ min: 2, max: 80 }).withMessage('title is required (2–80 characters)'),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 500 }),
  body('startAt').isISO8601().withMessage('startAt must be a date-time').toDate(),
  body('endAt').isISO8601().withMessage('endAt must be a date-time').toDate()
    .custom((endAt, { req }) => {
      if (endAt <= req.body.startAt) throw new Error('endAt must be after startAt');
      return true;
    }),
  body('riders').optional().isArray().withMessage('riders must be a list of delivery partner ids (empty = everyone)'),
  body('riders.*').isMongoId().withMessage('riders must be delivery partner ids'),
  body('tiers').isArray({ min: 1, max: 10 }).withMessage('Add 1–10 tiers'),
  body('tiers.*.incentive').isFloat({ gt: 0 }).withMessage('Each tier needs an incentive amount above 0').toFloat(),
  optionalInt('tiers.*.minGigs', 0, 'minGigs must be 0 or more'),
  optionalInt('tiers.*.minOrders', 0, 'minOrders must be 0 or more'),
  optionalNumber('tiers.*.minEarnings', 'minEarnings must be a positive number'),
  body('tiers').custom((tiers) => {
    const has = (v) => v !== null && v !== undefined && v !== '';
    if (tiers.some((x) => !has(x.minGigs) && !has(x.minOrders) && !has(x.minEarnings))) {
      throw new Error('Each tier needs at least one of minGigs, minOrders or minEarnings');
    }
    return true;
  }),
  optionalInt('conditions.maxOrderDenials', 0, 'maxOrderDenials must be 0 or more (null = no limit)'),
  optionalInt('conditions.maxCancellations', 0, 'maxCancellations must be 0 or more (null = no limit)'),
  optionalInt('conditions.maxIncompleteGigs', 0, 'maxIncompleteGigs must be 0 or more (null = no limit)'),
  body('conditionAudio.*').optional({ values: 'null' }).isURL().withMessage('Condition audio must be a URL'),
  body('compulsoryLogin').optional().isArray({ max: 5 }),
  body('compulsoryLogin.*.from').matches(HHMM).withMessage('compulsoryLogin from must be HH:mm'),
  body('compulsoryLogin.*.to').matches(HHMM).withMessage('compulsoryLogin to must be HH:mm'),
  body('compulsoryLogin.*.minMinutes').isInt({ min: 1 }).withMessage('compulsoryLogin minMinutes must be at least 1').toInt(),
  body('videoUrl').optional({ values: 'null' }).isURL().withMessage('videoUrl must be a URL'),
];

// POST /admin/delivery-partners/:id/earnings — orderId ties it to a trip (shown in Trip details).
const earningAdjustmentRules = [
  body('amount').isFloat({ gt: 0, max: 100000 }).withMessage('amount must be above 0').toFloat(),
  body('reason').trim().isLength({ min: 3, max: 100 }).withMessage('reason is required (e.g. "Referral bonus", "Long Distance Return Pay")'),
  body('orderId').optional({ values: 'null' }).isMongoId().withMessage('orderId must be an order id'),
];

// POST /admin/delivery-partners/:id/deductions
const deductionRules = [
  body('amount').isFloat({ gt: 0, max: 100000 }).withMessage('amount must be above 0').toFloat(),
  body('title').trim().isLength({ min: 2, max: 60 }).withMessage('title is required (e.g. "Temp Manual Pay")'),
  body('description').optional({ values: 'null' }).trim().isLength({ max: 120 }),
  body('orderId').optional({ values: 'null' }).isMongoId().withMessage('orderId must be an order id'),
];

// POST /admin/delivery-partners/:id/cash-deposits
const cashDepositRules = [
  body('amount').isFloat({ gt: 0, max: 1000000 }).withMessage('amount must be above 0').toFloat(),
  body('reference').optional({ values: 'null' }).trim().isLength({ max: 60 }),
];

// POST/PUT /admin/announcements
const announcementRules = [
  body('title').if((v, { req }) => req.method === 'POST' || v !== undefined).trim().isLength({ min: 2, max: 120 }).withMessage('title is required (2–120 characters)'),
  body('body').if((v, { req }) => req.method === 'POST' || v !== undefined).isString().trim().isLength({ min: 2, max: 10000 }).withMessage('body is required'),
  body('summary').optional({ values: 'null' }).isString().isLength({ max: 200 }),
  body('category').optional().isIn(['important', 'payments', 'process', 'earnings', 'safety', 'general']).withMessage('Unknown category'),
  body('audience.roles').optional().isArray({ min: 1 }).withMessage('audience.roles: delivery, picker and/or customer'),
  body('audience.roles.*').isIn(['delivery', 'picker', 'customer']).withMessage('audience.roles: delivery, picker and/or customer'),
  body('audience.stores').optional().isArray(),
  body('audience.stores.*').isMongoId(),
  body('audience.users').optional().isArray(),
  body('audience.users.*').isMongoId(),
  body('pinned').optional().isBoolean().toBoolean(),
  body('requireAck').optional().isBoolean().toBoolean(),
  body('sendPush').optional().isBoolean().toBoolean(),
  body('publish').optional().isBoolean().toBoolean(),
  body('ackLabel').optional().isString().isLength({ max: 40 }),
  body('publishAt').optional({ values: 'null' }).isISO8601().toDate(),
  body('expiresAt').optional({ values: 'null' }).isISO8601().toDate(),
  body('cta.url').optional({ values: 'null' }).isURL(),
];

module.exports = { gigBulkRules, gigUpdateRules, offerRules, earningAdjustmentRules, deductionRules, cashDepositRules, announcementRules };
