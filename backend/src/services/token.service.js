const crypto = require('crypto');
const generateAccessToken = require('../utils/generateToken');
const { RefreshToken } = require('../models');

const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30);

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function issueTokenPair(user, { deviceId = null, platform = null } = {}) {
  const accessToken = generateAccessToken({ id: user.id, role: user.role });

  const rawRefreshToken = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(rawRefreshToken),
    deviceId,
    platform,
    expiresAt,
  });

  return { accessToken, refreshToken: rawRefreshToken };
}

async function findValidRefreshToken(rawToken) {
  return RefreshToken.findOne({
    tokenHash: hashToken(rawToken),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
}

async function rotateRefreshToken(tokenDoc, user) {
  tokenDoc.revokedAt = new Date();
  await tokenDoc.save();
  return issueTokenPair(user, { deviceId: tokenDoc.deviceId, platform: tokenDoc.platform });
}

async function revokeRefreshToken(rawToken) {
  await RefreshToken.updateOne({ tokenHash: hashToken(rawToken), revokedAt: null }, { revokedAt: new Date() });
}

async function revokeAllForUser(userId) {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
}

module.exports = { issueTokenPair, findValidRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllForUser };
