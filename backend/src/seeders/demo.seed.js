require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectDB, disconnectDB } = require('../config/db');
const { User, Store, Category, Product, DeliveryProfile, PickerProfile, Banner, Coupon } = require('../models');
const { PERMISSIONS } = require('../utils/permissions');

async function seedDemo() {
  await connectDB();
  console.log('--- Starting Demo Seeding ---');

  // 1. Store
  let store = await Store.findOne({ name: 'Grovio Supermarket - Downtown' });
  if (!store) {
    store = await Store.create({
      name: 'Grovio Supermarket - Downtown',
      address: 'Shop 14, Main Market, Civil Lines',
      lat: 23.8343,
      lng: 80.3894,
      serviceRadiusKm: 25,
      openTime: '06:00',
      closeTime: '23:00',
      isOpen: true,
      status: 'active',
    });
    console.log('Created Store:', store.name);
  } else {
    store.status = 'active';
    store.isOpen = true;
    await store.save();
    console.log('Store exists and activated:', store.name);
  }

  // 2. Vendor
  const vendorEmail = 'vendor@grovio.com';
  let vendor = await User.findOne({ email: vendorEmail });
  if (!vendor) {
    const hashed = await bcrypt.hash('Vendor@12345', 10);
    vendor = await User.create({
      name: 'Downtown Store Manager',
      email: vendorEmail,
      phone: '9876543210',
      password: hashed,
      role: 'admin',
      permissions: [PERMISSIONS.MANAGE_OWN_STORE_INVENTORY],
      assignedStore: store._id,
      isVerified: true,
      isActive: true,
    });
    console.log('Created Vendor User:', vendorEmail, '/ Vendor@12345');
  } else {
    vendor.assignedStore = store._id;
    vendor.permissions = [PERMISSIONS.MANAGE_OWN_STORE_INVENTORY];
    await vendor.save();
    console.log('Vendor User updated:', vendorEmail);
  }

  // 3. Categories
  const categories = await Category.find();
  const catMap = {};
  for (const c of categories) {
    catMap[c.name] = c._id;
  }

  // 4. Products
  const sampleProducts = [
    {
      name: 'Fresh Red Apples',
      category: catMap['Fruits & Vegetables'] || categories[0]?._id,
      description: 'Crisp and juicy Kashmiri red apples (1kg)',
      price: 160,
      discountPrice: 139,
      unit: 'kg',
      stockQty: 50,
      sku: 'APPL-001',
      requiresColdBag: false,
      pickType: 'fruits_veg',
      images: ['https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=400'],
    },
    {
      name: 'Organic Bananas',
      category: catMap['Fruits & Vegetables'] || categories[0]?._id,
      description: 'Sweet and nutritious ripe bananas (1 Dozen)',
      price: 60,
      discountPrice: 48,
      unit: 'dozen',
      stockQty: 75,
      sku: 'BAN-001',
      requiresColdBag: false,
      pickType: 'fruits_veg',
      images: ['https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400'],
    },
    {
      name: 'Farm Fresh Whole Milk',
      category: catMap['Dairy & Eggs'] || categories[1]?._id,
      description: 'Pasteurized homogenized full-cream cow milk (1L)',
      price: 66,
      discountPrice: 62,
      unit: 'L',
      stockQty: 100,
      sku: 'MILK-001',
      requiresColdBag: true,
      pickType: 'dairy',
      images: ['https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400'],
    },
    {
      name: 'Brown Eggs (Pack of 6)',
      category: catMap['Dairy & Eggs'] || categories[1]?._id,
      description: 'Protein-rich organic brown eggs pack of 6',
      price: 55,
      discountPrice: 49,
      unit: 'pack',
      stockQty: 40,
      sku: 'EGG-006',
      requiresColdBag: false,
      pickType: 'dairy',
      images: ['https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=400'],
    },
    {
      name: 'Multigrain Artisan Bread',
      category: catMap['Bakery'] || categories[2]?._id,
      description: 'Healthy freshly baked multigrain loaf (400g)',
      price: 50,
      discountPrice: 45,
      unit: 'pack',
      stockQty: 30,
      sku: 'BRD-001',
      requiresColdBag: false,
      pickType: 'normal',
      images: ['https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400'],
    },
    {
      name: 'Fresh Orange Juice (1L)',
      category: catMap['Beverages'] || categories[3]?._id,
      description: '100% pure cold pressed orange juice, no added sugar',
      price: 120,
      discountPrice: 105,
      unit: 'bottle',
      stockQty: 35,
      sku: 'BEV-001',
      requiresColdBag: true,
      pickType: 'dairy',
      images: ['https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400'],
    },
    {
      name: 'Crispy Potato Chips - Salted',
      category: catMap['Snacks'] || categories[4]?._id,
      description: 'Golden crunchy salted potato chips (150g)',
      price: 40,
      discountPrice: 35,
      unit: 'pack',
      stockQty: 120,
      sku: 'SNK-001',
      requiresColdBag: false,
      pickType: 'small',
      images: ['https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=400'],
    },
    {
      name: 'Premium Basmati Rice (5kg)',
      category: catMap['Household'] || categories[5]?._id,
      description: 'Long grain aromatic aged basmati rice bag',
      price: 450,
      discountPrice: 399,
      unit: 'bag',
      stockQty: 25,
      sku: 'RIC-005',
      weightKg: 5,
      requiresColdBag: false,
      pickType: 'heavy_5_10',
      images: ['https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400'],
    },
  ];

  for (const p of sampleProducts) {
    if (!p.category) continue;
    await Product.findOneAndUpdate(
      { store: store._id, sku: p.sku },
      { ...p, store: store._id, status: 'active', isAvailable: true },
      { upsert: true, new: true }
    );
  }
  console.log('Seeded sample products for store.');

  // 5. Customer User
  let customer = await User.findOne({ phone: '9999988888', role: 'customer' });
  if (!customer) {
    const hashed = await bcrypt.hash('Customer@12345', 10);
    customer = await User.create({
      name: 'Rahul Sharma',
      email: 'customer@grovio.com',
      phone: '9999988888',
      password: hashed,
      role: 'customer',
      isVerified: true,
      isActive: true,
    });
    console.log('Created Demo Customer: 9999988888 / customer@grovio.com');
  }

  // 6. Delivery Rider
  let rider = await User.findOne({ phone: '9990009990', role: 'delivery' });
  if (!rider) {
    const hashed = await bcrypt.hash('Rider@12345', 10);
    rider = await User.create({
      name: 'Amit Rider',
      email: 'rider@grovio.com',
      phone: '9990009990',
      password: hashed,
      role: 'delivery',
      isVerified: true,
      isActive: true,
    });
  }
  await DeliveryProfile.findOneAndUpdate(
    { user: rider._id },
    {
      user: rider._id,
      status: 'approved',
      onboardingStep: 'completed',
      isAvailable: true,
      currentLocation: { lat: 23.8345, lng: 80.3896, updatedAt: new Date() },
      vehicle: { type: 'motorcycle', number: 'MP20-AB-1234' },
    },
    { upsert: true }
  );
  console.log('Created Demo Delivery Partner: 9990009990 / rider@grovio.com');

  // 7. Picker
  let picker = await User.findOne({ phone: '9988776677', role: 'picker' });
  if (!picker) {
    const hashed = await bcrypt.hash('Picker@12345', 10);
    picker = await User.create({
      name: 'Suresh Picker',
      email: 'picker@grovio.com',
      phone: '9988776677',
      password: hashed,
      role: 'picker',
      isVerified: true,
      isActive: true,
    });
  }
  await PickerProfile.findOneAndUpdate(
    { user: picker._id },
    {
      user: picker._id,
      store: store._id,
      status: 'approved',
      isAvailable: true,
    },
    { upsert: true }
  );
  console.log('Created Demo Picker: 9988776677 / picker@grovio.com');

  // 8. Banners & Coupons
  await Banner.findOneAndUpdate(
    { title: 'Flat 50% Off on First Order' },
    {
      title: 'Flat 50% Off on First Order',
      imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=800',
      linkType: 'category',
      linkId: categories[0]?._id,
      status: 'active',
      priority: 10,
    },
    { upsert: true }
  );

  await Coupon.findOneAndUpdate(
    { code: 'WELCOME50' },
    {
      code: 'WELCOME50',
      discountType: 'percentage',
      discountValue: 50,
      maxDiscountAmount: 100,
      minOrderAmount: 199,
      status: 'active',
    },
    { upsert: true }
  );

  console.log('--- Demo Data Seeding Complete ---');
  await disconnectDB();
  process.exit(0);
}

seedDemo().catch((err) => {
  console.error('Demo seed error:', err);
  process.exit(1);
});
