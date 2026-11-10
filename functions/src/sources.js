// Fetches the raw data for a week: both Google Calendars and the weather.
// `fetch` is passed in so tests can stand in for the network.
//
// Requirements doc: Data sources.

import { createHash } from 'node:crypto';
import { TZ, parseOpenMeteo, parseOpenMeteoCurrent, parseNws, parseAirQuality, parseAirCurrent, parseAirNow, zonedTime, parseEnphaseDaily, parseSoc, energySummary, addDays, dayShort, monthDay } from '../shared/week.js';

// ---------------------------------------------------------------------------
// Google Calendar
// ---------------------------------------------------------------------------

export class GoogleAuthError extends Error {}

// Swaps the stored refresh token for a short-lived access token.
export async function googleAccessToken({ clientId, clientSecret, refreshToken }, fetch) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new GoogleAuthError('Google isn\'t connected yet. Run `npm run connect-google` (see README).');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const why = body.error === 'invalid_grant'
      ? 'Google access was revoked or expired. Run `npm run connect-google` again.'
      : `Google sign-in failed (${body.error || res.status}).`;
    throw new GoogleAuthError(why);
  }
  return body.access_token;
}

// Every event on one calendar between two instants, recurring events expanded
// into their instances. Follows nextPageToken until the list is complete.
export async function listEvents(calendarId, { timeMin, timeMax }, token, fetch) {
  const events = [];
  let pageToken;
  do {
    const q = new URLSearchParams({
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', timeZone: TZ,
    });
    if (pageToken) q.set('pageToken', pageToken);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${q}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Calendar ${res.status}${res.status === 404 ? ' (not shared with this Google account?)' : ''}: ${detail.slice(0, 200)}`);
    }
    const body = await res.json();
    events.push(...(body.items || []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return events;
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

const UA = 'week-at-a-glance home display';

// Open-Meteo, all seven days in one call (yesterday included), plus the
// conditions right now for the header. Returns { days, current }.
export async function openMeteo({ lat, lon }, week, fetch) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    current: 'temperature_2m,weather_code,is_day',
    temperature_unit: 'fahrenheit', timezone: TZ,
    start_date: week.start, end_date: week.end,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { headers: { 'User-Agent': UA } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) throw new Error(`Open-Meteo: ${body?.reason || res.status}`);
  return { days: parseOpenMeteo(body), current: parseOpenMeteoCurrent(body) };
}

// National Weather Service: forward-looking days only.
export async function nws({ lat, lon }, fetch) {
  const get = async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/geo+json' } });
    if (!res.ok) throw new Error(`NWS ${res.status}`);
    return res.json();
  };
  const point = await get(`https://api.weather.gov/points/${(+lat).toFixed(4)},${(+lon).toFixed(4)}`);
  return parseNws(await get(point.properties.forecast));
}

// Weather for every day of the week, as well as it can be had:
// 1. Open-Meteo for the whole week;
// 2. if that fails, the National Weather Service for the days ahead;
// 3. any day still missing keeps what the previous snapshot had for it.
// Days already past that come from the previous snapshot are normal (NWS has no
// past days); only a stale forecast for today or later earns a warning.
// `current` (conditions now) comes only from Open-Meteo; without it the header
// shows today's forecast instead.
export async function weekWeather(location, week, asOf, previousDays, fetch) {
  const warnings = [];
  let got = {}, current = null;
  try {
    ({ days: got, current } = await openMeteo(location, week, fetch));
  } catch (e1) {
    try {
      got = await nws(location, fetch);
    } catch (e2) {
      warnings.push('Weather service unreachable');
      console.warn('Weather failed', e1.message, e2.message);
    }
  }
  const out = {};
  const kept = [];
  for (const date of week.dates) {
    if (got[date]) out[date] = got[date];
    else if (previousDays?.[date]) { out[date] = { ...previousDays[date], stale: true }; kept.push(date); }
  }
  if (kept.some((d) => d >= asOf) && !warnings.length) warnings.push('Some weather is from an earlier forecast');
  return { weather: out, current, warnings };
}

// ---------------------------------------------------------------------------
// Air quality
// ---------------------------------------------------------------------------

// Open-Meteo's air-quality API (CAMS forecasts): US AQI by the hour, reduced
// to each day's worst hour. Its forecast reaches about 5 days ahead, so the
// last day or two of the week may have none yet. Days it can't supply keep
// what the previous snapshot had.
export async function weekAir({ lat, lon }, week, asOf, previous, fetch) {
  const warnings = [];
  let got = {}, current = null;
  try {
    const q = new URLSearchParams({
      latitude: String(lat), longitude: String(lon), hourly: 'us_aqi', current: 'us_aqi', timezone: TZ,
      start_date: week.start, end_date: week.end,
    });
    const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}`, { headers: { 'User-Agent': UA } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.error) throw new Error(`Air quality: ${body?.reason || res.status}`);
    got = parseAirQuality(body);
    current = parseAirCurrent(body);
  } catch (e) {
    console.warn('Air quality failed', e.message);
    if (!previous?.[asOf]) warnings.push('Air quality unavailable');
  }
  const out = {};
  for (const date of week.dates) {
    const v = got[date] ?? previous?.[date];
    if (v != null) out[date] = v;
  }
  return { air: out, current, warnings };
}

// AirNow (EPA): the official current AQI from nearby monitors, for the header.
// Uses the current-observations service that replaced observation/latLong/
// current when AirNow retired it on October 1, 2026.
// The AIRNOW secret holds the free API key; empty or "off" skips it, and the
// header then uses Open-Meteo's modelled AQI. AirNow allows 500 calls an hour;
// this makes one per build.
export async function airNowCurrent(apiKey, { lat, lon }, fetch, now = Date.now()) {
  const key = String(apiKey || '').trim();
  if (!key || /^(\{\s*\}|off|none)$/i.test(key)) return { current: null, warnings: [] };
  try {
    const q = new URLSearchParams({
      format: 'application/json', latitude: String(lat), longitude: String(lon), API_KEY: key,
    });
    const res = await fetch(`https://www.airnowapi.org/aq/observation/current/ziplatlong/?${q}`, { headers: { 'User-Agent': UA } });
    const body = await res.json().catch(() => null);
    const said = body?.WebServiceError?.[0]?.Message;
    if (!res.ok || said) throw new Error(`AirNow ${res.status}${said ? `: ${said}` : ''}`);
    const current = parseAirNow(body, now);
    if (!current) throw new Error('AirNow: no recent reading');
    return { current, warnings: [] };
  } catch (e) {
    console.warn('AirNow failed', e.message);
    return { current: null, warnings: [] }; // Open-Meteo's AQI stands in
  }
}

