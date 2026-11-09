// Week rules shared by the web page and the Cloud Functions:
// the Sunday–Saturday window, turning Google Calendar events into one merged,
// de-duplicated list per day with P/D RSVP badges, and the weather labels.
//
// Pure functions with no Firebase or network code, so they run in the browser,
// in Cloud Functions and in `node --test` alike. Section names in comments
// ("Data sources", "E-ink display") refer to the requirements doc.

export const TZ = 'America/Los_Angeles';
const DAY = 864e5;

// ---------------------------------------------------------------------------
// Dates in the household time zone
// ---------------------------------------------------------------------------
// Dates are passed around as 'YYYY-MM-DD' strings in Pacific time. Instants are
// milliseconds since 1970. Everything goes through Intl so daylight saving
// changes are handled without a date library.

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function zonedParts(ms) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, s: +p.second };
}

const pad = (n) => String(n).padStart(2, '0');

// The Pacific calendar date of an instant.
export function isoDate(ms) {
  const { y, m, d } = zonedParts(ms);
  return `${y}-${pad(m)}-${pad(d)}`;
}

function offsetMs(ms) {
  const { y, m, d, h, min, s } = zonedParts(ms);
  return Date.UTC(y, m - 1, d, h, min, s) - Math.floor(ms / 1000) * 1000;
}

// The instant a Pacific date starts (its local midnight), DST-safe.
export function startOfDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(guess);
  const again = offsetMs(t);
  if (guess - again !== t) t = guess - again;
  return t;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekday(iso) { // 0 = Sunday
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

export const dayShort = (iso) => DOW[weekday(iso)];
export const monthDay = (iso) => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8)}`;
export const longDate = (iso) =>
  `${DOW_LONG[weekday(iso)]}, ${MON_LONG[+iso.slice(5, 7) - 1]} ${+iso.slice(8)}`;

// "Week of Nov 8 – 14", or "Week of Nov 29 – Dec 5" across a month boundary.
export function weekTitle(sunday) {
  const sat = addDays(sunday, 6);
  const end = sat.slice(5, 7) === sunday.slice(5, 7) ? String(+sat.slice(8)) : monthDay(sat);
  return `Week of ${monthDay(sunday)} – ${end}`;
}

// "9a", "9:30a", "12p" (E-ink display: start time only, compact).
export function shortTime(ms) {
  const { h, min } = zonedParts(ms);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min ? ':' + pad(min) : ''}${h < 12 ? 'a' : 'p'}`;
}

// "4:58 PM".
export function clockTime(ms) {
  const { h, min } = zonedParts(ms);
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(min)} ${h < 12 ? 'AM' : 'PM'}`;
}

// Sunset for a date at a place, from the standard sunrise equation (NOAA's
// simplified form, accurate to about a minute). Computed locally, so it is
// there even when the weather services aren't.
export function sunsetMs(iso, lat, lon) {
  const rad = Math.PI / 180;
  const [y, m, d] = iso.split('-').map(Number);
  const julian = Date.UTC(y, m - 1, d, 12) / DAY + 2440587.5;
  const n = Math.ceil(julian - 2451545 + 0.0008);
  const jStar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const transit = 2451545 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const sinDec = Math.sin(lambda * rad) * Math.sin(23.4397 * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) / (Math.cos(lat * rad) * cosDec);
  if (cosW < -1 || cosW > 1) return null; // polar day or night
  const set = transit + Math.acos(cosW) / rad / 360;
  return Math.round((set - 2440587.5) * DAY);
}

// "Sun 11:55 PM", for the "Updated …" line.
export function stampLabel(ms) {
  const { h, min } = zonedParts(ms);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${dayShort(isoDate(ms))} ${h12}:${pad(min)} ${h < 12 ? 'AM' : 'PM'}`;
}

// ---------------------------------------------------------------------------
// The week window (strictly Sunday to Saturday)
// ---------------------------------------------------------------------------

export function weekOf(iso) {
  const sunday = addDays(iso, -weekday(iso));
  const dates = Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
  return {
    id: sunday,
    sunday,
    saturday: dates[6],
    dates,
    timeMin: startOfDay(sunday),
    timeMax: startOfDay(addDays(sunday, 7)),
  };
}

