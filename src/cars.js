// Two cars on one Tesla BLE bridge. The bridge talks to one car at a time ("Active Car").
//   Discovery: while the active car's charge port is closed (or the car isn't in range), switch to the
//   other car every DWELL_S, so whichever car gets plugged in is found within a few minutes.
//   Locked: once the active car's charge port is open (cable in), stay with it until it closes.
// The charge port door comes from VCSEC, which the bridge reads without waking the car.
import { config } from './config.js';
import { log } from './log.js';
import { quiet } from './quiet.js';

const DWELL_S = 4 * 60;      // time on each car before moving on: connect + a few VCSEC polls
const SETTLE_S = 45;         // after a switch, wait this long before asking the car for fresh data
const LOCK_GRACE_S = 10 * 60; // a plugged-in car that drops its link keeps the bridge this long

export class CarSwitcher {
  constructor(tesla) {
    this.tesla = tesla;
    this.lastSwitch = Math.floor(Date.now() / 1000); // give the car the bridge starts on a full dwell
    this.refreshed = true;
    this.plugged = null;          // { key, at }: car last seen linked with its cable in
    this.status = { enabled: config.tesla.cars.length > 1, mode: 'single car', car: config.tesla.cars[0].name };
  }

  start() {
    if (!this.status.enabled || !this.tesla.enabled()) return;
    const run = () => this.tick().catch((e) => log.warn('cars', e.message));
    setTimeout(run, 20_000);
    setInterval(run, 30_000);
  }

  async tick(isQuiet = quiet.active()) {
    const now = Math.floor(Date.now() / 1000);
    const t = this.tesla;
    const car = t.car();
    const sinceSwitch = now - Math.max(this.lastSwitch, Math.floor(t.status.switchedAt / 1000));
    // A real link, shown by a BLE signal. The bridge's "BLE Connection" switch stays on with no car in range.
    const connected = Boolean(t.linked(60_000));
    const c = t.current();

    // Once connected after a switch, ask the car for a full update so no field is left empty. At night only for a
    // car with its cable in: nothing is managed on an unplugged car then, and the update talks to the car.
    if (!this.refreshed && connected && sinceSwitch >= SETTLE_S) {
      this.refreshed = true;
      if (!isQuiet || c.portOpen === true) await t.forceUpdate().catch((e) => log.warn('cars', `force update: ${e.message}`));
    }

    const plugged = c.portOpen === true || (c.pluggedIn === true && c.state != null && c.state !== 'Disconnected');
    if (connected && plugged) {
      this.plugged = { key: car.key, at: now };
      this.status = { enabled: true, mode: 'locked', car: car.name, reason: `${car.name} is plugged in` };
      return;
    }
    if (connected) this.plugged = null; // linked and the cable is out: nothing to wait for
    // A short Bluetooth dropout mid-session shouldn't hand the bridge to the other car.
    if (this.plugged && this.plugged.key === car.key && now - this.plugged.at < LOCK_GRACE_S) {
      this.status = { enabled: true, mode: 'locked', car: car.name, reason: `${car.name} is plugged in; waiting for its link to come back` };
      return;
    }
    const why = !connected ? `${car.name} not in range or not paired` : `${car.name} not plugged in`;
    // Overnight with nothing plugged in there is no hurry to find a car: stay longer on each one.
    const dwell = isQuiet ? Math.max(DWELL_S, config.quiet.carDwellS) : DWELL_S;
    if (sinceSwitch < dwell) {
      this.status = { enabled: true, mode: 'discovery', car: car.name, reason: `${why}; checking it until ${clock(now - sinceSwitch + dwell)}` };
      return;
    }
    const cars = config.tesla.cars;
    const next = cars[(cars.findIndex((x) => x.key === car.key) + 1) % cars.length];
    log.info('cars', `${why}; switching bridge to ${next.name}`);
    await t.setActiveCar(next.key);
    this.lastSwitch = now;
    this.refreshed = false;
    this.plugged = null;
    this.status = { enabled: true, mode: 'discovery', car: next.name, reason: `switched to ${next.name} (${why})` };
  }
}

const clock = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
