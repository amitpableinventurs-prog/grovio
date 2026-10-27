// Demo SOS alerts for the admin panel's SOS Alerts page: open, acknowledged, resolved and
// cancelled ones from riders, pickers and customers, spread over the last few days.
// Run: npm run seed:sos
// Safe to run again — each demo alert has a fixed id and is overwritten, not duplicated. Accounts
// that don't exist in this database are skipped.
require('dotenv').config();
const { connectDB, mongoose } = require('../config/db');
const { SosAlert, User, Order, Store } = require('../models');

const MIN = 60 * 1000;
const ago = (minutes) => new Date(Date.now() - minutes * MIN);
const demoId = (n) => new mongoose.Types.ObjectId(`a05a05a05a05a05a05a050${String(n).padStart(2, '0')}`);

// Around Katni (the dark store has no coordinates set yet).
const BASE = { lat: 23.8343, lng: 80.3894 };
function trail(startMinAgo, count, drift) {
  return Array.from({ length: count }, (_, i) => ({
    lat: +(BASE.lat + drift.lat + i * 0.00012).toFixed(6),
    lng: +(BASE.lng + drift.lng + i * 0.00009).toFixed(6),
    accuracyM: 8 + (i % 3) * 4,
    at: ago(startMinAgo - i * 0.5),
  }));
}

const NUMBERS = { emergency: '112', police: '100', ambulance: '108', fire: '101', women: '1091', road_accident: '1033' };
const call = (key, minAgo) => ({ key, number: NUMBERS[key], at: ago(minAgo) });

// phone: any of the ways it may be stored ('9990009990' / '+919990009990').
const DEMO = [
  {
    n: 1, phone: '9990009990', role: 'delivery', kind: 'ambulance', status: 'open', minAgo: 4,
    note: 'Bike skidded near Katni bus stand, leg injury',
    calls: [call('ambulance', 4), call('emergency', 3)], points: trail(4, 6, { lat: 0.004, lng: -0.003 }),
    contact: { name: 'Sunita (wife)', phone: '9000000101' },
  },
  {
    n: 2, phone: '9988776677', role: 'picker', kind: 'sos', status: 'open', minAgo: 1,
    note: null, calls: [], points: trail(1, 2, { lat: 0, lng: 0 }),
    contact: { name: 'Ramesh (brother)', phone: '9000000102' },
  },
  {
    n: 3, phone: '6660004444', role: 'delivery', kind: 'police', status: 'acknowledged', minAgo: 18, ackMinAgo: 15,
    note: 'Group of men blocking my bike at the drop location, not letting me leave',
    calls: [call('police', 18)], points: trail(18, 10, { lat: -0.006, lng: 0.005 }),
    contact: { name: 'Mohan (father)', phone: '9000000103' },
  },
  {
    n: 4, phone: '8880002222', role: 'customer', kind: 'women', status: 'acknowledged', minAgo: 35, ackMinAgo: 31,
    note: 'Late-night delivery, the person at the door is behaving badly',
    calls: [call('women', 35)], points: trail(35, 4, { lat: 0.009, lng: 0.007 }),
  },
  {
    n: 5, phone: '9080709080', role: 'delivery', kind: 'road_accident', status: 'resolved', minAgo: 190, ackMinAgo: 186, resolvedMinAgo: 150,
    note: 'Car hit my scooter on NH-30, minor injury',
    calls: [call('road_accident', 190), call('ambulance', 188)], points: trail(190, 12, { lat: 0.02, lng: -0.015 }),
    contact: { name: 'Pooja (sister)', phone: '9000000105' },
    resolution: 'Called the rider: hand injury, treated at district hospital. Order reassigned to another rider; accident cover claim started.',
  },
  {
    n: 6, phone: '9998889998', role: 'picker', kind: 'fire', status: 'resolved', minAgo: 26 * 60, ackMinAgo: 26 * 60 - 2, resolvedMinAgo: 25 * 60,
    note: 'Smoke from the cold-storage panel',
    calls: [call('fire', 26 * 60)], points: trail(26 * 60, 3, { lat: 0, lng: 0 }),
    contact: { name: 'Kavita (mother)', phone: '9000000106' },
    resolution: 'Short circuit in the cold-storage panel. Fire brigade arrived in 12 min, staff evacuated, no injuries. Store paused for 1 hour.',
  },
  {
    n: 7, phone: '9000000020', role: 'delivery', kind: 'sos', status: 'cancelled', minAgo: 2 * 24 * 60,
    note: null, calls: [], points: trail(2 * 24 * 60, 1, { lat: 0.001, lng: 0.001 }),
    cancelReason: 'Pressed by mistake',
  },
  {
    n: 8, phone: '9123456780', role: 'customer', kind: 'ambulance', status: 'resolved', minAgo: 4 * 24 * 60, ackMinAgo: 4 * 24 * 60 - 3, resolvedMinAgo: 4 * 24 * 60 - 40,
    note: 'My father fainted while receiving the order',
    calls: [call('ambulance', 4 * 24 * 60)], points: trail(4 * 24 * 60, 2, { lat: -0.011, lng: 0.012 }),
    resolution: 'Ambulance 108 reached in 15 min. Rider stayed until it arrived. Followed up next day — customer is fine.',
  },
];

