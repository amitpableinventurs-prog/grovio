const { Announcement, AnnouncementReceipt, User, DeliveryProfile, PickerProfile } = require('../models');
const ApiError = require('../utils/apiError');
const t = require('../utils/localTime');
const { notifyUser } = require('./notification.service');

// Company notices ("महत्वपूर्ण सूचना") for the Updates tab — models/announcement.model.js.
// Admins write and publish them (optionally scheduled, with a push notification); partners read
// them, and confirm the ones that need it ("Okay, I understand").

// ---- Body formatting ---------------------------------------------------------------------------

// "Hello **world**" -> [{ text: 'Hello ', bold: false }, { text: 'world', bold: true }]
function spans(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out.length ? out : [{ text, bold: false }];
}

// Body text -> blocks the app renders one by one:
//   heading    a line that is entirely **bold** (or starts with "# ")
//   bullet     "* ", "• ", "- " or ". " at the start
//   paragraph  other consecutive lines (line breaks kept)
function toBlocks(body) {
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      const text = para.join('\n');
      blocks.push({ type: 'paragraph', text: text.replace(/\*\*/g, ''), spans: spans(text) });
      para = [];
    }
  };
  for (const raw of String(body || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const bullet = line.match(/^(?:[*•\-]|\.)\s+(.*)$/);
    const heading = line.match(/^#{1,3}\s+(.*)$/) || line.match(/^\*\*([^*]+)\*\*:?$/);
    if (bullet) {
      flush();
      blocks.push({ type: 'bullet', text: bullet[1].replace(/\*\*/g, ''), spans: spans(bullet[1]) });
    } else if (heading) {
      flush();
      blocks.push({ type: 'heading', text: heading[1].replace(/:$/, ''), spans: [{ text: heading[1].replace(/:$/, ''), bold: true }] });
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

const plain = (body) => String(body || '').replace(/\*\*/g, '').replace(/^\s*(?:[*•\-]|\.)\s+/gm, '').replace(/\s+/g, ' ').trim();
const summaryOf = (a) => a.summary || (plain(a.body).length > 120 ? `${plain(a.body).slice(0, 117)}…` : plain(a.body));
// '2:02pm, 23 Sep'
const whenLabel = (d) => (d ? `${t.timeLabel(d)}, ${t.dayLabel(d)}` : null);

// ---- Audience --------------------------------------------------------------------------------

// The store a partner works at, for store-targeted notices.
async function storeOf(user) {
  if (user.role === 'picker') return (await PickerProfile.findOne({ user: user._id || user.id }).select('store'))?.store || null;
  if (user.role === 'delivery') return (await DeliveryProfile.findOne({ user: user._id || user.id }).select('hubCheckin'))?.hubCheckin?.store || null;
  return null;
}

// Notices a user can see right now.
async function visibleFilter(user) {
  const now = new Date();
  const uid = user._id || user.id;
  const store = await storeOf(user);
  return {
    status: 'published',
    'audience.roles': user.role,
    $and: [
      { $or: [{ publishAt: null }, { publishAt: { $lte: now } }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      { $or: [{ 'audience.users': { $size: 0 } }, { 'audience.users': uid }] },
      { $or: [{ 'audience.stores': { $size: 0 } }, ...(store ? [{ 'audience.stores': store }] : [])] },
    ],
  };
}

// A scheduled notice shows its scheduled time; otherwise when it was published.
const shownAt = (a) => a.publishAt || a.publishedAt;

function listItem(a, receipt) {
  return {
    id: a._id,
    title: a.title,
    summary: summaryOf(a),
    image: a.image,
    category: a.category,
    pinned: a.pinned,
    publishedAt: shownAt(a),
    publishedLabel: whenLabel(shownAt(a)),
    requireAck: a.requireAck,
    read: !!receipt?.readAt,
    acknowledged: !!receipt?.ackAt,
  };
}

// GET /common/announcements?category=&page=&limit=
async function listForUser(user, { category, offset = 0, limit = 20 } = {}) {
  const where = await visibleFilter(user);
  if (category) where.category = category;
  const [rows, count] = await Promise.all([
    Announcement.find(where).sort({ pinned: -1, publishedAt: -1 }).skip(offset).limit(limit).lean(),
    Announcement.countDocuments(where),
  ]);
  const receipts = await AnnouncementReceipt.find({ user: user._id || user.id, announcement: { $in: rows.map((r) => r._id) } }).lean();
  const byId = new Map(receipts.map((r) => [String(r.announcement), r]));
  return { items: rows.map((a) => listItem(a, byId.get(String(a._id)))), count };
}

// Unread + still-to-confirm counts (Updates tab badge).
async function unreadCount(user) {
  const visible = await Announcement.find(await visibleFilter(user)).select('_id requireAck').lean();
  const receipts = await AnnouncementReceipt.find({ user: user._id || user.id, announcement: { $in: visible.map((a) => a._id) } }).lean();
  const byId = new Map(receipts.map((r) => [String(r.announcement), r]));
  return {
    unread: visible.filter((a) => !byId.get(String(a._id))?.readAt).length,
    toAcknowledge: visible.filter((a) => a.requireAck && !byId.get(String(a._id))?.ackAt).length,
  };
}

async function findVisible(user, id) {
  const a = await Announcement.findOne({ _id: id, ...(await visibleFilter(user)) }).lean().catch(() => null);
  if (!a) throw new ApiError(404, 'Notice not found');
  return a;
}

// GET /common/announcements/:id — the Details page (marks it read).
async function detailForUser(user, id) {
  const a = await findVisible(user, id);
  const receipt = await AnnouncementReceipt.findOneAndUpdate(
    { announcement: a._id, user: user._id || user.id },
    { $setOnInsert: { readAt: new Date() } },
    { upsert: true, new: true },
  ).lean();
  return {
    ...listItem(a, receipt),
    body: a.body,
    blocks: toBlocks(a.body),
    cta: a.cta?.label && a.cta?.url ? a.cta : null,
    ackLabel: a.requireAck ? a.ackLabel : null,
    acknowledgedAt: receipt?.ackAt || null,
  };
}

// POST /common/announcements/:id/ack — "Okay, I understand".
async function acknowledge(user, id) {
  const a = await findVisible(user, id);
  const now = new Date();
  const receipt = await AnnouncementReceipt.findOneAndUpdate(
    { announcement: a._id, user: user._id || user.id },
    { $setOnInsert: { readAt: now }, $max: { ackAt: now } },
    { upsert: true, new: true },
  );
  return { id: a._id, acknowledged: true, acknowledgedAt: receipt.ackAt };
}

// ---- Admin -----------------------------------------------------------------------------------

// Everyone a notice is for (active accounts).
async function audienceUsers(a) {
  const where = { role: { $in: a.audience.roles }, isActive: true };
  if (a.audience.users?.length) where._id = { $in: a.audience.users };
  let users = await User.find(where).select('_id role name phone').lean();
  if (a.audience.stores?.length) {
    const stores = a.audience.stores.map(String);
    const [pickers, riders] = await Promise.all([
      PickerProfile.find({ user: { $in: users.filter((u) => u.role === 'picker').map((u) => u._id) } }).select('user store').lean(),
      DeliveryProfile.find({ user: { $in: users.filter((u) => u.role === 'delivery').map((u) => u._id) } }).select('user hubCheckin').lean(),
    ]);
    const storeOfUser = new Map([
      ...pickers.map((p) => [String(p.user), String(p.store)]),
      ...riders.map((r) => [String(r.user), String(r.hubCheckin?.store || '')]),
    ]);
    users = users.filter((u) => stores.includes(storeOfUser.get(String(u._id))));
  }
  return users;
}

// Push the notice to its audience once it's live (publish, or later by the background job).
async function notifyAudience(announcementId) {
  const a = await Announcement.findOneAndUpdate(
    { _id: announcementId, status: 'published', sendPush: true, notifiedAt: null, $or: [{ publishAt: null }, { publishAt: { $lte: new Date() } }] },
    { $set: { notifiedAt: new Date() } },
    { new: true },
  );
  if (!a) return 0;
  const users = await audienceUsers(a);
  const body = summaryOf(a);
  for (let i = 0; i < users.length; i += 50) {
    await Promise.all(users.slice(i, i + 50).map((u) => notifyUser(u._id, {
      title: a.title,
      body,
      type: 'announcement',
      data: { announcementId: a._id },
    }).catch(() => {})));
  }
  return users.length;
}

// Scheduled notices whose time has come (services/riderJobs.service.js).
async function notifyDue() {
  const due = await Announcement.find({ status: 'published', sendPush: true, notifiedAt: null, $or: [{ publishAt: null }, { publishAt: { $lte: new Date() } }] }).select('_id').limit(20);
  for (const a of due) await notifyAudience(a._id);
  return due.length;
}

async function publish(id) {
  const a = await Announcement.findById(id);
  if (!a) throw new ApiError(404, 'Notice not found');
  if (a.status === 'published') throw new ApiError(400, 'Already published');
  a.status = 'published';
  a.publishedAt = new Date();
  await a.save();
  const notified = await notifyAudience(a._id);
  return { announcement: a, notified };
}

// Reach: how many it's for, how many opened / confirmed it, and who hasn't confirmed yet.
async function stats(id) {
  const a = await Announcement.findById(id);
  if (!a) throw new ApiError(404, 'Notice not found');
  const [users, receipts] = await Promise.all([audienceUsers(a), AnnouncementReceipt.find({ announcement: a._id }).lean()]);
  const byUser = new Map(receipts.map((r) => [String(r.user), r]));
  const pending = users.filter((u) => (a.requireAck ? !byUser.get(String(u._id))?.ackAt : !byUser.get(String(u._id))?.readAt));
  return {
    audience: users.length,
    read: receipts.filter((r) => r.readAt).length,
    acknowledged: receipts.filter((r) => r.ackAt).length,
    pendingCount: pending.length,
    pending: pending.slice(0, 200).map((u) => ({ _id: u._id, name: u.name, phone: u.phone, role: u.role })),
  };
}

module.exports = { toBlocks, summaryOf, listForUser, unreadCount, detailForUser, acknowledge, audienceUsers, notifyAudience, notifyDue, publish, stats };
