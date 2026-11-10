// End-to-end check of the web page in a real browser, against the local
// Firebase emulators. Run with `npm run test:e2e`.
//
// It seeds a household and a week, signs in through the emulator's fake
// Google sign-in, and checks the phone and desktop layouts. Screenshots go to
// test-results/ for a visual check.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { sampleSnapshot } from './fixtures.js';

const BASE = 'http://127.0.0.1:5000/';
const MEMBER = 'pete@example.com';
const STRANGER = 'stranger@example.com';
const TODAY = new Date('2026-11-10T12:00:00-08:00'); // Tuesday of the fixture week
mkdirSync('test-results', { recursive: true });

// ---- Seed the emulator with the Admin SDK (bypasses security rules) ---------
const req = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = req('firebase-admin/app');
const { getFirestore } = req('firebase-admin/firestore');
initializeApp({ projectId: 'demo-week-at-a-glance' });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

const snap = sampleSnapshot({ asOf: '2026-11-10' });
await db.doc(`allowlist/${MEMBER}`).set({ role: 'owner' });
await db.doc(`weeks/${snap.week_id}`).set(snap);
await db.doc('status/latest').set({ ok: true, week_id: snap.week_id, as_of: snap.as_of, built_at: snap.built_at, consecutive_failures: 0 });
await db.doc('status/device').set({ last_seen: TODAY.getTime() - 36e5, battery_pct: 14, battery_voltage: 3.51 });

// ---- Browser ---------------------------------------------------------------
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined, // optional: an already-installed Chrome
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.clock.setFixedTime(TODAY);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (p, name, fullPage = true) => p.screenshot({ path: `test-results/${name}.png`, fullPage });

async function signIn(p, email) {
  const [popup] = await Promise.all([p.waitForEvent('popup'), p.click('#signin')]);
  await popup.waitForLoadState();
  await popup.getByText('Add new account').click();
  await popup.locator('#email-input').fill(email);
  await popup.locator('#display-name-input').fill(email.split('@')[0]);
  await popup.getByText('Sign in with Google.com').click();
}

// 1. A stranger is turned away.
await page.goto(BASE);
await page.waitForSelector('#view-signin:not([hidden])');
await shot(page, 'web-1-signin');
await signIn(page, STRANGER);
await page.waitForSelector('#view-denied:not([hidden])');
assert.equal(await page.textContent('#denied-email'), STRANGER);
await page.click('#denied-signout');
await page.waitForSelector('#view-signin:not([hidden])');

// 2. The household sees the week, today marked, past days folded.
await signIn(page, MEMBER);
await page.waitForSelector('.day.today');
assert.equal(await page.textContent('.week-head .wk-of'), 'Mon – Sun');
assert.equal(await page.textContent('.week-head .wk-range'), 'Nov 9 – 15');
assert.equal(await page.getAttribute('.day.today', 'data-date'), '2026-11-10');
assert.equal(await page.locator('.day.past').count(), 1); // only yesterday
assert.equal(await page.locator('.day').count(), 7);
assert.equal(await page.locator('.past-fold[open]').count(), 0);
assert.match(await page.textContent('.day[data-date="2026-11-09"] summary'), /\d+ events/);
const tueTitles = await page.locator('.day.today .title').allTextContents();
assert.ok(tueTitles.includes('Dinner at Nido with Sam & Ari'));
assert.ok(!tueTitles.includes('Physical therapy'), 'private events stay hidden');

// 3. Badges and locations.
const dinner = page.locator('.day.today .ev', { hasText: 'Dinner at Nido' });
assert.deepEqual(await dinner.locator('.badge').allTextContents(), ['P', 'D']);
assert.equal(await dinner.locator('.loc').textContent(), 'Nido');
// Desktop and phone: every day's weather box is the same height (checked at desktop size below).
assert.equal(await page.locator('.day.today .ev', { hasText: 'Compost' }).locator('.loc').count(), 0);

// Home energy strip under the header.
assert.match(await page.textContent('.energy'), /Yesterday’s energy.*Solar 18\.4 kWh.*Self-powered 86%.*Battery 64%/);

// The credit line says where the header's AQI came from (the fixture has none named).
assert.match(await page.textContent('#credits'), /Air quality now: AirNow \(EPA\), or Open-Meteo/);

// 4. Low-battery banner.
assert.match(await page.textContent('#banners'), /battery is at about 14%/);
await shot(page, 'web-2-phone');
await shot(page, 'web-2-phone-viewport', false);

// 5. Desktop: seven columns, past days open.
await page.setViewportSize({ width: 1440, height: 1000 });
await page.waitForFunction(() => document.querySelectorAll('.past-fold[open]').length === 1);
const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.week')).gridTemplateColumns.split(' ').length);
const wxHeights = await page.evaluate(() => [...document.querySelectorAll('.day .wx')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height));
assert.equal(new Set(wxHeights).size, 1, `weather boxes differ: ${wxHeights}`);
assert.equal(cols, 7);
await shot(page, 'web-3-desktop', false);

// 6. A failed night shows a banner, and the page updates live.
await db.doc('status/latest').set({ ok: false, failed_at: TODAY.getTime(), last_error: 'No calendar could be read', google_disconnected: true }, { merge: true });
await page.waitForSelector('.banner.warn >> text=npm run connect-google');
await shot(page, 'web-4-failed', false);

// 7. Signing out.
await page.click('#signout');
await page.waitForSelector('#view-signin:not([hidden])');

assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
await browser.close();
console.log('e2e: all checks passed');
process.exit(0);
