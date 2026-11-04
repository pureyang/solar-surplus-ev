// Attic fan on a Tapo plug: runs only in summer, in daylight, on solar that would otherwise be exported.
// Lowest priority: the car and the house battery get the solar first. Every ATTIC_FAN_INTERVAL_S:
//   start  house battery >= ATTIC_FAN_MIN_SOC and excess (solar - house load, fan excluded) covers the
//          fan plus MARGIN_W, START_TICKS ticks in a row, and it has been off for ATTIC_FAN_MIN_OFF_MIN
//   stop   grid import above MARGIN_W or battery fell 5 points below the minimum, STOP_TICKS ticks in a
//          row (after ATTIC_FAN_MIN_ON_MIN), or immediately when the sun is down / the season ends
// It only turns off a fan it turned on, so switching the plug on yourself in the Tapo app is left alone.
import { config } from './config.js';
import { db } from './db.js';
import { log } from './log.js';

const MARGIN_W = 150;
const START_TICKS = 3;
const STOP_TICKS = 3;
const DAYLIGHT_W = 100;
const MIN_REAL_W = 20; // a plug reading below this isn't the fan running

export class Fan {
  constructor(advisor, device) {
    this.advisor = advisor;
    this.device = device;       // TapoDevice, or null when no plug is configured
    this.measuredW = null;      // real draw from a P110 while the fan runs
    this.startTicks = 0;
    this.stopTicks = 0;
    this.warned = '';
    const saved = advisor.state.fan || {};
    this.own = Boolean(saved.own);
    this.changedAt = saved.changedAt || 0;
    this.status = { enabled: Boolean(device && config.fan.enabled), device: device && device.name, on: null, own: this.own, reason: 'starting' };
    if (!device) this.status.reason = 'No Tapo plug configured';
    else if (!config.fan.enabled) this.status.reason = 'ATTIC_FAN_AUTO=0';
  }

  start() {
    if (!this.status.enabled) return;
    const run = () => this.tick().catch((e) => this.fail(e));
    setTimeout(run, 45_000);
    setInterval(run, config.fan.intervalS * 1000);
  }

  // Watts the fan adds to the house load while we run it; the car controller leaves them out of its load.
  runningW() { return this.status.on && this.own ? (this.measuredW ?? config.fan.watts) : 0; }

  fail(e) {
    this.status = { ...this.status, on: null, at: Math.floor(Date.now() / 1000), reason: `Plug: ${e.message}` };
    if (this.warned !== e.message) { log.warn('fan', e.message); this.warned = e.message; }
  }

  persist() {
    this.advisor.state.fan = { own: this.own, changedAt: this.changedAt };
    this.advisor.save();
  }

  async tick() {
    const now = Math.floor(Date.now() / 1000);
    const r = db.prepare('SELECT AVG(pv) AS pv, AVG(load) AS load, AVG(grid) AS grid, AVG(soc) AS soc, COUNT(*) AS n FROM samples WHERE ts >= ? AND src = 1')
      .get(now - config.fan.intervalS);
    await this.step(now, r, new Date(now * 1000).getMonth() + 1);
  }

  async step(now, r, month) {
    const c = config.fan, d = this.device;
    const set = (reason) => { this.status = { enabled: true, device: d.name, on: this.status.on, own: this.own, at: now, reason }; };
    const info = await d.info();
    this.warned = '';
    const on = info.on;
    this.status.on = on;
    if (!on && this.own) { this.own = false; this.persist(); }   // someone switched it off
    this.measuredW = null;
    if (on) {
      const w = await d.powerW().catch(() => null);
      if (w != null && w >= MIN_REAL_W) this.measuredW = w;
    }

    const flip = async (to, why) => {
      await d.setOn(to);
      log.info('fan', `${to ? 'on' : 'off'}: ${why}`);
      this.status.on = to; this.own = to; this.changedAt = now; this.startTicks = this.stopTicks = 0;
      this.persist();
      set(to ? `Running: ${why}` : `Stopped: ${why}`);
    };

    if (!c.months.includes(month)) {
      if (on && this.own) return flip(false, 'out of season');
      return set(`Off season (runs in month${c.months.length > 1 ? 's' : ''} ${c.months.join(', ')})`);
    }
    if (r.n < c.intervalS / 2) return set('Not enough live gateway data');
    if (r.pv < DAYLIGHT_W) {
      if (on && this.own) return flip(false, 'solar is down');
      return set('Night');
    }

    const fanW = this.measuredW ?? c.watts;
    const excessW = r.pv - (r.load - (on ? fanW : 0));   // solar beyond the house, fan excluded
    const importW = Math.max(0, r.grid);
    const kw = (w) => `${(w / 1000).toFixed(1)} kW`;

    if (on) {
      if (!this.own) return set('On, switched on outside solar control: left alone');
      const bad = importW > MARGIN_W || r.soc < c.minSoc - 5;
      this.stopTicks = bad ? this.stopTicks + 1 : 0;
      if (this.stopTicks >= STOP_TICKS && now - this.changedAt >= c.minOnMin * 60) {
        return flip(false, importW > MARGIN_W ? `importing ${Math.round(importW)} W` : `house battery ${Math.round(r.soc)}%`);
      }
      return set(`Running on solar excess (${kw(excessW)} spare, battery ${Math.round(r.soc)}%)`);
    }

    this.stopTicks = 0;
    if (r.soc < c.minSoc) { this.startTicks = 0; return set(`House battery ${Math.round(r.soc)}% (fan waits for ${c.minSoc}%)`); }
    if (excessW < fanW + MARGIN_W) { this.startTicks = 0; return set(`Excess ${kw(excessW)} below the fan's ${kw(fanW)}`); }
    this.startTicks++;
    if (this.startTicks < START_TICKS) return set(`Excess ${kw(excessW)}: confirming (${this.startTicks}/${START_TICKS})`);
    if (now - this.changedAt < c.minOffMin * 60) return set('Resting after the last stop');
    return flip(true, `${kw(excessW)} excess, battery ${Math.round(r.soc)}%`);
  }
}
