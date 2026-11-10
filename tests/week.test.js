// Unit tests for the week rules (no emulator needed: `node --test tests/week.test.js`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isoDate, startOfDay, windowOf, rangeTitle, shortTime, secondsToMidnight, secondsToNextRefresh, lastRefreshAt, buildEvents,
  layoutWeek, eventDates, isBirthdayEvent, cleanLocation, shortLocation, placeName, titleWords, parseOpenMeteo,
  reminderOn, noticesFor, hiddenByReminder, titleMatches, aqiInfo, parseAirQuality, showAqi, sunsetMs, clockTime, parseNws, weatherInfo, showRain, buildSnapshot,
  parseEnphaseDaily, parseSoc, energySummary, parseOpenMeteoCurrent, parseAirCurrent, parseAirNow, REFRESH_HOURS, overnightBuild, buildDue,
} from '../public/lib/week.js';
import { weekHtml, einkDocument, esc, plainText, energyHtml, creditsHtml } from '../public/lib/view.js';
import { sampleEnergy, sampleSnapshot } from './fixtures.js';

const PETE = 'pete@example.com', DAVID = 'david@example.com';
const PEOPLE = [
  { key: 'pete', letter: 'P', email: PETE },
  { key: 'david', letter: 'D', email: DAVID },
];

// A timed Google Calendar event on 2026-11-10 (Tuesday) unless overridden.
let n = 0;
const ev = (o = {}) => ({
  id: `e${++n}`, iCalUID: `uid${n}@google.com`, status: 'confirmed', summary: 'Dentist',
  start: { dateTime: '2026-11-10T09:30:00-08:00' }, end: { dateTime: '2026-11-10T10:30:00-08:00' },
  ...o,
});
const att = (email, responseStatus, extra = {}) => ({ email, responseStatus, ...extra });
const titles = (events) => events.map((e) => e.title);

test('the window is yesterday, today and the next five days, in Pacific time', () => {
  const w = windowOf('2026-11-10'); // a Tuesday
  assert.equal(w.start, '2026-11-09');
  assert.equal(w.end, '2026-11-15');
  assert.equal(w.dates.length, 7);
  assert.equal(w.dates[1], '2026-11-10'); // today is always second
  assert.equal(windowOf('2026-11-14').start, '2026-11-13'); // Saturday: no longer mostly past
  assert.equal(windowOf('2026-11-30').end, '2026-12-05');   // across a month
  assert.equal(new Date(w.timeMin).toISOString(), '2026-11-09T08:00:00.000Z');
  assert.equal(new Date(w.timeMax).toISOString(), '2026-11-16T08:00:00.000Z');
  assert.equal(rangeTitle('2026-11-09', '2026-11-15'), 'Nov 9 – 15');
  assert.equal(rangeTitle('2026-11-29', '2026-12-05'), 'Nov 29 – Dec 5');
});

test('dates and midnights survive daylight saving changes', () => {
  // Nov 1 2026: clocks fall back. Mar 14 2027: they spring forward.
  assert.equal(new Date(startOfDay('2026-11-01')).toISOString(), '2026-11-01T07:00:00.000Z');
  assert.equal(new Date(startOfDay('2026-11-02')).toISOString(), '2026-11-02T08:00:00.000Z');
  assert.equal(new Date(startOfDay('2027-03-14')).toISOString(), '2027-03-14T08:00:00.000Z');
  assert.equal(new Date(startOfDay('2027-03-15')).toISOString(), '2027-03-15T07:00:00.000Z');
  assert.equal(isoDate(Date.parse('2026-11-10T07:59:00Z')), '2026-11-09'); // 11:59 PM Pacific
  assert.equal(shortTime(Date.parse('2026-11-10T09:30:00-08:00')), '9:30a');
  assert.equal(shortTime(Date.parse('2026-11-10T12:00:00-08:00')), '12p');
  assert.equal(shortTime(Date.parse('2026-11-10T00:00:00-08:00')), '12a');
});

test('the device sleeps until just after midnight', () => {
  const s = secondsToMidnight(Date.parse('2026-11-09T23:59:00-08:00'));
  assert.equal(s, 60 + 30);
  assert.equal(secondsToMidnight(Date.parse('2026-11-09T00:00:30-08:00')), 24 * 3600 - 30 + 30);
  assert.equal(secondsToMidnight(Date.parse('2026-11-09T23:59:59-08:00')), 60); // never below a minute
});

test('a shared invite shows once, with badges for everyone who is going', () => {
  const shared = ev({
    summary: 'Dinner with Sam',
    organizer: { email: PETE },
    attendees: [att(PETE, 'accepted', { organizer: true }), att(DAVID, 'accepted')],
  });
  const out = buildEvents([
    { person: 'pete', events: [shared] },
    { person: 'david', events: [{ ...shared, id: 'other-copy-id' }] },
  ], PEOPLE);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].badges, ['P', 'D']);
});

test('badges follow RSVPs, not whose calendar the event was found on', () => {
  const invite = (pete, david) => ev({
    summary: 'Party', organizer: { email: 'friend@example.com' },
    attendees: [att('friend@example.com', 'accepted', { organizer: true }), att(PETE, pete), att(DAVID, david)],
  });
  const one = (e) => buildEvents([{ person: 'pete', events: [e] }, { person: 'david', events: [e] }], PEOPLE);
  assert.deepEqual(one(invite('declined', 'accepted'))[0].badges, ['D']);
  assert.deepEqual(one(invite('tentative', 'needsAction'))[0].badges, ['P']);
  assert.deepEqual(one(invite('needsAction', 'needsAction'))[0].badges, []); // shown, no badge yet
});

