// One period for the iPhone app's graphs (GET /api/mobile/day?span=day|week|month|year&day=YYYY-MM-DD).
// The same numbers as the web History tab (store.series / store.energy) in one compact reply, with the same periods:
// a local day, a week starting Monday, a calendar month, a calendar year. `day` is any date inside the period
// (default today). Buckets: 5 min for a day, 1 h for a week or month, 1 day for a year.
//
// EV power only counts ev_samples rows with a numeric rssi (a real Bluetooth link). The bridge replays remembered
// values, so rows without one can show a car charging that isn't (see /ev-health). store.evEnergy adds each real
// row's watts times the gap to the next real row (capped), so a link that drops mid-bucket isn't stretched.

export const SPANS = { day: 300, week: 3600, month: 3600, year: 86400 };

const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const key = (d) => d.toLocaleDateString('en-CA');

// { span, res, start, from, to } for the period holding `day`. Local time; DST days are 23 or 25 hours.
export function periodBounds(span, day, now = new Date()) {
  if (!SPANS[span]) span = 'day';
  const d = parseDay(day) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let a, b;
  if (span === 'day') { a = d; b = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); }
  if (span === 'week') {
    a = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
    b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7);
  }
  if (span === 'month') { a = new Date(d.getFullYear(), d.getMonth(), 1); b = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
  if (span === 'year') { a = new Date(d.getFullYear(), 0, 1); b = new Date(d.getFullYear() + 1, 0, 1); }
  return { span, res: SPANS[span], start: key(a), from: Math.floor(a / 1000), to: Math.floor(b / 1000) };
}

// evRows: [{ b, wsec }] from store.evEnergy (watt-seconds of real charging per bucket).
// Average watts over each bucket of t; null where no real reading fell in it (no link: unknown, not zero).
export function evBuckets(t, res, evRows) {
  const byB = new Map(evRows.map((r) => [r.b, r.wsec]));
  return t.map((b) => (byB.has(b) ? byB.get(b) / res : null));
}

const whole = (a) => (a || []).map((v) => (typeof v === 'number' ? Math.round(v) : null));

// series: store.series(from, to, res). energy: store.energy(from, to). evRows: store.evEnergy(from, to, res).
export function buildPeriod({ span, res, start, from, to, series, energy, evRows, now = Date.now() / 1000 }) {
  const t = series.t || [];
  const e = energy || {};
  return {
    span, res, day: start, from, to, until: Math.min(to, Math.floor(now)),
    t,
    pv: whole(series.pv), load: whole(series.load), grid: whole(series.grid), batt: whole(series.batt),
    soc: whole(series.soc), ev: whole(evBuckets(t, res, evRows)),
    energy: {
      produced: Math.round(e.produced || 0), consumed: Math.round(e.consumed || 0),
      imported: Math.round(e.imported || 0), exported: Math.round(e.exported || 0),
      charged: Math.round(e.charged || 0), discharged: Math.round(e.discharged || 0),
      ev: Math.round(evRows.reduce((s, r) => s + r.wsec, 0) / 3600),
      socMin: e.soc_min ?? null, socMax: e.soc_max ?? null, coverage: e.coverage ?? null,
    },
  };
}
