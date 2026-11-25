// Starter FAQs for the apps' Support screen (Payouts / Orders / Documents for riders and pickers;
// Orders / Payments / Account for customers). Admins edit them afterwards via /admin/faqs.
// Run: npm run seed:faqs
// Safe to run again: only questions that aren't there yet are added; edited or deleted ones are
// left as they are (a deleted one comes back only if you run this again).
require('dotenv').config();
const { connectDB, disconnectDB } = require('../config/db');
const { Faq } = require('../models');

const FAQS = {
  delivery: {
    payouts: [
      ['When do I get paid?', 'Your pay for each order is added to your Pocket as soon as you complete it. Payouts go to the bank account in your profile; you can see every payout and its status in Pocket.'],
      ['My payout failed. What should I do?', 'Check that the bank details in your profile are correct. If they are and it still failed, open Chat with us → Pocket & payouts → Withdrawal failed / not received.'],
    ],
    orders: [
      ['How do I pick up an order at the hub?', 'At the hub, scan the order\'s QR on the hub screen with the Delivery app. You can also scan the picker\'s handover QR or enter the pickup OTP the picker gives you.'],
      ['The customer is not answering. What should I do?', 'Call the customer from the order screen (numbers are masked). If they still don\'t answer, wait at the address and contact us from Chat with us before marking the delivery as failed.'],
    ],
    documents: [
      ['Which documents do I need?', 'A government ID, your driving licence, your vehicle details and a bank account in your name. You add them while signing up and can see their status in your profile.'],
      ['How long does verification take?', 'Our team usually checks documents within 1–2 working days. You get a notification as soon as your account is approved.'],
    ],
  },
  picker: {
    payouts: [
      ['How is my picking pay calculated?', 'You earn for every order you pick and pack, with extra for peak hours, fast picking and accuracy. Today\'s earning and each order\'s pay are under Earnings.'],
      ['When is my pay credited?', 'Picking pay is credited to your Pocket as soon as you mark your part of an order ready. Daily bonuses are added once the day is settled.'],
    ],
    orders: [
      ['An item is out of stock. What do I do?', 'Mark the item as unavailable in the job, or choose a substitute. The customer is told about the change.'],
      ['How do I hand over an order to the delivery partner?', 'When the order is ready, the delivery partner scans its QR on the hub screen. You can also show the handover QR or read out the OTP from the job screen.'],
    ],
    documents: [
      ['Which documents do I need?', 'A government ID for KYC and your personal details (name, email, date of birth). You add them while signing up.'],
      ['How long does approval take?', 'Our team usually checks your details within 1–2 working days. You get a notification as soon as your account is approved.'],
    ],
  },
  customer: {
    orders: [
      ['Where is my order?', 'Open Orders and tap your order to track it live, including the delivery partner\'s location once it is on the way.'],
      ['An item is missing or damaged. What do I do?', 'Open the order and tap Help, choose the issue and tell us what went wrong. We\'ll sort it out, usually with a refund to your wallet.'],
    ],
    payments: [
      ['When will I get my refund?', 'Refunds are added to your Grovio wallet as soon as they are approved, and you can use the balance on your next order.'],
      ['Money was deducted but the payment failed.', 'If the order wasn\'t placed, the bank usually reverses the amount within 5–7 working days. If it doesn\'t, contact us from Chat with us → Payments & wallet.'],
    ],
    account: [
      ['How do I change my phone number?', 'Contact us from Chat with us → Account and we\'ll help you move your account to the new number.'],
    ],
  },
};

async function seedFaqs() {
  let added = 0;
  for (const [app, topics] of Object.entries(FAQS)) {
    for (const [topic, list] of Object.entries(topics)) {
      for (const [i, [question, answer]] of list.entries()) {
        const res = await Faq.updateOne(
          { app, question },
          { $setOnInsert: { app, topic, question, answer, sortOrder: (i + 1) * 10, isActive: true } },
          { upsert: true },
        );
        added += res.upsertedCount || 0;
      }
    }
  }
  return added;
}

if (require.main === module) {
  (async () => {
    await connectDB();
    const added = await seedFaqs();
    console.log(`FAQs: ${added} added (existing ones left as they are)`);
    await disconnectDB();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedFaqs, FAQS };
