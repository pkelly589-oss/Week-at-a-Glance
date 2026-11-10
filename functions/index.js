// Cloud Functions for Week at a Glance.
//
//   nightlyBuild  23:55 Pacific every day: builds the coming day's week and image
//   refreshNow    the web page's "Refresh now" button (signed-in household only)
//   device        the TRMNL X's API, served at /api/** through Firebase Hosting
//
// The work itself lives in src/; this file only wires it to Firebase.
// Requirements doc: Architecture; Reliability, privacy and errors.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { runBuild, recordFailure } from './src/build.js';
import { renderPng } from './src/render.js';
import { makeDeviceHandler } from './src/device.js';
import { TZ, isoDate } from './shared/week.js';

// Oakland: keep everything in the region nearest home.
setGlobalOptions({ region: 'us-west1', maxInstances: 2 });

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const bucket = () => getStorage().bucket();

// Google OAuth client and the refresh token from `npm run connect-google`.
// Stored in Secret Manager, never in Firestore or the code.
const GOOGLE_CLIENT_ID = defineSecret('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET');
const GOOGLE_REFRESH_TOKEN = defineSecret('GOOGLE_REFRESH_TOKEN');
// Enphase (solar and battery): one JSON secret from `npm run connect-enphase`,
// or "{}" to leave energy off.
const ENPHASE = defineSecret('ENPHASE');
// AirNow (EPA) API key for the measured AQI, or "off" to use Open-Meteo's.
const AIRNOW = defineSecret('AIRNOW');
const SECRETS = [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, ENPHASE, AIRNOW];
const secretValues = () => ({
  clientId: GOOGLE_CLIENT_ID.value(),
  clientSecret: GOOGLE_CLIENT_SECRET.value(),
  refreshToken: GOOGLE_REFRESH_TOKEN.value(),
  enphase: ENPHASE.value(),
  airnow: AIRNOW.value(),
});

// Rendering runs headless Chrome, which needs the extra memory.
const BUILD_OPTS = { memory: '2GiB', timeoutSeconds: 300, secrets: SECRETS };

async function build({ asOf, manual }) {
  try {
    return await runBuild({
      db, bucket: bucket(), fetch: globalThis.fetch, secrets: secretValues(),
      now: Date.now(), asOf, render: renderPng, manual,
    });
  } catch (e) {
    console.error('Build failed', e);
    await recordFailure(db, e);
    throw e;
  }
}

// Hourly at :55 from 6:55am to 11:55pm, so each image is ready before the
// device wakes on the hour from 7am to midnight. The 23:55 run builds for the
// day about to begin. A failed run is retried up to 3 times,
// 2 minutes apart. (Still called nightlyBuild so the deployed function keeps
// its name.)
export const nightlyBuild = onSchedule({
  ...BUILD_OPTS,
  schedule: '55 6-23 * * *', timeZone: TZ,
  retryCount: 3, minBackoffSeconds: 120, maxBackoffSeconds: 120,
}, async () => {
  await build({ asOf: isoDate(Date.now() + 10 * 60 * 1000), manual: false });
});

// Web view: "Refresh now", at most once a minute.
const MANUAL_GAP_MS = 1 * 60 * 1000;
// Firebase makes callable functions public on first deploy (the code itself
// checks sign-in and the allowlist). If that step failed, see README
// "Troubleshooting": allow public access on the refreshnow Cloud Run service.
export const refreshNow = onCall({ ...BUILD_OPTS }, async (req) => {
  const email = req.auth?.token?.email?.toLowerCase();
  if (!email || req.auth.token.email_verified !== true) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (!(await db.doc(`allowlist/${email}`).get()).exists) throw new HttpsError('permission-denied', 'Not on the list.');

  const statusRef = db.doc('status/latest');
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const last = (await tx.get(statusRef)).data()?.last_manual_at || 0;
    if (now - last < MANUAL_GAP_MS) {
      const mins = Math.ceil((MANUAL_GAP_MS - (now - last)) / 60000);
      throw new HttpsError('resource-exhausted', `Refreshed recently. Try again in ${mins} min.`);
    }
    tx.set(statusRef, { last_manual_at: now }, { merge: true });
  });
  try {
    const snap = await build({ asOf: isoDate(now), manual: true });
    return { ok: true, warnings: snap.warnings };
  } catch (e) {
    throw new HttpsError('internal', `Refresh failed: ${e.message}`);
  }
});

let deviceHandler;
// Public for the TRMNL, which can't sign in; it is checked by its MAC address and key.
export const device = onRequest({ memory: '512MiB', timeoutSeconds: 30, invoker: 'public' }, (req, res) => {
  deviceHandler ||= makeDeviceHandler({ db, bucket: bucket() });
  return deviceHandler(req, res);
});
