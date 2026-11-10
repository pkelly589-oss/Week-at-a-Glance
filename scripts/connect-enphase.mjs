// One-time Enphase connection for the solar and battery strip (README, step 4).
//
//   npm run connect-enphase
//
// 1. Asks for the API key, client ID and client secret of the app you made at
//    developer-v4.enphase.com (free "Watt" plan).
// 2. Opens Enphase's approval page. Sign in with your Enlighten homeowner
//    account and approve; the page then shows a code. Paste it here.
// 3. Finds your system, checks the energy figures can be read, and stores
//    everything as one secret, ENPHASE, with `firebase functions:secrets:set`.
//    Run `npm run deploy` afterwards.
//
// To deploy without solar figures, store "{}" instead (README, step 4).
// Nothing is written into this folder.

import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline/promises';

const API = 'https://api.enphaseenergy.com';
const REDIRECT = `${API}/oauth/redirect_uri`; // Enphase's own page that displays the code

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, fallback) => (fallback || (await rl.question(q)).trim());

const apiKey = await ask('Enphase API key: ', process.env.ENPHASE_API_KEY);
const clientId = await ask('Enphase client ID: ', process.env.ENPHASE_CLIENT_ID);
const clientSecret = await ask('Enphase client secret: ', process.env.ENPHASE_CLIENT_SECRET);
if (!apiKey || !clientId || !clientSecret) { console.error('All three are needed (README, step 4).'); process.exit(1); }
const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

const authUrl = `${API}/oauth/authorize?` + new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT });
console.log('\nOpening Enphase. Sign in with your Enlighten account and approve. If no browser opens, visit:\n' + authUrl + '\n');
const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
spawn(opener, [authUrl], { stdio: 'ignore', detached: true }).on('error', () => {});
const code = await ask('Code shown after approving: ');

const tokRes = await fetch(`${API}/oauth/token?` + new URLSearchParams({ grant_type: 'authorization_code', redirect_uri: REDIRECT, code }), {
  method: 'POST', headers: { Authorization: basic },
});
const tok = await tokRes.json().catch(() => ({}));
if (!tok.access_token || !tok.refresh_token) {
  console.error('Enphase returned no tokens:', tok.error_description || tok.error || tokRes.status);
  process.exit(1);
}

const get = async (path) => {
  const res = await fetch(`${API}/api/v4/${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`, {
    headers: { Authorization: `Bearer ${tok.access_token}`, key: apiKey },
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
};

const list = await get('systems');
const systems = list.body.systems || [];
if (!list.ok || !systems.length) { console.error(`Couldn't list your systems (${list.status}).`); process.exit(1); }
let system = systems[0];
if (systems.length > 1) {
  systems.forEach((s, i) => console.log(`  ${i + 1}. ${s.name} (${s.system_id})`));
  system = systems[(Number(await ask('Which system? ')) || 1) - 1] || systems[0];
}
console.log(`Using system ${system.system_id}.`);

// Check each figure the display uses, so a missing permission shows up now.
for (const [path, what] of [
  ['energy_lifetime', 'solar production (Site Level Production Monitoring)'],
  ['consumption_lifetime', 'home use (Site Level Consumption Monitoring)'],
  ['battery_lifetime', 'battery (Site Level Consumption Monitoring)'],
]) {
  const r = await get(`systems/${system.system_id}/${path}`);
  console.log(`  ${r.ok ? 'ok  ' : `${r.status} `} ${what}`);
}

const dir = mkdtempSync(join(tmpdir(), 'waag-'));
try {
  const f = join(dir, 'ENPHASE');
  writeFileSync(f, JSON.stringify({
    api_key: apiKey, client_id: clientId, client_secret: clientSecret,
    refresh_token: tok.refresh_token, system_id: system.system_id,
  }), { mode: 0o600 });
  const r = spawnSync('npx', ['firebase', 'functions:secrets:set', 'ENPHASE', '--data-file', f, '--force'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error("Couldn't store ENPHASE");
} finally {
  rmSync(dir, { recursive: true, force: true });
  rl.close();
}
console.log('\nEnphase is connected. Run `npm run deploy` so the functions pick it up.');
