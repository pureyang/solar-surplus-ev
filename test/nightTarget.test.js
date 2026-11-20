import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nightTarget } from '../src/nightTarget.js';

test('winter cap applies Oct-May when no per-car max is set', () => {
  assert.deepEqual(nightTarget({ month: 11, limit: 80, winterMax: 70 }), { target: 70, why: 'winter cap' });
  assert.deepEqual(nightTarget({ month: 7, limit: 80, winterMax: 70 }), { target: 80, why: 'its limit' });
});

test('a per-car max replaces the winter cap, all year', () => {
  assert.deepEqual(nightTarget({ month: 11, limit: 90, carMax: 80, winterMax: 70 }), { target: 80, why: 'car max' });
  assert.deepEqual(nightTarget({ month: 7, limit: 90, carMax: 80, winterMax: 70 }), { target: 80, why: 'car max' });
});

test("the car's own limit wins when lower", () => {
  assert.deepEqual(nightTarget({ month: 11, limit: 75, carMax: 80, winterMax: 70 }), { target: 75, why: 'its limit' });
});

test('unknown limit falls back to the cap, or null with no cap', () => {
  assert.deepEqual(nightTarget({ month: 11, limit: null, carMax: 80 }), { target: 80, why: 'car max' });
  assert.deepEqual(nightTarget({ month: 7, limit: null, winterMax: 70 }), { target: null, why: 'its limit' });
});
