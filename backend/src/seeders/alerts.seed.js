// Sample alert messages for Diwali 2026 (Diwali: Sunday 8 Nov). Run: npm run seed:alerts
// Safe to run again — each alert has a fixed key and is only created once, so edits made in
// Admin > Alert Messages are kept. Times are IST.
require('dotenv').config();
const { connectDB, mongoose } = require('../config/db');
const { AppAlert } = require('../models');

const ist = (dateTime) => new Date(`${dateTime}:00+05:30`);
const AFTER_DIWALI = ist('2026-11-09T04:00'); // when the Diwali Dhamaka offer ends

const ALERTS = [
  // Customer app
  {
    key: 'alert-customer-diwali-store',
    apps: ['customer'],
    severity: 'success',
    display: 'banner',
    title: 'Diwali specials are here',
    message: 'Sweets, dry fruits, diyas and pooja essentials, delivered to your door in minutes.',
    endsAt: AFTER_DIWALI,
  },
  {
    key: 'alert-customer-festive-rush',
    apps: ['customer'],
    severity: 'warning',
    display: 'banner',
    title: 'Festive rush',
    message: 'Orders are higher than usual this week, so some deliveries may take 10–15 minutes longer. Thank you for your patience!',
    endsAt: AFTER_DIWALI,
  },
  {
    key: 'alert-customer-diwali-night',
    apps: ['customer'],
    severity: 'warning',
    display: 'popup',
    title: 'Diwali night timings',
    message: 'On Diwali night (8 Nov) we take the last orders at 10:30 pm and are back at 7:00 am on 9 Nov. Happy Diwali from Team Grovio!',
    startsAt: ist('2026-11-07T18:00'),
    endsAt: ist('2026-11-09T07:00'),
  },
  {
    key: 'alert-customer-pay-upi',
    apps: ['customer'],
    severity: 'info',
    display: 'banner',
    title: 'Pay with UPI',
    message: 'Pay online with UPI for a faster checkout and contact-free delivery.',
    isActive: false,
  },

  // Delivery app
  {
    key: 'alert-delivery-diwali-dhamaka',
    apps: ['delivery'],
    severity: 'success',
    display: 'banner',
    title: 'Diwali Dhamaka offer चालू है',
    message: '9 Nov सुबह 4 बजे तक ₹1001 तक extra कमाएँ। पूरी जानकारी के लिए Offers खोलें।',
    endsAt: AFTER_DIWALI,
  },
  {
    key: 'alert-delivery-cod-deposit',
    apps: ['delivery'],
    severity: 'critical',
    display: 'banner',
    dismissible: false,
    title: 'COD cash जमा करें',
    message: 'Diwali से पहले अपना सारा COD cash 7 Nov रात 11 बजे तक hub पर जमा करें। Cash बकाया रहने पर नए COD orders नहीं मिलेंगे।',
    endsAt: ist('2026-11-07T23:00'),
  },
  {
    key: 'alert-delivery-festive-safety',
    apps: ['delivery'],
    severity: 'warning',
    display: 'popup',
    title: 'सुरक्षित चलाएँ',
    message: 'त्योहारों में सड़कों पर भीड़ और पटाखे ज़्यादा होते हैं। हमेशा helmet पहनें, धीरे चलाएँ, और ज़रूरत पड़ने पर app में SOS दबाएँ।',
    startsAt: ist('2026-11-06T06:00'),
    endsAt: ist('2026-11-10T06:00'),
  },

  // Picker app
  {
    key: 'alert-picker-expiry-check',
    apps: ['picker'],
    severity: 'info',
    display: 'banner',
    title: 'Festive rush: expiry check',
    message: 'मिठाई, dairy और dry fruits pack करने से पहले expiry date ज़रूर देखें।',
    endsAt: AFTER_DIWALI,
  },
  {
    key: 'alert-picker-stock-audit',
    apps: ['picker'],
    severity: 'warning',
    display: 'popup',
    title: 'Stock audit: रविवार 1 Nov',
    message: 'रविवार 1 Nov सुबह 7 से 9 बजे तक stock audit होगा। इस दौरान picking बंद रहेगी, कृपया समय पर hub पहुँचें।',
    startsAt: ist('2026-10-31T18:00'),
    endsAt: ist('2026-11-01T09:00'),
  },
];

async function run() {
  await connectDB();
  let created = 0;
  for (const a of ALERTS) {
    const res = await AppAlert.updateOne({ key: a.key }, { $setOnInsert: { dismissible: true, isActive: true, startsAt: null, endsAt: null, ...a } }, { upsert: true });
    if (res.upsertedCount) created += 1;
  }
  console.log(`Alerts: ${created} created, ${ALERTS.length - created} already there.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
