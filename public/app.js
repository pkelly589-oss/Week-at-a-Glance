// Week at a Glance web page.
//
// What this file does:
//   1. Connects to Firebase (or to the local emulators when run on localhost).
//   2. Handles Google sign-in and checks the household allowlist.
//   3. Listens to status/latest and the week snapshot it points at, and draws
//      the week with lib/view.js (the same markup the e-ink image uses).
//   4. Shows banners for a failed update, a disconnected Google account, a
//      low display battery, or a display waiting to be approved.
//   5. "Refresh now" asks the refreshNow function to rebuild the week.
//
// Requirements doc: Web view (mobile and desktop).

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, connectAuthEmulator, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {
  getFunctions, connectFunctionsEmulator, httpsCallable,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { FIREBASE_CONFIG, EMULATOR_CONFIG } from './firebase-config.js';
import { isoDate, stampLabel, windowOf } from './lib/week.js';
import { weekHtml, esc } from './lib/view.js';

// ---------------------------------------------------------------------------
// Firebase setup
// ---------------------------------------------------------------------------

// On localhost we talk to the emulators started by `npm run dev`, never to the
// live project.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const config = LOCAL ? EMULATOR_CONFIG : FIREBASE_CONFIG;
if (!config) {
  document.getElementById('view-loading').innerHTML =
    '<p class="error">Firebase isn\'t configured yet. Paste your web config into firebase-config.js (see README).</p>';
  throw new Error('FIREBASE_CONFIG is not set');
}

const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);
const fns = getFunctions(app, 'us-west1');
if (LOCAL) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(fns, '127.0.0.1', 5001);
}

// ---------------------------------------------------------------------------
// Page state and helpers
// ---------------------------------------------------------------------------

const state = { status: null, device: null, week: null, weekId: null, scrolled: false };
let stops = [];

const $ = (id) => document.getElementById(id);
function show(view) {
  for (const id of ['view-loading', 'view-signin', 'view-denied', 'view-week']) $(id).hidden = id !== view;
  $('actions').hidden = view !== 'view-week';
}
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

$('signin').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  $('signin-error').hidden = true;
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      return signInWithRedirect(auth, provider);
    }
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      $('signin-error').textContent = `Sign-in failed (${e.code || e.message}).`;
      $('signin-error').hidden = false;
    }
  }
});
for (const id of ['signout', 'denied-signout']) $(id).addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  stops.forEach((s) => s());
  stops = [];
  Object.assign(state, { status: null, device: null, week: null, weekId: null, scrolled: false });
  if (!user) return show('view-signin');
  const email = (user.email || '').toLowerCase();
  let allowed = false;
  try { allowed = (await getDoc(doc(db, 'allowlist', email))).exists(); } catch { allowed = false; }
  if (!allowed) {
    $('denied-email').textContent = email;
    return show('view-denied');
  }
  show('view-loading');
  listen();
});

// ---------------------------------------------------------------------------
// Live data
// ---------------------------------------------------------------------------

function listen() {
  stops.push(onSnapshot(doc(db, 'status', 'latest'), (s) => {
    state.status = s.data() || null;
    const id = state.status?.week_id;
    if (id && id !== state.weekId) watchWeek(id);
    if (!id) render();
    renderBanners();
  }, onError));
  stops.push(onSnapshot(doc(db, 'status', 'device'), (s) => {
    state.device = s.data() || null;
    renderBanners();
  }, onError));
}

let stopWeek = null;
function watchWeek(id) {
  stopWeek?.();
  state.weekId = id;
  stopWeek = onSnapshot(doc(db, 'weeks', id), (s) => {
    state.week = s.data() || null;
    render();
  }, onError);
  stops.push(() => stopWeek?.());
}

function onError(e) {
  console.error(e);
  toast('Couldn\'t load the week. Check your connection.');
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function render() {
  show('view-week');
  const today = isoDate(Date.now());
  if (!state.week) {
    $('week').innerHTML = '<p class="muted center">No week has been built yet. Tap “Refresh now”, or wait for tonight\'s update.</p>';
    return;
  }
  $('week').innerHTML = weekHtml(state.week, { mode: 'web', today });
  openPastOnDesktop();
  // Mobile: start at today (Web view: "auto-scrolled to today").
  if (!state.scrolled) {
    state.scrolled = true;
    const el = document.querySelector('.day.today');
    if (el && matchMedia('(max-width: 899px)').matches) el.scrollIntoView({ block: 'start' });
  }
  renderBanners();
}

// Past days fold away on phones but stay open in the seven-column layout.
const wide = matchMedia('(min-width: 900px)');
function openPastOnDesktop() {
  for (const d of document.querySelectorAll('.past-fold')) d.open = wide.matches;
}
wide.addEventListener('change', openPastOnDesktop);

const LOW_BATTERY_PCT = 20;
const DEVICE_SILENT_MS = 2 * 864e5;

function renderBanners() {
  const out = [];
  const st = state.status, dev = state.device, today = isoDate(Date.now());
  if (st && st.ok === false) {
    out.push(['warn', `The last update failed (${esc(stampLabel(st.failed_at))}): ${esc(st.last_error)}`]);
  }
  if (st?.google_disconnected) {
    out.push(['warn', 'Google needs reconnecting: run <code>npm run connect-google</code> on your computer.']);
  }
  if (state.week && windowOf(today).id !== state.week.week_id && state.week.as_of < today) {
    out.push(['warn', `This shows ${esc(state.week.title.replace('Week of ', ''))}, built for an earlier day; today's hasn't been built yet.`]);
  }
  if (dev?.battery_pct != null && dev.battery_pct < LOW_BATTERY_PCT) {
    out.push(['warn', `The door display's battery is at about ${esc(dev.battery_pct)}%. Time to charge it.`]);
  }
  if (dev?.last_seen && Date.now() - dev.last_seen > DEVICE_SILENT_MS) {
    out.push(['info', `The door display hasn't checked in since ${esc(stampLabel(dev.last_seen))}.`]);
  }
  if (dev?.pending_mac) {
    out.push(['info', `A display (MAC <code>${esc(dev.pending_mac)}</code>) asked to connect. Approve it by adding <code>devices/${esc(dev.pending_mac)}</code> in Firestore (README, step 8).`]);
  }
  $('banners').innerHTML = out.map(([kind, html]) => `<div class="banner ${kind}">${html}</div>`).join('');
}

// Redraw just after midnight so "today" moves along on a page left open.
setInterval(() => { if (state.week) render(); }, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// Refresh now
// ---------------------------------------------------------------------------

$('refresh').addEventListener('click', async () => {
  const btn = $('refresh');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    const { data } = await httpsCallable(fns, 'refreshNow', { timeout: 300_000 })();
    toast(data?.warnings?.length ? `Updated, with warnings: ${data.warnings.join('; ')}` : 'Updated.');
  } catch (e) {
    toast(e.message || 'Refresh failed.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh now';
  }
});
