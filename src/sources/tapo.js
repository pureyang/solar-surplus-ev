// Tapo smart plug (P100 / P110 / ...) over the local network, KLAP v2 protocol (no cloud calls).
// Login is your TP-Link / Tapo account email + password, used only to derive the session keys.
//   handshake1: send 16 random bytes, device answers its own 16 + a hash proving it knows the account
//   handshake2: prove the same back; both sides now share the keys
//   request:    AES-128-CBC + signature, counter in the URL. Sessions last ~24 h, then re-handshake.
// Firmware older than KLAP ("securePassthrough") is not supported; update the plug in the Tapo app.
import crypto from 'node:crypto';
import { log } from '../log.js';

const sha1 = (...b) => crypto.createHash('sha1').update(Buffer.concat(b)).digest();
const sha256 = (...b) => crypto.createHash('sha256').update(Buffer.concat(b)).digest();
const text = (s) => Buffer.from(s, 'utf8');
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n | 0); return b; };
const TIMEOUT_MS = 6000;

export class TapoDevice {
  constructor({ name, host, email, password }) {
    this.name = name;
    this.host = host;
    this.authHash = sha256(sha1(text(email)), sha1(text(password)));
    this.session = null;
    this.uuid = crypto.randomUUID();
    this.queue = Promise.resolve(); // one request at a time: the counter must stay in order
  }

  async post(path, body, cookie) {
    const res = await fetch(`http://${this.host}${path}`, {
      method: 'POST', body, headers: cookie ? { Cookie: cookie } : {}, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw Object.assign(new Error(`tapo ${this.name} ${path} ${res.status}`), { status: res.status });
    return { buf: Buffer.from(await res.arrayBuffer()), cookie: res.headers.get('set-cookie') };
  }

  async handshake() {
    const local = crypto.randomBytes(16);
    const h1 = await this.post('/app/handshake1', local);
    if (h1.buf.length !== 48) throw new Error(`tapo ${this.name}: unexpected handshake reply (${h1.buf.length} bytes; old firmware?)`);
    const remote = h1.buf.subarray(0, 16), serverHash = h1.buf.subarray(16);
    if (!serverHash.equals(sha256(local, remote, this.authHash))) {
      throw new Error(`tapo ${this.name}: account email/password rejected by the plug`);
    }
    const sid = /TP_SESSIONID=[^;]+/.exec(h1.cookie || '');
    if (!sid) throw new Error(`tapo ${this.name}: no session cookie`);
    const cookie = sid[0];
    await this.post('/app/handshake2', sha256(remote, local, this.authHash), cookie);

    const seed = [local, remote, this.authHash];
    const ivFull = sha256(text('iv'), ...seed);
    const timeout = Number(/TIMEOUT=(\d+)/.exec(h1.cookie || '')?.[1] || 86400);
    this.session = {
      cookie, key: sha256(text('lsk'), ...seed).subarray(0, 16), iv: ivFull.subarray(0, 12),
      sig: sha256(text('ldk'), ...seed).subarray(0, 28), seq: ivFull.readInt32BE(ivFull.length - 4),
      expires: Date.now() + Math.max(60, timeout - 120) * 1000,
    };
  }

  async send(method, params) {
    if (!this.session || Date.now() > this.session.expires) await this.handshake();
    const s = this.session;
    s.seq = (s.seq + 1) | 0;
    const iv = Buffer.concat([s.iv, i32(s.seq)]);
    const cipher = crypto.createCipheriv('aes-128-cbc', s.key, iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify({ method, params, requestTimeMils: Date.now(), terminalUUID: this.uuid })), cipher.final()]);
    const body = Buffer.concat([sha256(s.sig, i32(s.seq), enc), enc]);
    const r = await this.post(`/app/request?seq=${s.seq}`, body, s.cookie);
    const decipher = crypto.createDecipheriv('aes-128-cbc', s.key, iv);
    const out = JSON.parse(Buffer.concat([decipher.update(r.buf.subarray(32)), decipher.final()]).toString('utf8'));
    if (out.error_code) throw Object.assign(new Error(`tapo ${this.name} ${method} error ${out.error_code}`), { code: out.error_code });
    return out.result || {};
  }

  // Serialised, with one fresh handshake and retry if the session was dropped (device reboot, 403).
  request(method, params) {
    const run = async () => {
      try { return await this.send(method, params); } catch (e) {
        if (e.code != null || !(e.status === 403 || e.name === 'SyntaxError' || /decrypt|bad decrypt|wrong final block/i.test(e.message))) throw e;
        this.session = null;
        return this.send(method, params);
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async info() {
    const r = await this.request('get_device_info');
    return { on: Boolean(r.device_on), model: r.model, nickname: r.nickname ? Buffer.from(r.nickname, 'base64').toString('utf8') : null, rssi: r.rssi ?? null, overheated: Boolean(r.overheated) };
  }

  // P110/P115 only; null on plugs without energy metering.
  async powerW() {
    try {
      const r = await this.request('get_energy_usage');
      return typeof r.current_power === 'number' ? r.current_power / 1000 : null; // mW -> W
    } catch (e) {
      if (e.code != null) return null;
      throw e;
    }
  }

  async setOn(on) {
    await this.request('set_device_info', { device_on: Boolean(on) });
    log.info('tapo', `${this.name} turned ${on ? 'on' : 'off'}`);
  }
}
