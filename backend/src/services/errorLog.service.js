const { ErrorLog } = require('../models');

// Admin > Error Logs (models/errorLog.model.js). Writing a log must never throw or hold up the
// request that hit the error: failures to write only go to the console.

const APPS = ErrorLog.schema.path('app').enumValues;
const CLIENT_APPS = APPS.filter((a) => a !== 'backend');
const LEVELS = ErrorLog.schema.path('level').enumValues;
const SOURCES = ErrorLog.schema.path('source').enumValues;

const MAX_CONTEXT = 8000;
// Request fields never stored as-is (passwords, OTPs, tokens, delivery PINs, device keys, …).
const SECRET_FIELD = /password|passwd|otp|token|secret|authorization|cvv|cardnumber|pin$|key$/i;

const cut = (v, n) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, n));

function mask(value, depth = 0) {
  if (value === null || value === undefined || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 500) : value;
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => mask(v, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([k, v]) => [k, SECRET_FIELD.test(k) ? '[hidden]' : mask(v, depth + 1)]));
}

// Secrets masked, empty parts dropped, size capped.
function cleanContext(value) {
  if (!value || typeof value !== 'object') return null;
  const clean = Object.fromEntries(Object.entries(mask(value)).filter(([, v]) => v !== undefined && v !== null && !(typeof v === 'object' && !Object.keys(v).length)));
  if (!Object.keys(clean).length) return null;
  const json = JSON.stringify(clean);
  return json.length > MAX_CONTEXT ? { truncated: json.slice(0, MAX_CONTEXT) } : clean;
}

async function write(entry) {
  try {
    await ErrorLog.create({ ...entry, message: cut(entry.message, 2000) || 'Unknown error', stack: cut(entry.stack, 20000) });
  } catch (err) {
    console.error('Failed to write error log:', err.message);
  }
}

// A 5xx from an API request (middleware/error.middleware.js).
function logRequestError(err, req, statusCode) {
  return write({
    source: 'backend',
    app: 'backend',
    message: err?.message || 'Internal server error',
    stack: err?.stack,
    method: req.method,
    url: req.originalUrl.split('?')[0],
    statusCode,
    user: req.user?._id || null,
    role: req.user?.role || null,
    ip: req.ip,
    userAgent: cut(req.get('user-agent'), 300),
    context: cleanContext({ query: req.query, params: req.params, body: req.body }),
  });
}

// An error that never reaches a response: background jobs, push / SMS / IVR side effects, sockets.
// Prints to the console as before, and logs it.
function logServerError(label, err, context) {
  if (err) console.error(`${label}:`, err.message ?? err);
  else console.error(label);
  write({
    source: 'backend',
    app: 'backend',
    message: err ? `${label}: ${err.message ?? err}` : label,
    stack: err?.stack,
    context: cleanContext(context),
  });
}

// The process is about to die (server.js). Resolves once logged, or after 3s.
function logCrash(label, err) {
  const logged = write({ source: 'backend', app: 'backend', level: 'fatal', message: `${label}: ${err?.message ?? err}`, stack: err?.stack });
  return Promise.race([logged, new Promise((resolve) => setTimeout(resolve, 3000).unref())]);
}

// POST /common/error-logs — already validated (validators/errorLogs.validator.js).
async function saveClientErrors(errors, req) {
  const latest = Date.now() + 5 * 60 * 1000; // a device clock a little ahead is fine, more is not
  const docs = errors.map((e) => ({
    source: e.source || 'mobile',
    app: e.app,
    level: e.level || 'error',
    message: cut(e.message, 2000),
    stack: cut(e.stack, 20000),
    occurredAt: e.occurredAt && e.occurredAt.getTime() <= latest ? e.occurredAt : new Date(),
    method: cut(e.method, 10),
    url: cut(e.url, 500),
    statusCode: e.statusCode ?? null,
    screen: cut(e.screen, 200),
    platform: e.platform || null,
    appVersion: cut(e.appVersion, 50),
    deviceModel: cut(e.deviceModel, 100),
    osVersion: cut(e.osVersion, 50),
    user: req.user?._id || null,
    role: req.user?.role || null,
    ip: req.ip,
    userAgent: cut(req.get('user-agent'), 300),
    context: cleanContext(e.context),
  }));
  await ErrorLog.insertMany(docs);
  return docs.length;
}

// The report endpoint works without login, so each IP may send at most 100 errors per 10 minutes.
const REPORT_WINDOW_MS = 10 * 60 * 1000;
const REPORT_LIMIT = 100;
const reportsByIp = new Map();
function allowClientReport(ip, count) {
  const now = Date.now();
  if (reportsByIp.size > 10000) reportsByIp.clear();
  const seen = reportsByIp.get(ip);
  if (!seen || now - seen.since > REPORT_WINDOW_MS) {
    reportsByIp.set(ip, { since: now, count });
    return count <= REPORT_LIMIT;
  }
  seen.count += count;
  return seen.count <= REPORT_LIMIT;
}

module.exports = {
  APPS,
  CLIENT_APPS,
  LEVELS,
  SOURCES,
  logRequestError,
  logServerError,
  logCrash,
  saveClientErrors,
  allowClientReport,
};