test('an event is hidden only when both of you have declined', () => {
  const invite = (pete, david) => ev({
    summary: 'Gala', organizer: { email: 'host@example.com' },
    attendees: [att(PETE, pete), att(DAVID, david)],
  });
  const run = (e) => buildEvents([{ person: 'pete', events: [e] }, { person: 'david', events: [e] }], PEOPLE);
  assert.equal(run(invite('declined', 'declined')).length, 0);
  assert.equal(run(invite('declined', 'accepted')).length, 1);
  assert.equal(run(invite('declined', 'needsAction')).length, 1);
  // Only Pete was invited, and he declined: nobody is going, so it's hidden.
  const solo = ev({ summary: 'Webinar', organizer: { email: 'host@example.com' }, attendees: [att(PETE, 'declined')] });
  assert.equal(buildEvents([{ person: 'pete', events: [solo] }], PEOPLE).length, 0);
});

test("someone's own event with no invite list counts as going", () => {
  const out = buildEvents([{ person: 'david', events: [ev({ summary: 'Haircut' })] }], PEOPLE);
  assert.deepEqual(out[0].badges, ['D']);
});

test('private events are hidden for both of you, on any copy', () => {
  const shared = ev({ summary: 'Doctor', attendees: [att(PETE, 'accepted'), att(DAVID, 'accepted')] });
  const out = buildEvents([
    { person: 'pete', events: [ev({ summary: 'Therapy', visibility: 'private' }), shared] },
    { person: 'david', events: [{ ...shared, visibility: 'private' }, ev({ summary: 'Secret', visibility: 'confidential' })] },
  ], PEOPLE);
  assert.deepEqual(titles(out), []);
});

test('busy-only copies and cancelled instances are ignored', () => {
  const real = ev({ summary: 'Yoga' });
  const out = buildEvents([
    { person: 'pete', events: [real, ev({ summary: 'Gone', status: 'cancelled' })] },
    { person: 'david', events: [{ ...real, summary: undefined, id: 'busy' }, ev({ summary: undefined })] },
  ], PEOPLE);
  assert.deepEqual(titles(out), ['Yoga']);
});

test('copies made by hand merge on title and start; different instances do not', () => {
  const a = ev({ summary: 'Book club ' });
  const b = ev({ summary: 'book  club', iCalUID: 'different@icloud.com' });
  assert.equal(buildEvents([{ person: 'pete', events: [a] }, { person: 'david', events: [b] }], PEOPLE).length, 1);
  // Two instances of one recurring series keep the same iCalUID but differ by start.
  const mon = ev({ iCalUID: 'series@google.com', summary: 'Standup', originalStartTime: { dateTime: '2026-11-09T09:00:00-08:00' }, start: { dateTime: '2026-11-09T09:00:00-08:00' }, end: { dateTime: '2026-11-09T09:15:00-08:00' } });
  const tue = ev({ iCalUID: 'series@google.com', summary: 'Standup', originalStartTime: { dateTime: '2026-11-10T09:00:00-08:00' }, start: { dateTime: '2026-11-10T09:00:00-08:00' }, end: { dateTime: '2026-11-10T09:15:00-08:00' } });
  assert.equal(buildEvents([{ person: 'pete', events: [mon, tue] }], PEOPLE).length, 2);
});

test("the organizer's copy wins, and blanks are filled from the other", () => {
  const base = { iCalUID: 'same@google.com', summary: 'Lunch', attendees: [att(PETE, 'accepted'), att(DAVID, 'accepted')] };
  const davidCopy = ev({ ...base, organizer: { email: DAVID, self: true }, summary: 'Lunch at Nido' });
  const peteCopy = ev({ ...base, organizer: { email: DAVID }, location: 'Nido, Oakland' });
  const [out] = buildEvents([{ person: 'pete', events: [peteCopy] }, { person: 'david', events: [davidCopy] }], PEOPLE);
  assert.equal(out.title, 'Lunch at Nido');
  assert.equal(out.location, 'Nido');
});

test('days list all-day events first, then by start time', () => {
  const week = windowOf('2026-11-09');
  const events = buildEvents([{ person: 'pete', events: [
    ev({ summary: 'Late', start: { dateTime: '2026-11-10T18:00:00-08:00' }, end: { dateTime: '2026-11-10T19:00:00-08:00' } }),
    ev({ summary: 'Early', start: { dateTime: '2026-11-10T07:00:00-08:00' }, end: { dateTime: '2026-11-10T08:00:00-08:00' } }),
    ev({ summary: 'Holiday', start: { date: '2026-11-10' }, end: { date: '2026-11-11' } }),
  ] }], PEOPLE);
  const tue = layoutWeek(events, week)['2026-11-10'];
  assert.deepEqual(tue.map((r) => [r.title, r.time]), [['Holiday', null], ['Early', '7a'], ['Late', '6p']]);
});

