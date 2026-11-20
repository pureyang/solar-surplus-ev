// Push when a car really starts charging, whoever started it. Runs on its own 10 s timer, so a push doesn't
// wait for the controller's next minute and still works with EV_AUTO_CONTROL=0.
//
// What counts, from the ev_samples history:
//   - A numeric rssi (tesla.linked()). Without it the bridge may be replaying remembered values.
//   - state === 'Charging'. A finished car can report state 'Complete' with 3 A and 0 kW for hours, which
//     current() calls charging and which once sent a false "started at 8 A" push.
//   - Two readings in a row, so a one-off value doesn't count.
//   - Off charge for the cooldown first. The night top-off can restart every 15-40 min around its SOC cap (18 start
//     pushes on Oct 28); those repeats are recorded for the charts but don't buzz the phone. Unplugging ends the
//     cooldown. No link means no information, so it changes nothing.
import fs from 'node:fs';
import { log } from './log.js';

const TICK_MS = 10_000;
const CONFIRM_READINGS = 2;
const SAVE_EVERY_S = 60;

export const emptyState = () => ({ on: false, streak: 0, lastChargingAt: 0 });

// One step for one car. reading = tesla.linked() for this car, or null with no link right now.
// Returns the new state and event: 'start' (push it), 'repeat' (record only) or null.
export function step(s, reading, now, cooldownS) {
  if (!reading || reading.state == null) return { state: { ...s, streak: 0 }, event: null };
  if (reading.state === 'Disconnected' && reading.pluggedIn === false) return { state: emptyState(), event: null };
  if (reading.state !== 'Charging') return { state: { ...s, on: false, streak: 0 }, event: null };
  const streak = s.streak + 1;
  if (streak < CONFIRM_READINGS) return { state: { ...s, streak }, event: null };
  const event = now - s.lastChargingAt >= cooldownS ? 'start' : s.on ? null : 'repeat';
  return { state: { on: true, streak, lastChargingAt: now }, event };
}

export class ChargeWatch {
  constructor({ tesla, cars, message, notify, record, file, cooldownS }) {
    Object.assign(this, { tesla, cars, message, notify, record, file, cooldownS });
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    this.states = Object.fromEntries(cars.map((c) => [c.key, { ...emptyState(), ...saved[c.key], streak: 0 }]));
    this.savedAt = 0;
  }

  start() {
    if (!this.tesla.enabled()) return;
    setInterval(() => this.tick(), TICK_MS);
  }

  tick(now = Math.floor(Date.now() / 1000)) {
    const car = this.tesla.linked();
    let changed = false;
    const events = [];
    for (const { key } of this.cars) {
      const before = this.states[key];
      const { state, event } = step(before, car?.car === key ? car : null, now, this.cooldownS);
      this.states[key] = state;
      if (state.on !== before.on || state.lastChargingAt === 0 && before.lastChargingAt !== 0) changed = true;
      if (event) events.push({ key, event });
    }
    // Save before sending, so a crash mid-send can't push the same start again after a restart.
    if (changed || events.length || (now - this.savedAt >= SAVE_EVERY_S && Object.values(this.states).some((s) => s.on))) this.save(now);
    for (const { key, event } of events) this.announce(key, event, car, now);
  }

  announce(key, event, car, now) {
    const { title, body } = this.message(now, car);
    const amps = Math.round(car.ampsSet ?? car.current ?? 0);
    log.info('charge', `${key}: ${event === 'start' ? 'charging started, pushing' : 'charging restarted inside the cooldown, no push'}`);
    if (event === 'repeat') {
      this.record({ ts: now, kind: 'EV_STARTED', title, body, amps, sent: false, error: 'repeat, no push' });
      return;
    }
    const collapseId = `ev-started-${key.replace(/\W/g, '')}-${now}`;
    // Not awaited: retries can take a while and the state above already stops a second push.
    this.notify({ kind: 'EV_STARTED', title, body, amps, priority: 3, tags: ['red_car', 'electric_plug'], collapseId })
      .catch((e) => log.warn('charge', e.message));
  }

  save(now) {
    this.savedAt = now;
    try {
      const out = Object.fromEntries(Object.entries(this.states).map(([k, { on, lastChargingAt }]) => [k, { on, lastChargingAt }]));
      fs.writeFileSync(this.file, JSON.stringify(out));
    } catch (e) { log.warn('charge', e.message); }
  }
}
