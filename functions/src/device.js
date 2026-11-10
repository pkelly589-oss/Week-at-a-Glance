// The self-hosted ("BYOS") API the TRMNL X talks to, served under /api/ on the
// web page's own address:
//
//   GET  /api/setup          first boot: swaps the device's MAC for an API key
//   GET  /api/display        every wake: which image to show, and how long to sleep
//   POST /api/log            the device reporting a problem
//   GET  /api/image/<name>   the PNG itself
//
// Only a device whose MAC address has been added to Firestore (devices/<MAC>,
// see README) gets a key. Requirements doc: Hardware > Refresh; Architecture.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { lastRefreshAt, secondsToNextRefresh } from '../shared/week.js';

// While the picture for the latest refresh isn't ready yet (its build failed
// or is still retrying), check again this often, for up to 6 hours, and never
// later than the next scheduled refresh.
export const RETRY_SECONDS = 15 * 60;
export const RETRY_WINDOW_MS = 6 * 36e5;
// The build runs 5 minutes before each refresh; anything built since 15
// minutes before it counts as this refresh's image.
const BUILD_LEAD_MS = 15 * 60 * 1000;

const normMac = (s) => String(s || '').trim().toUpperCase();
const same = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

// Li-Po: about 4.2 V full, 3.4 V empty. A rough guide for the web page's
// low-battery warning (Reliability > Cost and maintenance).
export function batteryPercent(volts) {
  const v = Number(volts);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(((v - 3.4) / (4.2 - 3.4)) * 100)));
}

// How long the device should sleep: until the next refresh (on the hour from
// 7am to midnight). If the image for the latest refresh isn't there yet (the
// build failed or is still retrying), check back every 15 minutes for up to 6
// hours after it, never sleeping past the next refresh.
export function refreshRate(now, latestBuiltAt) {
  const due = lastRefreshAt(now);
  const fresh = latestBuiltAt != null && latestBuiltAt >= due - BUILD_LEAD_MS;
  const next = secondsToNextRefresh(now);
  if (!fresh && now < due + RETRY_WINDOW_MS) return Math.min(RETRY_SECONDS, next);
  return next;
}

async function latestRender(db) {
  const q = await db.collection('renders').orderBy('created_at', 'desc').limit(1).get();
  return q.empty ? null : { name: q.docs[0].id, ...q.docs[0].data() };
}

export function makeDeviceHandler({ db, bucket, now = () => Date.now() }) {
  async function authed(req) {
    const mac = normMac(req.get('ID'));
    if (!mac) return null;
    const snap = await db.doc(`devices/${mac}`).get();
    if (!snap.exists || !same(snap.data().api_key, req.get('Access-Token'))) return null;
    return { mac, ref: snap.ref };
  }

  const baseUrl = (req) => `https://${req.get('x-forwarded-host') || req.get('host')}`;

  return async function handler(req, res) {
    const path = req.path.replace(/^\/api/, '');
    try {
      if (path === '/setup') {
        const mac = normMac(req.get('ID'));
        const snap = mac ? await db.doc(`devices/${mac}`).get() : null;
        if (!snap?.exists) {
          console.warn('Setup from unknown device', mac);
          // Shown on the web page so you can find the MAC to approve.
          if (mac) await db.doc('status/device').set({ pending_mac: mac, pending_at: now() }, { merge: true });
          return res.status(404).json({ status: 404, message: `Add devices/${mac || '<MAC>'} in Firestore first (see README)` });
        }
        let key = snap.data().api_key;
        if (!key) {
          key = randomBytes(24).toString('base64url');
          await snap.ref.set({ api_key: key, set_up_at: now() }, { merge: true });
        }
        return res.json({
          status: 200, api_key: key, friendly_id: mac.replace(/:/g, '').slice(-6),
          image_url: `${baseUrl(req)}/eink/waiting.png`, message: 'Week at a Glance',
        });
      }

      if (path === '/display') {
        const dev = await authed(req);
        if (!dev) return res.status(401).json({ status: 401, error: 'Unknown device or key' });
        const volts = req.get('Battery-Voltage');
        await db.doc('status/device').set({
          last_seen: now(),
          battery_voltage: volts ? Number(volts) : null,
          battery_pct: batteryPercent(volts),
          rssi: req.get('RSSI') ? Number(req.get('RSSI')) : null,
          firmware: req.get('FW-Version') || null,
        }, { merge: true });

        const r = await latestRender(db);
        const common = { status: 0, refresh_rate: refreshRate(now(), r?.created_at), update_firmware: false,
          reset_firmware: false, special_function: 'none' };
        if (!r) return res.json({ ...common, image_url: `${baseUrl(req)}/eink/waiting.png`, filename: 'waiting' });
        return res.json({
          ...common,
          image_url: `${baseUrl(req)}/api/image/${r.name}.png?t=${r.token}`,
          filename: r.name,
        });
      }

      if (path === '/log') {
        const dev = await authed(req);
        if (!dev) return res.status(401).json({ status: 401 });
        const logs = (req.body?.logs || []).slice(0, 20).map((l) => String(l?.message || JSON.stringify(l)).slice(0, 500));
        console.warn('TRMNL log', dev.mac, logs);
        await db.doc('status/device').set({ last_log: logs.at(-1) || null, last_log_at: now() }, { merge: true });
        return res.json({ status: 200 });
      }

      const m = path.match(/^\/image\/([A-Za-z0-9-]{1,40})\.png$/);
      if (m) {
        const snap = await db.doc(`renders/${m[1]}`).get();
        if (!snap.exists || !same(snap.data().token, req.query.t)) return res.status(404).send('Not found');
        const [png] = await bucket.file(snap.data().path).download();
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'private, max-age=86400');
        return res.send(png);
      }

      return res.status(404).json({ status: 404 });
    } catch (e) {
      console.error('Device API error', path, e);
      return res.status(500).json({ status: 500 });
    }
  };
}
