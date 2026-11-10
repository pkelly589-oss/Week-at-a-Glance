// Builds the week's markup from a snapshot. Used by the web page (mode 'web')
// and by the Cloud Function that renders the e-ink PNG (mode 'eink'), so the
// door and the phone always show the same thing laid out the same way
// (requirements: Architecture, E-ink display, Web view).
//
// Returns HTML strings. Every piece of calendar text goes through esc(), so
// event titles can never be read as markup.

import { showRain, stampLabel, aqiInfo, showAqi, AQI_WARN, clockTime, isoDate } from './week.js';

// The e-ink renderer has no emoji font, so emoji would print as boxes there.
export const plainText = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, '').replace(/\s+/g, ' ').trim();

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Weather icons: simple line drawings that stay readable in 16 greys.
const S = 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
const sun = (cx = 16, cy = 16, r = 6) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>` +
  [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
    const t = (a * Math.PI) / 180, r1 = r + 3.5, r2 = r + 7;
    const f = (n) => n.toFixed(1);
    return `<path d="M${f(cx + r1 * Math.cos(t))} ${f(cy + r1 * Math.sin(t))}L${f(cx + r2 * Math.cos(t))} ${f(cy + r2 * Math.sin(t))}"/>`;
  }).join('');
const cloud = 'M9 25h14a5.5 5.5 0 0 0 .6-11A7.5 7.5 0 0 0 9.3 15.5 4.8 4.8 0 0 0 9 25z';
const cloudHigh = 'M9 20h14a5.5 5.5 0 0 0 .6-11A7.5 7.5 0 0 0 9.3 10.5 4.8 4.8 0 0 0 9 20z';
export const ICONS = {
  sun: `<svg viewBox="0 0 32 32" ${S}>${sun()}</svg>`,
  partly: `<svg viewBox="0 0 32 32" ${S}><circle cx="12" cy="11" r="4.5"/><path d="M12 2.5v2M3.5 11h2M6 5l1.4 1.4M18 5l-1.4 1.4"/><path d="M11 27h13a5 5 0 0 0 .5-10A7 7 0 0 0 11.3 18.5 4.3 4.3 0 0 0 11 27z" style="fill: var(--wx-fill, #fff)"/></svg>`,
  cloud: `<svg viewBox="0 0 32 32" ${S}><path d="${cloud}"/></svg>`,
  fog: `<svg viewBox="0 0 32 32" ${S}><path d="${cloudHigh}"/><path d="M6 24h20M9 28.5h14"/></svg>`,
  drizzle: `<svg viewBox="0 0 32 32" ${S}><path d="${cloudHigh}"/><path d="M11 24v1.5M16 26v1.5M21 24v1.5"/></svg>`,
  rain: `<svg viewBox="0 0 32 32" ${S}><path d="${cloudHigh}"/><path d="M11 23l-1.5 5M16.5 23l-1.5 5M22 23l-1.5 5"/></svg>`,
  snow: `<svg viewBox="0 0 32 32" ${S}><path d="${cloudHigh}"/><path d="M11 24.5h.01M16 27.5h.01M21 24.5h.01M13.5 29.5h.01M18.5 29.5h.01" stroke-width="3.4"/></svg>`,
  moon: `<svg viewBox="0 0 32 32" ${S}><path d="M22.5 20.5A9.5 9.5 0 0 1 11.5 7.6 9.5 9.5 0 1 0 24.4 20a9.6 9.6 0 0 1-1.9.5z"/></svg>`,
  'partly-night': `<svg viewBox="0 0 32 32" ${S}><path d="M16 11.2A5.6 5.6 0 0 1 9.4 3.6a5.6 5.6 0 1 0 7.5 7.4 5.7 5.7 0 0 1-.9.2z"/><path d="M11 27h13a5 5 0 0 0 .5-10A7 7 0 0 0 11.3 18.5 4.3 4.3 0 0 0 11 27z" style="fill: var(--wx-fill, #fff)"/></svg>`,
  storm: `<svg viewBox="0 0 32 32" ${S}><path d="${cloudHigh}"/><path d="M17 20l-3.5 5h5L15 30.5"/></svg>`,
};
const DROP = `<svg class="drop" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5C8 1.5 3 7.2 3 10.2a5 5 0 0 0 10 0C13 7.2 8 1.5 8 1.5z" fill="currentColor"/></svg>`;

