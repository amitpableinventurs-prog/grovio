const { body, query } = require('express-validator');
const { APPS } = require('../services/appAlert.service');

// POST / PUT /admin/alerts
const alertRules = [
  body('title').optional({ values: 'null' }).isString().trim().isLength({ max: 80 }).withMessage('title can be at most 80 characters'),
  body('message').isString().withMessage('message is required').bail().trim().isLength({ min: 2, max: 500 }).withMessage('message is required (2–500 characters)'),
  body('severity').optional().isIn(['info', 'success', 'warning', 'critical']).withMessage('severity must be info, success, warning or critical'),
  body('display').optional().isIn(['banner', 'popup']).withMessage('display must be banner or popup'),
  body('apps').isArray({ min: 1 }).withMessage(`Pick at least one app: ${APPS.join(', ')}`),
  body('apps.*').isIn(APPS).withMessage(`apps must be from: ${APPS.join(', ')}`),
  body('dismissible').optional().isBoolean().withMessage('dismissible must be true or false').toBoolean(),
  body('isActive').optional().isBoolean().withMessage('isActive must be true or false').toBoolean(),
  body('cta.label').optional({ values: 'null' }).isString().trim().isLength({ max: 30 }).withMessage('Button text can be at most 30 characters'),
  body('cta.url').optional({ values: 'null' }).isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('Button link must be a full http(s) URL'),
  body('cta').optional({ values: 'null' }).custom((cta) => {
    if (cta && !!cta.label !== !!cta.url) throw new Error('A button needs both its text and its link');
    return true;
  }),
  body('startsAt').optional({ values: 'null' }).isISO8601().withMessage('startsAt must be a date-time').toDate(),
  body('endsAt').optional({ values: 'null' }).isISO8601().withMessage('endsAt must be a date-time').toDate()
    .custom((endsAt, { req }) => {
      if (req.body.startsAt && endsAt <= new Date(req.body.startsAt)) throw new Error('endsAt must be after startsAt');
      return true;
    }),
];

// PATCH /admin/alerts/:id/active
const alertActiveRules = [
  body('isActive').isBoolean().withMessage('isActive must be true or false').toBoolean(),
];

// GET /admin/alerts
const alertListRules = [
  query('status').optional().isIn(['live', 'scheduled', 'ended', 'off']).withMessage('status must be live, scheduled, ended or off'),
  query('app').optional().isIn(APPS).withMessage(`app must be one of: ${APPS.join(', ')}`),
];

// GET /common/alerts — signed-out apps say which app they are.
const appAlertsRules = [
  query('app').optional().isIn(APPS).withMessage(`app must be one of: ${APPS.join(', ')}`),
];

module.exports = { alertRules, alertActiveRules, alertListRules, appAlertsRules };
