// Tests for the Cloud Functions' build and device API, run against the
// Firestore emulator (`npm test`). Google, the weather services and Chrome are
// replaced by stand-ins, so nothing leaves the computer.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { calendarSources, HOUSEHOLD, PETE, DAVID, ENPHASE } from './fixtures.js';

const req = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = req('firebase-admin/app');
const { getFirestore } = req('firebase-admin/firestore');
const { runBuild, recordFailure, BuildError } = await import('../functions/src/build.js');
const { makeDeviceHandler, refreshRate, batteryPercent, RETRY_SECONDS } = await import('../functions/src/device.js');

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
initializeApp({ projectId: 'demo-week-at-a-glance' });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

// ---- stand-ins -------------------------------------------------------------

function fakeBucket() {
  const files = new Map();
  return {
    files,
    file: (path) => ({
      save: async (buf) => { files.set(path, Buffer.from(buf)); },
      download: async () => [files.get(path)],
      delete: async () => { files.delete(path); },
    }),
  };
}

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

const OPEN_METEO = {
  daily: {
    time: ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'],
    weather_code: [0, 2, 3, 63, 53, 2, 0, 1],
    temperature_2m_max: [66, 63, 60, 57, 58, 61, 64, 65],
    temperature_2m_min: [48, 50, 52, 50, 49, 47, 46, 47],
    precipitation_probability_max: [0, 10, 20, 80, 40, 10, 0, 0],
  },
};
const AIR_QUALITY = { hourly: {
  time: ['2026-11-10T08:00', '2026-11-10T16:00', '2026-11-12T12:00'], us_aqi: [40, 72, 130],
} };
const NWS_FORECAST = { properties: { periods: [
  { startTime: '2026-11-10T06:00:00-08:00', isDaytime: true, temperature: 61, shortForecast: 'Cloudy', probabilityOfPrecipitation: { value: 10 } },
  { startTime: '2026-11-10T18:00:00-08:00', isDaytime: false, temperature: 50, shortForecast: 'Cloudy', probabilityOfPrecipitation: { value: 10 } },
  { startTime: '2026-11-11T06:00:00-08:00', isDaytime: true, temperature: 56, shortForecast: 'Rain', probabilityOfPrecipitation: { value: 90 } },
  { startTime: '2026-11-11T18:00:00-08:00', isDaytime: false, temperature: 49, shortForecast: 'Rain', probabilityOfPrecipitation: { value: 70 } },
] } };

// A fake network. Options turn individual services off.
function fakeFetch({ badToken = false, davidDown = false, openMeteoDown = false, airDown = false, enphaseDown = false, enphaseExpired = false } = {}) {
  const cals = Object.fromEntries(calendarSources().map((c) => [c.id, c.events]));
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push(String(url));
    const u = new URL(url);
    if (u.host === 'api.enphaseenergy.com') {
      if (u.pathname === '/oauth/token') {
        fn.enphaseRefreshes.push(u.searchParams.get('refresh_token'));
        assert.match(init.headers?.Authorization || '', /^Basic /);
        return enphaseExpired ? json({ error: 'invalid_grant' }, 401)
          : json({ access_token: `en-access-${fn.enphaseRefreshes.length}`, refresh_token: `en-refresh-${fn.enphaseRefreshes.length}`, expires_in: 86393 });
      }
      if (enphaseDown) return json({ message: 'down' }, 503);
      assert.equal(u.searchParams.get('key'), 'en-key');
      const path = u.pathname.replace('/api/v4/systems/42/', '');
      return ENPHASE[path] ? json(ENPHASE[path]) : json({ message: 'not found' }, 404);
    }
    if (u.host === 'oauth2.googleapis.com') return badToken ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'tok' });
    if (u.host === 'www.googleapis.com') {
      const id = decodeURIComponent(u.pathname.split('/')[4]);
      if (id === DAVID && davidDown) return json({ error: 'nope' }, 404);
      return json({ items: cals[id] || [] });
    }
    if (u.host === 'api.open-meteo.com') return openMeteoDown ? json({ error: true, reason: 'Daily API request limit exceeded' }, 429) : json(OPEN_METEO);
    if (u.host === 'air-quality-api.open-meteo.com') return airDown ? json({ error: true, reason: 'down' }, 503) : json(AIR_QUALITY);
    if (u.pathname.startsWith('/points/')) return json({ properties: { forecast: 'https://api.weather.gov/gridpoints/MTR/1,1/forecast' } });
    if (u.pathname.endsWith('/forecast')) return json(NWS_FORECAST);
    throw new Error(`unexpected ${url}`);
  };
  fn.calls = calls;
  fn.enphaseRefreshes = [];
  fn.enphaseCalls = () => calls.filter((c) => c.includes('enphaseenergy') && !c.includes('/oauth/'));
  return fn;
}

