const { initializeApp, cert, getApps, getApp } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const path = require('path');
const fs = require('fs');

let firebaseApp = null;
let messaging = null;

try {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : path.join(__dirname, 'firebase-service-account.json');

  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    if (!getApps().length) {
      firebaseApp = initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    } else {
      firebaseApp = getApp();
    }
    messaging = getMessaging(firebaseApp);
    console.log(`Firebase Admin SDK initialized successfully (Project: ${serviceAccount.project_id})`);
  } else {
    console.warn(`Firebase service account file not found at: ${serviceAccountPath}`);
  }
} catch (err) {
  console.error('Failed to initialize Firebase Admin SDK:', err.message);
}

module.exports = { firebaseApp, messaging };