test('multi-day events repeat on each day; late nights do not spill over', () => {
  const trip = { allDay: true, start: '2026-11-12', end: '2026-11-15' };
  assert.deepEqual(eventDates(trip), ['2026-11-12', '2026-11-13', '2026-11-14']);
  const party = { allDay: false, start: Date.parse('2026-11-13T22:00:00-08:00'), end: Date.parse('2026-11-14T01:00:00-08:00') };
  assert.deepEqual(eventDates(party), ['2026-11-13']);
  const conf = { allDay: false, start: Date.parse('2026-11-12T09:00:00-08:00'), end: Date.parse('2026-11-13T17:00:00-08:00') };
  assert.deepEqual(eventDates(conf), ['2026-11-12', '2026-11-13']);
  // A trip that runs into next week shows only its in-week days, still numbered.
  const week = windowOf('2026-11-09');
  const days = layoutWeek([{ title: 'Tahoe', location: null, badges: ['P'], allDay: true, start: '2026-11-14', end: '2026-11-17' }], week);
  assert.deepEqual(days['2026-11-14'][0].span, { n: 1, of: 3 });
  const confDays = layoutWeek([{ title: 'Summit', location: null, badges: [], ...conf }], week);
  assert.equal(confDays['2026-11-12'][0].time, '9a');
  assert.equal(confDays['2026-11-13'][0].time, null);
  assert.deepEqual(confDays['2026-11-13'][0].span, { n: 2, of: 2 });
});

test('weather: Open-Meteo and NWS parse to the same shape', () => {
  const om = parseOpenMeteo({ daily: {
    time: ['2026-11-08', '2026-11-09'], weather_code: [2, 63],
    temperature_2m_max: [64.4, 58.6], temperature_2m_min: [49.2, 51], precipitation_probability_max: [5, 80],
  } });
  assert.deepEqual(om['2026-11-09'], { icon: 'rain', label: 'Rain', hi: 59, lo: 51, rain: 80, source: 'open-meteo' });
  const nws = parseNws({ properties: { periods: [
    { startTime: '2026-11-10T06:00:00-08:00', isDaytime: true, temperature: 61, shortForecast: 'Chance Rain Showers', probabilityOfPrecipitation: { value: 40 } },
    { startTime: '2026-11-10T18:00:00-08:00', isDaytime: false, temperature: 48, shortForecast: 'Mostly Cloudy', probabilityOfPrecipitation: { value: 20 } },
    { startTime: '2026-11-11T06:00:00-08:00', isDaytime: true, temperature: 63, shortForecast: 'Sunny', probabilityOfPrecipitation: { value: null } },
  ] } });
  assert.deepEqual(nws['2026-11-10'], { hi: 61, lo: 48, rain: 40, source: 'nws', icon: 'rain', label: 'Showers' });
  assert.equal(nws['2026-11-11'], undefined); // no night half yet → no low → skipped
  assert.equal(weatherInfo(0).icon, 'sun');
  assert.equal(weatherInfo(95).icon, 'storm');
  assert.equal(showRain({ rain: 19 }), false);
  assert.equal(showRain({ rain: 20 }), true);
});

test('the markup escapes calendar text and marks today and past days', () => {
  const week = windowOf('2026-11-10');
  const snap = buildSnapshot({
    asOf: '2026-11-10', builtAt: Date.parse('2026-11-09T23:55:00-08:00'), week,
    events: [{ title: '<img src=x onerror=alert(1)>', location: '"Home"', badges: ['P', 'D'], allDay: false,
      start: Date.parse('2026-11-11T09:00:00-08:00'), end: Date.parse('2026-11-11T10:00:00-08:00') }],
    weather: { '2026-11-11': { icon: 'rain', label: 'Rain', hi: 60, lo: 50, rain: 70 } },
  });
  const html = weekHtml(snap, { mode: 'web' });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(html.includes('class="day today" data-date="2026-11-10"'));
  assert.ok(html.includes('class="day past" data-date="2026-11-09"'));
  assert.equal((html.match(/class="day past"/g) || []).length, 1, 'only yesterday is past');
  assert.ok(html.includes('Updated Mon 11:55 PM'));
  assert.ok(html.includes('70%'));
  assert.ok(html.includes('&quot;Home&quot;'), 'locations show, escaped');
  assert.ok(einkDocument(snap).includes('<span class="wk-of">Mon – Sun</span><span class="wk-range">Nov 9 – 15</span>'));
  // Without the subtitle field, the weekday line comes from the days.
  assert.ok(weekHtml({ ...snap, subtitle: undefined }).includes('<span class="wk-of">Mon – Sun</span>'));
  // A snapshot built before the change still shows its old title, split.
  assert.ok(weekHtml({ ...snap, title: 'Week of Nov 8 – 14', subtitle: undefined }).includes('<span class="wk-of">Week of</span><span class="wk-range">Nov 8 – 14</span>'));
  assert.equal(esc(`a&'`), 'a&amp;&#39;');
});

test('locations: meeting links and the home address are dropped; e-ink shows the first part', () => {
  assert.equal(cleanLocation('  Nido,  444 Embarcadero W, Oakland '), 'Nido, 444 Embarcadero W, Oakland');
  assert.equal(cleanLocation('https://us02web.zoom.us/j/123'), null);
  assert.equal(cleanLocation('Google Meet: meet.google.com/abc'), null);
  assert.equal(cleanLocation('123 Example St, Oakland, CA', ['123 example st']), null);
  assert.equal(cleanLocation(''), null);
  assert.equal(shortLocation('444 Embarcadero W, Oakland, CA 94607, USA'), '444 Embarcadero W');
  assert.equal(shortLocation('Dimond Dental'), 'Dimond Dental');
  const out = buildEvents([{ person: null, events: [ev({ summary: 'Recycling', location: '123 Example St' })] }], PEOPLE, { hideLocations: ['123 Example St'] });
  assert.equal(out[0].location, null);
  assert.deepEqual(out[0].badges, []); // a shared calendar's own event: nobody's badge
});