// One face per US AQI band, drawn in plain lines so it reads in 16 greys:
// good = big smile … hazardous = face mask.
const FACE_BASE = '<circle cx="16" cy="16" r="13"/>';
const EYES = '<circle cx="11.5" cy="13" r="1.4" fill="currentColor" stroke="none"/><circle cx="20.5" cy="13" r="1.4" fill="currentColor" stroke="none"/>';
const FACES = {
  good: `${EYES}<path d="M9.5 18.5c1.6 3.4 4 4.8 6.5 4.8s4.9-1.4 6.5-4.8"/>`,
  moderate: `${EYES}<path d="M10.5 20c1.7 1.6 3.5 2.2 5.5 2.2s3.8-.6 5.5-2.2"/>`,
  sensitive: `${EYES}<path d="M11 21.5h10"/>`,
  unhealthy: `${EYES}<path d="M10.5 23c1.7-2 3.5-2.8 5.5-2.8s3.8.8 5.5 2.8"/>`,
  very: '<path d="M9 10.5l4.5 1.5M23 10.5l-4.5 1.5"/>' + EYES.replace(/cy="13"/g, 'cy="14.5"') +
    '<path d="M10 24c1.8-2.6 3.8-3.6 6-3.6s4.2 1 6 3.6"/>',
  hazardous: '<path d="M9.5 11l3.5 3.5M13 11l-3.5 3.5M19 11l3.5 3.5M22.5 11L19 14.5"/>' +
    '<path d="M8 18.5h16v3.5a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4z" fill="currentColor" fill-opacity=".25"/><path d="M8 19.5L4 17M24 19.5l4-2.5"/>',
};
export function aqiFace(level) {
  return `<svg class="aqi-face" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${FACE_BASE}${FACES[level] || FACES.moderate}</svg>`;
}

// Air quality: today's only, in the header beside the sunset. Drawn as a
// warning chip from "Unhealthy for sensitive groups" up; the web adds the band's name.
function aqiHtml(aqi, mode) {
  if (!showAqi(aqi)) return '';
  const a = aqiInfo(aqi);
  const warn = a.aqi >= AQI_WARN ? ' aqi-warn' : '';
  const word = mode === 'web' ? ` <span class="aqi-word">${esc(a.label)}</span>` : '';
  return `<span class="aqi aqi-${a.level}${warn}" title="Air quality: ${esc(a.label)}">${aqiFace(a.level)}<span>AQI ${a.aqi}${word}</span></span>`;
}

function weatherHtml(w, aqi, mode) {
  const air = aqiHtml(aqi, mode);
  if (!w) return `<div class="wx wx-none"><span>No forecast</span>${air ? `<span class="wx-meta">${air}</span>` : ''}</div>`;
  const rain = showRain(w) ? `<span class="rain">${DROP}${esc(w.rain)}%</span>` : '';
  const meta = rain || air ? `<span class="wx-meta">${rain}${air}</span>` : '';
  return `<div class="wx" title="${esc(w.label)}">` +
    `<span class="wx-icon" aria-hidden="true">${ICONS[w.icon] || ICONS.cloud}</span>` +
    `<span class="wx-text"><span class="temps"><b>${esc(w.hi)}°</b><span class="lo"> / ${esc(w.lo)}°</span></span>` +
    `<span class="wx-label">${esc(w.label)}</span>${meta}</span></div>`;
}

// Holidays: always the first thing under the weather, above reminders and events.
const STAR = `<svg class="star" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.9 4.1 4.4.5-3.3 3 .9 4.4L8 11.3l-3.9 2.2.9-4.4-3.3-3 4.4-.5z" fill="currentColor"/></svg>`;
// Birthdays: after holidays, with a cake.
const CAKE = `<svg class="cake" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21h16v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z"/><path d="M4 16.5c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0 2.7-1 4 0"/><path d="M8 12V9M12 12V9M16 12V9"/><path d="M8 6.5c.8-.7.8-1.6 0-2.5-.8.9-.8 1.8 0 2.5zM12 6.5c.8-.7.8-1.6 0-2.5-.8.9-.8 1.8 0 2.5zM16 6.5c.8-.7.8-1.6 0-2.5-.8.9-.8 1.8 0 2.5z" fill="currentColor"/></svg>`;
function birthdaysHtml(events, mode) {
  if (!events.length) return '';
  return `<ul class="birthdays">${events.map((e) =>
    `<li class="birthday">${CAKE}<span>${esc(mode === 'eink' ? plainText(e.title) : e.title)}</span></li>`).join('')}</ul>`;
}

