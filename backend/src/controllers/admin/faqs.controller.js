const { Faq } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { logAdminActivity } = require('../../services/audit.service');
const { FAQ_TOPICS, ALL_TOPIC_KEYS, validTopic } = require('../../services/support.service');

// FAQs on the apps' Support screen (models/faq.model.js) — read by GET /common/support/faqs.

const APPS = ['all', ...Object.keys(FAQ_TOPICS)];

// GET /admin/faq-topics -> topics each app shows (for the admin form)
const listTopics = catchAsync(async (req, res) => {
  new ApiResponse(200, { ...FAQ_TOPICS, all: ALL_TOPIC_KEYS.map((key) => ({ key })) }).send(res);
});

// GET /admin/faqs?app=&topic=&isActive= -> every FAQ, inactive included
const listFaqs = catchAsync(async (req, res) => {
  const where = {};
  if (req.query.app) where.app = req.query.app;
  if (req.query.topic) where.topic = req.query.topic;
  if (req.query.isActive !== undefined && req.query.isActive !== '') where.isActive = String(req.query.isActive) === 'true';
  const items = await Faq.find(where).sort({ app: 1, topic: 1, sortOrder: 1, createdAt: 1 });
  new ApiResponse(200, items).send(res);
});

// Checks and normalizes a create / update body. `current` is the FAQ being updated.
function readBody(body, current = null) {
  const out = {};
  const app = body.app !== undefined ? String(body.app) : current?.app ?? 'all';
  if (!APPS.includes(app)) throw new ApiError(422, `app must be one of: ${APPS.join(', ')}`);
  if (body.app !== undefined) out.app = app;

  const topic = body.topic !== undefined ? String(body.topic) : current?.topic;
  if (!topic) throw new ApiError(422, 'topic is required');
  if (!validTopic(app, topic)) {
    const allowed = app === 'all' ? ALL_TOPIC_KEYS : FAQ_TOPICS[app].map((x) => x.key);
    throw new ApiError(422, `topic for app '${app}' must be one of: ${allowed.join(', ')}`);
  }
  if (body.topic !== undefined) out.topic = topic;

  for (const field of ['question', 'answer']) {
    if (body[field] !== undefined || !current) {
      const v = String(body[field] ?? '').trim();
      if (!v) throw new ApiError(422, `${field} is required`);
      out[field] = v;
    }
  }
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isFinite(n)) throw new ApiError(422, 'sortOrder must be a number');
    out.sortOrder = n;
  }
  if (body.isActive !== undefined) out.isActive = body.isActive === true || body.isActive === 'true';
  return out;
}

// POST /admin/faqs { app, topic, question, answer, sortOrder?, isActive? }
const createFaq = catchAsync(async (req, res) => {
  const faq = await Faq.create(readBody(req.body || {}));
  await logAdminActivity({ adminId: req.user.id, action: 'faq.create', entityType: 'Faq', entityId: faq._id, metadata: { app: faq.app, topic: faq.topic } });
  new ApiResponse(201, faq, 'FAQ created').send(res);
});

// PATCH /admin/faqs/:id { app?, topic?, question?, answer?, sortOrder?, isActive? }
const updateFaq = catchAsync(async (req, res) => {
  const faq = await Faq.findById(req.params.id);
  if (!faq) throw new ApiError(404, 'FAQ not found');
  Object.assign(faq, readBody(req.body || {}, faq));
  await faq.save();
  await logAdminActivity({ adminId: req.user.id, action: 'faq.update', entityType: 'Faq', entityId: faq._id, metadata: { app: faq.app, topic: faq.topic } });
  new ApiResponse(200, faq, 'FAQ updated').send(res);
});

// DELETE /admin/faqs/:id
const deleteFaq = catchAsync(async (req, res) => {
  const faq = await Faq.findByIdAndDelete(req.params.id);
  if (!faq) throw new ApiError(404, 'FAQ not found');
  await logAdminActivity({ adminId: req.user.id, action: 'faq.delete', entityType: 'Faq', entityId: faq._id, metadata: { app: faq.app, topic: faq.topic, question: faq.question } });
  new ApiResponse(200, null, 'FAQ deleted').send(res);
});

module.exports = { listTopics, listFaqs, createFaq, updateFaq, deleteFaq };
