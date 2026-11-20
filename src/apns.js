// iPhone pushes through Apple's push service (APNs), using node:http2 and an ES256 token so there's no new
// dependency. Needs a key from an Apple Developer Program account (README, "iPhone app").
import crypto from 'node:crypto';
import fs from 'node:fs';
import http2 from 'node:http2';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';

const c = config.apns;
const HOSTS = { production: 'api.push.apple.com', sandbox: 'api.sandbox.push.apple.com' };
const TIMEOUT_MS = 15_000;
const TOKEN_MAX_AGE_S = 50 * 60; // Apple wants a new token at least hourly and no more than every 20 min
const devicesFile = path.join(config.dataDir, 'ios-devices.json');

let devices = [];
try { devices = JSON.parse(fs.readFileSync(devicesFile, 'utf8')); } catch {}
function saveDevices() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(devicesFile, JSON.stringify(devices, null, 2), { mode: 0o600 });
}

export const apnsConfigured = () => Boolean(c.keyFile && c.keyId && c.teamId && c.topic);
export const deviceCount = () => devices.length;

// From the app: { token: hex, env: 'sandbox' | 'production', name }. Returns false if the token looks wrong.
export function registerDevice({ token, env, name } = {}) {
  if (!/^[0-9a-f]{32,200}$/i.test(String(token))) return false;
  const d = { token: String(token).toLowerCase(), env: env === 'sandbox' ? 'sandbox' : 'production', name: String(name || 'iPhone').slice(0, 64), at: Math.floor(Date.now() / 1000) };
  devices = [...devices.filter((x) => x.token !== d.token), d];
  saveDevices();
  log.info('apns', `registered ${d.name}, ${devices.length} device(s)`);
  return true;
}

let provider = null, keyObject = null;
function providerToken() {
  const now = Math.floor(Date.now() / 1000);
  if (provider && now - provider.iat < TOKEN_MAX_AGE_S) return provider.value;
  keyObject ??= crypto.createPrivateKey(fs.readFileSync(path.resolve(config.root, c.keyFile)));
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signed = `${part({ alg: 'ES256', kid: c.keyId })}.${part({ iss: c.teamId, iat: now })}`;
  const sig = crypto.sign('sha256', Buffer.from(signed), { key: keyObject, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  provider = { iat: now, value: `${signed}.${sig}` };
  return provider.value;
}

function post(env, token, payload, headers) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${c.host || HOSTS[env]}`);
    const timer = setTimeout(() => client.destroy(new Error('APNs timed out')), TIMEOUT_MS);
    const fail = (e) => { clearTimeout(timer); client.destroy(); reject(e); };
    client.on('error', fail);
    const req = client.request({ ':method': 'POST', ':path': `/3/device/${token}`, authorization: `bearer ${providerToken()}`, ...headers });
    let status = 0, data = '';
    req.setEncoding('utf8');
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (d) => { data += d; });
    req.on('error', fail);
    req.on('end', () => {
      clearTimeout(timer);
      client.close();
      let reason = null;
      try { reason = JSON.parse(data).reason ?? null; } catch {}
      resolve({ status, reason });
    });
    req.end(JSON.stringify(payload));
  });
}

async function deliver(device, payload, headers) {
  let r = await post(device.env, device.token, payload, headers);
  // Xcode builds and TestFlight builds use different APNs servers. A token sent to the wrong one is "bad", so try the other.
  if (r.status === 400 && r.reason === 'BadDeviceToken') {
    const other = device.env === 'sandbox' ? 'production' : 'sandbox';
    r = await post(other, device.token, payload, headers);
    if (r.status === 200) { device.env = other; saveDevices(); }
  }
  // The app was deleted or the token no longer works here: forget the phone.
  if (r.status === 410 || ['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'].includes(r.reason)) {
    devices = devices.filter((x) => x.token !== device.token);
    saveDevices();
    log.warn('apns', `removed ${device.name}: ${r.reason || r.status}`);
  }
  if (r.reason === 'ExpiredProviderToken') provider = null;
  return r;
}

// Never throws. Returns { sent, error }, where sent counts the phones Apple accepted.
export async function pushToDevices({ title, body, collapseId }) {
  if (!apnsConfigured()) return { sent: 0, error: 'APNs key is not set up on the server' };
  if (!devices.length) return { sent: 0, error: 'No iPhone has registered yet' };
  const payload = { aps: { alert: { title, body }, sound: 'default' } };
  const headers = {
    'apns-topic': c.topic,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600), // an hour late is still useful; later isn't
    ...(collapseId ? { 'apns-collapse-id': collapseId } : {}),
  };
  const results = await Promise.all(devices.map((d) => deliver(d, payload, headers).catch((e) => ({ status: 0, reason: (e.cause && e.cause.code) || e.code || e.message }))));
  const sent = results.filter((r) => r.status === 200).length;
  const failed = results.find((r) => r.status !== 200);
  return { sent, error: failed ? `APNs ${failed.status || ''} ${failed.reason || ''}`.replace(/\s+/g, ' ').trim() : null };
}