function holidaysHtml(events) {
  if (!events.length) return '';
  return `<ul class="holidays">${events.map((e) =>
    `<li class="holiday">${STAR}<span>${esc(plainText(e.title))}</span></li>`).join('')}</ul>`;
}

// Household reminders (bins, street sweeping): a bar at the top of the day.
const BELL = `<svg class="bell" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8a4 4 0 0 0-4 4v2.6L2.6 11h10.8L12 8.4V5.8a4 4 0 0 0-4-4zM6.3 12.6a1.8 1.8 0 0 0 3.4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
function noticesHtml(notices) {
  if (!notices?.length) return '';
  return `<ul class="notices">${notices.map((n) =>
    `<li class="notice notice-${esc(n.when)}">${BELL}<span>${esc(n.text)}</span></li>`).join('')}</ul>`;
}

function badgesHtml(badges) {
  return `<span class="badges">${(badges || []).map((b) =>
    `<span class="badge badge-${esc(b.toLowerCase())}" title="${b === 'P' ? 'Pete' : b === 'D' ? 'David' : esc(b)} is going">${esc(b)}</span>`).join('')}</span>`;
}

const PIN = `<svg class="pin" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15s5-4.6 5-8.6A5 5 0 0 0 3 6.4C3 10.4 8 15 8 15z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="6.5" r="1.8" fill="currentColor"/></svg>`;

function eventHtml(ev, mode) {
  const span = ev.span ? `<span class="span">Day ${ev.span.n} of ${ev.span.of}</span>` : '';
  const when = ev.time ? `<span class="time">${esc(ev.time)}</span>` : (ev.allDay ? '<span class="time allday">All day</span>' : '');
  // The web shows the full location; the e-ink one short line.
  const place = ev.location || '';
  const loc = place ? `<span class="loc">${PIN}<span>${esc(place)}</span></span>` : '';
  const cls = `ev${ev.allDay ? ' ev-allday' : ''}`;
  return `<li class="${cls}"><span class="ev-top">${when}${badgesHtml(ev.badges)}</span>` +
    `<span class="title">${esc(mode === 'eink' ? plainText(ev.title) : ev.title)}</span>${loc}${span}</li>`;
}

export function dayHtml(day, { today, mode }) {
  const past = day.date < today, isToday = day.date === today;
  const cls = `day${past ? ' past' : ''}${isToday ? ' today' : ''}`;
  const holidays = day.events.filter((e) => e.holiday);
  const birthdays = day.events.filter((e) => e.birthday);
  // Events from a reminder calendar (Home Tasks) join the reminder bars.
  const calReminders = day.events.filter((e) => e.reminder)
    .map((e) => ({ text: e.time ? `${e.time} · ${e.title}` : e.title, when: 'calendar' }));
  const others = day.events.filter((e) => !e.holiday && !e.reminder && !e.birthday);
  const events = others.length
    ? `<ul class="events">${others.map((e) => eventHtml(e, mode)).join('')}</ul>`
    : (holidays.length || birthdays.length || day.notices?.length || calReminders.length ? '' : '<p class="empty">Nothing scheduled</p>');
  const notices = [...(day.notices || []), ...calReminders];
  const top = holidaysHtml(holidays) + birthdaysHtml(birthdays, mode) + noticesHtml(notices);
  const inner = `<header class="day-head"><span class="dow">${esc(day.dow)}</span>` +
    `<span class="date">${esc(day.label)}</span>${isToday ? '<span class="today-tag">Today</span>' : ''}</header>` +
    weatherHtml(day.weather, null, mode) + top + events;
  // On the web, past days fold away (Web view: "past days collapsed by default").
  if (mode === 'web' && past) {
    const n = day.events.length;
    return `<section class="${cls}" data-date="${esc(day.date)}"><details class="past-fold">` +
      `<summary><span class="dow">${esc(day.dow)}</span> <span class="date">${esc(day.label)}</span>` +
      `<span class="muted"> · ${n ? `${n} event${n > 1 ? 's' : ''}` : 'nothing scheduled'}</span></summary>` +
      `<div class="past-body">${weatherHtml(day.weather, null, mode)}${top}${events}</div></details></section>`;
  }
  return `<section class="${cls}" data-date="${esc(day.date)}">${inner}</section>`;
}

// Today's weather beside the date in the header: icon, high/low, conditions,
// rain chance, air quality and sunset.
// Sunset: half sun on the horizon with the arrow pointing down (up = sunrise).
const SUNSET = `<svg class="sunset-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 18a5.5 5.5 0 0 1 11 0M1.5 18h21M3.5 12.5l1.8 1.2M20.5 12.5l-1.8 1.2M6 21.5h12M12 1.5v7M8.8 5.6 12 8.8l3.2-3.2"/></svg>`;
const THERMO = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6a3 3 0 0 1 6 0v12.2a6.2 6.2 0 1 1-6 0z"/><path d="M16 11v11"/><circle cx="16" cy="23" r="2.6" fill="currentColor" stroke="none"/><path d="M22 8h3M22 12h3M22 16h3"/></svg>`;