// Seconds from `ms` until the next Pacific midnight, plus a small margin so the
// device wakes just after it. Used as the TRMNL refresh_rate.
export function secondsToMidnight(ms, marginSec = 30) {
  const next = startOfDay(addDays(isoDate(ms), 1));
  return Math.max(60, Math.ceil((next - ms) / 1000) + marginSec);
}

// ---------------------------------------------------------------------------
// Calendar events → one list per day
// ---------------------------------------------------------------------------
//
// `people` describes the two of you, e.g.
//   [{ key: 'pete', letter: 'P', email: 'pete@…' }, { key: 'david', letter: 'D', email: '…' }]
// `sources` is one entry per calendar read:
//   { person: 'pete', events: [<Google Calendar API event>, …] }
// A calendar that isn't one person's (Home Tasks, holidays, the house account)
// has person: null. Its events get badges only from their invite list.
// A holiday calendar also has holiday: true; its events come first in their
// day and carry no badges (requirements: E-ink display > Event rows).

// Google's public holiday calendars, e.g. en.usa#holiday@group.v.calendar.google.com.
export const isHolidayCalendar = (cal) => cal?.holiday === true || /#holiday@group\.v\.calendar\.google\.com$/.test(cal?.id || '');

// A calendar with as_reminders: true (Home Tasks) is shown as reminder bars,
// like "Bins out tonight", instead of as events.
export const isReminderCalendar = (cal) => cal?.as_reminders === true;

const PRIVATE = new Set(['private', 'confidential']);
// Events Gmail adds from confirmation emails (reservations, flights) are
// always created private. That isn't your choice, so it doesn't hide them.
const fromGmail = (ev) => /^from_?gmail$/i.test(ev?.eventType || '');
export const isPrivate = (ev) => PRIVATE.has(ev?.visibility) && !fromGmail(ev);
const lower = (s) => (s || '').trim().toLowerCase();
const squash = (s) => lower(s).replace(/\s+/g, ' ');

// The start of an event (or of the instance of a recurring series it came from)
// as a comparable string.
const startKey = (t) => (t && (t.dateTime ? String(Date.parse(t.dateTime)) : t.date)) || '';

// Rule 1 (Data sources > Deduplication): same iCalUID and same instance.
export function eventKey(ev) {
  const inst = startKey(ev.originalStartTime || ev.start);
  return ev.iCalUID ? `uid:${ev.iCalUID}|${inst}` : `id:${ev.id}`;
}

// Rule 2: hand-made copies with the same title and the same start.
export function looseKey(ev) {
  return `t:${squash(ev.summary)}|${startKey(ev.start)}`;
}

function personByEmail(people, email) {
  const e = lower(email);
  return people.find((p) => lower(p.email) === e);
}

// Merge the copies of each event found across the calendars.
// Returns [{ copies: [{person, ev}], primary: ev, sources: Set<personKey> }].
export function mergeEvents(sources, people) {
  const groups = [];
  const byKey = new Map();
  for (const { person, events, holiday = false, reminder = false } of sources) {
    for (const ev of events || []) {
      if (!ev || ev.status === 'cancelled') continue;
      // A copy with no title is a free/busy-only view of someone else's
      // calendar: it says nothing usable, so it is ignored (it does not make
      // the event private; another copy may still show it).
      if (!ev.summary && !isPrivate(ev)) continue;
      const k1 = eventKey(ev), k2 = ev.summary ? looseKey(ev) : null;
      let g = byKey.get(k1) || (k2 && byKey.get(k2));
      if (!g) { g = { copies: [], sources: new Set() }; groups.push(g); }
      g.copies.push({ person, ev, holiday, reminder });
      g.sources.add(person);
      byKey.set(k1, g);
      if (k2) byKey.set(k2, g);
    }
  }
  const merged = mergeSimilar(groups);
  for (const g of merged) g.primary = pickPrimary(g.copies, people);
  return merged;
}

