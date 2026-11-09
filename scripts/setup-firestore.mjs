// Loads the household settings and allowlist into Firestore (README, steps 4–5).
//
//   node scripts/setup-firestore.mjs ~/Downloads/<service-account-key>.json
//
// Reads household.local.json from the project folder (kept out of git: it
// holds your email addresses) and writes:
//   config/household      replaced with the "household" section
//   allowlist/<email>     one per entry in the "allowlist" section
//
// The key file comes from Firebase console > Project settings > Service
// accounts > Generate new private key. It grants full access to the project:
// keep it out of this folder and delete it once this has run.
// Run it again whenever you change household.local.json.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(`${root}functions/package.json`);
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const keyPath = process.argv[2];
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!keyPath && !emulator) {
  console.error('Usage: node scripts/setup-firestore.mjs <path to service-account key .json>');
  process.exit(1);
}

const settings = JSON.parse(readFileSync(`${root}household.local.json`, 'utf8'));
const { household, allowlist = {} } = settings;

// Catch the mistakes that would make the nightly build fail.
const problems = [];
if (!household?.people?.length) problems.push('household.people is empty');
if (!household?.calendars?.length) problems.push('household.calendars is empty');
if (!Number.isFinite(household?.location?.lat) || !Number.isFinite(household?.location?.lon)) problems.push('household.location needs lat and lon numbers');
for (const p of household?.people || []) if (!p.key || !p.letter || !p.email) problems.push(`person ${JSON.stringify(p)} needs key, letter and email`);
for (const c of household?.calendars || []) if (!c.id) problems.push(`calendar ${JSON.stringify(c)} needs an id`);
for (const [email, role] of Object.entries(allowlist)) if (!['owner', 'member'].includes(role)) problems.push(`allowlist ${email}: role must be owner or member`);
if (!Object.values(allowlist).includes('owner')) problems.push('allowlist needs at least one owner');
if (problems.length) { console.error('household.local.json:\n - ' + problems.join('\n - ')); process.exit(1); }

const key = keyPath ? JSON.parse(readFileSync(keyPath, 'utf8')) : null;
initializeApp(key ? { credential: cert(key), projectId: key.project_id } : { projectId: 'demo-week-at-a-glance' });
const db = getFirestore();

await db.doc('config/household').set(household);
for (const [email, role] of Object.entries(allowlist)) {
  await db.doc(`allowlist/${email.trim().toLowerCase()}`).set({ role });
}
console.log(`Saved config/household (${household.calendars.length} calendars, ${(household.reminders || []).length} reminders) ` +
  `and ${Object.keys(allowlist).length} allowlist entries to ${key ? key.project_id : 'the emulator'}.`);
if (key) console.log('Now delete the key file:', keyPath);
