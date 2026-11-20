import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyState, step } from '../src/chargeWatch.js';

const COOLDOWN = 3600;
const charging = { state: 'Charging', pluggedIn: true };
const stopped = { state: 'Stopped', pluggedIn: true };

// Run a list of [seconds, reading] through step and return the events that came out.
function run(readings, s = emptyState()) {
  const events = [];
  for (const [t, r] of readings) {
    const out = step(s, r, t, COOLDOWN);
    s = out.state;
    if (out.event) events.push([t, out.event]);
  }
  return { events, state: s };
}

test('a real start pushes once, on the second reading', () => {
  const { events } = run([[100_000, stopped], [100_010, charging], [100_020, charging], [100_030, charging], [100_040, charging]]);
  assert.deepEqual(events, [[100_020, 'start']]);
});

test('no link never pushes, whatever was replayed', () => {
  assert.deepEqual(run([[100_000, null], [100_010, null], [100_020, null]]).events, []);
});

test("a finished car drawing 3 A in state 'Complete' is not a start", () => {
  const complete = { state: 'Complete', pluggedIn: true, current: 3, powerW: 0 };
  assert.deepEqual(run([[100_000, complete], [100_010, complete], [100_020, complete]]).events, []);
});

test('one lone Charging reading is not enough', () => {
  assert.deepEqual(run([[100_000, charging], [100_010, stopped], [100_020, charging], [100_030, null]]).events, []);
});

test('a car found already charging still pushes', () => {
  assert.deepEqual(run([[100_000, null], [100_010, charging], [100_020, charging]]).events, [[100_020, 'start']]);
});

test('night top-off restarts inside the cooldown are recorded, not pushed', () => {
  // Oct 28 pattern: a minute of charging about every 30 minutes around the 70% cap.
  const t0 = 100_000, seq = [];
  for (let cycle = 0; cycle < 4; cycle++) {
    const at = t0 + cycle * 1800;
    seq.push([at, charging], [at + 10, charging], [at + 60, stopped]);
  }
  assert.deepEqual(run(seq).events, [[t0 + 10, 'start'], [t0 + 1810, 'repeat'], [t0 + 3610, 'repeat'], [t0 + 5410, 'repeat']]);
});

test('a new session after the cooldown pushes again', () => {
  const { events } = run([[100_000, charging], [100_010, charging], [100_020, stopped], [104_000, charging], [104_010, charging]]);
  assert.deepEqual(events.map((e) => e[1]), ['start', 'start']);
});

test('unplugging ends the cooldown', () => {
  const unplugged = { state: 'Disconnected', pluggedIn: false };
  const { events } = run([[100_000, charging], [100_010, charging], [100_020, unplugged], [100_300, charging], [100_310, charging]]);
  assert.deepEqual(events.map((e) => e[1]), ['start', 'start']);
});

test("a just-connected car, state not read yet and plugged reading false, doesn't end the cooldown", () => {
  const unread = { state: null, pluggedIn: false };
  const { events } = run([[100_000, charging], [100_010, charging], [100_020, unread], [100_030, charging], [100_040, charging]]);
  assert.deepEqual(events.map((e) => e[1]), ['start']);
});

test('a Bluetooth dropout during a session stays quiet', () => {
  const { events } = run([[100_000, charging], [100_010, charging], [100_020, null], [100_500, null], [100_510, charging], [100_520, charging]]);
  assert.deepEqual(events.map((e) => e[1]), ['start']);
});

test('a new session after a long link gap pushes even though the old one was never seen ending', () => {
  const { events } = run([[100_000, charging], [100_010, charging], [100_020, null], [120_000, charging], [120_010, charging]]);
  assert.deepEqual(events.map((e) => e[1]), ['start', 'start']);
});
