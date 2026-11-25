const { SupportTicket, Faq } = require('../models');
const { getSetting } = require('./settings.service');
const t = require('../utils/localTime');

// The apps' Support screen (GET /common/support/home): "Call support" with its hours, "Chat with
// us" with the typical reply time, and "FAQs" by topic. Chat itself is the support tickets in
// controllers/common/support.controller.js; FAQs are admin-editable (models/faq.model.js).
//
// Settings (Admin > Settings, PUT /admin/settings; .env as the fallback):
//   supportPhone            SUPPORT_PHONE            number for every app, e.g. +919876543210
//   deliverySupportPhone / pickerSupportPhone / customerSupportPhone   per-app override
//   supportHoursFrom        SUPPORT_HOURS_FROM       'HH:MM' local time, default 07:00
//   supportHoursTo          SUPPORT_HOURS_TO         'HH:MM' local time, default 23:00
//   supportChatReplyMinutes SUPPORT_CHAT_REPLY_MINUTES  shown until there are enough real replies, default 2

// FAQ topics per app, in display order. The FAQs row's subtitle lists them ("Payouts, orders,
// documents").
const FAQ_TOPICS = {
  delivery: [
    { key: 'payouts', label: 'Payouts' },
    { key: 'orders', label: 'Orders' },
    { key: 'documents', label: 'Documents' },
  ],
  picker: [
    { key: 'payouts', label: 'Payouts' },
    { key: 'orders', label: 'Orders' },
    { key: 'documents', label: 'Documents' },
  ],
  customer: [
    { key: 'orders', label: 'Orders' },
    { key: 'payments', label: 'Payments & refunds' },
    { key: 'account', label: 'Account' },
  ],
};
const APPS = Object.keys(FAQ_TOPICS);
const topicsFor = (app) => FAQ_TOPICS[app] || [];
// Topics an 'all' FAQ may use: any app's.
const ALL_TOPIC_KEYS = [...new Set(APPS.flatMap((a) => FAQ_TOPICS[a].map((x) => x.key)))];
const validTopic = (app, topic) => (app === 'all' ? ALL_TOPIC_KEYS : topicsFor(app).map((x) => x.key)).includes(topic);

// ---- Call support -------------------------------------------------------------------------------

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// '07:00' -> '7 AM', '23:30' -> '11:30 PM'
function clockLabel(hhmm) {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3);
  return `${h % 12 || 12}${m === '00' ? '' : `:${m}`} ${h < 12 ? 'AM' : 'PM'}`;
}

async function supportHours() {
  const read = async (key, env, fallback) => {
    const v = String((await getSetting(key, env)) || '').trim();
    return HHMM.test(v) ? v : fallback;
  };
  return { from: await read('supportHoursFrom', 'SUPPORT_HOURS_FROM', '07:00'), to: await read('supportHoursTo', 'SUPPORT_HOURS_TO', '23:00') };
}