test('reminders: weekly bins and street sweeping on the 2nd Wednesday', () => {
  const bins = { weekday: 4, day_before: 'Bins out tonight', day_of: 'Bin pickup this morning', hide_events: ['put out trash'] };
  const sweep = { weekday: 3, nth: 2, day_before: 'Move car tonight', day_of: 'Street sweeping today', hide_events: ['street sweeping'] };
  assert.equal(reminderOn(sweep, '2026-11-11'), true);   // 2nd Wednesday of November
  assert.equal(reminderOn(sweep, '2026-11-04'), false);  // 1st
  assert.equal(reminderOn(sweep, '2026-12-09'), true);   // 2nd Wednesday of December
  assert.equal(reminderOn({ weekday: 3, nth: -1 }, '2026-11-25'), true); // last Wednesday
  assert.deepEqual(noticesFor([bins, sweep], '2026-11-10').map((n) => n.text), ['Move car tonight']);
  assert.deepEqual(noticesFor([bins, sweep], '2026-11-11').map((n) => n.text), ['Bins out tonight', 'Street sweeping today']);
  assert.deepEqual(noticesFor([bins, sweep], '2026-11-12').map((n) => n.text), ['Bin pickup this morning']);
  assert.deepEqual(noticesFor([bins], '2026-11-14'), []);
  // The calendar copies are hidden; similar words are not.
  assert.equal(hiddenByReminder('Put out trash for pickup', [bins]), true);
  assert.equal(hiddenByReminder('STREET SWEEPING - move car', [sweep]), true);
  assert.equal(hiddenByReminder('Street sweepings', [sweep]), false);
  const out = buildEvents([{ person: 'pete', events: [ev({ summary: 'Put out trash for pickup' }), ev({ summary: 'Dentist' })] }], PEOPLE, { reminders: [bins] });
  assert.deepEqual(titles(out), ['Dentist']);
});

test('air quality: daily worst hour, shown every day it is known', () => {
  const air = parseAirQuality({ hourly: {
    time: ['2026-11-10T00:00', '2026-11-10T15:00', '2026-11-11T09:00'], us_aqi: [22, 64.4, null],
  } });
  assert.deepEqual(air, { '2026-11-10': 64 });
  assert.deepEqual(aqiInfo(118), { aqi: 118, level: 'sensitive', label: 'Unhealthy for sensitive groups', short: 'Sensitive' });
  assert.equal(aqiInfo(50).level, 'good');
  assert.equal(aqiInfo(null), null);
  assert.equal(showAqi(12), true);
  assert.equal(showAqi(null), false);
});

test('holidays come first in their day, without badges', () => {
  const week = windowOf('2026-11-09');
  const events = buildEvents([
    { person: 'pete', events: [
      ev({ summary: 'Early run', start: { dateTime: '2026-11-11T06:00:00-08:00' }, end: { dateTime: '2026-11-11T07:00:00-08:00' } }),
      ev({ summary: 'All-day thing', start: { date: '2026-11-11' }, end: { date: '2026-11-12' } }),
    ] },
    { person: null, holiday: true, events: [ev({ summary: 'Veterans Day', start: { date: '2026-11-11' }, end: { date: '2026-11-12' } })] },
  ], PEOPLE);
  const wed = layoutWeek(events, week)['2026-11-11'];
  assert.deepEqual(wed.map((r) => r.title), ['Veterans Day', 'All-day thing', 'Early run']);
  assert.equal(wed[0].holiday, true);
  assert.deepEqual(wed[0].badges, []);
  const snap = buildSnapshot({ asOf: '2026-11-09', builtAt: 0, week, events, weather: {},
    reminders: [{ weekday: 3, day_of: 'Street sweeping today' }] });
  const html = weekHtml(snap, { mode: 'eink' });
  const wedHtml = html.slice(html.indexOf('data-date="2026-11-11"'));
  assert.ok(wedHtml.indexOf('class="holiday"') < wedHtml.indexOf('class="notice'), 'holiday above reminders');
  assert.ok(wedHtml.indexOf('class="notice') < wedHtml.indexOf('All-day thing'), 'reminders above events');
});

test('sunset in Oakland, computed locally, across the clock changes', () => {
  const at = (iso) => clockTime(sunsetMs(iso, 37.8044, -122.2712));
  // Published Oakland sunsets: Nov 10 4:59 PM, Jun 21 8:35 PM, Dec 21 4:54 PM, Mar 8 7:08 PM (PDT).
  const mins = (t) => { const [h, m] = t.split(/[: ]/); return (+h % 12 + 12) * 60 + +m; };
  for (const [iso, published] of [['2026-11-10', '4:59 PM'], ['2026-06-21', '8:35 PM'], ['2026-12-21', '4:54 PM'], ['2026-03-08', '7:08 PM']]) {
    assert.ok(Math.abs(mins(at(iso)) - mins(published)) <= 2, `${iso}: ${at(iso)} vs ${published}`);
  }
});

test("the header shows today's weather, air quality and sunset", () => {
  const week = windowOf('2026-11-10');
  const snap = buildSnapshot({ asOf: '2026-11-10', builtAt: 0, week, events: [],
    weather: { '2026-11-10': { icon: 'rain', label: 'Rain', hi: 58, lo: 50, rain: 70 } },
    air: { '2026-11-10': 42 }, location: { lat: 37.8044, lon: -122.2712 } });
  const head = weekHtml(snap, { mode: 'eink' }).split('<div class="week">')[0];
  assert.match(head, /class="today-wx"/);
  assert.match(head, /58°/);
  assert.match(head, /70%/);
  assert.match(head, /AQI 42/);
  assert.match(head, /Sunset<\/span> <b>5:01 PM<\/b>/);
  // Three rows in order: temperature, conditions, air quality; sunset after them.
  const order = ['tw-temps', 'tw-label', 'AQI 42', 'tw-sunset'].map((k) => head.indexOf(k));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), `order: ${order}`);
  const columns = weekHtml(snap, { mode: 'eink' }).split('<div class="week">')[1];
  assert.doesNotMatch(columns, /AQI/, 'AQI is only in the header');
});

