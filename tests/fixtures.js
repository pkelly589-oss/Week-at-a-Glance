// A believable week of Google Calendar data for tests, local development and
// screenshots. Invented people and events only (no household data).
import { windowOf, buildEvents, buildSnapshot, energySummary } from '../public/lib/week.js';

export const PETE = 'pete@example.com';
export const DAVID = 'david@example.com';
export const HOUSEHOLD = {
  people: [
    { key: 'pete', name: 'Pete', letter: 'P', email: PETE },
    { key: 'david', name: 'David', letter: 'D', email: DAVID },
  ],
  calendars: [
    { person: 'pete', id: PETE },
    { person: 'david', id: DAVID },
    { id: 'home-tasks@group.calendar.google.com', label: 'Home Tasks', as_reminders: true },
    { id: 'house@example.com', label: 'House' },
    { id: 'en.usa#holiday@group.v.calendar.google.com', label: 'US holidays' },
  ],
  location: { lat: 37.8044, lon: -122.2712 },
  hide_locations: ['123 Example St'],
  hide_events: ["Temescal farmer's market", "South Berkeley farmer's market"],
  reminders: [
    { label: 'Bins', weekday: 4, day_before: 'Bins out tonight', hide_events: ['put out trash'] },
    { label: 'Street sweeping', weekday: 3, nth: 2, day_of: 'Street sweeping today',
      hide_events: ['parking enforcement', 'street sweeping'] },
  ],
};

const at = (date, hm, mins = 60) => {
  const start = new Date(`${date}T${hm}:00-08:00`);
  return {
    start: { dateTime: start.toISOString() },
    end: { dateTime: new Date(+start + mins * 6e4).toISOString() },
  };
};
const allDay = (from, to) => ({ start: { date: from }, end: { date: to } });
const a = (email, responseStatus, organizer = false) => ({ email, responseStatus, ...(organizer ? { organizer } : {}) });
const both = (s1 = 'accepted', s2 = 'accepted') => ({ organizer: { email: PETE }, attendees: [a(PETE, s1, true), a(DAVID, s2)] });

let n = 0;
const e = (summary, when, extra = {}) => ({ id: `f${++n}`, iCalUID: `fixture-${n}@example.com`, status: 'confirmed', summary, ...when, ...extra });

// Events around Sun Nov 8 – Sun Nov 15, 2026 (the sample window is Mon Nov 9 – Sun Nov 15).
export function calendarSources() {
  n = 0;
  const shared = [
    e('Dinner at Nido with Sam & Ari', at('2026-11-10', '19:00', 120), { ...both(), location: 'Nido, 444 Embarcadero W, Oakland' }),

    e('Tahoe weekend', allDay('2026-11-13', '2026-11-16'), both()),
    e('Farmers market', at('2026-11-08', '10:00', 90), both()),
    e('Plumber (kitchen sink)', at('2026-11-12', '08:00', 120), both('accepted', 'declined')),
  ];
  const pete = [
    ...shared,
    e('Run club', at('2026-11-09', '06:30', 60)),
    e('Lisa’s Birthday', allDay('2026-11-12', '2026-11-13')),
    e('Temescal farmers market', at('2026-11-08', '09:00', 240), both()),
    e('South Berkeley Farmers Market', at('2026-11-10', '14:00', 270), both()),
    e('Put out trash for pickup', at('2026-11-11', '21:00', 15), both()),
    e('Parking enforcement 2nd Wednesday', allDay('2026-11-11', '2026-11-12')),
    e('Dentist', at('2026-11-09', '15:30', 60), { location: 'Dimond Dental' }),
    e('Board prep call', at('2026-11-10', '09:00', 60), { organizer: { email: 'chair@example.org' }, attendees: [a('chair@example.org', 'accepted', true), a(PETE, 'accepted')] }),
    e('1:1 with Morgan', at('2026-11-10', '11:30', 30)),
    e('Lunch: Jordan', at('2026-11-10', '12:30', 60)),
    e('Team retro', at('2026-11-10', '15:00', 60)),
    e('Physical therapy', at('2026-11-10', '17:00', 45), { visibility: 'private' }),
    e('Book club: "The Overstory"', at('2026-11-12', '19:30', 120), { organizer: { email: 'host@example.org' }, attendees: [a(PETE, 'tentative'), a(DAVID, 'needsAction')] }),
    e('Conference: AI for Science Summit', { start: { dateTime: '2026-11-11T09:00:00-08:00' }, end: { dateTime: '2026-11-12T17:00:00-08:00' } }),
    e('Webinar nobody is going to', at('2026-11-12', '13:00'), { organizer: { email: 'x@example.org' }, attendees: [a(PETE, 'declined'), a(DAVID, 'declined')] }),
  ];
  const david = [
    ...shared.map((ev) => ({ ...ev, id: `${ev.id}-d` })),
    e('Climbing', at('2026-11-09', '18:00', 90)),
    e('Haircut', at('2026-11-11', '10:00', 45)),
    e('Pick up dry cleaning', at('2026-11-11', '16:00', 15)),
    e('Therapy', at('2026-11-12', '17:00', 50), { visibility: 'private' }),
    e(undefined, at('2026-11-12', '12:00', 60)), // a busy-only block with no details
    e("Mom's birthday call", at('2026-11-08', '16:00', 30)),
  ];
  const homeTasks = [
    e('Compost and recycling out', at('2026-11-10', '20:00', 15), { location: '123 Example St, Oakland, CA 94602, USA' }),
    e('Change furnace filter', allDay('2026-11-14', '2026-11-15')),
  ];
  const house = [
    e('Gutter cleaning', at('2026-11-12', '10:00', 120), { location: '123 Example St, Oakland, CA' }),
    e('Housewarming planning call', at('2026-11-09', '20:00', 30), { location: 'https://meet.google.com/abc-defg-hij', attendees: [a(PETE, 'accepted'), a(DAVID, 'accepted')] }),
  ];
  const holidays = [
    e('Veterans Day', allDay('2026-11-11', '2026-11-12'), { iCalUID: '20261111_veterans@google.com' }),
  ];
  return [
    { person: 'pete', id: PETE, events: pete },
    { person: 'david', id: DAVID, events: david },
    { person: null, reminder: true, id: 'home-tasks@group.calendar.google.com', events: homeTasks },
    { person: null, id: 'house@example.com', events: house },
    { person: null, holiday: true, id: 'en.usa#holiday@group.v.calendar.google.com', events: holidays },
  ];
}

