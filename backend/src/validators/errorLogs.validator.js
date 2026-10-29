const { body, query } = require('express-validator');
const { CLIENT_APPS, LEVELS, SOURCES } = require('../services/errorLog.service');

// POST /common/error-logs takes one error, or { errors: [...] } (a queue sent after being offline).
// Both are validated as a list.
function asErrorList(req, res, next) {
  if (!Array.isArray(req.body?.errors)) req.body = { errors: [req.body || {}] };
  next();
}

const reportErrorRules = [
  body('errors').isArray({ min: 1, max: 20 }).withMessage('Send 1–20 errors at a time'),
  body('errors.*.message').isString().withMessage('message is required').bail().trim().notEmpty().withMessage('message is required'),
  body('errors.*.app').isIn(CLIENT_APPS).withMessage(`app must be one of: ${CLIENT_APPS.join(', ')}`),
  body('errors.*.source').optional().isIn(['mobile', 'web']).withMessage('source must be mobile or web'),
  body('errors.*.level').optional().isIn(LEVELS).withMessage(`level must be one of: ${LEVELS.join(', ')}`),
  body('errors.*.platform').optional().isIn(['android', 'ios', 'web']).withMessage('platform must be android, ios or web'),
  body('errors.*.occurredAt').optional().isISO8601().withMessage('occurredAt must be an ISO date-time').toDate(),
  body('errors.*.statusCode').optional({ values: 'null' }).isInt({ min: 100, max: 599 }).withMessage('statusCode must be an HTTP status').toInt(),
  body('errors.*.stack').optional({ values: 'null' }).isString(),
  body('errors.*.screen').optional({ values: 'null' }).isString(),
  body('errors.*.url').optional({ values: 'null' }).isString(),
  body('errors.*.method').optional({ values: 'null' }).isString(),
  body('errors.*.appVersion').optional({ values: 'null' }).isString(),
  body('errors.*.deviceModel').optional({ values: 'null' }).isString(),
  body('errors.*.osVersion').optional({ values: 'null' }).isString(),
  body('errors.*.context').optional({ values: 'null' }).isObject().withMessage('context must be an object'),
];

// GET / DELETE /admin/error-logs filters.
const errorLogFilterRules = [
  query('from').optional().isISO8601().withMessage('from must be an ISO date-time'),
  query('to').optional().isISO8601().withMessage('to must be an ISO date-time'),
  query('source').optional().isIn(SOURCES).withMessage(`source must be one of: ${SOURCES.join(', ')}`),
  query('app').optional().isIn([...CLIENT_APPS, 'backend']).withMessage('Unknown app'),
  query('level').optional().isIn(LEVELS).withMessage(`level must be one of: ${LEVELS.join(', ')}`),
  query('sort').optional().isIn(['newest', 'oldest']).withMessage('sort must be newest or oldest'),
];

module.exports = { asErrorList, reportErrorRules, errorLogFilterRules };