test('hide_events: whole words, any case, apostrophes ignored', () => {
  const hide = ["Temescal farmer's market", "South Berkeley farmer's market"];
  assert.equal(titleMatches('Temescal farmers market', hide), true);
  assert.equal(titleMatches('South Berkeley Farmers Market', hide), true);
  assert.equal(titleMatches("Temescal Farmer’s Market", hide), true);
  assert.equal(titleMatches('Oakland Vintage Market', hide), false);
  assert.equal(titleMatches('Temescal farmers market run', hide), true); // the phrase appears in it
  const out = buildEvents([{ person: 'pete', events: [ev({ summary: 'Temescal farmers market' }), ev({ summary: 'Dentist' })] }], PEOPLE, { hideEvents: hide });
  assert.deepEqual(titles(out), ['Dentist']);
});

test('a reminder calendar (Home Tasks) shows as reminder bars, after holidays', () => {
  const week = windowOf('2026-11-09');
  const events = buildEvents([
    { person: 'pete', events: [ev({ summary: 'Haircut', start: { dateTime: '2026-11-11T10:00:00-08:00' }, end: { dateTime: '2026-11-11T11:00:00-08:00' } })] },
    { person: null, reminder: true, events: [
      ev({ summary: 'Citrus fertilizer (1/3)', start: { date: '2026-11-11' }, end: { date: '2026-11-12' }, location: '123 Example St' }),
      ev({ summary: 'Compost out', start: { dateTime: '2026-11-11T20:00:00-08:00' }, end: { dateTime: '2026-11-11T20:15:00-08:00' } }),
    ] },
    { person: null, holiday: true, events: [ev({ summary: 'Veterans Day', start: { date: '2026-11-11' }, end: { date: '2026-11-12' } })] },
  ], PEOPLE);
  const wed = layoutWeek(events, week)['2026-11-11'];
  assert.deepEqual(wed.map((r) => r.title), ['Veterans Day', 'Citrus fertilizer (1/3)', 'Compost out', 'Haircut']);
  assert.deepEqual(wed[1].badges, []);
  const snap = buildSnapshot({ asOf: '2026-11-09', builtAt: 0, week, events, weather: {},
    reminders: [{ weekday: 3, day_before: 'Bins out tonight' }] });
  const html = weekHtml(snap, { mode: 'eink' });
  const wedHtml = html.slice(html.indexOf('data-date="2026-11-11"'), html.indexOf('data-date="2026-11-12"'));
  assert.match(wedHtml, /class="notice notice-calendar"><svg[^]*?<span>Citrus fertilizer \(1\/3\)<\/span>/);
  assert.match(wedHtml, /<span>8p · Compost out<\/span>/);
  assert.ok(wedHtml.indexOf('Veterans Day') < wedHtml.indexOf('Citrus'));
  assert.ok(wedHtml.indexOf('Compost out') < wedHtml.indexOf('Haircut'));
  assert.doesNotMatch(wedHtml, /class="ev[^"]*">[^]*Citrus/, 'not drawn as an event row');
});