// Today, three rows with their icons in one column: temperature (thermometer),
// conditions and rain chance (weather icon), air quality (face). Sunset to the
// right of all three.
// The header: conditions at the last update (temperature, sky, AQI) when the
// snapshot has them, else today's forecast; and the sunset. "now" becomes
// "at 11:55 PM" for the late-night build, shown until the morning.
function todayHtml(day, mode, snap) {
  if (!day) return '';
  const cur = snap?.current && snap.as_of === day.date ? snap.current : null;
  const w = day.weather;
  const rows = [];
  const row = (icon, text, cls = '') => rows.push(
    `<span class="tw-ic${cls}" aria-hidden="true">${icon}</span><span class="tw-val">${text}</span>`);
  if (cur?.temp != null) {
    const when = snap.built_at && isoDate(snap.built_at) !== snap.as_of ? `at ${clockTime(snap.built_at)}` : 'now';
    row(THERMO, `<span class="tw-temps"><b>${esc(cur.temp)}°</b><span class="lo tw-now"> ${esc(when)}</span></span>`);
    row(ICONS[cur.icon] || ICONS.cloud, `<span class="tw-label">${esc(cur.label)}</span>`);
  } else if (w) {
    row(THERMO, `<span class="tw-temps"><b>${esc(w.hi)}°</b><span class="lo"> / ${esc(w.lo)}°</span></span>`);
    row(ICONS[w.icon] || ICONS.cloud,
      `<span class="tw-label">${esc(w.label)}</span>${showRain(w) ? `<span class="rain">${DROP}${esc(w.rain)}%</span>` : ''}`);
  }
  const aqiNow = cur?.aqi ?? day.aqi;
  if (showAqi(aqiNow)) {
    const a = aqiInfo(aqiNow);
    const warn = a.aqi >= AQI_WARN ? ' aqi-warn' : '';
    const word = mode === 'web' ? ` <span class="aqi-word">${esc(a.label)}</span>` : '';
    const src = cur?.aqi_source === 'airnow' ? ` (AirNow${cur.aqi_area ? `, ${cur.aqi_area}` : ''})` : '';
    row(aqiFace(a.level), `<span class="aqi aqi-${a.level}${warn}" title="Air quality: ${esc(a.label)}${esc(src)}"><span>AQI ${a.aqi}${word}</span></span>`,
      ` aqi-${a.level}${warn}`);
  }
  const main = rows.length ? `<div class="tw-grid">${rows.join('')}</div>` : '';
  const sunset = day.sunset
    ? `<div class="tw-sunset">${SUNSET}<span><span class="tw-sun-label">Sunset</span> <b>${esc(clockTime(day.sunset))}</b></span></div>` : '';
  if (!main && !sunset) return '';
  return `<div class="today-wx">${main}${sunset}</div>`;
}

