// Quiet mode: poll the gateway and the Tesla bridge much less in the evening and overnight, when
// nothing needs 1 s data. It is on only while all three hold:
//   - the clock is inside QUIET_FROM..QUIET_UNTIL
//   - solar is below QUIET_DAYLIGHT_W (so a long summer evening with sun keeps the fast polls)
//   - no car is charging (the controller needs ~30 live samples a minute while it manages a session)
import { config } from './config.js';

const q = config.quiet;
const mins = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };

let pvW = null;          // latest solar W, set by the collector
let evCharging = false;  // set by the Tesla source
let lastActiveAt = 0;

function inWindow(d) {
  const t = d.getHours() * 60 + d.getMinutes(), a = mins(q.from), b = mins(q.until);
  return a <= b ? t >= a && t < b : t >= a || t < b;
}

export const quiet = {
  setPv(w) { pvW = typeof w === 'number' ? w : null; },
  setCharging(on) { evCharging = Boolean(on); },

  active(now = new Date()) {
    const on = q.enabled && pvW != null && pvW < q.daylightW && !evCharging && inWindow(now);
    if (on) lastActiveAt = now.getTime();
    return on;
  },

  // Slow value while quiet, the normal one otherwise. Never faster than the normal setting.
  pick(normalMs, quietMs) { return this.active() ? Math.max(normalMs, quietMs) : normalMs; },

  // How old a gateway reading may be and still count as fresh. Wider while quiet (and for one more
  // poll after it ends, since the next poll can be up to a quiet interval away) so the slow polls
  // don't look like a stalled gateway and trigger the cloud fallback. 0 = use the normal limits.
  staleMs() {
    this.active();
    return Date.now() - lastActiveAt < q.livePollMs + 5000 ? q.livePollMs * 2 + 3000 : 0;
  },
};