test('the AQI carries a face for its band', () => {
  const week = windowOf('2026-11-10');
  const head = (aqi) => weekHtml(buildSnapshot({ asOf: '2026-11-10', builtAt: 0, week, events: [], weather: {},
    air: { '2026-11-10': aqi } }), { mode: 'eink' }).split('<div class="week">')[0];
  const faceOf = (html) => (html.match(/<span class="aqi aqi-(\w+)/) || [])[1];
  assert.equal(faceOf(head(30)), 'good');
  assert.equal(faceOf(head(75)), 'moderate');
  assert.equal(faceOf(head(130)), 'sensitive');
  assert.match(head(130), /aqi-warn[^>]*><svg class="aqi-face"/);
  assert.equal(faceOf(head(350)), 'hazardous');
});

test("the same occasion entered by each of you merges, even worded differently", () => {
  const day = { start: { date: '2026-11-08' }, end: { date: '2026-11-09' } };
  const out = buildEvents([
    { person: 'pete', events: [ev({ summary: 'My Anniversary!!', ...day })] },
    { person: 'david', events: [ev({ summary: '💍Anniversary', ...day })] },
  ], PEOPLE);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, '💍Anniversary');           // not one person's "My …"
  assert.deepEqual(out[0].badges, ['P', 'D']);
  // Not merged: same person, different days, timed vs all-day, unrelated titles, shared calendars.
  const two = (a, b) => buildEvents([a, b], PEOPLE).length;
  assert.equal(two({ person: 'pete', events: [ev({ summary: 'Anniversary', ...day })] },
    { person: 'pete', events: [ev({ summary: 'My anniversary', ...day })] }), 2);
  assert.equal(two({ person: 'pete', events: [ev({ summary: 'Anniversary', ...day })] },
    { person: 'david', events: [ev({ summary: 'Anniversary dinner', start: { date: '2026-11-09' }, end: { date: '2026-11-10' } })] }), 2);
  assert.equal(two({ person: 'pete', events: [ev({ summary: 'Anniversary', ...day })] },
    { person: 'david', events: [ev({ summary: 'Anniversary', start: { dateTime: '2026-11-08T00:00:00-08:00' }, end: { dateTime: '2026-11-08T01:00:00-08:00' } })] }), 2);
  assert.equal(two({ person: 'pete', events: [ev({ summary: 'Dentist' })] },
    { person: 'david', events: [ev({ summary: 'Haircut' })] }), 2);
  assert.equal(two({ person: 'pete', events: [ev({ summary: 'Anniversary', ...day })] },
    { person: null, events: [ev({ summary: 'Anniversary', iCalUID: 'other', ...day })] }), 1); // exact title still merges
  assert.deepEqual([...titleWords("Pete's Birthday 🎂")], ['pete', 'birthday']);
});

test('locations show the place name only, never the address', () => {
  assert.equal(placeName('Nido, 444 Embarcadero W, Oakland, CA 94607'), 'Nido');
  assert.equal(placeName('5614 Bay Street, 5614 Bay Street Emeryville CA94608'), null);
  assert.equal(placeName('AMC Bay Street 16'), 'AMC Bay Street 16');
  assert.equal(placeName('Dimond Dental'), 'Dimond Dental');
  assert.equal(placeName('12B Main St'), null);
  assert.equal(placeName(''), null);
  const [e] = buildEvents([{ person: 'pete', events: [ev({ summary: 'Movie', location: '5614 Bay Street, Emeryville CA' })] }], PEOPLE);
  assert.equal(e.location, null);
});

test('emoji are dropped from titles on the e-ink only', () => {
  assert.equal(plainText('💍Anniversary'), 'Anniversary');
  assert.equal(plainText('Party 🎉 time'), 'Party time');
  const week = windowOf('2026-11-08');
  const snap = buildSnapshot({ asOf: '2026-11-08', builtAt: 0, week, weather: {},
    events: [{ title: '💍Anniversary', location: null, badges: [], allDay: true, start: '2026-11-08', end: '2026-11-09' }] });
  assert.match(weekHtml(snap, { mode: 'eink' }), /<span class="title">Anniversary<\/span>/);
  assert.match(weekHtml(snap, { mode: 'web' }), /💍Anniversary/);
});

test("a Gmail-created copy's automatic privacy doesn't hide the real event", () => {
  // As on the calendar: your invite plus Gmail's copy of the confirmation email.
  const when = { start: { dateTime: '2026-11-13T16:30:00-08:00' }, end: { dateTime: '2026-11-13T17:30:00-08:00' } };
  const gmail = ev({ summary: 'Reservation at Ashes & Diamonds Winery', eventType: 'fromGmail', visibility: 'private',
    location: 'Ashes & Diamonds Winery', organizer: { email: PETE }, attendees: [att(PETE, 'accepted', { organizer: true })], ...when });
  const invite = ev({ summary: 'Reservation at Ashes & Diamonds Winery', location: '4130 Howard Ln, Napa, CA, US 94558',
    organizer: { email: PETE }, attendees: [att(DAVID, 'accepted'), att('friend@example.com', 'accepted'), att(PETE, 'accepted', { organizer: true })],
    end: { dateTime: '2026-11-13T18:15:00-08:00' }, start: when.start });
  const out = buildEvents([
    { person: 'pete', events: [gmail, invite] },
    { person: 'david', events: [{ ...invite, id: 'david-copy' }] },
  ], PEOPLE);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].badges, ['P', 'D']);
  assert.equal(out[0].location, 'Ashes & Diamonds Winery'); // the copy that names the place
  // Privacy you set yourself still hides an event.
  assert.equal(buildEvents([{ person: 'pete', events: [ev({ summary: 'Apply to Jobs', visibility: 'private' })] }], PEOPLE).length, 0);
  // A Gmail-created event on its own shows.
  assert.equal(buildEvents([{ person: 'pete', events: [ev({ summary: 'Flight to NYC', eventType: 'fromGmail', visibility: 'private' })] }], PEOPLE).length, 1);
});

test('refreshes come every 30 minutes from 7am to 11:30pm, then 12:10am, across the clock changes', () => {
  const t = (s) => Date.parse(s);
  assert.equal(REFRESH_HOURS.length, 35);
  assert.equal(secondsToNextRefresh(t('2026-11-10T00:10:30-08:00')), 7 * 3600 - 630 + 30); // asleep until 7am
  assert.equal(secondsToNextRefresh(t('2026-11-10T11:59:00-08:00')), 60 + 30);
  assert.equal(secondsToNextRefresh(t('2026-11-10T18:00:00-08:00')), 1800 + 30);
  assert.equal(secondsToNextRefresh(t('2026-11-10T23:30:00-08:00')), 40 * 60 + 30); // 12:10am
  assert.equal(secondsToNextRefresh(t('2026-11-10T23:29:00-08:00')), 60 + 30);      // 11:30pm
  // The schedule fires at :05, :25 and :55; only runs just ahead of a refresh build.
  for (const hm of ['00:05', '06:55', '07:25', '12:25', '23:25']) assert.equal(buildDue(t(`2026-11-10T${hm}:00-08:00`)), true, hm);
  for (const hm of ['23:55', '06:25', '06:05', '07:05', '00:25', '00:55']) assert.equal(buildDue(t(`2026-11-10T${hm}:00-08:00`)), false, hm);
  // The overnight picture's weather says when it was read.
  assert.equal(overnightBuild(t('2026-11-10T00:05:00-08:00'), '2026-11-10'), true);
  assert.equal(overnightBuild(t('2026-11-10T06:55:00-08:00'), '2026-11-10'), false);
  assert.equal(overnightBuild(t('2026-11-09T23:55:00-08:00'), '2026-11-10'), true);
  // The night the clocks go back (Nov 1, 2026), 12:10am to 7am is 7h50m.
  assert.equal(secondsToNextRefresh(t('2026-11-01T00:10:00-07:00')), 7 * 3600 + 50 * 60 + 30);
  assert.equal(new Date(lastRefreshAt(t('2026-11-10T09:20:00-08:00'))).toISOString(), '2026-11-10T17:00:00.000Z');
  assert.equal(new Date(lastRefreshAt(t('2026-11-10T09:40:00-08:00'))).toISOString(), '2026-11-10T17:30:00.000Z');
  assert.equal(new Date(lastRefreshAt(t('2026-11-10T03:00:00-08:00'))).toISOString(), '2026-11-10T08:10:00.000Z');
});