// Home energy: yesterday's solar, home use, grid and self-powered share, plus
// the battery's charge at build time. A strip along the bottom of the e-ink
// image and under the header on the web.
const EN_S = 'viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const HOUSE = `<svg ${EN_S}><path d="M5 15L16 5l11 10"/><path d="M8 13v14h16V13"/><path d="M13.5 27v-7h5v7"/></svg>`;
const BOLT = `<svg ${EN_S}><path d="M18 3L8 18h7l-2 11 11-16h-7z"/></svg>`;
const battery = (pct) => {
  const w = Math.max(0, Math.min(100, pct ?? 0)) / 100 * 19;
  return `<svg ${EN_S}><rect x="3" y="9" width="24" height="14" rx="2.5"/><path d="M29.5 13.5v5"/>` +
    `<rect x="5.5" y="11.5" width="${w.toFixed(1)}" height="9" rx="1" fill="currentColor" stroke="none"/></svg>`;
};
const num = (v) => (v == null ? '–' : esc(v));
export function energyHtml(e) {
  if (!e) return '';
  const items = [];
  const item = (icon, label, value, cls = '') =>
    items.push(`<span class="en-item${cls}"><span class="en-ic">${icon}</span><span class="en-label">${label}</span> <b>${value}</b></span>`);
  if (e.date) {
    if (e.solar_kwh != null) item(ICONS.sun, 'Solar', `${num(e.solar_kwh)} kWh`);
    if (e.used_kwh != null) item(HOUSE, 'Home', `${num(e.used_kwh)} kWh`);
    if (e.imported_kwh != null || e.exported_kwh != null) {
      item(BOLT, 'Grid', `${num(e.imported_kwh)} in <span class="en-sep">·</span> ${num(e.exported_kwh)} out`);
    }
    if (e.self_powered != null) items.push(`<span class="en-item en-self"><span class="en-label">Self-powered</span> <b>${num(e.self_powered)}%</b></span>`);
  }
  if (e.battery_pct != null) item(battery(e.battery_pct), 'Current Battery', `${num(e.battery_pct)}%`, ' en-batt');
  if (!items.length) return '';
  const head = e.date ? `${esc(e.label || 'Yesterday')}’s energy` : 'Energy';
  return `<section class="energy${e.stale ? ' stale' : ''}" aria-label="Home energy">` +
    `<span class="en-head">${head}</span>${items.join('')}</section>`;
}

// The title on two lines: the weekdays shown ("Mon – Sun"), then the dates
// ("Nov 9 – 15"). Snapshots built before the rolling window carry
// "Week of Nov 8 – 14" instead, split the same way.
function titleHtml(snap) {
  const old = String(snap.title || '').match(/^(Week of)\s+(.*)$/);
  const days = snap.days || [];
  const weekdays = snap.subtitle || (days.length ? `${days[0].dow} – ${days.at(-1).dow}` : '');
  const [top, range] = old ? [old[1], old[2]] : [weekdays, snap.title];
  return top ? `<span class="wk-of">${esc(top)}</span><span class="wk-range">${esc(range)}</span>` : esc(range);
}

// The whole window: header + seven days.
export function weekHtml(snap, { mode = 'web', today = snap.as_of } = {}) {
  const warn = (snap.warnings || []).length
    ? `<p class="warnings">${snap.warnings.map(esc).join(' · ')}</p>` : '';
  return `<header class="week-head"><div><h1>${titleHtml(snap)}</h1>${warn}</div>` +
    `<div class="head-right">` +
    todayHtml(snap.days.find((d) => d.date === today), mode, snap) +
    `<span class="updated">Updated ${esc(stampLabel(snap.built_at))}</span></div></header>` +
    (mode === 'web' ? energyHtml(snap.energy) : '') +
    `<div class="week">${snap.days.map((d) => dayHtml(d, { today, mode })).join('')}</div>` +
    (mode === 'eink' ? energyHtml(snap.energy) : '');
}

// The credit line under the week: which service each part came from, naming
// the source of the AQI in the header for this snapshot.
export function creditsHtml(snap) {
  const om = '<a href="https://open-meteo.com/">Open-Meteo</a>';
  const an = '<a href="https://www.airnow.gov/">AirNow</a>';
  const cur = snap?.current;
  let air;
  if (cur?.aqi_source === 'airnow') {
    const when = cur.aqi_at ? `, ${esc(clockTime(cur.aqi_at))} reading` : '';
    air = `${an} (EPA)${cur.aqi_area ? `, ${esc(cur.aqi_area)}` : ''}${when}`;
  } else if (cur?.aqi_source === 'open-meteo') {
    air = `${om} (CAMS forecast; AirNow had no recent reading)`;
  } else {
    air = `${an} (EPA), or ${om} (CAMS) when AirNow has no recent reading`;
  }
  return `Weather: ${om} and the National Weather Service. Air quality now: ${air}.`;
}

// ---------------------------------------------------------------------------
// The e-ink page: a complete 1872 × 1404 document for the headless browser.
// ---------------------------------------------------------------------------

export const EINK_W = 1872, EINK_H = 1404;

