import assert from 'node:assert/strict';
import { test } from 'node:test';

// Two cars, as on the real install. Set before config.js loads.
process.env.TESLA_BLE_HOST = 'bridge.test';
process.env.TESLA_CAR1_NAME = 'Model 3';
process.env.TESLA_CAR2_NAME = 'Model Y';
const { MobileStatus } = await import('../src/mobile.js');
const { TeslaSource } = await import('../src/sources/tesla.js');

const DAY = 86400;

function setup({ teslaState = {}, lastRealCar = () => ({ link: null, soc: null }) } = {}) {
  const tesla = new TeslaSource();
  tesla.state = { activeCar: 'Car 2', bleConnected: true, ...teslaState };
  tesla.status = { state: 'ok', error: null, lastEventAt: Date.now(), switchedAt: 0 };
  const collector = { active: 'local', current: { ts: 1, soc: 88 }, latest: { local: { at: Date.now(), s: { soc: 88, batt: -1200, pv: 4000, load: 700, grid: -2100 } } } };
  const store = { lastHomeReading: () => null, lastRealCar };
  return { tesla, collector, m: new MobileStatus({ collector, tesla, store, pushInfo: () => ({ configured: false, devices: 0 }) }) };
}
const byKey = (snap, key) => snap.cars.find((c) => c.key === key);

test('remembered bridge values with no rssi are not shown as a live car', () => {
  const old = Math.floor(Date.now() / 1000) - 7 * DAY;
  const { m } = setup({
    teslaState: { battery: 65, state: 'Charging', current: 16, pluggedIn: true, rssi: null },
    lastRealCar: (k) => (k === 'Car 2' ? { link: { ts: old, rssi: -89 }, soc: { ts: old, battery: 76, limit: 80 } } : { link: null, soc: null }),
  });
  const y = byKey(m.snapshot(), 'Car 2');
  assert.equal(y.link, 'none');
  assert.equal(y.checking, true);
  assert.equal(y.soc, 76, 'shows the last real SOC, not the remembered 65');
  assert.equal(y.socTs, old);
  assert.equal(y.charging, null, 'unknown, not false');
  assert.equal(y.chargeState, null);
  assert.equal(y.plugged, null);
});

test('a numeric rssi makes the active car linked and the other one not', () => {
  const { m } = setup({ teslaState: { rssi: -62, state: 'Charging', pluggedIn: true, current: 16, powerKw: 3.8, battery: 70, limit: 80 } });
  const snap = m.snapshot();
  const y = byKey(snap, 'Car 2');
  assert.equal(y.link, 'linked');
  assert.equal(y.rssi, -62);
  assert.equal(y.charging, true);
  assert.equal(y.powerW, 3800);
  assert.equal(y.plugged, true);
  assert.equal(byKey(snap, 'Car 1').link, 'none');
});

test("state 'Complete' with stray current is not charging", () => {
  const { m } = setup({ teslaState: { rssi: -55, state: 'Complete', pluggedIn: true, current: 3, powerKw: 0 } });
  assert.equal(byKey(m.snapshot(), 'Car 2').charging, false);
});

test('a dead bridge stream unlinks the car even with an old rssi in memory', () => {
  const { m, tesla } = setup({ teslaState: { rssi: -62, state: 'Charging' } });
  tesla.status.lastEventAt = Date.now() - 200_000;
  const snap = m.snapshot();
  assert.equal(snap.bridge.state, 'down');
  assert.equal(byKey(snap, 'Car 2').link, 'none');
  assert.equal(byKey(snap, 'Car 2').checking, false);
});

test('pairing required is stated', () => {
  const { m } = setup({ teslaState: { rssi: -62, pairingRequired: true } });
  assert.equal(byKey(m.snapshot(), 'Car 2').link, 'pairing');
});

test('SOC updates only once the next row confirms it, and a lone garbled reading never counts', () => {
  const { m } = setup();
  const row = (battery, rssi = -60, car = 'Car 2') => ({ car, battery, rssi, limit: 80 });
  m.onSample(1000, row(70));
  assert.equal(m.last.get('Car 2').soc, null);
  m.onSample(1010, row(70));
  assert.equal(m.last.get('Car 2').soc.battery, 70);
  assert.equal(m.last.get('Car 2').soc.ts, 1000);
  m.onSample(1020, row(18));
  m.onSample(1030, row(71));
  assert.equal(m.last.get('Car 2').soc.battery, 70, 'the lone 18 was dropped');
  m.onSample(1040, row(71));
  assert.equal(m.last.get('Car 2').soc.battery, 71);
});

test('rows with no rssi never move the last real link or SOC', () => {
  const { m } = setup();
  m.onSample(1000, { car: 'Car 2', battery: 65, rssi: null, limit: 80 });
  m.onSample(1010, { car: 'Car 2', battery: 65, rssi: null, limit: 80 });
  assert.equal(m.last.get('Car 2').soc, null);
  assert.equal(m.last.get('Car 2').link, null);
});

test('home battery reports the gateway state, and keeps the last SOC with its time when data stops', () => {
  const { m, collector } = setup();
  let home = m.snapshot().home;
  assert.equal(home.link, 'local');
  assert.equal(home.soc, 88);
  assert.equal(home.battW, -1200);
  collector.active = null;
  home = m.snapshot().home;
  assert.equal(home.link, 'none');
  assert.equal(home.soc, 88);
  assert.equal(home.ts, 1);
  assert.equal(home.battW, null);
});