test('birthdays get their own look; plans around birthdays stay events', () => {
  const day = (d = '2026-11-12') => ({ start: { date: d }, end: { date: addDaysFix(d, 1) } });
  function addDaysFix(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  // As on your calendar.
  for (const t of ['Lisa’s Birthday', 'Stevens birthday', "Jameson's Birthday!!", 'Spencer’s birthday', 'Mo bday 🎂']) {
    assert.equal(isBirthdayEvent({ summary: t, ...day() }), true, t);
  }
  assert.equal(isBirthdayEvent({ summary: 'Paul Davis birthday party', start: { dateTime: '2026-02-22T17:00:00-08:00' } }), false);
  assert.equal(isBirthdayEvent({ summary: "Tahoe Weekend for Jake's Birthday", start: { date: '2026-02-19' }, end: { date: '2026-02-23' } }), false);
  assert.equal(isBirthdayEvent({ summary: "Supper Club (Pete's Birthday Edition)", ...day() }), false);
  assert.equal(isBirthdayEvent({ summary: "Mom's birthday call", start: { dateTime: '2026-11-08T16:00:00-08:00' } }), false);
  assert.equal(isBirthdayEvent({ summary: 'Sam', eventType: 'birthday', ...day() }), true);

  const week = windowOf('2026-11-09');
  const events = buildEvents([
    { person: 'pete', events: [ev({ summary: 'Lisa’s Birthday', ...day() }), ev({ summary: 'Dentist', start: { dateTime: '2026-11-12T09:00:00-08:00' }, end: { dateTime: '2026-11-12T10:00:00-08:00' } })] },
    { person: null, holiday: true, events: [ev({ summary: 'Some Holiday', ...day() })] },
    { person: null, reminder: true, events: [ev({ summary: 'Fertilize citrus', ...day() })] },
  ], PEOPLE);
  const thu = layoutWeek(events, week)['2026-11-12'];
  assert.deepEqual(thu.map((r) => r.title), ['Some Holiday', 'Lisa’s Birthday', 'Fertilize citrus', 'Dentist']);
  assert.equal(thu[1].birthday, true);
  assert.deepEqual(thu[1].badges, []);
  const html = weekHtml(buildSnapshot({ asOf: '2026-11-09', builtAt: 0, week, events, weather: {} }), { mode: 'eink' });
  const thuHtml = html.slice(html.indexOf('data-date="2026-11-12"'), html.indexOf('data-date="2026-11-13"'));
  assert.match(thuHtml, /<li class="birthday"><svg class="cake"[^]*?<span>Lisa’s Birthday<\/span>/);
  assert.ok(thuHtml.indexOf('Some Holiday') < thuHtml.indexOf('Lisa’s Birthday') && thuHtml.indexOf('Lisa’s Birthday') < thuHtml.indexOf('Fertilize'));
});

test('home energy: Enphase daily totals become yesterday\'s strip', () => {
  const body = { start_date: '2026-11-08', production: [17600, 18420], consumption: [20100, 21730] };
  assert.deepEqual(parseEnphaseDaily(body, 'production'), { '2026-11-08': 17600, '2026-11-09': 18420 });
  assert.deepEqual(parseEnphaseDaily({ start_date: 'bad', production: [1] }, 'production'), {});
  assert.deepEqual(parseEnphaseDaily(body, 'import'), {});
  assert.equal(parseSoc('64%'), 64);
  assert.equal(parseSoc(80.6), 81);
  assert.equal(parseSoc('n/a'), null);
  assert.equal(parseSoc(140), null);

  const e = sampleEnergy('2026-11-10');
  assert.equal(e.date, '2026-11-09');
  assert.equal(e.label, 'Yesterday');
  assert.equal(e.solar_kwh, 18.4);
  assert.equal(e.used_kwh, 21.7); // Enphase's consumption figure, as sent
  assert.equal(e.self_powered, 86); // 1 - 3.11 / 21.73
  // Home use is Enphase's figure even when the flows would add up differently.
  const d = (wh) => ({ '2026-11-09': wh });
  assert.equal(energySummary({ produced: d(13600), imported: d(900), exported: d(140), charged: d(9000),
    discharged: d(7300), consumed: d(13400) }, '2026-11-09').used_kwh, 13.4);
  assert.equal(e.battery_pct, 64);

  // Yesterday not reported yet: the day before, named.
  const late = energySummary({ produced: { '2026-11-08': 17600 } }, '2026-11-09', { asOf: '2026-11-10' });
  assert.equal(late.label, 'Sun Nov 8');
  assert.equal(late.self_powered, null);
  // Only a battery reading.
  assert.deepEqual(energySummary({}, '2026-11-09', { soc: 50 }), { date: null, battery_pct: 50 });
  assert.equal(energySummary({}, '2026-11-09'), null);

  const html = energyHtml(e);
  assert.match(html, /Yesterday’s energy/);
  assert.match(html, /Solar<\/span> <b>18\.4 kWh/);
  assert.match(html, /Grid<\/span> <b>3\.1 in/);
  assert.match(html, /Self-powered<\/span> <b>86%/);
  assert.match(html, /Current Battery<\/span> <b>64%/);
  assert.match(energyHtml({ ...e, stale: true }), /class="energy stale"/);
  assert.equal(energyHtml(null), '');
  // Where it goes: under the header on the web, along the bottom on the door.
  const snap = sampleSnapshot();
  const web = weekHtml(snap, { mode: 'web' }), eink = weekHtml(snap, { mode: 'eink' });
  assert.ok(web.indexOf('class="energy') < web.indexOf('class="week"'));
  assert.ok(eink.indexOf('class="energy') > eink.indexOf('class="week"'));
  assert.ok(!weekHtml(sampleSnapshot({ energy: null }), { mode: 'eink' }).includes('class="energy'));
});

test('the header shows conditions now, else today\'s forecast', () => {
  assert.deepEqual(parseOpenMeteoCurrent({ current: { time: '2026-11-10T21:00', temperature_2m: 51.6, weather_code: 2, is_day: 0 } }),
    { temp: 52, icon: 'partly-night', label: 'Partly cloudy', at: '2026-11-10T21:00' });
  assert.equal(weatherInfo(0, 1).icon, 'sun');
  assert.equal(weatherInfo(0, 0).icon, 'moon');
  assert.equal(parseOpenMeteoCurrent({}), null);
  assert.equal(parseAirCurrent({ current: { us_aqi: 71.4 } }), 71);
  assert.equal(parseAirCurrent({ current: {} }), null);

  const head = (snap) => weekHtml(snap, { mode: 'web' }).split('class="week"')[0];
  // Built during the day: "58° now", the sky now, the AQI now.
  const day = head(sampleSnapshot({ builtAt: Date.parse('2026-11-10T07:55:00-08:00') }));
  assert.match(day, /<b>58°<\/b><span class="lo tw-now"> now<\/span>/);
  assert.match(day, /tw-label">Cloudy</);
  assert.match(day, /AQI 52/);
  assert.ok(!/\/ 52°/.test(day), 'no forecast high/low in the header');
  // The overnight build, shown until morning, says when.
  assert.match(head(sampleSnapshot({ builtAt: Date.parse('2026-11-10T00:05:00-08:00') })), /58°<\/b><span class="lo tw-now"> at 12:05 AM/);
  // Without current conditions: today's forecast, as before.
  const fallback = head(sampleSnapshot({ current: null }));
  assert.match(fallback, /<b>60°<\/b><span class="lo"> \/ 52°/);
  assert.match(fallback, /AQI 64/);
});

test('AirNow: the highest pollutant AQI, recent readings only', () => {
  const now = Date.parse('2026-11-10T08:10:00-08:00');
  const seven = Date.parse('2026-11-10T07:00:00-08:00');
  // The current service: one row per site and pollutant.
  const row = (siteName, parameterName, nowcastAQI, hourObserved = '07:00', dateObserved = '2026-11-10', reportingAreaName = 'Oakland') =>
    ({ dateObserved, hourObserved, localTimeZone: 'PST', reportingAreaName, siteName, parameterName, nowcastAQI, aqiCategoryName: 'x' });
  assert.deepEqual(parseAirNow([row('A', 'OZONE', 30), row('A', 'PM2.5', 71), row('B', 'PM2.5', 65), row('C', 'PM2.5', 140, '07:00', '2026-11-10', null)], now),
    { aqi: 71, area: 'Oakland', at: seven }); // PM2.5: median of 65, 71, 140; a missing area name is fine
  assert.equal(parseAirNow([row('A', 'PM2.5', 71, '04:00')], now), null);   // over 3 hours old
  assert.equal(parseAirNow([row('A', 'PM2.5', -999)], now), null);           // unavailable
  assert.equal(parseAirNow([row('A', 'OZONE', 40, '23:00', '11/09/2026')], now), null);
  assert.equal(parseAirNow([row('A', 'OZONE', 40, '07:00', '11/10/2026')], now).aqi, 40);
  assert.equal(parseAirNow({ WebServiceError: [{ Message: 'nothing in range' }] }, now), null);
  assert.equal(parseAirNow([], now), null);
  // The retired service's field names still read.
  assert.deepEqual(parseAirNow([{ DateObserved: '2026-11-10 ', HourObserved: 7, ReportingArea: 'Oakland', ParameterName: 'O3', AQI: 30 }], now),
    { aqi: 30, area: 'Oakland', at: seven });
});

test('the credit line names where the AQI came from', () => {
  const at = Date.parse('2026-11-10T08:00:00-08:00');
  assert.match(creditsHtml({ current: { aqi: 28, aqi_source: 'airnow', aqi_area: 'Oakland', aqi_at: at } }),
    /Air quality now: <a [^>]+>AirNow<\/a> \(EPA\), Oakland, 8:00 AM reading\./);
  assert.match(creditsHtml({ current: { aqi: 20, aqi_source: 'open-meteo' } }), /CAMS forecast; AirNow had no recent reading/);
  assert.match(creditsHtml({}), /AirNow<\/a> \(EPA\), or/);
  assert.match(creditsHtml({ current: { aqi_source: 'airnow', aqi_area: '<b>' } }), /&lt;b&gt;/);
});
