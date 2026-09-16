const mongoose = require('mongoose');
require('dotenv').config();

async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/grovio');
  console.log('MongoDB connected');
  return mongoose.connection;
}

module.exports = { connectDB, mongoose };
