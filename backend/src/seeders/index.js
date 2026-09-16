require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectDB } = require('../config/db');
const { User, Category, Setting } = require('../models');

async function run() {
  await connectDB();

  // Default admin
  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@grovio.com';
  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    const hashed = await bcrypt.hash(process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@12345', 10);
    await User.create({
      name: process.env.DEFAULT_ADMIN_NAME || 'Grovio Admin',
      email: adminEmail,
      password: hashed,
      role: 'admin',
      permissions: ['*'],
      isVerified: true,
    });
    console.log(`Created default admin: ${adminEmail}`);
  } else if (!existingAdmin.permissions?.includes('*')) {
    existingAdmin.permissions = ['*'];
    await existingAdmin.save();
    console.log('Upgraded existing default admin to super-admin permissions.');
  } else {
    console.log('Default admin already exists, skipping.');
  }

  // Base categories
  const baseCategories = ['Fruits & Vegetables', 'Dairy & Eggs', 'Bakery', 'Beverages', 'Snacks', 'Household'];
  for (const name of baseCategories) {
    await Category.findOneAndUpdate({ name }, { name, status: 'active' }, { upsert: true });
  }
  console.log('Seeded base categories.');

  // Default settings
  const defaultSettings = {
    deliveryFee: process.env.DEFAULT_DELIVERY_FEE || '25',
    commissionPercent: process.env.DEFAULT_COMMISSION_PERCENT || '10',
    minOrderAmount: '0',
    appVersion: '1.0.0',
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await Setting.findOneAndUpdate({ key }, { key, value: String(value) }, { upsert: true });
  }
  console.log('Seeded default settings.');

  process.exit(0);
}

run().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
