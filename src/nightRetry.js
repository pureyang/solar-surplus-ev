// At night nothing changes fast: there's no solar to follow, and a car that ignored a start won't change its mind a
// minute later. After a start or raise the car didn't take, the controller asks again after 15 min, then 30, then
// every 60, instead of every tick.
export const NIGHT_RETRY_S = [15 * 60, 30 * 60, 60 * 60];

// asks: { [carKey]: { ts, tries } }, kept by the caller. Returns { ok: true } and records the ask when it may be
// sent now, or { ok: false, at } with the time it may be sent.
export function nightAsk(asks, key, now) {
  const last = asks[key];
  if (last) {
    const at = last.ts + NIGHT_RETRY_S[Math.min(last.tries, NIGHT_RETRY_S.length) - 1];
    if (now < at) return { ok: false, at };
  }
  asks[key] = { ts: now, tries: (last?.tries ?? 0) + 1 };
  return { ok: true };
}
