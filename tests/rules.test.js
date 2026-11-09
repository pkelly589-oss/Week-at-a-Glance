// Security rules tests. Run with `npm test` (starts the Firestore emulator).
import { test, before, beforeEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';

const MEMBER = 'pete@example.com';
const STRANGER = 'stranger@example.com';
let env;

const as = (email, verified = true) =>
  env.authenticatedContext(email.split('@')[0], { email, email_verified: verified }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-week-at-a-glance',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'allowlist', MEMBER), { role: 'owner' });
    await setDoc(doc(db, 'allowlist', 'david@example.com'), { role: 'member' });
    await setDoc(doc(db, 'weeks', '2026-11-08'), { week_id: '2026-11-08', days: [] });
    await setDoc(doc(db, 'status', 'latest'), { ok: true, week_id: '2026-11-08' });
    await setDoc(doc(db, 'config', 'household'), { people: [] });
    await setDoc(doc(db, 'devices', 'AA:BB'), { api_key: 'k' });
    await setDoc(doc(db, 'renders', 'week-1'), { token: 't' });
  });
});

after(async () => { await env.cleanup(); });

test('signed-out visitors can read nothing', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'weeks', '2026-11-08')));
  await assertFails(getDoc(doc(db, 'status', 'latest')));
});

test('accounts not on the allowlist, or unverified, can read nothing', async () => {
  await assertFails(getDoc(doc(as(STRANGER), 'weeks', '2026-11-08')));
  await assertFails(getDoc(doc(as(MEMBER, false), 'weeks', '2026-11-08')));
});

test('the household can read the week and status, and nothing else', async () => {
  const db = as(MEMBER);
  await assertSucceeds(getDoc(doc(db, 'weeks', '2026-11-08')));
  await assertSucceeds(getDoc(doc(db, 'status', 'latest')));
  await assertSucceeds(getDoc(doc(db, 'allowlist', MEMBER)));
  await assertFails(getDoc(doc(db, 'allowlist', 'david@example.com')));
  await assertFails(getDocs(collection(db, 'allowlist')));
  await assertFails(getDoc(doc(db, 'config', 'household')));
  await assertFails(getDoc(doc(db, 'devices', 'AA:BB')));
  await assertFails(getDoc(doc(db, 'renders', 'week-1')));
});

test('browsers cannot write anything', async () => {
  const db = as(MEMBER);
  await assertFails(setDoc(doc(db, 'weeks', '2026-11-08'), { hacked: true }));
  await assertFails(setDoc(doc(db, 'status', 'latest'), { ok: false }));
  await assertFails(setDoc(doc(db, 'allowlist', STRANGER), { role: 'owner' }));
});