async function findUser(phone, role) {
  const variants = [phone, `+91${phone}`, `91${phone}`];
  return User.findOne({ phone: { $in: variants }, role }).select('name phone role');
}

async function contextOf(user) {
  let order = null;
  if (user.role === 'delivery') order = await Order.findOne({ delivery: user._id }).sort({ updatedAt: -1 }).select('store');
  else if (user.role === 'picker') order = await Order.findOne({ 'pickTasks.picker': user._id }).sort({ updatedAt: -1 }).select('store');
  else order = await Order.findOne({ customer: user._id }).sort({ updatedAt: -1 }).select('store');
  return { order: order?._id || null, store: order?.store || null };
}

async function run() {
  await connectDB();
  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 }).select('_id');
  const katni = await Store.findOne({ name: /katni/i }).select('_id');
  let written = 0;
  const skipped = [];

  for (const d of DEMO) {
    const user = await findUser(d.phone, d.role);
    if (!user) {
      skipped.push(`${d.role} ${d.phone}`);
      continue;
    }
    const ctx = await contextOf(user);
    const createdAt = ago(d.minAgo);
    const location = d.points[d.points.length - 1];
    const doc = new SosAlert({
      _id: demoId(d.n),
      user: user._id,
      role: d.role,
      kind: d.kind,
      status: d.status,
      note: d.note,
      location,
      trail: d.points,
      order: ctx.order,
      store: ctx.store || katni?._id || null,
      calls: d.calls,
      contactsNotified: d.contact
        ? [{ kind: 'emergency_contact', ...d.contact, sent: false, reason: 'not_configured', at: createdAt }]
        : [],
      acknowledgedBy: d.ackMinAgo != null ? admin?._id : null,
      acknowledgedAt: d.ackMinAgo != null ? ago(d.ackMinAgo) : null,
      resolvedBy: d.resolvedMinAgo != null ? admin?._id : null,
      resolvedAt: d.resolvedMinAgo != null ? ago(d.resolvedMinAgo) : null,
      resolutionNote: d.resolution || null,
      cancelledAt: d.status === 'cancelled' ? ago(d.minAgo - 1) : null,
      cancelReason: d.cancelReason || null,
    }).toObject();
    // Written straight to the collection so the back-dated createdAt/updatedAt stick.
    doc.createdAt = createdAt;
    doc.updatedAt = location.at;
    await SosAlert.collection.replaceOne({ _id: doc._id }, doc, { upsert: true });
    written += 1;
  }

  console.log(`SOS demo alerts: ${written} written${skipped.length ? `, skipped (no such account): ${skipped.join(', ')}` : ''}.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Seeding SOS alerts failed:', err);
  process.exit(1);
});