// ---------------------------------------------------------------------------
// Home energy: Enphase Enlighten API v4
// ---------------------------------------------------------------------------
//
// The ENPHASE secret (set by `npm run connect-enphase`) holds the app's API key,
// client ID and secret, the system ID and the first refresh token. Enphase
// access tokens last a day and refresh tokens a month, and each refresh may
// hand back a new refresh token, so the latest pair is kept in Firestore at
// private/enphase (functions only; the rules deny every browser). `seed`
// records which connect it came from, so reconnecting starts a fresh chain.
//
// Free "Watt" plan: 10 calls a minute, 1,000 a month. Yesterday's totals (5
// calls) are fetched only by the first build of a day (23:55) and again after
// 11:50, when the day's data is complete. The battery level (1 call) is
// reused for 55 minutes, so it's fetched at about every other 30-minute build.
// About 28 calls a day, 870 a month, leaving room for "Refresh now".

export class EnphaseAuthError extends Error {}

const ENPHASE = 'https://api.enphaseenergy.com';
const SOC_CACHE_MS = 55 * 60 * 1000;
const TOTALS_RECHECK_MS = 10 * 60 * 1000; // totals are refetched from 11:50
const fingerprint = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

// Reads the ENPHASE secret. Empty, "{}" or "off" means energy is switched off.
export function enphaseConfig(raw) {
  if (!raw || /^\s*(\{\s*\}|off|none)?\s*$/i.test(raw)) return null;
  let c;
  try { c = JSON.parse(raw); } catch { throw new EnphaseAuthError('The ENPHASE secret isn\'t valid JSON. Run `npm run connect-enphase` again.'); }
  const missing = ['api_key', 'client_id', 'client_secret', 'refresh_token', 'system_id'].filter((k) => !c[k]);
  if (missing.length) throw new EnphaseAuthError(`The ENPHASE secret is missing ${missing.join(', ')}. Run \`npm run connect-enphase\` again.`);
  return c;
}

