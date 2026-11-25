const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

let memServer = null;

async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/grovio';
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
    console.log('MongoDB connected to', uri);
  } catch (err) {
    console.log('Local MongoDB not reachable at', uri, '- starting embedded MongoDB instance...');
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const dbPath = path.join(__dirname, '../../.mongo-data');
      if (!fs.existsSync(dbPath)) {
        fs.mkdirSync(dbPath, { recursive: true });
      }
      memServer = await MongoMemoryServer.create({
        instance: {
          port: 27017,
          dbPath,
          storageEngine: 'wiredTiger',
          dbName: 'grovio',
        },
      });
      const memUri = memServer.getUri();
      console.log('Embedded MongoDB started at:', memUri);
      await mongoose.connect(memUri);
      console.log('MongoDB connected successfully');
    } catch (e) {
      console.error('Failed to start embedded MongoDB:', e.message);
      throw err;
    }
  }
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

async function disconnectDB() {
  await mongoose.disconnect();
  if (memServer) {
    await memServer.stop();
    memServer = null;
  }
}

module.exports = { connectDB, disconnectDB, mongoose };
