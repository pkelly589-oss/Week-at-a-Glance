// Fetches the raw data for a week: both Google Calendars and the weather.
// `fetch` is passed in so tests can stand in for the network.
//
// Requirements doc: Data sources.

import { TZ, parseOpenMeteo, parseNws, parseAirQuality } from '../shared/week.js';

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

// Open-Meteo, the whole Sunday–Saturday week in one call (past days included).
export async function openMeteo({ lat, lon }, week, fetch) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: 'fahrenheit', timezone: TZ,
    start_date: week.sunday, end_date: week.saturday,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { headers: { 'User-Agent': UA } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) throw new Error(`Open-Meteo: ${body?.reason || res.status}`);
  return parseOpenMeteo(body);
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
export async function weekWeather(location, week, asOf, previousDays, fetch) {
  const warnings = [];
  let got = {};
  try {
    got = await openMeteo(location, week, fetch);
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
  return { weather: out, warnings };
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
  let got = {};
  try {
    const q = new URLSearchParams({
      latitude: String(lat), longitude: String(lon), hourly: 'us_aqi', timezone: TZ,
      start_date: week.sunday, end_date: week.saturday,
    });
    const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}`, { headers: { 'User-Agent': UA } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.error) throw new Error(`Air quality: ${body?.reason || res.status}`);
    got = parseAirQuality(body);
  } catch (e) {
    console.warn('Air quality failed', e.message);
    if (!previous?.[asOf]) warnings.push('Air quality unavailable');
  }
  const out = {};
  for (const date of week.dates) {
    const v = got[date] ?? previous?.[date];
    if (v != null) out[date] = v;
  }
  return { air: out, warnings };
}
