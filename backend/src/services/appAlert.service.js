const crypto = require('crypto');
const { AppAlert } = require('../models');

// Alert messages for the apps (models/appAlert.model.js).

const APPS = AppAlert.schema.path('apps').caster.enumValues;
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2, success: 3 };

// off: switched off · scheduled: not started yet · ended: past endsAt · live: showing now
function alertStatus(alert, now = new Date()) {
  if (!alert.isActive) return 'off';
  if (alert.startsAt && alert.startsAt > now) return 'scheduled';
  if (alert.endsAt && alert.endsAt <= now) return 'ended';
  return 'live';
}

function liveQuery(app, now = new Date()) {
  return {
    isActive: true,
    apps: app,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
    ],
  };
}

// Changes only when what the user sees changes, so switching an alert off and on again doesn't
// bring it back for people who closed it.
function dismissKey(alert) {
  const shown = JSON.stringify([alert.title, alert.message, alert.severity, alert.display, alert.cta?.label, alert.cta?.url]);
  return `${alert._id}:${crypto.createHash('sha1').update(shown).digest('hex').slice(0, 10)}`;
}

// What an app gets: critical first, then the newest.
function appView(alert) {
  return {
    id: alert._id,
    title: alert.title,
    message: alert.message,
    severity: alert.severity,
    display: alert.display,
    dismissible: alert.dismissible,
    cta: alert.cta?.label && alert.cta?.url ? { label: alert.cta.label, url: alert.cta.url } : null,
    startsAt: alert.startsAt,
    endsAt: alert.endsAt,
    // Remember a dismissal under this key; an edit to the text, colour, style or button changes it.
    dismissKey: dismissKey(alert),
  };
}

async function liveForApp(app) {
  const alerts = await AppAlert.find(liveQuery(app)).sort({ updatedAt: -1 }).limit(20);
  return alerts
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.updatedAt - a.updatedAt)
    .map(appView);
}

// Tell the apps (socket 'alerts:changed') to fetch their alerts again: the alert's apps, plus the
// ones it was just removed from.
function notifyApps(apps) {
  const { emitToRooms, ROOMS } = require('../sockets');
  const rooms = [...new Set(apps)].map((app) => ROOMS.role(app));
  if (rooms.length) emitToRooms(rooms, 'alerts:changed', {});
}

module.exports = { APPS, alertStatus, liveForApp, notifyApps };
