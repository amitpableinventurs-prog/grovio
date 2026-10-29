const { SosAlert, Order, PickerProfile, DeliveryProfile } = require('../models');
const ApiError = require('../utils/apiError');
const { getSetting } = require('./settings.service');
const { sendTextSms } = require('./sms.service');
const { emitToRooms, ROOMS } = require('../sockets');
const { hasFullAccess } = require('../utils/storeScope');
const { PERMISSIONS } = require('../utils/permissions');
const { logServerError } = require('./errorLog.service');

// SOS for pickers, delivery partners and customers.
//
// The phone dials the helpline itself (tel:112 etc.): emergency numbers can't be called through a
// telephony API, and no public API dispatches police or an ambulance. What the backend does:
//   GET  /common/sos/config      the helpline numbers to show (admin-editable) + my open alert
//   POST /common/sos             raise an SOS / log a helpline call, with location. One active
//                                alert per person: tapping again (or another helpline) adds to it.
//   POST /common/sos/:id/location   live location while the alert is open
//   POST /common/sos/:id/cancel     "I'm safe"
// Raising one pushes 'sos:alert' to the ops team (admin panel → SOS Alerts, with a siren) and texts
// the person's emergency contact and the ops phone a map link. Admins acknowledge and resolve it;
// each change goes back to the person's app as 'sos:updated'.

// India. Override in Admin → Settings (sosHelplines, a JSON list of { key, label, number }).
const DEFAULT_HELPLINES = [
  { key: 'emergency', label: 'Emergency (Police, Fire, Ambulance)', number: '112' },
  { key: 'police', label: 'Police', number: '100' },
  { key: 'ambulance', label: 'Ambulance', number: '108' },
  { key: 'fire', label: 'Fire', number: '101' },
  { key: 'women', label: 'Women helpline', number: '1091' },
  { key: 'road_accident', label: 'Highway accident', number: '1033' },
];
const ACTIVE = ['open', 'acknowledged'];
// A new SOS after this long starts a new alert even if the old one was never closed.
const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_TRAIL = 500;
const ACTIVE_RIDER_ORDER = ['assigned', 'picked_up', 'out_for_delivery'];
const ACTIVE_PICKER_ORDER = ['accepted', 'picking', 'partially_picked', 'packed', 'assigned'];
const ACTIVE_CUSTOMER_ORDER = ['placed', 'accepted', 'picking', 'partially_picked', 'packed', 'assigned', 'picked_up', 'out_for_delivery'];

async function helplines() {
  const raw = await getSetting('sosHelplines', 'SOS_HELPLINES');
  let list = DEFAULT_HELPLINES;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const valid = Array.isArray(parsed) && parsed.filter((h) => h && h.key && h.label && h.number);
      if (valid && valid.length) list = valid.map((h) => ({ key: String(h.key), label: String(h.label), number: String(h.number) }));
    } catch {
      // bad JSON in the setting: keep the defaults rather than showing no numbers in an emergency
    }
  }
  const opsPhone = await getSetting('sosOpsPhone', 'SOS_OPS_PHONE');
  return opsPhone ? [...list, { key: 'grovio', label: 'Grovio safety team', number: String(opsPhone) }] : list;
}

function mapsLink(point) {
  return point ? `https://maps.google.com/?q=${point.lat},${point.lng}` : null;
}