// fontCss: @font-face rules (the render function inlines the font files so the
// image never depends on fonts installed on the server).
export function einkDocument(snap, { fontCss = '', today = snap.as_of } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${fontCss}${EINK_CSS}</style></head>` +
    `<body>${weekHtml(snap, { mode: 'eink', today })}<script>${FIT_SCRIPT}</script></body></html>`;
}

// E-ink display > Event rows, overflow: drop rows from the bottom of a day
// until the list fits, and say how many are hidden.
// It waits for the fonts, because rows measured in a fallback font would fit
// differently.
const FIT_SCRIPT = `
document.fonts.ready.then(() => {
// The week title is drawn large; on a week with a long title and long weather
// words it shrinks just enough to leave room for today's weather.
const head = document.querySelector('.week-head'), h1 = head && head.querySelector('h1');
if (h1) {
  let size = parseFloat(getComputedStyle(h1).fontSize);
  while (head.scrollWidth > head.clientWidth + 1 && size > 48) { size -= 2; h1.style.fontSize = size + 'px'; }
}
// The energy strip shrinks a little on a day of big numbers.
const en = document.querySelector('.energy');
if (en) {
  let size = parseFloat(getComputedStyle(en).fontSize);
  while (en.scrollWidth > en.clientWidth + 1 && size > 22) { size -= 1; en.style.fontSize = size + 'px'; }
}
for (const day of document.querySelectorAll('.day')) {
  const list = day.querySelector('.events'); if (!list) continue;
  const rows = [...list.children]; let hidden = 0;
  const more = document.createElement('li'); more.className = 'more';
  const fits = () => day.scrollHeight <= day.clientHeight + 1;
  while (!fits() && hidden < rows.length) {
    rows[rows.length - 1 - hidden].remove(); hidden++;
    more.textContent = '+' + hidden + ' more';
    if (!more.isConnected) list.append(more);
  }
}
document.body.dataset.ready = '1';
});`;

const EINK_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${EINK_W}px; height: ${EINK_H}px; overflow: hidden; background: #fff; color: #000; }
body { font-family: 'Atkinson Hyperlegible', system-ui, sans-serif; padding: 36px 40px 32px;
  display: flex; flex-direction: column; -webkit-font-smoothing: antialiased; }
.week-head { display: flex; justify-content: space-between; align-items: center; gap: 40px;
  padding-bottom: 18px; border-bottom: 4px solid #000; }
h1 { font-size: 96px; font-weight: 700; letter-spacing: -1px; line-height: 1.02; white-space: nowrap; }
.wk-of, .wk-range { display: block; }
.wk-of { font-weight: 400; }
.warnings { font-size: 22px; margin-top: 10px; color: #444; }
.head-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; }
.today-wx { display: flex; align-items: center; gap: 32px; font-size: 44px; white-space: nowrap; }
.tw-grid { display: grid; grid-template-columns: auto auto; align-items: center; column-gap: 14px; row-gap: 4px; }
.tw-ic { display: flex; justify-content: center; }
.tw-ic svg { width: 56px; height: 56px; display: block; }
.tw-val { display: flex; align-items: center; gap: 16px; }
.tw-temps b { font-weight: 700; }
/* One size for everything on today's line. */
.today-wx .rain, .today-wx .aqi, .today-wx .tw-sunset, .today-wx .tw-sunset b { font-size: 44px; }
.today-wx .drop { width: 32px; height: 32px; }
.tw-val .aqi-warn > span:last-child { margin-left: -7px; }
.tw-sunset { display: flex; align-items: center; gap: 10px; padding-left: 22px; border-left: 3px solid #000;
  font-size: 26px; line-height: 1.15; }
.sunset-icon { width: 64px; height: 64px; flex: none; }
.tw-sun-label { display: block; }
.updated { font-size: 20px; color: #555; }
.week { flex: 1; display: grid; grid-template-columns: repeat(7, 1fr); min-height: 0; }
.day { display: flex; flex-direction: column; min-height: 0; overflow: hidden; padding: 0 14px 0;
  border-right: 2px solid #000; }
.day:last-child { border-right: 0; }
.day-head { display: flex; align-items: baseline; gap: 10px; padding: 16px 12px 12px; margin: 0 -14px; }
.dow { font-size: 40px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; }
.date { font-size: 32px; }
.today-tag { display: none; }
.today .day-head { background: #000; color: #fff; }
.wx { display: flex; gap: 8px; align-items: center; height: 136px; border-bottom: 2px solid #000; }
.wx-icon svg { width: 62px; height: 62px; display: block; }
.wx-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.temps { font-size: 33px; line-height: 1.05; white-space: nowrap; }
.temps b { font-weight: 700; } .lo { color: #555; }
.wx-label { font-size: 22px; line-height: 1.15; }
.wx-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; }
.rain { font-size: 24px; font-weight: 700; display: flex; align-items: center; gap: 4px; }
.aqi { font-size: 22px; font-weight: 700; white-space: nowrap; }
.aqi-warn > span:last-child { background: #000; color: #fff; padding: 1px 7px; border-radius: 5px; }
.holidays { list-style: none; display: flex; flex-direction: column; gap: 8px; padding-top: 14px; }
.holiday { display: flex; align-items: center; gap: 8px; border: 3px solid #000; border-radius: 6px;
  padding: 7px 10px; font-size: 27px; font-weight: 700; line-height: 1.15; }
.star { width: 24px; height: 24px; flex: none; }
.past .holiday { border-color: #9a9a9a; }
.birthdays { list-style: none; display: flex; flex-direction: column; gap: 8px; padding-top: 14px; }
.birthday { display: flex; align-items: center; gap: 8px; border: 3px dashed #000; border-radius: 6px;
  padding: 7px 10px; font-size: 26px; font-weight: 700; line-height: 1.15; }
.cake { width: 28px; height: 28px; flex: none; }
.past .birthday { border-color: #9a9a9a; }
.notices { list-style: none; display: flex; flex-direction: column; gap: 8px; padding-top: 14px; }
.notice { display: flex; align-items: center; gap: 8px; background: #000; color: #fff; font-size: 24px;
  font-weight: 700; line-height: 1.15; padding: 8px 10px; border-radius: 6px; }
.bell { width: 24px; height: 24px; flex: none; }
.past .notice { background: #9a9a9a; }
.past .aqi-warn > span:last-child { background: #8a8a8a; }
.drop { width: 20px; height: 20px; }
.wx-none { font-size: 24px; color: #555; flex-direction: column; align-items: flex-start; justify-content: center; }
.events { list-style: none; display: flex; flex-direction: column; gap: 14px; padding-top: 14px; }
.ev { display: flex; flex-direction: column; gap: 3px; }
.ev-top { display: flex; justify-content: space-between; align-items: center; min-height: 34px; }
.time { font-size: 27px; font-weight: 700; }
.time.allday { font-size: 21px; text-transform: uppercase; letter-spacing: 0.5px; }
.ev-allday { background: #e4e4e4; padding: 6px 8px 8px; border-radius: 6px; }
.title { font-size: 30px; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.span { color: #555; font-size: 22px; }
.loc { display: flex; align-items: center; gap: 4px; font-size: 24px; color: #444; min-width: 0; }
.loc > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pin { width: 20px; height: 20px; flex: none; }
.past .loc { color: #a0a0a0; }
.badges { display: flex; gap: 5px; }
.badge { font-size: 21px; font-weight: 700; width: 34px; height: 34px; border: 2.5px solid #000;
  border-radius: 6px; display: flex; align-items: center; justify-content: center; line-height: 1; }
.badge-d { background: #000; color: #fff; }
.more { font-size: 26px; font-weight: 700; color: #333; }
.empty { font-size: 26px; color: #666; padding-top: 16px; }
.past { color: #8a8a8a; }
.past .badge { border-color: #8a8a8a; } .past .badge-d { background: #8a8a8a; color: #fff; }
.past .lo, .past .span, .past .updated { color: #a0a0a0; }
.past .wx, .past .day-head { border-color: #8a8a8a; }
.past .ev-allday { background: #efefef; }
.energy { flex: none; display: flex; align-items: center; gap: 28px; border-top: 4px solid #000;
  padding-top: 16px; margin-top: 4px; font-size: 31px; white-space: nowrap; }
.en-head { font-size: 24px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-right: -6px; }
.en-item { display: flex; align-items: center; gap: 8px; }
.en-item b { font-weight: 700; }
.en-ic svg { width: 1.35em; height: 1.35em; display: block; }
.en-sep { font-weight: 400; }
.en-batt { margin-left: auto; padding-left: 28px; border-left: 3px solid #000; }
.energy.stale .en-head::after { content: ' (earlier)'; font-weight: 400; text-transform: none; }
`;
