// Solar EV tablet / phone app: efficiency first, then today's solar and the cars.
// Phone shows one screen at a time (bottom tabs); tablet landscape shows everything at once (app.css).
'use strict';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const get = (url) => fetch(url, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
const kw = (w) => `${(Math.abs(w) / 1000).toFixed(1)} kW`;
const kwhTxt = (wh) => `${(wh / 1000).toFixed(1)} kWh`;
const clock = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COL = { g: '#46d07a', w: '#f2c94c', r: '#ff6f5e' };
const isTablet = () => matchMedia('(min-width: 700px)').matches;

document.documentElement.classList.add(/android/i.test(navigator.userAgent) ? 'android' : 'ios');

// ---------- tabs (phone)
const main = $('main');
function setTab(t) {
  main.dataset.tab = t;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false');
  store.set('sse-tab', t);
  drawAll();
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));

// ---------- efficiency: 1 - exported / produced, per day / week / month
let rows = [];           // [{ day, produced, consumed, exported, ev }]
let mode = store.get('sse-mode', 'day');
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function bucket(rs, label) {
  const b = { label, pv: 0, exp: 0, home: 0, ev: 0, unsplit: 0 };
  for (const r of rs) {
    b.pv += r.produced; b.exp += r.exported;
    if (r.ev == null) b.unsplit += r.consumed;
    else { b.ev += r.ev; b.home += Math.max(0, r.consumed - r.ev); }
  }
  return b;
}
const eff = (b) => (b.pv > 0 ? Math.round((1 - b.exp / b.pv) * 100) : null);
const cls = (p) => (p >= 90 ? 'g' : p >= 70 ? 'w' : 'r');