// Rule 2b: the same occasion entered separately by each of you, with
// different wording ("My Anniversary!!" and "💍Anniversary"). Two events merge
// when they come from different people's calendars, start at the same moment
// (or on the same day, for all-day events) and the words of one title are all
// in the other, ignoring "my", "our", emoji and punctuation. Shared calendars
// (Home Tasks, holidays, the house) never take part.
const FILLER = new Set(['my', 'our', 'the', 'a', 'an', 'his', 'her', 'their']);
export function titleWords(title) {
  return new Set(String(title || '').toLowerCase()
    .replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, ' ')
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !FILLER.has(w)));
}
const subset = (a, b) => [...a].every((w) => b.has(w));
function similarTitles(t1, t2) {
  const a = titleWords(t1), b = titleWords(t2);
  return a.size > 0 && b.size > 0 && (subset(a, b) || subset(b, a));
}
function mergeSimilar(groups) {
  const out = [];
  for (const g of groups) {
    const ev = g.copies[0].ev;
    const people = [...g.sources].filter(Boolean);
    const match = people.length && out.find((o) => {
      const other = o.copies[0].ev;
      const theirs = [...o.sources].filter(Boolean);
      return theirs.length && !theirs.some((p) => g.sources.has(p))
        && o.sources.size === theirs.length && g.sources.size === people.length
        && startKey(other.start) === startKey(ev.start)
        && !!other.start?.date === !!ev.start?.date
        && similarTitles(other.summary, ev.summary);
    });
    if (match) { match.copies.push(...g.copies); g.sources.forEach((p) => match.sources.add(p)); }
    else out.push(g);
  }
  return out;
}

// Rule 4: prefer the organizer's copy, and fill blanks from the others.
function pickPrimary(copies, people) {
  const orgCopy = copies.find(({ person, ev }) => {
    const p = people.find((x) => x.key === person);
    return p && (ev.organizer?.self || lower(ev.organizer?.email) === lower(p.email));
  });
  const base = { ...(orgCopy || copies[0]).ev };
  for (const { ev } of copies) {
    for (const f of ['summary', 'location', 'description']) if (!base[f] && ev[f]) base[f] = ev[f];
    if ((!base.attendees || !base.attendees.length) && ev.attendees?.length) base.attendees = ev.attendees;
  }
  // Merged copies with different wording: prefer the title that isn't one
  // person's view ("Anniversary" over "My Anniversary!!").
  const personal = (t) => /^\s*(my|our)\b/i.test(String(t || '').replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, ''));
  if (personal(base.summary)) {
    const neutral = copies.map(({ ev }) => ev.summary).find((t) => t && !personal(t));
    if (neutral) base.summary = neutral;
  }
  return base;
}

// Is this person going? (Data sources > Deduplication, rule 3)
//  - organizer, or accepted / tentative on the invite → yes
//  - declined, or invited but not yet answered → no badge
//  - on their calendar with no entry for them on the invite (their own event,
//    or invited through a group) → yes
export function rsvp(group, person) {
  const ev = group.primary;
  const atts = group.copies.flatMap(({ ev: c }) => c.attendees || []);
  const mine = atts.filter((a) => lower(a.email) === lower(person.email));
  if (mine.some((a) => a.responseStatus === 'declined')) return 'declined';
  if (mine.some((a) => a.organizer || ['accepted', 'tentative'].includes(a.responseStatus))) return 'going';
  if (lower(ev.organizer?.email) === lower(person.email)) return 'going';
  if (mine.length) return 'invited';
  return group.sources.has(person.key) ? 'going' : 'none';
}

