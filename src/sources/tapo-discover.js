// Finds Tapo devices on the LAN, no cloud, no IP typing.
//   udpProbe: TP-Link's own discovery broadcast (UDP 20002). Devices answer with model, MAC, IP.
//   sweep:    fallback for devices/routers that ignore the broadcast: ask every address in the local /24
//             for a KLAP handshake on port 80. Only Tapo plugs answer that with 48 bytes.
// Then each find is logged in with the Tapo account to get its name (the nickname from the Tapo app).
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import os from 'node:os';
import zlib from 'node:zlib';
import { TapoDevice } from './tapo.js';

const UDP_PORT = 20002;
const SKIP_IFACE = /vethernet|wsl|virtualbox|vmware|hyper-v|docker|loopback|bluetooth|tailscale|zerotier/i;

export const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const ip2n = (ip) => ip.split('.').reduce((a, o) => ((a << 8) | Number(o)) >>> 0, 0);
const n2ip = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

// Real LAN interfaces: [{ address, broadcast, hosts[] }]. Wide masks are cut to the /24 we sit in.
export function lanInterfaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (SKIP_IFACE.test(name)) continue;
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const addr = ip2n(a.address);
      const prefix = Math.max(24, a.netmask ? ip2n(a.netmask).toString(2).replace(/0/g, '').length : 24);
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      const net = (addr & mask) >>> 0, bc = (net | (~mask >>> 0)) >>> 0;
      const hosts = [];
      for (let n = net + 1; n < bc; n++) if (n !== addr) hosts.push(n2ip(n));
      out.push({ name, address: a.address, broadcast: n2ip(bc), hosts });
    }
  }
  return out;
}

function probePacket() {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const body = Buffer.from(JSON.stringify({ params: { rsa_key: publicKey.export({ type: 'spki', format: 'pem' }) } }));
  const h = Buffer.alloc(16);
  h[0] = 2; h[1] = 0; h.writeUInt16BE(1, 2); h.writeUInt16BE(body.length, 4); h[6] = 0x11; h[7] = 0;
  h.writeUInt32BE(crypto.randomBytes(4).readUInt32BE(), 8);
  h.writeUInt32BE(0x5a6b7c8d, 12);
  const pkt = Buffer.concat([h, body]);
  pkt.writeUInt32BE(zlib.crc32(pkt) >>> 0, 12);
  return pkt;
}

// -> [{ host, mac, model, type, encrypt, deviceId }]
export function udpProbe({ targets, port = UDP_PORT, timeoutMs = 3500 } = {}) {
  const to = targets || ['255.255.255.255', ...lanInterfaces().map((i) => i.broadcast)];
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket('udp4');
    const done = () => { try { sock.close(); } catch { /* already closed */ } resolve([...found.values()]); };
    sock.on('error', done);
    sock.on('message', (msg, rinfo) => {
      try {
        const r = JSON.parse(msg.subarray(16).toString('utf8')).result;
        if (!r) return;
        const host = r.ip || rinfo.address;
        found.set(host, {
          host, mac: r.mac || null, model: r.device_model || null, type: r.device_type || null,
          encrypt: r.mgt_encrypt_schm?.encrypt_type || null, deviceId: r.device_id || null,
        });
      } catch { /* not a TP-Link reply */ }
    });
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch { /* loopback targets in tests */ }
      const pkt = probePacket();
      const send = () => { for (const t of to) sock.send(pkt, port, t, () => {}); };
      send();
      setTimeout(send, 1200);
      setTimeout(done, timeoutMs);
    });
  });
}

// -> [{ host }] for every address that answers a Tapo KLAP handshake on `port`.
export async function sweep({ hosts, port = 80, concurrency = 64, timeoutMs = 1500 } = {}) {
  const list = hosts || [...new Set(lanInterfaces().flatMap((i) => i.hosts))];
  const found = [];
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const h = list[next++];
      try {
        const res = await fetch(`http://${h}${port === 80 ? '' : `:${port}`}/app/handshake1`, {
          method: 'POST', body: crypto.randomBytes(16), signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok && (await res.arrayBuffer()).byteLength === 48) found.push({ host: h });
      } catch { /* nothing there */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return found;
}

// Everything on the LAN that talks Tapo, logged in and named. -> [{ name, host, model, nickname, on, powerW, mac, auth, error }]
export async function discover({ email, password, udp = {}, scan = {} } = {}) {
  const [u, s] = await Promise.all([udpProbe(udp), sweep(scan)]);
  const byHost = new Map();
  for (const d of s) byHost.set(d.host, { host: d.host });
  for (const d of u) byHost.set(d.host, { ...byHost.get(d.host), ...d });
  const rows = await Promise.all([...byHost.values()].map(async (d) => {
    const row = { host: d.host, mac: d.mac || null, model: d.model || null, type: d.type || null, encrypt: d.encrypt || null, nickname: null, on: null, powerW: null, auth: false, error: null };
    if (row.encrypt && row.encrypt !== 'KLAP') { row.error = `uses ${row.encrypt} encryption (update the plug in the Tapo app)`; return row; }
    if (!email || !password) { row.error = 'no account to log in with'; return row; }
    try {
      const dev = new TapoDevice({ name: d.host, host: d.host, email, password });
      const i = await dev.info();
      Object.assign(row, { auth: true, model: i.model || row.model, nickname: i.nickname, on: i.on, powerW: await dev.powerW().catch(() => null) });
    } catch (e) {
      row.error = e.message.replace(/^tapo \S+:? ?/, '');
    }
    return row;
  }));
  rows.sort((a, b) => ip2n(a.host.split(':')[0]) - ip2n(b.host.split(':')[0]));
  const used = new Set();
  for (const r of rows) {
    let n = slug(r.nickname) || slug(`${r.model || 'tapo'}-${r.host.split('.').pop()}`);
    for (let k = 2; used.has(n); k++) n = `${slug(r.nickname) || 'tapo'}-${k}`;
    used.add(n); r.name = n;
  }
  return rows;
}