export const WEATHER = {
  '2026-11-08': { icon: 'sun', label: 'Sunny', hi: 66, lo: 48, rain: 0 },
  '2026-11-09': { icon: 'partly', label: 'Partly cloudy', hi: 63, lo: 50, rain: 10 },
  '2026-11-10': { icon: 'cloud', label: 'Cloudy', hi: 60, lo: 52, rain: 20 },
  '2026-11-11': { icon: 'rain', label: 'Rain', hi: 57, lo: 50, rain: 80 },
  '2026-11-12': { icon: 'drizzle', label: 'Drizzle', hi: 58, lo: 49, rain: 40 },
  '2026-11-13': { icon: 'partly', label: 'Partly cloudy', hi: 61, lo: 47, rain: 10 },
  '2026-11-14': { icon: 'sun', label: 'Sunny', hi: 64, lo: 46, rain: 0 },
  '2026-11-15': { icon: 'partly', label: 'Partly cloudy', hi: 62, lo: 47, rain: 10 },
};

export const AIR = { '2026-11-08': 32, '2026-11-09': 48, '2026-11-10': 64, '2026-11-11': 41, '2026-11-12': 118, '2026-11-13': 87 };

// Enphase lifetime answers (Wh per day from start_date), as the API sends them.
export const ENPHASE = {
  energy_lifetime: { system_id: 42, start_date: '2026-11-08', production: [17600, 18420] },
  consumption_lifetime: { system_id: 42, start_date: '2026-11-08', consumption: [20100, 21730] },
  energy_import_lifetime: { system_id: 42, start_date: '2026-11-08', import: [2900, 3110] },
  energy_export_lifetime: { system_id: 42, start_date: '2026-11-08', export: [5800, 6240] },
  battery_lifetime: { system_id: 42, start_date: '2026-11-08', charge: [7700, 7930], discharge: [7300, 7420] },
  'telemetry/battery': { system_id: 42, last_reported_aggregate_soc: '64%', intervals: [] },
};
const daily = (body, key) => Object.fromEntries(body[key].map((v, i) => [`2026-11-${String(8 + i).padStart(2, '0')}`, v]));
export const sampleEnergy = (asOf = '2026-11-10') => energySummary({
  produced: daily(ENPHASE.energy_lifetime, 'production'),
  consumed: daily(ENPHASE.consumption_lifetime, 'consumption'),
  imported: daily(ENPHASE.energy_import_lifetime, 'import'),
  exported: daily(ENPHASE.energy_export_lifetime, 'export'),
  charged: daily(ENPHASE.battery_lifetime, 'charge'),
  discharged: daily(ENPHASE.battery_lifetime, 'discharge'),
}, '2026-11-09', { asOf, soc: 64 });

export function sampleSnapshot({ asOf = '2026-11-10', builtAt = Date.parse('2026-11-09T23:55:00-08:00'), warnings = [], energy = sampleEnergy(asOf) } = {}) {
  const week = windowOf(asOf);
  const { hide_locations: hideLocations, reminders, hide_events: hideEvents } = HOUSEHOLD;
  return buildSnapshot({
    asOf, builtAt, week, warnings, weather: WEATHER, air: AIR, reminders, location: HOUSEHOLD.location, energy,
    events: buildEvents(calendarSources(), HOUSEHOLD.people, { hideLocations, reminders, hideEvents }),
  });
}
