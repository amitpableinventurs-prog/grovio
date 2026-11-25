// Verifies a Google Sign-In ID token for the Picker and Delivery apps.
// Unlike the generic POST /auth/google, a missing or invalid token is always a 401 — the email in
// the request body is never trusted, so nobody can sign in as someone else's address.
const ApiError = require('../utils/apiError');

// The Web OAuth client the apps pass as `serverClientId` (the ID token's audience).
const WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID
  || '718221804618-f3aigaboc8js517b6vnmufp9orltg3m7.apps.googleusercontent.com';

let client;

async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') throw new ApiError(400, 'Google idToken is required');
  try {
    const { OAuth2Client } = require('google-auth-library');
    client = client || new OAuth2Client(WEB_CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken, audience: WEB_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.email || p.email_verified === false) throw new Error('Google account email is not verified');
    return { email: String(p.email).trim().toLowerCase(), name: p.name || '', picture: p.picture || null };
  } catch (err) {
    throw new ApiError(401, 'Google sign-in could not be verified. Please try again.');
  }
}

module.exports = { verifyGoogleIdToken };