// Open now, in local time? A range like 22:00–06:00 runs past midnight; equal ends = all day.
function isOpenAt(hours, date = new Date()) {
  const now = t.localMinutes(date);
  const from = toMinutes(hours.from);
  const to = toMinutes(hours.to);
  if (from === to) return true;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

async function supportPhone(app) {
  const own = APPS.includes(app) ? await getSetting(`${app}SupportPhone`) : null;
  const phone = String(own || (await getSetting('supportPhone', 'SUPPORT_PHONE')) || '').replace(/[^\d+]/g, '');
  return phone || null;
}

async function callItem(app, now) {
  const [phone, hours] = await Promise.all([supportPhone(app), supportHours()]);
  const allDay = hours.from === hours.to;
  return {
    key: 'call',
    title: 'Call support',
    subtitle: allDay ? 'Open 24 hours' : `${clockLabel(hours.from)} – ${clockLabel(hours.to)}`,
    // false when no number is set: show the row disabled.
    enabled: !!phone,
    phone,
    dialUrl: phone ? `tel:${phone}` : null,
    hours,
    isOpenNow: isOpenAt(hours, now),
  };
}

// ---- Chat with us -------------------------------------------------------------------------------

const REPLY_WINDOW_DAYS = 30;
const MIN_SAMPLES = 5;
let replyCache = null; // { minutes, at }
const REPLY_CACHE_MS = 5 * 60 * 1000;

// Typical time to the first support reply on tickets from the last 30 days (the median, so one
// ticket left overnight doesn't skew it). Too few replied tickets -> the configured figure.
async function typicalReplyMinutes() {
  if (replyCache && Date.now() - replyCache.at < REPLY_CACHE_MS) return replyCache.minutes;
  const since = new Date(Date.now() - REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const tickets = await SupportTicket.find({ createdAt: { $gte: since }, 'messages.sender': 'agent' })
    .select('createdAt messages.sender messages.createdAt')
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  const waits = tickets
    .map((tk) => {
      const first = (tk.messages || []).find((m) => m.sender === 'agent' && m.createdAt);
      return first ? (new Date(first.createdAt) - new Date(tk.createdAt)) / 60000 : null;
    })
    .filter((m) => m != null && m >= 0)
    .sort((a, b) => a - b);

  let minutes;
  if (waits.length >= MIN_SAMPLES) {
    const mid = Math.floor(waits.length / 2);
    minutes = waits.length % 2 ? waits[mid] : (waits[mid - 1] + waits[mid]) / 2;
  } else {
    minutes = Number(await getSetting('supportChatReplyMinutes', 'SUPPORT_CHAT_REPLY_MINUTES')) || 2;
  }
  minutes = Math.max(1, Math.ceil(minutes));
  replyCache = { minutes, at: Date.now() };
  return minutes;
}

function replyLabel(minutes) {
  if (minutes < 60) return `Average reply in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `Average reply in ${hours} hr${hours === 1 ? '' : 's'}`;
}

async function chatItem(userId) {
  const [minutes, open] = await Promise.all([
    typicalReplyMinutes(),
    SupportTicket.find({ user: userId, status: { $in: ['open', 'in_progress'] } }).select('_id').sort({ updatedAt: -1 }).lean(),
  ]);
  return {
    key: 'chat',
    title: 'Chat with us',
    subtitle: replyLabel(minutes),
    enabled: true,
    averageReplyMinutes: minutes,
    // My unclosed tickets: the app can open the latest one instead of starting a new chat.
    openTickets: open.length,
    activeTicketId: open[0]?._id || null,
  };
}

// ---- FAQs ---------------------------------------------------------------------------------------

const faqFilter = (app) => ({ app: { $in: ['all', app] }, isActive: true });

async function faqTopicsWithCounts(app) {
  const rows = await Faq.aggregate([{ $match: faqFilter(app) }, { $group: { _id: '$topic', count: { $sum: 1 } } }]);
  const counts = new Map(rows.map((r) => [r._id, r.count]));
  return topicsFor(app).map((x) => ({ ...x, count: counts.get(x.key) || 0 }));
}

function joinLabels(labels) {
  if (!labels.length) return '';
  const [first, ...rest] = labels;
  return [first, ...rest.map((l) => l.toLowerCase())].join(', ');
}

async function faqItem(app) {
  const topics = await faqTopicsWithCounts(app);
  return {
    key: 'faqs',
    title: 'FAQs',
    subtitle: joinLabels(topics.map((x) => x.label)),
    enabled: topics.some((x) => x.count > 0),
    topics,
  };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// FAQs for my app, optionally one topic and/or a search over question and answer.
async function listFaqs(app, { topic, q } = {}) {
  const where = faqFilter(app);
  if (topic) where.topic = topic;
  const search = String(q || '').trim().slice(0, 100);
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    where.$or = [{ question: re }, { answer: re }];
  }
  const known = topicsFor(app).map((x) => x.key);
  const items = await Faq.find(where).select('topic question answer sortOrder updatedAt').sort({ sortOrder: 1, createdAt: 1 }).lean();
  return {
    topics: await faqTopicsWithCounts(app),
    // Only topics this app shows (an 'all' FAQ may use another app's topic).
    items: items.filter((f) => known.includes(f.topic)).map(({ sortOrder, ...f }) => f),
  };
}

async function supportHome(user, now = new Date()) {
  const [call, chat, faqs] = await Promise.all([callItem(user.role, now), chatItem(user.id), faqItem(user.role)]);
  return { title: 'Support', items: [call, chat, faqs] };
}

module.exports = {
  FAQ_TOPICS,
  ALL_TOPIC_KEYS,
  validTopic,
  supportHome,
  listFaqs,
  isOpenAt,
  clockLabel,
};