function readPoint(body) {
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (body?.lat == null || body?.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const accuracy = Number(body.accuracy);
  return { lat, lng, accuracyM: Number.isFinite(accuracy) ? accuracy : null, at: new Date() };
}

async function emergencyContactOf(user) {
  const Profile = user.role === 'picker' ? PickerProfile : user.role === 'delivery' ? DeliveryProfile : null;
  if (!Profile) return null;
  const p = await Profile.findOne({ user: user._id }).select('emergencyContactName emergencyContactPhone').lean();
  return p?.emergencyContactPhone ? { name: p.emergencyContactName || null, phone: p.emergencyContactPhone } : null;
}

// The order this person is busy with right now, and the store it's at — so the ops team knows
// whom to call (customer, hub) and which hub manager sees the alert.
async function contextOf(user, orderId) {
  const me = user._id;
  let order = null;
  if (user.role === 'delivery') {
    order = await Order.findOne({ delivery: me, orderStatus: { $in: ACTIVE_RIDER_ORDER } }).sort({ updatedAt: -1 }).select('store');
  } else if (user.role === 'picker') {
    order = await Order.findOne({ 'pickTasks.picker': me, orderStatus: { $in: ACTIVE_PICKER_ORDER } }).sort({ updatedAt: -1 }).select('store');
  } else if (user.role === 'customer') {
    const where = { customer: me, orderStatus: { $in: ACTIVE_CUSTOMER_ORDER } };
    if (orderId && /^[a-f\d]{24}$/i.test(String(orderId))) where._id = orderId;
    order = await Order.findOne(where).sort({ updatedAt: -1 }).select('store');
  }
  let store = order?.store || null;
  if (!store && user.role === 'picker') store = (await PickerProfile.findOne({ user: me }).select('store').lean())?.store || null;
  if (!store && user.role === 'delivery') {
    const c = (await DeliveryProfile.findOne({ user: me }).select('hubCheckin').lean())?.hubCheckin;
    if (c?.store && c.expiresAt > new Date()) store = c.store;
  }
  return { order: order?._id || null, store };
}

// The alert as the ops team sees it (admin panel list/detail and socket pushes).
async function adminView(alertId) {
  return SosAlert.findById(alertId)
    .populate('user', 'name phone role')
    .populate('order', 'orderNumber orderStatus')
    .populate('store', 'name address phone')
    .populate('acknowledgedBy resolvedBy', 'name')
    .lean();
}

function adminRooms(alert) {
  const store = alert.store?._id || alert.store;
  return [ROOMS.sosAll, ...(store ? [ROOMS.store(String(store))] : [])];
}

async function pushToAdmins(event, alertId) {
  const view = await adminView(alertId);
  if (view) emitToRooms(adminRooms(view), event, view);
  return view;
}

// What the person's own app sees.
function userView(alert) {
  const a = alert.toObject ? alert.toObject() : alert;
  return {
    _id: a._id, kind: a.kind, status: a.status, note: a.note, location: a.location, calls: a.calls,
    acknowledgedAt: a.acknowledgedAt, resolvedAt: a.resolvedAt, resolutionNote: a.resolutionNote,
    cancelledAt: a.cancelledAt, createdAt: a.createdAt,
  };
}

function pushToUser(alert) {
  emitToRooms([ROOMS.user(String(alert.user?._id || alert.user))], 'sos:updated', userView(alert));
}

async function activeAlertOf(userId) {
  return SosAlert.findOne({ user: userId, status: { $in: ACTIVE }, createdAt: { $gt: new Date(Date.now() - ACTIVE_WINDOW_MS) } })
    .sort({ createdAt: -1 });
}

async function getConfig(user) {
  const [lines, contact, active] = await Promise.all([helplines(), emergencyContactOf(user), activeAlertOf(user._id)]);
  return { helplines: lines, emergencyContact: contact, activeAlert: active ? userView(active) : null };
}

// Texts the emergency contact and the ops phone once per alert, in the background.
async function notifyContacts(alertId, user) {
  const alert = await SosAlert.findById(alertId);
  if (!alert || alert.contactsNotified.length) return;
  const targets = [];
  const contact = await emergencyContactOf(user);
  if (contact) targets.push({ kind: 'emergency_contact', ...contact });
  const opsPhone = await getSetting('sosOpsPhone', 'SOS_OPS_PHONE');
  if (opsPhone) targets.push({ kind: 'ops', name: 'Ops', phone: String(opsPhone) });
  if (!targets.length) return;

  const who = `${user.name || 'A Grovio user'}${user.phone ? ` (${user.phone})` : ''}`;
  const link = mapsLink(alert.location) || 'location not shared';
  const message = `SOS: ${who} needs help. Location: ${link}. Sent by Grovio.`;
  for (const t of targets) {
    const r = await sendTextSms(t.phone, message, { msg91TemplateSetting: 'smsSosTemplateId', vars: { NAME: who, LINK: link } });
    alert.contactsNotified.push({ kind: t.kind, name: t.name, phone: t.phone, sent: !!r.sent, reason: r.sent ? null : r.reason });
  }
  await alert.save();
  await pushToAdmins('sos:updated', alert._id);
}

// POST /common/sos { kind, lat, lng, accuracy?, note?, orderId? }
async function raise(user, body = {}) {
  const lines = await helplines();
  const kind = String(body.kind || 'sos');
  const helpline = lines.find((h) => h.key === kind);
  if (kind !== 'sos' && !helpline) throw new ApiError(422, `kind must be 'sos' or one of: ${lines.map((h) => h.key).join(', ')}`);
  const point = readPoint(body);
  const note = body.note ? String(body.note).slice(0, 500) : null;

  let alert = await activeAlertOf(user._id);
  const created = !alert;
  if (created) {
    const ctx = await contextOf(user, body.orderId);
    alert = new SosAlert({ user: user._id, role: user.role, kind, note, location: point, trail: point ? [point] : [], ...ctx });
  } else {
    if (point) {
      alert.location = point;
      if (alert.trail.length < MAX_TRAIL) alert.trail.push(point);
    }
    if (note) alert.note = alert.note ? `${alert.note}\n${note}` : note;
  }
  if (helpline) alert.calls.push({ key: helpline.key, number: helpline.number });
  await alert.save();

  await pushToAdmins(created ? 'sos:alert' : 'sos:updated', alert._id);
  if (created) notifyContacts(alert._id, user).catch((err) => logServerError('SOS SMS failed', err));

  return {
    alert: userView(alert),
    created,
    // What the app dials (it never waits for this response to start the call).
    dial: helpline ? helpline.number : null,
    helplines: lines,
  };
}

async function ownActiveAlert(user, id) {
  const alert = await SosAlert.findOne({ _id: id, user: user._id });
  if (!alert) throw new ApiError(404, 'SOS alert not found');
  if (!ACTIVE.includes(alert.status)) throw new ApiError(400, `This SOS is already ${alert.status}`);
  return alert;
}

// POST /common/sos/:id/location { lat, lng, accuracy? } — every ~10 s while the alert is open.
async function addLocation(user, id, body) {
  const alert = await ownActiveAlert(user, id);
  const point = readPoint(body);
  if (!point) throw new ApiError(422, 'lat and lng must be valid coordinates');
  alert.location = point;
  if (alert.trail.length < MAX_TRAIL) alert.trail.push(point);
  await alert.save();
  emitToRooms(adminRooms(alert), 'sos:location', { alertId: alert._id, ...point });
  return userView(alert);
}

// POST /common/sos/:id/cancel { reason? } — "I'm safe" / pressed by mistake.
async function cancel(user, id, body = {}) {
  const alert = await ownActiveAlert(user, id);
  alert.status = 'cancelled';
  alert.cancelledAt = new Date();
  alert.cancelReason = body.reason ? String(body.reason).slice(0, 300) : null;
  await alert.save();
  await pushToAdmins('sos:updated', alert._id);
  return userView(alert);
}

async function listMine(user, { offset, limit }) {
  const where = { user: user._id };
  const [items, count] = await Promise.all([
    SosAlert.find(where).sort({ createdAt: -1 }).skip(offset).limit(limit),
    SosAlert.countDocuments(where),
  ]);
  return { items: items.map(userView), count };
}

// ---- Admin -----------------------------------------------------------------------------------

// Full access to SOS: anyone who manages orders, riders or pickers platform-wide. A store manager
// sees only alerts at their own store.
function adminScope(admin) {
  const full = [PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_PICKERS].some((perm) => hasFullAccess(admin, perm));
  if (full) return {};
  if (!admin.assignedStore) throw new ApiError(403, 'Your account is not assigned to a store yet — contact an admin.');
  return { store: admin.assignedStore };
}

async function adminList(admin, { status, role, offset, limit }) {
  const scope = adminScope(admin);
  const where = { ...scope };
  if (status === 'active') where.status = { $in: ACTIVE };
  else if (status) where.status = status;
  if (role) where.role = role;
  const [items, count, activeCount] = await Promise.all([
    SosAlert.find(where).select('-trail')
      .populate('user', 'name phone role')
      .populate('order', 'orderNumber orderStatus')
      .populate('store', 'name')
      .populate('acknowledgedBy resolvedBy', 'name')
      .sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    SosAlert.countDocuments(where),
    SosAlert.countDocuments({ ...scope, status: { $in: ACTIVE } }),
  ]);
  return { items, count, activeCount };
}

async function adminFind(admin, id) {
  const scope = adminScope(admin);
  const alert = await SosAlert.findOne({ _id: id, ...scope });
  if (!alert) throw new ApiError(404, 'SOS alert not found');
  return alert;
}

async function adminGet(admin, id) {
  const alert = await adminFind(admin, id);
  return adminView(alert._id);
}

async function acknowledge(admin, id) {
  const alert = await adminFind(admin, id);
  if (alert.status !== 'open') throw new ApiError(400, `This SOS is already ${alert.status}`);
  alert.status = 'acknowledged';
  alert.acknowledgedBy = admin._id;
  alert.acknowledgedAt = new Date();
  await alert.save();
  pushToUser(alert);
  return pushToAdmins('sos:updated', alert._id);
}

async function resolve(admin, id, { note } = {}) {
  const alert = await adminFind(admin, id);
  if (!ACTIVE.includes(alert.status)) throw new ApiError(400, `This SOS is already ${alert.status}`);
  alert.status = 'resolved';
  alert.resolvedBy = admin._id;
  alert.resolvedAt = new Date();
  alert.resolutionNote = note ? String(note).slice(0, 1000) : null;
  if (!alert.acknowledgedAt) {
    alert.acknowledgedBy = admin._id;
    alert.acknowledgedAt = alert.resolvedAt;
  }
  await alert.save();
  pushToUser(alert);
  return pushToAdmins('sos:updated', alert._id);
}

module.exports = {
  DEFAULT_HELPLINES,
  helplines,
  getConfig,
  raise,
  addLocation,
  cancel,
  listMine,
  adminList,
  adminGet,
  acknowledge,
  resolve,
};
