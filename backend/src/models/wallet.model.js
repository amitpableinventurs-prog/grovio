const { Schema, model } = require('mongoose');

const walletSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = model('Wallet', walletSchema);
