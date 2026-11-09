// Builds the week's markup from a snapshot. Used by the web page (mode 'web')
// and by the Cloud Function that renders the e-ink PNG (mode 'eink'), so the
// door and the phone always show the same thing laid out the same way
// (requirements: Architecture, E-ink display, Web view).
//
// Returns HTML strings. Every piece of calendar text goes through esc(), so
// event titles can never be read as markup.

import { showRain, longDate, stampLabel, aqiInfo, showAqi, AQI_WARN, clockTime } from './week.js';

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
  // Events from a reminder calendar (Home Tasks) join the reminder bars.
  const calReminders = day.events.filter((e) => e.reminder)
    .map((e) => ({ text: e.time ? `${e.time} · ${e.title}` : e.title, when: 'calendar' }));
  const others = day.events.filter((e) => !e.holiday && !e.reminder);
  const events = others.length
    ? `<ul class="events">${others.map((e) => eventHtml(e, mode)).join('')}</ul>`
    : (holidays.length || day.notices?.length || calReminders.length ? '' : '<p class="empty">Nothing scheduled</p>');
  const notices = [...(day.notices || []), ...calReminders];
  const top = holidaysHtml(holidays) + noticesHtml(notices);
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
function todayHtml(day, mode) {
  if (!day) return '';
  const w = day.weather;
  const row = [];
  if (w) {
    row.push(`<span class="tw-icon" aria-hidden="true">${ICONS[w.icon] || ICONS.cloud}</span>`);
    row.push(`<span class="tw-temps"><b>${esc(w.hi)}°</b><span class="lo"> / ${esc(w.lo)}°</span></span>`);
    row.push(`<span class="tw-label">${esc(w.label)}</span>`);
    if (showRain(w)) row.push(`<span class="rain">${DROP}${esc(w.rain)}%</span>`);
  }
  // Air quality sits directly under the weather line; sunset to the right of both.
  const air = aqiHtml(day.aqi, mode);
  const main = row.length || air
    ? `<div class="tw-main">${row.length ? `<div class="tw-row">${row.join('')}</div>` : ''}${air ? `<div class="tw-air">${air}</div>` : ''}</div>`
    : '';
  const sunset = day.sunset
    ? `<div class="tw-sunset">${SUNSET}<span>Sunset<br><b>${esc(clockTime(day.sunset))}</b></span></div>` : '';
  if (!main && !sunset) return '';
  return `<div class="today-wx">${main}${sunset}</div>`;
}

// The whole week: header + seven days.
export function weekHtml(snap, { mode = 'web', today = snap.as_of } = {}) {
  const warn = (snap.warnings || []).length
    ? `<p class="warnings">${snap.warnings.map(esc).join(' · ')}</p>` : '';
  return `<header class="week-head"><div><h1>${esc(snap.title)}</h1>${warn}</div>` +
    `<div class="head-right"><span class="today-long">${esc(longDate(today))}</span>` +
    todayHtml(snap.days.find((d) => d.date === today), mode) +
    `<span class="updated">Updated ${esc(stampLabel(snap.built_at))}</span></div></header>` +
    `<div class="week">${snap.days.map((d) => dayHtml(d, { today, mode })).join('')}</div>`;
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
.week-head { display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 18px; border-bottom: 4px solid #000; }
h1 { font-size: 60px; font-weight: 700; letter-spacing: -0.5px; line-height: 1; }
.warnings { font-size: 22px; margin-top: 10px; color: #444; }
.head-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.today-long { font-size: 40px; font-weight: 700; }
.today-wx { display: flex; align-items: center; gap: 22px; font-size: 30px; white-space: nowrap; }
.tw-main { display: flex; flex-direction: column; gap: 4px; }
.tw-row { display: flex; align-items: center; gap: 16px; }
.tw-icon svg { width: 52px; height: 52px; display: block; }
.tw-temps b { font-weight: 700; }
.today-wx .rain, .today-wx .aqi { font-size: 30px; }
.aqi { display: inline-flex; align-items: center; gap: 8px; }
.aqi-face { width: 38px; height: 38px; flex: none; }
.today-wx .drop { width: 22px; height: 22px; }
.tw-air { padding-left: 0; }
/* The AQI face sits in the weather icon's column, the number under the temperatures. */
.tw-air .aqi { gap: 16px; }
.tw-air .aqi-face { width: 52px; height: 42px; }
.tw-air .aqi-warn > span:last-child { margin-left: -7px; }
.tw-sunset { display: flex; align-items: center; gap: 10px; padding-left: 22px; border-left: 3px solid #000;
  font-size: 26px; line-height: 1.15; }
.tw-sunset b { font-size: 32px; }
.sunset-icon { width: 44px; height: 44px; flex: none; }
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
`;
