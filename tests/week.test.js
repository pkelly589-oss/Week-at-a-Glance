// Unit tests for the week rules (no emulator needed: `node --test tests/week.test.js`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isoDate, startOfDay, weekOf, weekTitle, shortTime, secondsToMidnight, secondsToNextRefresh, lastRefreshAt, buildEvents,
  layoutWeek, eventDates, cleanLocation, shortLocation, placeName, titleWords, parseOpenMeteo,
  reminderOn, noticesFor, hiddenByReminder, titleMatches, aqiInfo, parseAirQuality, showAqi, sunsetMs, clockTime, parseNws, weatherInfo, showRain, buildSnapshot,
} from '../public/lib/week.js';
import { weekHtml, einkDocument, esc, plainText } from '../public/lib/view.js';

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

test('the week runs Sunday to Saturday in Pacific time', () => {
  const w = weekOf('2026-11-09'); // a Monday
  assert.equal(w.sunday, '2026-11-08');
  assert.equal(w.saturday, '2026-11-14');
  assert.equal(weekOf('2026-11-14').sunday, '2026-11-08'); // Saturday stays in its own week
  assert.equal(weekOf('2026-11-15').sunday, '2026-11-15'); // Sunday starts the next
  assert.equal(new Date(w.timeMin).toISOString(), '2026-11-08T08:00:00.000Z');
  assert.equal(weekTitle('2026-11-08'), 'Week of Nov 8 – 14');
  assert.equal(weekTitle('2026-11-29'), 'Week of Nov 29 – Dec 5');
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
  const week = weekOf('2026-11-09');
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
  const week = weekOf('2026-11-09');
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
  const week = weekOf('2026-11-10');
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
  assert.ok(html.includes('class="day past" data-date="2026-11-08"'));
  assert.ok(html.includes('Updated Mon 11:55 PM'));
  assert.ok(html.includes('70%'));
  assert.ok(html.includes('&quot;Home&quot;'), 'locations show, escaped');
  assert.ok(einkDocument(snap).includes('Week of Nov 8 – 14'));
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
  const week = weekOf('2026-11-09');
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
  const at = (iso) => clockTime(sunsetMs(iso, 37.789, -122.1913));
  // Published Oakland sunsets: Nov 10 4:59 PM, Jun 21 8:35 PM, Dec 21 4:54 PM, Mar 8 7:08 PM (PDT).
  const mins = (t) => { const [h, m] = t.split(/[: ]/); return (+h % 12 + 12) * 60 + +m; };
  for (const [iso, published] of [['2026-11-10', '4:59 PM'], ['2026-06-21', '8:35 PM'], ['2026-12-21', '4:54 PM'], ['2026-03-08', '7:08 PM']]) {
    assert.ok(Math.abs(mins(at(iso)) - mins(published)) <= 2, `${iso}: ${at(iso)} vs ${published}`);
  }
});

test("the header shows today's weather, air quality and sunset", () => {
  const week = weekOf('2026-11-10');
  const snap = buildSnapshot({ asOf: '2026-11-10', builtAt: 0, week, events: [],
    weather: { '2026-11-10': { icon: 'rain', label: 'Rain', hi: 58, lo: 50, rain: 70 } },
    air: { '2026-11-10': 42 }, location: { lat: 37.789, lon: -122.1913 } });
  const head = weekHtml(snap, { mode: 'eink' }).split('<div class="week">')[0];
  assert.match(head, /class="today-wx"/);
  assert.match(head, /58°/);
  assert.match(head, /70%/);
  assert.match(head, /AQI 42/);
  assert.match(head, /Sunset<br><b>5:00 PM<\/b>/);
  assert.ok(head.indexOf('tw-air') > head.indexOf('tw-row') && head.indexOf('tw-sunset') > head.indexOf('tw-air'), 'AQI under the weather, sunset to the right');
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
  const week = weekOf('2026-11-09');
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
  const week = weekOf('2026-11-10');
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
  const week = weekOf('2026-11-08');
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

test('refreshes come at midnight and noon, across the clock changes', () => {
  const t = (s) => Date.parse(s);
  assert.equal(secondsToNextRefresh(t('2026-11-10T00:00:30-08:00')), 12 * 3600);
  assert.equal(secondsToNextRefresh(t('2026-11-10T11:59:00-08:00')), 60 + 30);
  assert.equal(secondsToNextRefresh(t('2026-11-10T18:00:00-08:00')), 6 * 3600 + 30);
  // The night the clocks go back (Nov 1, 2026), midnight to noon is 13 hours.
  assert.equal(secondsToNextRefresh(t('2026-11-01T00:00:00-07:00')), 13 * 3600 + 30);
  assert.equal(new Date(lastRefreshAt(t('2026-11-10T09:00:00-08:00'))).toISOString(), '2026-11-10T08:00:00.000Z');
  assert.equal(new Date(lastRefreshAt(t('2026-11-10T13:00:00-08:00'))).toISOString(), '2026-11-10T20:00:00.000Z');
});