export async function enphaseAccessToken(cfg, db, fetch, now = Date.now()) {
  const ref = db.doc('private/enphase');
  const stored = (await ref.get()).data() || {};
  const seed = fingerprint(cfg.refresh_token);
  const mine = stored.seed === seed;
  if (mine && stored.access_token && stored.access_expires_at > now + 10 * 60 * 1000) return stored.access_token;

  const refreshToken = mine && stored.refresh_token ? stored.refresh_token : cfg.refresh_token;
  const q = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const res = await fetch(`${ENPHASE}/oauth/token?${q}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64')}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new EnphaseAuthError(res.status === 400 || res.status === 401 || body.error === 'invalid_grant'
      ? 'Enphase access expired. Run `npm run connect-enphase` again.'
      : `Enphase sign-in failed (${body.error || res.status}).`);
  }
  await ref.set({
    seed,
    refresh_token: body.refresh_token || refreshToken,
    access_token: body.access_token,
    access_expires_at: now + (Number(body.expires_in) || 86400) * 1000,
    refreshed_at: now,
  }, { merge: true });
  return body.access_token;
}

async function enphaseGet(cfg, token, path, params, fetch) {
  const q = new URLSearchParams({ ...params, key: cfg.api_key });
  const res = await fetch(`${ENPHASE}/api/v4/systems/${encodeURIComponent(cfg.system_id)}/${path}?${q}`, {
    headers: { Authorization: `Bearer ${token}`, key: cfg.api_key },
  });
  if (!res.ok) throw new Error(`Enphase ${path} ${res.status}`);
  return res.json();
}

// Yesterday's totals (relative to asOf) and the battery's charge right now.
// Each figure is fetched on its own, so a system without a battery or a
// consumption meter still shows what it has. The raw daily figures and the
// battery level are kept in private/enphase_cache so most builds need only one
// call. On failure it falls back to the previous snapshot's figures, then to
// nothing.
const TOTALS = [
  ['produced', 'energy_lifetime', 'production'],
  ['consumed', 'consumption_lifetime', 'consumption'],
  ['imported', 'energy_import_lifetime', 'import'],
  ['exported', 'energy_export_lifetime', 'export'],
  ['battery', 'battery_lifetime', null],
];

async function fetchTotals(cfg, token, day, fetch) {
  const range = { start_date: addDays(day, -1), end_date: day };
  const got = await Promise.allSettled(TOTALS.map(([, path]) => enphaseGet(cfg, token, path, range, fetch)));
  const series = {};
  got.forEach((r, i) => {
    const [name, path, key] = TOTALS[i];
    if (r.status !== 'fulfilled') { console.warn(`Enphase ${path} failed`, r.reason?.message); return; }
    if (key) series[name] = parseEnphaseDaily(r.value, key);
    else { series.charged = parseEnphaseDaily(r.value, 'charge'); series.discharged = parseEnphaseDaily(r.value, 'discharge'); }
  });
  console.log('Enphase daily Wh', JSON.stringify(series));
  return Object.keys(series.produced || {}).length ? series : null;
}

export async function homeEnergy(cfg, db, asOf, previous, fetch, now = Date.now()) {
  if (!cfg) return { energy: null, warnings: [] };
  const day = addDays(asOf, -1);
  const cacheRef = db.doc('private/enphase_cache');
  const c = (await cacheRef.get()).data() || {};
  const mine = c.system_id === String(cfg.system_id) && c.as_of === asOf;
  const recheckFrom = zonedTime(asOf, 12) - TOTALS_RECHECK_MS;
  const totalsOk = mine && c.series && !(now >= recheckFrom && c.totals_at < recheckFrom);
  const socOk = mine && c.soc_at != null && now - c.soc_at < SOC_CACHE_MS;
  const summary = (series, soc) => energySummary(series || {}, day, { asOf, soc });
  if (totalsOk && socOk) return { energy: summary(c.series, c.soc), warnings: [] };

  try {
    const token = await enphaseAccessToken(cfg, db, fetch, now);
    const [series, soc] = await Promise.all([
      totalsOk ? c.series : fetchTotals(cfg, token, day, fetch),
      socOk ? c.soc : enphaseGet(cfg, token, 'telemetry/battery', {}, fetch)
        .then((b) => parseSoc(b?.last_reported_aggregate_soc))
        .catch((e) => { console.warn('Enphase battery telemetry failed', e.message); return null; }),
    ]);
    if (!series) throw new Error('Enphase returned no totals');
    await cacheRef.set({
      system_id: String(cfg.system_id), as_of: asOf, series,
      totals_at: totalsOk ? c.totals_at : now,
      soc, soc_at: socOk ? c.soc_at : now,
    });
    return { energy: summary(series, soc), warnings: [] };
  } catch (e) {
    console.warn('Home energy failed', e.message);
    const why = e instanceof EnphaseAuthError ? e.message : 'Solar data unavailable';
    if (previous?.date) {
      const label = previous.date === day ? 'Yesterday' : `${dayShort(previous.date)} ${monthDay(previous.date)}`;
      return { energy: { ...previous, label, battery_pct: null, stale: true }, warnings: [why] };
    }
    return { energy: null, warnings: [why] };
  }
}