function series(m, big) {
  if (!rows.length) return [];
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  if (m === 'day') {
    return rows.slice(big ? -21 : -14).map((r) => {
      const d = parseDay(r.day);
      return bucket([r], d.getDate() === 1 ? `${MON[d.getMonth()]} 1` : String(d.getDate()));
    });
  }
  if (m === 'week') {
    // Rolling 7-day weeks ending today, so the last bar is always "this week so far".
    const n = big ? 12 : 8, groups = Array.from({ length: n }, () => []);
    for (const r of rows) {
      const k = Math.floor(Math.round((today - parseDay(r.day)) / 86400000) / 7);
      if (k < n) groups[n - 1 - k].push(r);
    }
    return groups.map((g, i) => {
      const start = new Date(today); start.setDate(start.getDate() - (n - 1 - i) * 7 - 6);
      return bucket(g, `${MON[start.getMonth()]} ${start.getDate()}`);
    }).filter((b) => b.pv > 0);
  }
  const by = new Map();
  for (const r of rows) { const k = r.day.slice(0, 7); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  return [...by.entries()].slice(big ? -12 : -6).map(([k, rs]) => bucket(rs, MON[Number(k.slice(5)) - 1]));
}

// One graph: pale produced bar, home + EV stacked in front of it, efficiency % above. One kWh scale.
function effChart(m, W, H, big) {
  const s = series(m, big);
  if (!s.length) return '';
  const fs = big ? 15 : 12, top = fs * 2.2, bottom = fs * 2, left = fs * 2.6, right = 4;
  let max = 0;
  for (const b of s) max = Math.max(max, b.pv, b.home + b.ev + b.unsplit);
  const kmax = max / 1000, step = [5, 10, 20, 50, 100, 200, 250, 500, 1000, 2000].find((x) => kmax / x <= 4) || 5000;
  const topK = Math.max(step, Math.ceil(kmax / step) * step);
  const y = (wh) => top + (1 - wh / 1000 / topK) * (H - top - bottom);
  const slot = (W - left - right) / s.length;
  const every = slot < fs * 2.8 ? 2 : 1;
  let g = '<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
    + '<rect width="5" height="5" fill="#3fbf9b40"/><rect width="2.5" height="5" fill="#3fbf9b"/></pattern></defs>';
  for (let k = 0; k <= topK; k += step) {
    const yy = y(k * 1000).toFixed(1);
    g += `<line x1="${left}" y1="${yy}" x2="${W - right}" y2="${yy}" stroke="#233240" stroke-width="${k ? 0.7 : 1.2}"/>`
      + `<text x="${left - 6}" y="${(+yy + fs * 0.35).toFixed(1)}" fill="#8ea3b4" font-size="${fs - 1}" text-anchor="end">${k}</text>`;
  }
  g += `<text x="${left - 6}" y="${(top - fs * 1.1).toFixed(1)}" fill="#8ea3b4" font-size="${fs - 1}" text-anchor="end">kWh</text>`;
  s.forEach((b, i) => {
    const cx = left + slot * (i + 0.5), gw = slot * 0.8, uw = slot * 0.46, base = y(0), last = i === s.length - 1;
    g += `<rect x="${(cx - gw / 2).toFixed(1)}" y="${y(b.pv).toFixed(1)}" width="${gw.toFixed(1)}" height="${(base - y(b.pv)).toFixed(1)}" fill="#ffb81f2e"/>`
      + `<rect x="${(cx - gw / 2).toFixed(1)}" y="${y(b.pv).toFixed(1)}" width="${gw.toFixed(1)}" height="${big ? 3 : 2}" fill="#ffb81f"/>`;
    let acc = 0;
    for (const [v, fill] of [[b.home, '#3fbf9b'], [b.unsplit, 'url(#hatch)'], [b.ev, '#5b93ff']]) {
      if (!v) continue;
      const y1 = y(acc + v), y0 = y(acc);
      g += `<rect x="${(cx - uw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${uw.toFixed(1)}" height="${(y0 - y1).toFixed(1)}" fill="${fill}"/>`;
      acc += v;
    }
    const e = eff(b), ty = Math.min(y(b.pv), y(acc)) - fs * 0.5;
    const show = (s.length - 1 - i) % every === 0;
    if (show) g += `<text x="${cx.toFixed(1)}" y="${ty.toFixed(1)}" fill="${COL[cls(e)]}" font-size="${fs}" font-weight="700" text-anchor="middle">${e}</text>`;
    if (show) g += `<text x="${cx.toFixed(1)}" y="${(H - fs * 0.6).toFixed(1)}" fill="${last ? '#eef4f8' : '#8ea3b4'}" font-size="${fs - 1}" text-anchor="middle"${last ? ' font-weight="700"' : ''}>${b.label}</text>`;
  });
  $('luKey').hidden = !s.some((b) => b.unsplit > 0);
  const desc = s.map((b) => `${b.label} ${eff(b)}%`).join(', ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Solar used at home by ${m}: ${desc}">${g}</svg>`;
}

function drawEff() {
  if (!rows.length) return;
  const todayKey = new Date().toLocaleDateString('en-CA'), monthKey = todayKey.slice(0, 7);
  const t = bucket(rows.filter((r) => r.day === todayKey)), w = bucket(rows.slice(-7)), mo = bucket(rows.filter((r) => r.day.startsWith(monthKey)));
  const n = (b, label) => { const e = eff(b); return `<div><b class="${e == null ? '' : cls(e)}">${e == null ? '–' : e + '%'}</b><span>${label}</span></div>`; };
  $('effNums').innerHTML = n(t, 'Today') + n(w, 'Last 7 days') + n(mo, MON[new Date().getMonth()]);
  $('effSub').textContent = t.pv > 0 ? `${kwhTxt(t.pv - t.exp)} of ${kwhTxt(t.pv)} kept today` : '';
  for (const b of document.querySelectorAll('.mseg button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  const el = $('effChart');
  if (el.offsetParent === null) return;
  el.innerHTML = effChart(mode, el.clientWidth, el.clientHeight, isTablet());
}
for (const b of document.querySelectorAll('.mseg button')) {
  b.addEventListener('click', () => { mode = b.dataset.mode; store.set('sse-mode', mode); drawEff(); });
}

// ---------- today's solar: actual so far (solid) + forecast ahead (dashed), excess shaded
let actual = null, app = null, live = null;

function sunChart(W, H, big) {
  const now = Date.now() / 1000, fs = big ? 13 : 12;
  const act = [];
  if (actual) actual.t.forEach((t, i) => { if (t + 900 <= now + 900 && actual.pv[i] != null) act.push({ ts: t + 450, pv: actual.pv[i], load: actual.load[i] }); });
  const fc = (app?.plan?.steps || []).filter((s) => s.ts + 900 > now).map((s) => ({ ts: Math.max(s.ts, now), pv: s.pv, load: s.load }));
  const all = [...act, ...fc];
  if (!all.length) return '';
  const sunny = all.filter((p) => p.pv > 50);
  const day0 = new Date().setHours(0, 0, 0, 0) / 1000;
  const x0 = sunny.length ? Math.min(sunny[0].ts - 3600, day0 + 7 * 3600) : day0 + 6 * 3600;
  const x1 = sunny.length ? Math.max(sunny.at(-1).ts + 3600, day0 + 17 * 3600) : day0 + 20 * 3600;
  const pts = all.filter((p) => p.ts >= x0 && p.ts <= x1);
  const maxKw = Math.max(2, ...pts.map((p) => Math.max(p.pv, p.load) / 1000)) * 1.1;
  const L = 6, R = W - 6, T = 8, B = H - fs - 6;
  const X = (ts) => L + ((ts - x0) / (x1 - x0)) * (R - L), Y = (w) => B - (w / 1000 / maxKw) * (B - T);
  const line = (a, k) => a.filter((p) => p.ts >= x0 && p.ts <= x1).map((p, i) => `${i ? 'L' : 'M'}${X(p.ts).toFixed(1)} ${Y(p[k]).toFixed(1)}`).join(' ');
  let g = `<line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="#233240"/>`;
  for (let h = 6; h <= 21; h += 3) {
    const ts = day0 + h * 3600;
    if (ts <= x0 || ts >= x1) continue;
    const x = X(ts).toFixed(1);
    g += `<line x1="${x}" y1="${T}" x2="${x}" y2="${B}" stroke="#233240" stroke-width="0.6"/><text x="${x}" y="${H - 3}" fill="#8ea3b4" font-size="${fs}" text-anchor="middle">${h > 12 ? h - 12 : h}${h >= 12 ? 'p' : 'a'}</text>`;
  }
  const f = fc.filter((p) => p.ts >= x0 && p.ts <= x1);
  if (f.length > 1) {
    let area = `M${X(f[0].ts).toFixed(1)} ${Y(f[0].load).toFixed(1)}`;
    for (const p of f) area += ` L${X(p.ts).toFixed(1)} ${Y(Math.max(p.pv, p.load)).toFixed(1)}`;
    for (const p of [...f].reverse()) area += ` L${X(p.ts).toFixed(1)} ${Y(p.load).toFixed(1)}`;
    g += `<path d="${area} Z" fill="#ffb81f40"/>`
      + `<path d="${line(f, 'pv')}" fill="none" stroke="#ffb81f" stroke-width="2" stroke-dasharray="5 4"/>`
      + `<path d="${line(f, 'load')}" fill="none" stroke="#8ea3b4" stroke-width="1.4" stroke-dasharray="4 3"/>`;
  }
  if (act.length > 1) g += `<path d="${line(act, 'pv')}" fill="none" stroke="#ffb81f" stroke-width="2.4"/><path d="${line(act, 'load')}" fill="none" stroke="#8ea3b4" stroke-width="1.6"/>`;
  if (now > x0 && now < x1) {
    const nx = X(now).toFixed(1);
    g += `<line x1="${nx}" y1="${T}" x2="${nx}" y2="${B}" stroke="#eef4f8"/><text x="${+nx + 4}" y="${T + fs}" fill="#eef4f8" font-size="${fs}">now</text>`;
  }
  g += `<text x="${R}" y="${T + fs}" fill="#8ea3b4" font-size="${fs}" text-anchor="end">${maxKw.toFixed(0)} kW</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Today's solar and house use, actual so far and forecast for the rest of the day">${g}</svg>`;
}

function drawToday() {
  const el = $('sunChart');
  if (el.offsetParent !== null) el.innerHTML = sunChart(el.clientWidth, el.clientHeight, isTablet());
  const now = Date.now() / 1000, p = app?.plan;
  let sub = '';
  if (p?.best && p.best.endTs > now) sub = `Car window ${clock(Math.max(now, p.best.startTs))}–${clock(p.best.endTs)}`;
  else if (p?.steps) {
    const wh = p.steps.filter((s) => s.ts + 900 > now).reduce((a, s) => a + Math.max(0, s.pv - s.load) / 4, 0);
    sub = wh >= 100 ? `~${kwhTxt(wh)} excess left` : 'No excess left today';
  }
  $('excessSub').textContent = sub;
}

function drawLive() {
  const s = live?.sample;
  if (!s) return;
  const car = app?.cars?.find((c) => c.key === app.activeCar);
  const carW = car && car.charging && Date.now() / 1000 - car.ts < 120 ? car.powerW || 0 : 0;
  const batt = s.batt < -50 ? `charging ${kw(s.batt)}` : s.batt > 50 ? `using ${kw(s.batt)}` : 'idle';
  const grid = s.grid < -30 ? ['To grid', kw(s.grid)] : s.grid > 30 ? ['From grid', kw(s.grid)] : ['Grid', '0 kW'];
  $('live').innerHTML = `<div>Solar now<b>${kw(s.pv)}</b></div><div>House battery<b>${s.soc ?? '–'}%</b>${batt}</div>`
    + `<div>House use<b>${kw(Math.max(0, s.load - carW))}</b></div><div>${grid[0]}<b class="${s.grid < -30 ? 'w' : ''}">${grid[1]}</b></div>`;
}

function ago(ts) {
  const m = Math.round((Date.now() / 1000 - ts) / 60);
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function drawCars() {
  if (!app) return;
  const now = Date.now() / 1000;
  $('carCards').innerHTML = app.cars.map((c) => {
    const active = c.key === app.activeCar && c.ts && now - c.ts < 300;
    let state = 'No reading yet', note = '';
    if (c.ts) {
      if (!active) { state = `Last seen ${ago(c.ts)}`; }
      else if (c.charging) { state = 'Charging'; note = `${kw(c.powerW || 0)} from solar`; }
      else if (c.plugged) { state = c.battery >= (c.limit ?? 101) - 1 ? 'At limit' : 'Plugged in'; }
      else state = 'Not plugged in';
      if (active && app.control?.reason && !c.charging && c.plugged) note = app.control.reason;
    }
    const pct = c.battery ?? 0;
    return `<div class="card car${c.charging && active ? '' : ' idle'}"><div class="lbl"><span>${esc(c.name)}</span><span${c.charging && active ? ' style="color:var(--ev)"' : ''}>${state}</span></div>`
      + `<div class="row"><span class="big">${c.battery != null ? Math.round(c.battery) : '–'}<small>%${c.limit != null ? ` to ${Math.round(c.limit)}%` : ''}</small></span><span class="note">${esc(note)}</span></div>`
      + `<div class="soc"><i style="width:${pct}%"></i>${c.limit != null ? `<s style="left:${c.limit}%"></s>` : ''}</div></div>`;
  }).join('');
  const a = $('advice');
  const m = /^(No swap|Swap):\s*(.*)$/s.exec(app.advice || '');
  if (m) { a.hidden = false; a.className = 'advice' + (m[1] === 'No swap' ? ' no' : ''); a.innerHTML = `<b>${m[1]}.</b> ${esc(m[2])}`; }
  else a.hidden = true;
}

function drawAll() { drawEff(); drawToday(); drawLive(); drawCars(); }

// ---------- data
async function loadEff() { try { rows = await get('/api/efficiency?days=400'); drawEff(); } catch {} }
async function loadApp() { try { app = await get('/api/app'); drawCars(); drawToday(); drawLive(); } catch {} }
async function loadActual() {
  const from = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  try { actual = await get(`/api/series?from=${from}&to=${Math.ceil(Date.now() / 1000)}&res=900`); drawToday(); } catch {}
}

let lastMsg = 0, liveDrawn = 0;
function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = (ev) => {
    lastMsg = Date.now();
    live = JSON.parse(ev.data);
    if (Date.now() - liveDrawn > 2000) { liveDrawn = Date.now(); drawLive(); }
  };
  es.onerror = () => { es.close(); setTimeout(connect, 5000); };
}
setInterval(() => {
  const ok = Date.now() - lastMsg < 10000;
  $('conn').textContent = ok ? 'live' : 'offline';
  $('conn').className = 'chip' + (ok ? '' : ' off');
}, 2000);

// ---------- always-on tablet: keep the screen awake, black clock overnight (tap to wake for 2 min)
let wake = null, wokenUntil = 0;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => (wake = null)); } } catch {}
}
document.addEventListener('visibilitychange', () => { keepAwake(); if (document.visibilityState === 'visible') { loadApp(); loadActual(); } });
function night() {
  const d = new Date(), h = d.getHours(), on = (h >= 22 || h < 6) && Date.now() > wokenUntil;
  $('night').hidden = !on;
  if (on) {
    $('clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
    const t = bucket(rows.filter((r) => r.day === d.toLocaleDateString('en-CA')));
    $('nightSub').textContent = t.pv > 0 ? `Solar used at home today: ${eff(t)}%` : '';
  }
}
$('night').addEventListener('click', () => { wokenUntil = Date.now() + 120000; night(); });

const fsBtn = $('fs');
if (document.fullscreenEnabled && !matchMedia('(display-mode: standalone)').matches) {
  fsBtn.hidden = false;
  fsBtn.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}));
  document.addEventListener('fullscreenchange', () => { fsBtn.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });
}

if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});

new ResizeObserver(() => { drawEff(); drawToday(); }).observe(main);
setTab(store.get('sse-tab', 'eff'));
loadEff(); loadApp(); loadActual(); connect(); keepAwake(); night();
setInterval(loadApp, 30000);
setInterval(loadActual, 5 * 60000);
setInterval(loadEff, 10 * 60000);
setInterval(night, 20000);
