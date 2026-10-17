const { Announcement, User, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { logAdminActivity } = require('../../services/audit.service');
const announcements = require('../../services/announcement.service');

// Admin: write, schedule and publish notices for delivery partners / pickers / customers.

const FIELDS = ['title', 'summary', 'body', 'image', 'category', 'pinned', 'requireAck', 'ackLabel', 'cta', 'publishAt', 'expiresAt', 'sendPush'];
const pick = (src) => Object.fromEntries(FIELDS.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));

async function audienceFrom(body, current = {}) {
  const a = body.audience || {};
  const audience = {
    roles: a.roles ?? current.roles ?? ['delivery'],
    stores: a.stores ?? current.stores ?? [],
    users: a.users ?? current.users ?? [],
  };
  if (audience.stores.length && (await Store.countDocuments({ _id: { $in: audience.stores } })) !== new Set(audience.stores.map(String)).size) {
    throw new ApiError(422, 'audience.stores must be store ids');
  }
  if (audience.users.length && (await User.countDocuments({ _id: { $in: audience.users }, role: { $in: audience.roles } })) !== new Set(audience.users.map(String)).size) {
    throw new ApiError(422, 'audience.users must be accounts with one of audience.roles');
  }
  return audience;
}

const withPreview = (a) => ({ ...a.toObject(), summary: announcements.summaryOf(a), blocks: announcements.toBlocks(a.body) });

// GET /admin/announcements?status=&category=&role=
const list = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.category) where.category = req.query.category;
  if (req.query.role) where['audience.roles'] = req.query.role;
  const [rows, count] = await Promise.all([
    Announcement.find(where).sort({ pinned: -1, createdAt: -1 }).skip(offset).limit(limit),
    Announcement.countDocuments(where),
  ]);
  new ApiResponse(200, { items: rows.map((a) => ({ ...a.toObject(), summary: announcements.summaryOf(a) })), meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// POST /admin/announcements { ..., publish?: true } -> draft, or published straight away
const create = catchAsync(async (req, res) => {
  const a = await Announcement.create({ ...pick(req.body), audience: await audienceFrom(req.body), createdBy: req.user.id });
  let notified = 0;
  if (req.body.publish) notified = (await announcements.publish(a._id)).notified;
  await logAdminActivity({ adminId: req.user.id, action: 'announcement.create', entityType: 'Announcement', entityId: a._id, metadata: { publish: !!req.body.publish } });
  const saved = await Announcement.findById(a._id);
  new ApiResponse(201, { ...withPreview(saved), notified }, req.body.publish ? 'Notice published' : 'Notice saved as draft').send(res);
});

const get = catchAsync(async (req, res) => {
  const a = await Announcement.findById(req.params.id);
  if (!a) throw new ApiError(404, 'Notice not found');
  new ApiResponse(200, withPreview(a)).send(res);
});

// PUT /admin/announcements/:id — edits show to everyone straight away, even after publishing.
const update = catchAsync(async (req, res) => {
  const a = await Announcement.findById(req.params.id);
  if (!a) throw new ApiError(404, 'Notice not found');
  a.set(pick(req.body));
  if (req.body.audience) a.audience = await audienceFrom(req.body, a.audience);
  await a.save();
  await logAdminActivity({ adminId: req.user.id, action: 'announcement.update', entityType: 'Announcement', entityId: a._id });
  new ApiResponse(200, withPreview(a), 'Notice updated').send(res);
});

// POST /admin/announcements/:id/publish -> live now (or at publishAt), push sent to the audience
const publish = catchAsync(async (req, res) => {
  const { announcement, notified } = await announcements.publish(req.params.id);
  await logAdminActivity({ adminId: req.user.id, action: 'announcement.publish', entityType: 'Announcement', entityId: announcement._id, metadata: { notified } });
  const scheduled = announcement.publishAt && announcement.publishAt > new Date();
  new ApiResponse(200, { ...withPreview(announcement), notified }, scheduled ? `Scheduled for ${announcement.publishAt.toISOString()}` : `Published — sent to ${notified} people`).send(res);
});

// DELETE /admin/announcements/:id -> archived (hidden from the apps)
const archive = catchAsync(async (req, res) => {
  const a = await Announcement.findByIdAndUpdate(req.params.id, { $set: { status: 'archived' } }, { new: true });
  if (!a) throw new ApiError(404, 'Notice not found');
  await logAdminActivity({ adminId: req.user.id, action: 'announcement.archive', entityType: 'Announcement', entityId: a._id });
  new ApiResponse(200, a, 'Notice archived').send(res);
});

// GET /admin/announcements/:id/stats -> reach, reads, confirmations, who hasn't read/confirmed
const stats = catchAsync(async (req, res) => {
  new ApiResponse(200, await announcements.stats(req.params.id)).send(res);
});

module.exports = { list, create, get, update, publish, archive, stats };
