import assert from 'node:assert/strict';
import { test } from 'node:test';

// Two cars on one bridge, as on the real install. Set before config.js loads.
process.env.TESLA_BLE_HOST = 'bridge.test';
process.env.TESLA_CAR1_NAME = 'Model 3';
process.env.TESLA_CAR2_NAME = 'Model Y';
const { CarSwitcher } = await import('../src/cars.js');
const { TeslaSource } = await import('../src/sources/tesla.js');

const now = () => Math.floor(Date.now() / 1000);

// A bridge on Car 1 whose stream is alive. Commands are recorded, not sent.
function setup(state) {
  const tesla = new TeslaSource();
  tesla.state = { activeCar: 'Car 1', bleConnected: true, ...state };
  tesla.status = { state: 'ok', error: null, lastEventAt: Date.now(), switchedAt: 0 };
  const calls = [];
  tesla.forceUpdate = async () => { calls.push('refresh'); };
  tesla.setActiveCar = async (key) => { calls.push(`switch to ${key}`); tesla.state.activeCar = key; };
  const sw = new CarSwitcher(tesla);
  return { tesla, sw, calls };
}
const pluggedIn = { portDoor: 'OPEN', pluggedIn: true, state: 'Charging' };
const unplugged = { portDoor: 'CLOSED', pluggedIn: false, state: 'Disconnected' };

test('remembered values with no signal: no refresh is sent, and the bridge keeps looking', async () => {
  const { sw, calls } = setup({ ...pluggedIn, rssi: null });
  sw.refreshed = false;
  sw.lastSwitch = now() - 300;
  await sw.tick(false);
  assert.deepEqual(calls, ['switch to Car 2']);
  assert.equal(sw.status.mode, 'discovery');
});

test('a real link by day gets one refresh and the bridge stays with a plugged-in car', async () => {
  const { sw, calls } = setup({ ...pluggedIn, rssi: -60 });
  sw.refreshed = false;
  sw.lastSwitch = now() - 300;
  await sw.tick(false);
  await sw.tick(false);
  assert.deepEqual(calls, ['refresh']);
  assert.equal(sw.status.mode, 'locked');
});

test('at night an unplugged car is not sent a refresh', async () => {
  const { sw, calls } = setup({ ...unplugged, rssi: -60 });
  sw.refreshed = false;
  sw.lastSwitch = now() - 60;
  await sw.tick(true);
  assert.deepEqual(calls, []);
  assert.equal(sw.status.mode, 'discovery');
});

test('at night a plugged-in car still gets its refresh', async () => {
  const { sw, calls } = setup({ ...pluggedIn, rssi: -60 });
  sw.refreshed = false;
  sw.lastSwitch = now() - 60;
  await sw.tick(true);
  assert.deepEqual(calls, ['refresh']);
});

test('a plugged-in car that drops its link keeps the bridge for 10 minutes', async () => {
  const { tesla, sw, calls } = setup({ ...pluggedIn, rssi: -60 });
  sw.lastSwitch = now() - 3600;
  await sw.tick(false);
  tesla.state.rssi = null;
  await sw.tick(false);
  assert.deepEqual(calls, [], 'still waiting for the link to come back');
  assert.equal(sw.status.mode, 'locked');
  sw.plugged.at -= 11 * 60;
  await sw.tick(false);
  assert.deepEqual(calls, ['switch to Car 2']);
});

test('a linked car seen unplugged gets no grace period', async () => {
  const { tesla, sw, calls } = setup({ ...pluggedIn, rssi: -60 });
  sw.lastSwitch = now() - 3600;
  await sw.tick(false);
  Object.assign(tesla.state, unplugged);
  await sw.tick(false);
  assert.deepEqual(calls, ['switch to Car 2']);
});
