// One-time Google sign-in for the nightly build (README, step 3).
//
//   npm run connect-google
//
// 1. Asks for the OAuth client ID and secret you created in Google Cloud.
// 2. Opens Google's consent page in your browser. Sign in as the account
//    that can see both calendars and allow read-only calendar access.
// 3. Stores the client ID, client secret and the resulting refresh token in
//    Secret Manager with `firebase functions:secrets:set`, then redeploys
//    nothing: run `npm run deploy` afterwards if the functions are live.
//
// Nothing is written into this folder. Requirements doc: Data sources;
// Reliability, privacy and errors ("secrets live in Secret Manager").

import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline/promises';

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, fallback) => (fallback || (await rl.question(q)).trim());

const clientId = await ask('OAuth client ID: ', process.env.GOOGLE_CLIENT_ID);
const clientSecret = await ask('OAuth client secret: ', process.env.GOOGLE_CLIENT_SECRET);
if (!clientId || !clientSecret) { console.error('Both are needed (README, step 3).'); process.exit(1); }

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('hex');

// Google sends the browser back to this temporary local address.
const server = http.createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const redirect = `http://127.0.0.1:${server.address().port}`;

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
  access_type: 'offline', prompt: 'consent', state,
  code_challenge: challenge, code_challenge_method: 'S256',
});

const code = await new Promise((resolve, reject) => {
  server.on('request', (req, res) => {
    const u = new URL(req.url, redirect);
    if (!u.searchParams.has('code') && !u.searchParams.has('error')) { res.end(); return; }
    const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(ok ? '<p>Connected. You can close this tab and go back to the terminal.</p>'
      : `<p>Something went wrong: ${u.searchParams.get('error') || 'state mismatch'}.</p>`);
    server.close();
    ok ? resolve(u.searchParams.get('code')) : reject(new Error(u.searchParams.get('error') || 'state mismatch'));
  });
  console.log('\nOpening Google sign-in. If no browser opens, visit:\n' + authUrl + '\n');
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawn(opener, [authUrl], { stdio: 'ignore', detached: true }).on('error', () => {});
});

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect,
    grant_type: 'authorization_code', code_verifier: verifier,
  }),
});
const tok = await res.json();
if (!tok.refresh_token) {
  console.error('Google returned no refresh token:', tok.error_description || tok.error || JSON.stringify(tok));
  process.exit(1);
}
if (!String(tok.scope || '').includes('calendar.readonly')) {
  console.error('Calendar access was not granted. Run this again and tick the calendar box.');
  process.exit(1);
}

// Hand each value to the Firebase CLI through a private temp file, deleted at once.
const dir = mkdtempSync(join(tmpdir(), 'waag-'));
try {
  for (const [name, value] of [
    ['GOOGLE_CLIENT_ID', clientId], ['GOOGLE_CLIENT_SECRET', clientSecret], ['GOOGLE_REFRESH_TOKEN', tok.refresh_token],
  ]) {
    const f = join(dir, name);
    writeFileSync(f, value, { mode: 0o600 });
    const r = spawnSync('npx', ['firebase', 'functions:secrets:set', name, '--data-file', f, '--force'], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`Couldn't store ${name}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  rl.close();
}
console.log('\nGoogle is connected. If the functions are already deployed, run `npm run deploy` so they pick up the new token.');