// Locations worth showing (requirements: E-ink display > Event rows): meeting
// links are dropped, and so is anything matching `hide` (e.g. the home
// address, which says nothing for an event at home).
export function cleanLocation(loc, hide = []) {
  const s = (loc || '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  if (/https?:\/\/|zoom\.us|meet\.google\.com|teams\.microsoft|webex\.com/i.test(s)) return null;
  if (hide.some((h) => h && lower(s).includes(lower(h)))) return null;
  return s;
}

// The e-ink has room for one short line: the place name, or the street
// address without city and postcode ("Nido, 444 Embarcadero W, …" → "Nido").
export const shortLocation = (s) => (s || '').split(',')[0].trim();

// Only the place's name, never its address (requirements: Event rows).
// Google Maps locations read "Name, street, city…": the first part is kept.
// When the location starts with the street itself ("5614 Bay Street, …") there
// is no name, so nothing is shown.
export function placeName(loc) {
  const first = shortLocation(loc);
  if (!first) return null;
  if (/^\d+[a-z]?\s+\S/i.test(first)) return null;                 // "444 Embarcadero W"
  if (/^(p\.?o\.? box|suite|ste\.?|unit|apt\.?)\b/i.test(first)) return null;
  return first;
}

// Applies the exclusion rules, then works out badges.
// Returns [{ title, location, allDay, start, end, badges }], where for all-day
// events start/end are 'YYYY-MM-DD' (end exclusive) and for timed events they
// are milliseconds.
export function buildEvents(sources, people, { hideLocations = [], reminders = [], hideEvents = [] } = {}) {
  const out = [];
  for (const g of mergeEvents(sources, people)) {
    // Private on any copy → hidden for everyone (both Pete's and David's).
    if (g.copies.some(({ ev }) => isPrivate(ev))) continue;
    const ev = g.primary;
    if (!ev.summary) continue;
    if (hiddenByReminder(ev.summary, reminders)) continue; // shown as a reminder instead
    if (titleMatches(ev.summary, hideEvents)) continue;        // config/household.hide_events
    const answers = people.map((p) => ({ p, a: rsvp(g, p) }));
    const involved = answers.filter(({ a }) => a !== 'none');
    // Hidden only when everyone of the two who is on it has declined.
    if (involved.length && involved.every(({ a }) => a === 'declined')) continue;
    const badges = answers.filter(({ a }) => a === 'going').map(({ p }) => p.letter);
    const allDay = !!ev.start?.date;
    const isHoliday = g.copies.some((c) => c.holiday);
    const isReminder = !isHoliday && g.copies.some((c) => c.reminder);
    out.push({
      title: ev.summary.trim(),
      // The first copy whose location names a place ("Ashes & Diamonds
      // Winery"), not just an address.
      location: [ev, ...g.copies.map((c) => c.ev)]
        .map((c) => placeName(cleanLocation(c.location, hideLocations))).find(Boolean) || null,
      allDay,
      start: allDay ? ev.start.date : Date.parse(ev.start.dateTime),
      end: allDay ? (ev.end?.date || addDays(ev.start.date, 1)) : Date.parse(ev.end?.dateTime || ev.start.dateTime),
      badges: isHoliday || isReminder ? [] : badges,
      holiday: isHoliday,
      reminder: isReminder,
    });
  }
  return out;
}

// A timed event that runs past midnight is not repeated on the next day when it
// ends before this hour (a 10pm–1am party belongs to its first day only).
const CARRY_OVER_HOUR = 6;

// The Pacific dates an event covers.
export function eventDates(ev) {
  const dates = [];
  if (ev.allDay) {
    for (let d = ev.start; d < ev.end; d = addDays(d, 1)) dates.push(d);
    return dates.length ? dates : [ev.start];
  }
  const first = isoDate(ev.start);
  const endMs = Math.max(ev.end, ev.start);
  for (let d = first; startOfDay(d) < endMs || d === first; d = addDays(d, 1)) {
    if (d !== first && endMs <= startOfDay(d) + CARRY_OVER_HOUR * 36e5) break;
    dates.push(d);
  }
  return dates;
}

// One row per day the event covers, inside the week only.
// E-ink display > Event rows: all-day first, then by start time.
export function layoutWeek(events, week) {
  const days = Object.fromEntries(week.dates.map((d) => [d, []]));
  for (const ev of events) {
    const dates = eventDates(ev);
    dates.forEach((d, i) => {
      if (!days[d]) return;
      const firstDay = i === 0;
      days[d].push({
        title: ev.title,
        location: ev.location,
        allDay: ev.allDay || !firstDay,
        time: !ev.allDay && firstDay ? shortTime(ev.start) : null,
        sortMs: ev.holiday ? -3 : ev.reminder ? -2 : ev.allDay || !firstDay ? -1 : ev.start,
        holiday: !!ev.holiday,
        reminder: !!ev.reminder,
        badges: ev.badges,
        span: dates.length > 1 ? { n: i + 1, of: dates.length } : null,
      });
    });
  }
  for (const d of week.dates) {
    days[d].sort((a, b) => a.sortMs - b.sortMs || a.title.localeCompare(b.title));
    days[d] = days[d].map(({ sortMs, ...row }) => row);
  }
  return days;
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

// WMO weather codes (Open-Meteo) → one of eight icons and a short label.
export function weatherInfo(code) {
  const c = Number(code);
  if (c === 0) return { icon: 'sun', label: 'Sunny' };
  if (c === 1) return { icon: 'sun', label: 'Mostly sunny' };
  if (c === 2) return { icon: 'partly', label: 'Partly cloudy' };
  if (c === 3) return { icon: 'cloud', label: 'Cloudy' };
  if (c === 45 || c === 48) return { icon: 'fog', label: 'Fog' };
  if (c >= 51 && c <= 57) return { icon: 'drizzle', label: 'Drizzle' };
  if (c === 65 || c === 67 || c === 82) return { icon: 'rain', label: 'Heavy rain' };
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return { icon: 'rain', label: c >= 80 ? 'Showers' : 'Rain' };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { icon: 'snow', label: 'Snow' };
  if (c >= 95) return { icon: 'storm', label: 'Thunderstorms' };
  return { icon: 'cloud', label: 'Cloudy' };
}

// National Weather Service short forecasts ("Chance Rain Showers") → icon/label.
export function nwsInfo(text) {
  const t = lower(text);
  if (/thunder/.test(t)) return { icon: 'storm', label: 'Thunderstorms' };
  if (/snow|sleet|flurr/.test(t)) return { icon: 'snow', label: 'Snow' };
  if (/drizzle/.test(t)) return { icon: 'drizzle', label: 'Drizzle' };
  if (/shower/.test(t)) return { icon: 'rain', label: 'Showers' };
  if (/rain/.test(t)) return { icon: 'rain', label: 'Rain' };
  if (/fog|haze|smoke/.test(t)) return { icon: 'fog', label: 'Fog' };
  if (/partly|mostly sunny|mostly clear/.test(t)) return { icon: 'partly', label: 'Partly cloudy' };
  if (/cloud|overcast/.test(t)) return { icon: 'cloud', label: 'Cloudy' };
  if (/sun|clear/.test(t)) return { icon: 'sun', label: 'Sunny' };
  return { icon: 'cloud', label: text || 'Cloudy' };
}

// E-ink display > Layout: rain chance is shown only from this percentage.
export const RAIN_SHOW_PCT = 20;
export const showRain = (w) => w && w.rain != null && w.rain >= RAIN_SHOW_PCT;

// Open-Meteo daily response → { 'YYYY-MM-DD': { icon, label, hi, lo, rain } }.
export function parseOpenMeteo(json) {
  const d = json?.daily;
  if (!d?.time) throw new Error('Open-Meteo: no daily data');
  const out = {};
  d.time.forEach((date, i) => {
    const hi = d.temperature_2m_max?.[i], lo = d.temperature_2m_min?.[i];
    if (hi == null || lo == null) return;
    out[date] = {
      ...weatherInfo(d.weather_code?.[i]),
      hi: Math.round(hi), lo: Math.round(lo),
      rain: d.precipitation_probability_max?.[i] ?? null,
      source: 'open-meteo',
    };
  });
  return out;
}

// NWS /forecast periods (day and night halves) → the same shape.
export function parseNws(json) {
  const out = {};
  for (const p of json?.properties?.periods || []) {
    const date = p.startTime.slice(0, 10); // NWS times carry the local offset
    const o = out[date] || (out[date] = { hi: null, lo: null, rain: null, source: 'nws' });
    const pop = p.probabilityOfPrecipitation?.value;
    if (pop != null) o.rain = Math.max(o.rain ?? 0, pop);
    if (p.isDaytime) { o.hi = p.temperature; Object.assign(o, nwsInfo(p.shortForecast)); }
    else { o.lo = p.temperature; if (!o.icon) Object.assign(o, nwsInfo(p.shortForecast)); }
  }
  for (const [date, o] of Object.entries(out)) if (o.hi == null || o.lo == null) delete out[date];
  return out;
}

// ---------------------------------------------------------------------------
// The snapshot both outputs draw from
// ---------------------------------------------------------------------------

export function buildSnapshot({ asOf, builtAt, week, events, weather, air = {}, reminders = [], location = null, warnings = [] }) {
  const days = layoutWeek(events, week);
  return {
    week_id: week.id,
    title: weekTitle(week.sunday),
    as_of: asOf,                 // the Pacific date the snapshot is for ("today")
    built_at: builtAt,           // ms
    warnings,
    days: week.dates.map((date) => ({
      date,
      dow: dayShort(date),
      label: monthDay(date),
      weather: weather[date] || null,
      aqi: air[date] ?? null,
      sunset: location ? sunsetMs(date, location.lat, location.lon) : null,
      notices: noticesFor(reminders, date),
      events: days[date],
    })),
  };
}

// ---------------------------------------------------------------------------
// Air quality (requirements: Data sources > Air quality)
// ---------------------------------------------------------------------------

// US AQI bands. `short` fits an e-ink column; `label` is for the web.
const AQI_BANDS = [
  [50, 'good', 'Good', 'Good'],
  [100, 'moderate', 'Moderate', 'Moderate'],
  [150, 'sensitive', 'Unhealthy for sensitive groups', 'Sensitive'],
  [200, 'unhealthy', 'Unhealthy', 'Unhealthy'],
  [300, 'very', 'Very unhealthy', 'Very bad'],
  [Infinity, 'hazardous', 'Hazardous', 'Hazardous'],
];
export function aqiInfo(aqi) {
  if (aqi == null || !Number.isFinite(+aqi)) return null;
  const v = Math.round(+aqi);
  const [, level, label, short] = AQI_BANDS.find(([max]) => v <= max);
  return { aqi: v, level, label, short };
}

// Shown every day it's known (requirements: Data sources > Air quality).
export const showAqi = (aqi) => aqi != null && Number.isFinite(+aqi);
// From "Unhealthy for sensitive groups" up, it is drawn as a warning.
export const AQI_WARN = 101;

// Open-Meteo hourly us_aqi → each day's worst hour: { 'YYYY-MM-DD': 87 }.
export function parseAirQuality(json) {
  const h = json?.hourly;
  if (!h?.time || !h.us_aqi) throw new Error('Air quality: no hourly data');
  const out = {};
  h.time.forEach((t, i) => {
    const v = h.us_aqi[i];
    if (v == null) return;
    const date = t.slice(0, 10);
    out[date] = Math.max(out[date] ?? 0, Math.round(v));
  });
  return out;
}

// ---------------------------------------------------------------------------
// Household reminders (requirements: E-ink display > Reminders)
// ---------------------------------------------------------------------------
//
// Fixed routines shown as warnings instead of calendar events. Set in
// config/household.reminders, e.g. bins:
//   { weekday: 4, day_before: 'Bins out tonight', hide_events: ['put out trash'] }
// and street sweeping on the 2nd Wednesday of every month:
//   { weekday: 3, nth: 2, day_of: 'Street sweeping today', hide_events: ['parking enforcement'] }
// weekday: 0 = Sunday … 6 = Saturday. nth: 1–5 for "the nth of the month",
// -1 for "the last"; leave it out for every week.

function daysInMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function reminderOn(rule, iso) {
  if (weekday(iso) !== Number(rule.weekday)) return false;
  if (rule.nth == null) return true;
  const day = +iso.slice(8);
  if (Number(rule.nth) === -1) return day + 7 > daysInMonth(iso);
  return Math.ceil(day / 7) === Number(rule.nth);
}

// The warnings for one date: the reminder's own day, and the evening before.
export function noticesFor(rules, iso) {
  const out = [];
  for (const r of rules || []) {
    if (r.day_before && reminderOn(r, addDays(iso, 1))) out.push({ text: r.day_before, when: 'before' });
    if (r.day_of && reminderOn(r, iso)) out.push({ text: r.day_of, when: 'day' });
  }
  return out;
}

// Title matching for hiding events: a phrase matches as whole words, ignoring
// case and apostrophes ("farmer's market" matches "Temescal Farmers Market";
// "bin" would not hide "Cabin trip").
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const noApostrophes = (t) => String(t || '').replace(/['’‘`]/g, '');
export function titleMatches(title, phrases) {
  const t = noApostrophes(title);
  return (phrases || []).map((p) => noApostrophes(p).trim()).filter(Boolean).some((p) => {
    const words = escapeRe(p).replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${words}($|[^\\p{L}\\p{N}])`, 'iu').test(t);
  });
}

// Calendar events a reminder replaces.
export const hiddenByReminder = (title, rules) =>
  titleMatches(title, (rules || []).flatMap((r) => r.hide_events || []));
