// One build of the week: read both calendars and the weather, merge them into a
// snapshot, store it, and render the e-ink image. Run nightly at 23:55 for the
// day about to start, and on demand from the web page's "Refresh now".
//
// Requirements doc: Architecture; Reliability, privacy and errors.
//
// Firestore layout (all written only by the functions):
//   config/household   who's who and which calendars to read (set by hand, see README)
//   weeks/{sunday}     the snapshot for that week          — members can read
//   status/latest      last build's outcome and image name — members can read
//   status/device      the TRMNL's last check-in           — members can read
//   renders/{name}     where each PNG is stored + its URL token (functions only)
//   devices/{mac}      the TRMNL's API key                 (functions only)

import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { weekOf, buildEvents, buildSnapshot, addDays, isHolidayCalendar, isReminderCalendar } from '../shared/week.js';
import { googleAccessToken, listEvents, weekWeather, weekAir, GoogleAuthError } from './sources.js';

export const KEEP_DAYS = 14;

export class BuildError extends Error {}

// Reads and checks config/household.
export async function loadHousehold(db) {
  const snap = await db.doc('config/household').get();
  const h = snap.exists ? snap.data() : null;
  const problems = [];
  if (!h) problems.push('config/household is missing');
  else {
    if (!Array.isArray(h.people) || !h.people.length) problems.push('people is empty');
    if (!Array.isArray(h.calendars) || !h.calendars.length) problems.push('calendars is empty');
    if (!(Number.isFinite(h.location?.lat) && Number.isFinite(h.location?.lon))) problems.push('location.lat/lon missing');
  }
  if (problems.length) throw new BuildError(`Household settings: ${problems.join('; ')} (see README, step 4)`);
  return h;
}

// Calendars → normalized events, plus warnings for any calendar that failed.
// Throws when no calendar at all could be read, so the device keeps its last
// good picture instead of showing an empty week.
async function readCalendars(household, week, secrets, fetch) {
  const warnings = [];
  let token;
  try {
    token = await googleAccessToken(secrets, fetch);
  } catch (e) {
    throw new BuildError(e.message);
  }
  const nameOf = (key) => household.people.find((p) => p.key === key)?.name || key;
  const results = await Promise.allSettled(household.calendars.map((c) => listEvents(c.id, week, token, fetch)));
  const sources = [];
  results.forEach((r, i) => {
    const cal = household.calendars[i];
    if (r.status === 'fulfilled') {
      sources.push({ person: cal.person || null, events: r.value, holiday: isHolidayCalendar(cal), reminder: isReminderCalendar(cal) });
    }
    else {
      console.warn(`Calendar ${i} failed`, r.reason?.message);
      warnings.push(`Couldn't read ${cal.label || (cal.person ? `${nameOf(cal.person)}'s calendar` : 'a shared calendar')}`);
    }
  });
  if (!sources.length) throw new BuildError(`No calendar could be read (${warnings.join('; ')})`);
  const opts = {
    hideLocations: household.hide_locations || [],
    reminders: household.reminders || [],
    hideEvents: household.hide_events || [],
  };
  return { events: buildEvents(sources, household.people, opts), warnings };
}

export async function runBuild({ db, bucket, fetch, secrets, now = Date.now(), asOf, render, manual = false }) {
  const household = await loadHousehold(db);
  const week = weekOf(asOf);
  const weekRef = db.doc(`weeks/${week.id}`);
  const statusRef = db.doc('status/latest');

  const previous = (await weekRef.get()).data();
  const previousWeather = Object.fromEntries((previous?.days || [])
    .filter((d) => d.weather).map((d) => [d.date, d.weather]));
  const previousAir = Object.fromEntries((previous?.days || [])
    .filter((d) => d.aqi != null).map((d) => [d.date, d.aqi]));

  const cal = await readCalendars(household, week, secrets, fetch);
  const [wx, aq] = await Promise.all([
    weekWeather(household.location, week, asOf, previousWeather, fetch),
    weekAir(household.location, week, asOf, previousAir, fetch),
  ]);
  const snapshot = buildSnapshot({
    asOf, builtAt: now, week, events: cal.events, weather: wx.weather, air: aq.air,
    reminders: household.reminders || [],
    location: household.location,
    warnings: [...cal.warnings, ...wx.warnings, ...aq.warnings],
  });
  await weekRef.set(snapshot);

  // The image the door shows. Its name changes only when the image does, so
  // the TRMNL downloads it once (TRMNL BYOS docs: filenames).
  const png = await render(snapshot, { today: asOf });
  const filename = `week-${week.id.replace(/-/g, '')}-${Math.floor(now / 1000)}`;
  const path = `renders/${filename}.png`;
  await bucket.file(path).save(png, { contentType: 'image/png', resumable: false });
  await db.doc(`renders/${filename}`).set({
    path, as_of: asOf, created_at: now, token: randomBytes(18).toString('base64url'),
  });

  await statusRef.set({
    ok: true, week_id: week.id, as_of: asOf, built_at: now, warnings: snapshot.warnings,
    image: filename, last_error: null, consecutive_failures: 0,
    ...(manual ? { last_manual_at: now } : {}),
  }, { merge: true });

  await cleanUp({ db, bucket, now, asOf });
  return snapshot;
}

// Records a failed build without touching the last good snapshot or image.
export async function recordFailure(db, err, now = Date.now()) {
  await db.doc('status/latest').set({
    ok: false, failed_at: now,
    last_error: String(err?.message || err).slice(0, 300),
    consecutive_failures: FieldValue.increment(1),
    google_disconnected: err instanceof BuildError && /connect-google/.test(err.message),
  }, { merge: true });
}

// Reliability, privacy and errors: snapshots and images older than 14 days go.
export async function cleanUp({ db, bucket, now, asOf }) {
  const cutoffWeek = addDays(asOf, -KEEP_DAYS);
  const oldWeeks = await db.collection('weeks').where('week_id', '<', cutoffWeek).get();
  const oldRenders = await db.collection('renders').where('created_at', '<', now - KEEP_DAYS * 864e5).get();
  await Promise.all([
    ...oldWeeks.docs.map((d) => d.ref.delete()),
    ...oldRenders.docs.map(async (d) => {
      await bucket.file(d.data().path).delete({ ignoreNotFound: true });
      await d.ref.delete();
    }),
  ]);
}

export { GoogleAuthError };
