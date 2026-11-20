import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nightAsk } from '../src/nightRetry.js';

const MIN = 60;

test('a car that ignores the night start is asked after 15, 30, then every 60 minutes', () => {
  const asks = {};
  const t0 = 1_000_000;
  const sent = [];
  // One tick a minute for four hours, the car never starting.
  for (let t = t0; t < t0 + 240 * MIN; t += MIN) if (nightAsk(asks, 'Car 1', t).ok) sent.push((t - t0) / MIN);
  assert.deepEqual(sent, [0, 15, 45, 105, 165, 225]);
});

test('a refused ask says when the next one may go', () => {
  const asks = {};
  nightAsk(asks, 'Car 1', 1000);
  assert.deepEqual(nightAsk(asks, 'Car 1', 1060), { ok: false, at: 1000 + 15 * MIN });
});

test('each car is paced on its own', () => {
  const asks = {};
  assert.equal(nightAsk(asks, 'Car 1', 1000).ok, true);
  assert.equal(nightAsk(asks, 'Car 2', 1010).ok, true);
  assert.equal(nightAsk(asks, 'Car 1', 1020).ok, false);
});
