const mongoose = require('mongoose');
require('dotenv').config();

async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/grovio');
  console.log('MongoDB connected');
  await dropLegacyUserPhoneIndex();
  return mongoose.connection;
}

// users.phone used to be globally unique (index "phone_1"), which stopped a rider/picker from also
// signing up in the customer app with the same number. It's now unique per role (phone_1_role_1,
// built by Mongoose's autoIndex), but autoIndex never drops an old index, so do that once here.
async function dropLegacyUserPhoneIndex() {
  const users = mongoose.connection.collection('users');
  let indexes;
  try {
    indexes = await users.indexes();
  } catch (err) {
    return; // collection doesn't exist yet (fresh database)
  }
  if (indexes.some((i) => i.name === 'phone_1')) {
    await users.dropIndex('phone_1');
    console.log('Dropped legacy users.phone_1 unique index (phone is now unique per role)');
  }
}

module.exports = { connectDB, mongoose };
