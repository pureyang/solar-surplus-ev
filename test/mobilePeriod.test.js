import assert from 'node:assert/strict';
import { test } from 'node:test';
import { periodBounds, evBuckets, buildPeriod, SPANS } from '../src/mobilePeriod.js';

const local = (s) => new Date(s * 1000);

test('a day runs local midnight to local midnight', () => {
  const p = periodBounds('day', '2026-11-19');
  assert.equal(p.start, '2026-11-19');
  assert.equal(p.res, 300);
  assert.equal(local(p.from).getHours(), 0);
  assert.equal(local(p.to).getDate(), 20);
});

test('a week starts on Monday, like the web History tab', () => {
  const p = periodBounds('week', '2026-11-19'); // a Thursday
  assert.equal(p.start, '2026-11-16');
  assert.equal(local(p.to).toLocaleDateString('en-CA'), '2026-11-23');
  assert.equal(periodBounds('week', '2026-11-22').start, '2026-11-16'); // Sunday belongs to the week before
});

test('month and year are calendar periods', () => {
  const m = periodBounds('month', '2026-11-19');
  assert.equal(m.start, '2026-11-01');
  assert.equal(local(m.to).toLocaleDateString('en-CA'), '2026-12-01');
  const y = periodBounds('year', '2026-11-19');
  assert.equal(y.start, '2026-01-01');
  assert.equal(y.res, 86400);
  assert.equal(local(y.to).toLocaleDateString('en-CA'), '2027-01-01');
});

test('unknown span or date falls back to today', () => {
  const now = new Date(2026, 10, 19, 22, 30);
  assert.equal(periodBounds('fortnight', 'garbage', now).start, '2026-11-19');
  assert.equal(periodBounds('fortnight', '', now).span, 'day');
});

test('EV watts are averaged over the whole bucket, and unknown where there was no real reading', () => {
  // 2 h at 7.2 kW inside one day bucket is 0.6 kW over the day, not 7.2 kW.
  const wsec = 7200 * 7200;
  assert.deepEqual(evBuckets([0, 86400], 86400, [{ b: 0, wsec }]), [600, null]);
});

test('buildPeriod rounds and totals EV energy from watt-seconds', () => {
  const series = { t: [0, 300], pv: [1000.4, null], load: [500.6, 400], grid: [-499.5, 1], batt: [0, 0], soc: [55.2, 56] };
  const evRows = [{ b: 0, wsec: 7200 * 300 }, { b: 300, wsec: 7200 * 300 }];
  const d = buildPeriod({ span: 'day', res: SPANS.day, start: 'x', from: 0, to: 600, series, energy: { produced: 83.3, soc_min: 55, soc_max: 56 }, evRows, now: 450 });
  assert.deepEqual(d.pv, [1000, null]);
  assert.deepEqual(d.grid, [-499, 1]);
  assert.deepEqual(d.ev, [7200, 7200]);
  assert.equal(d.energy.ev, 1200); // 7.2 kW for 10 minutes
  assert.equal(d.energy.produced, 83);
  assert.equal(d.until, 450);
  assert.equal(d.span, 'day');
});