const ENPHASE_SECRET = JSON.stringify({ api_key: 'en-key', client_id: 'en-id', client_secret: 'en-secret', refresh_token: 'en-first', system_id: 42 });
const SECRETS = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', enphase: ENPHASE_SECRET };
const NOW = Date.parse('2026-11-09T23:55:00-08:00');
const render = async () => Buffer.from('PNG');

async function clear() {
  for (const c of ['config', 'weeks', 'status', 'renders', 'devices', 'private']) {
    const s = await db.collection(c).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
}

before(clear);
beforeEach(async () => {
  await clear();
  await db.doc('config/household').set(HOUSEHOLD);
});

const build = (opts = {}) => runBuild({
  db, bucket: opts.bucket || fakeBucket(), fetch: opts.fetch || fakeFetch(), secrets: opts.secrets || SECRETS,
  now: opts.now || NOW, asOf: opts.asOf || '2026-11-10', render,
});

// ---- the nightly build -----------------------------------------------------

test('a build stores the merged week, the image and a good status', async () => {
  const bucket = fakeBucket();
  await build({ bucket });
  const week = (await db.doc('weeks/2026-11-09').get()).data(); // keyed by the window's first day
  assert.equal(week.title, 'Nov 9 – 15');
  assert.equal(week.subtitle, 'Mon – Sun');
  assert.deepEqual(week.days.map((d) => d.date)[0], '2026-11-09');
  assert.equal(week.as_of, '2026-11-10');
  const tue = week.days.find((d) => d.date === '2026-11-10');
  const dinner = tue.events.find((e) => e.title.startsWith('Dinner at Nido'));
  assert.deepEqual(dinner.badges, ['P', 'D']);
  assert.equal(tue.events.filter((e) => e.title.startsWith('Dinner')).length, 1); // de-duplicated
  assert.ok(!tue.events.some((e) => e.title === 'Physical therapy'));          // private
  assert.ok(!week.days.some((d) => d.events.some((e) => /temescal|south berkeley/i.test(e.title))), 'hide_events');
  assert.equal(tue.weather.hi, 60);
  assert.equal(dinner.location, 'Nido');

  // Shared calendars: no badges unless someone is on the invite; home address hidden.
  const compost = tue.events.find((e) => e.title === 'Compost and recycling out');
  assert.deepEqual(compost.badges, []);
  assert.equal(compost.location, null);
  const wed = week.days.find((d) => d.date === '2026-11-11');
  assert.equal(wed.events[0].title, 'Veterans Day');
  assert.equal(wed.events[0].holiday, true); // holiday calendar found by its ID
  const mon = week.days.find((d) => d.date === '2026-11-09');
  const call = mon.events.find((e) => e.title === 'Housewarming planning call');
  assert.deepEqual(call.badges, ['P', 'D']);
  assert.equal(call.location, null); // meeting links aren't shown

  // Air quality and reminders.
  assert.equal(tue.aqi, 72);
  assert.equal(week.days.find((d) => d.date === '2026-11-12').aqi, 130);
  assert.deepEqual(wed.notices.map((n) => n.text), ['Bins out tonight', 'Street sweeping today']);
  assert.ok(!wed.events.some((e) => /trash|sweeping/i.test(e.title)), 'calendar copies are replaced by the reminders');

  const status = (await db.doc('status/latest').get()).data();
  assert.equal(status.ok, true);
  assert.equal(status.consecutive_failures, 0);
  assert.match(status.image, /^week-20261109-\d{10}$/);
  assert.ok(status.image.length <= 31); // TRMNL filename limit
  const r = (await db.doc(`renders/${status.image}`).get()).data();
  assert.ok(bucket.files.has(r.path));
  assert.ok(r.token.length >= 20);
});

test('a shared calendar failing is named by its label', async () => {
  const fetch = fakeFetch();
  const wrapped = async (url, init) => (String(url).includes('home-tasks') ? json({}, 403) : fetch(url, init));
  const snap = await build({ fetch: wrapped });
  assert.deepEqual(snap.warnings, ["Couldn't read Home Tasks"]);
});

test("one calendar failing still builds, with a warning naming it", async () => {
  const snap = await build({ fetch: fakeFetch({ davidDown: true }) });
  assert.deepEqual(snap.warnings, ["Couldn't read David's calendar"]);
  const all = snap.days.flatMap((d) => d.events.map((e) => e.title));
  assert.ok(all.includes('Run club'));
  assert.ok(!all.includes('Climbing'));
});

test('a revoked Google token fails the build and is flagged on the page', async () => {
  await build(); // a good night first
  const err = await build({ fetch: fakeFetch({ badToken: true }) }).catch((e) => e);
  assert.ok(err instanceof BuildError);
  assert.match(err.message, /connect-google/);
  await recordFailure(db, err);
  await recordFailure(db, err);
  const status = (await db.doc('status/latest').get()).data();
  assert.equal(status.ok, false);
  assert.equal(status.consecutive_failures, 2);
  assert.equal(status.google_disconnected, true);
  assert.equal(status.week_id, '2026-11-09'); // the last good window is still pointed at
});

test('if Open-Meteo is down, NWS covers the days ahead and past days keep their forecast', async () => {
  await build({ asOf: '2026-11-09', now: NOW - 864e5 }); // Monday's build, with Open-Meteo up
  const fetch = fakeFetch({ openMeteoDown: true });
  const snap = await build({ fetch });
  const byDate = Object.fromEntries(snap.days.map((d) => [d.date, d.weather]));
  assert.equal(byDate['2026-11-10'].source, 'nws');
  assert.equal(byDate['2026-11-11'].label, 'Rain');
  assert.equal(byDate['2026-11-09'].stale, true);        // yesterday: kept from the last build's window
  assert.equal(byDate['2026-11-13'].stale, true);        // beyond NWS here: kept, and…
  assert.deepEqual(snap.warnings, ['Some weather is from an earlier forecast']); // …flagged
  assert.ok(fetch.calls.some((u) => u.includes('api.weather.gov')));
});

test('snapshots and images older than 14 days are deleted', async () => {
  const bucket = fakeBucket();
  await db.doc('weeks/2026-10-18').set({ week_id: '2026-10-18' });
  await db.doc('renders/week-20261018-1').set({ path: 'renders/old.png', created_at: NOW - 15 * 864e5, token: 'x' });
  bucket.files.set('renders/old.png', Buffer.from('old'));
  await build({ bucket });
  assert.equal((await db.doc('weeks/2026-10-18').get()).exists, false);
  assert.equal((await db.doc('renders/week-20261018-1').get()).exists, false);
  assert.equal(bucket.files.has('renders/old.png'), false);
  assert.equal((await db.doc('weeks/2026-11-09').get()).exists, true);
});

test('missing household settings stop the build with a pointer to the README', async () => {
  await db.doc('config/household').delete();
  await assert.rejects(build(), /config\/household is missing/);
});

// ---- the TRMNL device API --------------------------------------------------

function call(handler, { path, headers = {}, query = {}, body } = {}) {
  const h = Object.fromEntries(Object.entries({ host: 'week.example.web.app', ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { path, query, body, get: (k) => h[k.toLowerCase()] };
  return new Promise((resolve) => {
    const res = {
      code: 200, headers: {},
      status(c) { this.code = c; return this; },
      set(k, v) { this.headers[k] = v; return this; },
      json(b) { resolve({ code: this.code, body: b }); },
      send(b) { resolve({ code: this.code, body: b, headers: this.headers }); },
    };
    handler(req, res);
  });
}

const MAC = 'AA:BB:CC:DD:EE:FF';

test('an unknown display is refused at setup and shown on the page for approval', async () => {
  const handler = makeDeviceHandler({ db, bucket: fakeBucket(), now: () => NOW });
  const r = await call(handler, { path: '/api/setup', headers: { ID: MAC.toLowerCase() } });
  assert.equal(r.code, 404);
  assert.equal((await db.doc('status/device').get()).data().pending_mac, MAC);
});

test('an approved display gets a key, then the latest image and a sleep until midnight', async () => {
  const bucket = fakeBucket();
  await build({ bucket });
  await db.doc(`devices/${MAC}`).set({ approved: true });
  const now = Date.parse('2026-11-10T00:00:30-08:00');
  const handler = makeDeviceHandler({ db, bucket, now: () => now });

  const setup = await call(handler, { path: '/api/setup', headers: { ID: MAC } });
  assert.equal(setup.body.status, 200);
  const key = setup.body.api_key;
  assert.ok(key.length > 20);
  // Asking again returns the same key.
  assert.equal((await call(handler, { path: '/api/setup', headers: { ID: MAC } })).body.api_key, key);

  assert.equal((await call(handler, { path: '/api/display', headers: { ID: MAC, 'Access-Token': 'wrong' } })).code, 401);

  const disp = await call(handler, { path: '/api/display', headers: { ID: MAC, 'Access-Token': key, 'Battery-Voltage': '3.6' } });
  const status = (await db.doc('status/latest').get()).data();
  assert.equal(disp.body.status, 0);
  assert.equal(disp.body.filename, status.image);
  assert.equal(disp.body.refresh_rate, 12 * 3600); // 00:00:30 to noon, plus the 30 s margin
  assert.equal(typeof disp.body.refresh_rate, 'number');
  assert.ok(disp.body.image_url.startsWith(`https://week.example.web.app/api/image/${status.image}.png?t=`));
  assert.equal((await db.doc('status/device').get()).data().battery_pct, 25);

  // The image needs its token.
  const u = new URL(disp.body.image_url);
  const img = await call(handler, { path: u.pathname, query: { t: u.searchParams.get('t') } });
  assert.equal(img.headers['Content-Type'], 'image/png');
  assert.equal(String(img.body), 'PNG');
  assert.equal((await call(handler, { path: u.pathname, query: { t: 'guess' } })).code, 404);
});

test("the display refreshes at midnight and noon, and retries if that refresh's image isn't ready", () => {
  const at = (t, d = '2026-11-10') => Date.parse(`${d}T${t}-08:00`);
  // Fresh images: sleep until the next noon or midnight.
  assert.equal(refreshRate(at('00:00:30'), at('23:55:00', '2026-11-09')), 12 * 3600);
  assert.equal(refreshRate(at('12:00:30'), at('11:55:00')), 12 * 3600);
  assert.equal(refreshRate(at('15:00:00'), at('11:56:00')), 9 * 3600 + 30);
  // The noon build hasn't landed: only the midnight image exists.
  assert.equal(refreshRate(at('12:00:30'), at('23:55:00', '2026-11-09')), RETRY_SECONDS);
  assert.equal(refreshRate(at('17:50:00'), at('23:55:00', '2026-11-09')), RETRY_SECONDS);
  assert.equal(refreshRate(at('18:00:00'), at('23:55:00', '2026-11-09')), 6 * 3600 + 30); // gave up: wait for midnight
  assert.equal(refreshRate(at('00:00:30'), undefined), RETRY_SECONDS);
  assert.equal(batteryPercent('4.2'), 100);
  assert.equal(batteryPercent('3.4'), 0);
  assert.equal(batteryPercent(undefined), null);
});

test('air quality down: earlier values are kept, with a warning only if today has none', async () => {
  await build();
  const snap = await build({ fetch: fakeFetch({ airDown: true }) });
  assert.equal(snap.days.find((d) => d.date === '2026-11-10').aqi, 72);
  assert.deepEqual(snap.warnings, []);
  await db.doc('weeks/2026-11-09').delete();
  const fresh = await build({ fetch: fakeFetch({ airDown: true }) });
  assert.deepEqual(fresh.warnings, ['Air quality unavailable']);
});

// ---- home energy (Enphase) -------------------------------------------------

test('energy: yesterday\'s Enphase totals land in the snapshot, tokens rotate, results are reused', async () => {
  const fetch = fakeFetch();
  const week = await build({ fetch });
  assert.equal(week.energy.date, '2026-11-09');
  assert.equal(week.energy.solar_kwh, 18.4);
  assert.equal(week.energy.self_powered, 79);
  assert.equal(week.energy.battery_pct, 64);
  assert.deepEqual(week.warnings, []);
  assert.deepEqual(fetch.enphaseRefreshes, ['en-first']);
  assert.equal(fetch.enphaseCalls().length, 6);
  const tokens = (await db.doc('private/enphase').get()).data();
  assert.equal(tokens.refresh_token, 'en-refresh-1');
  assert.equal(tokens.access_token, 'en-access-1');

  // A "Refresh now" ten minutes later reuses the figures: no Enphase calls.
  const again = fakeFetch();
  assert.equal((await build({ fetch: again, now: NOW + 10 * 6e4 })).energy.solar_kwh, 18.4);
  assert.equal(again.enphaseCalls().length, 0);

  // Two days on: the access token has expired, so the stored (rotated)
  // refresh token is used, not the one from the original connect.
  const later = fakeFetch();
  later.enphaseRefreshes.length = 0;
  await build({ fetch: later, now: NOW + 2 * 864e5, asOf: '2026-11-12' });
  assert.deepEqual(later.enphaseRefreshes, ['en-refresh-1']);
});

test('energy: an outage keeps the earlier figures, marked, and the build still succeeds', async () => {
  await build({ fetch: fakeFetch() });
  await db.doc('private/enphase_cache').delete();
  const snap = await build({ fetch: fakeFetch({ enphaseDown: true }), now: NOW + 36e5 });
  assert.equal(snap.energy.solar_kwh, 18.4);
  assert.equal(snap.energy.stale, true);
  assert.equal(snap.energy.battery_pct, null); // a battery level from earlier would mislead
  assert.deepEqual(snap.warnings, ['Solar data unavailable']);
  assert.equal((await db.doc('status/latest').get()).data().ok, true);
});

test('energy: expired Enphase access asks for a reconnect; no secret means no strip', async () => {
  const expired = await build({ fetch: fakeFetch({ enphaseExpired: true }) });
  assert.equal(expired.energy, null);
  assert.match(expired.warnings.join(), /npm run connect-enphase/);

  await clear(); await db.doc('config/household').set(HOUSEHOLD);
  const fetch = fakeFetch();
  const off = await build({ fetch, secrets: { ...SECRETS, enphase: '{}' } });
  assert.equal(off.energy, null);
  assert.deepEqual(off.warnings, []);
  assert.equal(fetch.calls.filter((c) => c.includes('enphase')).length, 0);
});
