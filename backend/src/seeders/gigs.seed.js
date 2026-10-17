// Sample gigs (bookable one-hour shifts) for today + the next 6 days, for every hub.
// Run: npm run seed:gigs  (or: node src/seeders/gigs.seed.js 14  — number of days)
// Safe to run again — a gig that already exists for the same hub and time is skipped, same as
// POST /admin/gigs/bulk.
require('dotenv').config();
const { connectDB, mongoose } = require('../config/db');
const { GigSlot } = require('../models');
const t = require('../utils/localTime');

// Morning 6–11, lunch 11–15, evening 15–19, dinner 19–23 (services/gig.service.js#PERIODS).
const SLOTS = [
  { from: '06:00', to: '07:00', payPerHourMin: 44, payPerHourMax: 60 },
  { from: '07:00', to: '08:00', payPerHourMin: 48, payPerHourMax: 66, isPriority: true },
  { from: '08:00', to: '09:00', payPerHourMin: 48, payPerHourMax: 66, isPriority: true },
  { from: '09:00', to: '11:00', payPerHourMin: 48, payPerHourMax: 66, isFree: true, isPriority: true, minLoginMinutes: 0 },
  { from: '11:00', to: '12:00', payPerHourMin: 46, payPerHourMax: 68 },
  { from: '12:00', to: '13:00', payPerHourMin: 46, payPerHourMax: 68 },
  { from: '13:00', to: '14:00', payPerHourMin: 46, payPerHourMax: 62 },
  { from: '14:00', to: '15:00', payPerHourMin: 44, payPerHourMax: 60 },
  { from: '15:00', to: '16:00', payPerHourMin: 42, payPerHourMax: 58 },
  { from: '16:00', to: '17:00', payPerHourMin: 42, payPerHourMax: 58 },
  { from: '17:00', to: '18:00', payPerHourMin: 46, payPerHourMax: 64 },
  { from: '18:00', to: '19:00', payPerHourMin: 52, payPerHourMax: 74, isPriority: true },
  { from: '19:00', to: '20:00', payPerHourMin: 52, payPerHourMax: 74, isPriority: true },
  { from: '20:00', to: '21:00', payPerHourMin: 52, payPerHourMax: 74, isPriority: true },
  { from: '21:00', to: '22:00', payPerHourMin: 48, payPerHourMax: 66 },
  { from: '22:00', to: '23:00', payPerHourMin: 44, payPerHourMax: 60, isFree: true, minLoginMinutes: 0 },
];

async function run() {
  await connectDB();
  const days = Math.max(1, Math.min(31, Number(process.argv[2]) || 7));
  const today = t.startOfDay();
  let created = 0;
  let skipped = 0;
  for (let i = 0; i < days; i += 1) {
    const day = t.addDays(today, i);
    for (const s of SLOTS) {
      const startAt = t.atTime(day, s.from);
      let endAt = t.atTime(day, s.to);
      if (endAt <= startAt) endAt = t.addDays(endAt, 1);
      // Hub-wide (store null): shown to every partner, whichever hub they pick.
      if (await GigSlot.exists({ store: null, startAt, endAt, status: 'active' })) { skipped += 1; continue; }
      await GigSlot.create({
        store: null,
        startAt,
        endAt,
        payPerHourMin: s.payPerHourMin,
        payPerHourMax: s.payPerHourMax,
        capacity: null,
        minLoginMinutes: s.minLoginMinutes ?? 50,
        isFree: !!s.isFree,
        isPriority: !!s.isPriority,
      });
      created += 1;
    }
  }
  console.log(`Gigs: ${created} created, ${skipped} already there (${days} days from ${t.dateKey(today)}).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Seeding gigs failed:', err);
  process.exit(1);
});
