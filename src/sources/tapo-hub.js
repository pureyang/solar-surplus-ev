// The one plug the attic fan runs on. Finds it by name (the nickname you gave it in the Tapo app) so no IP
// is needed, and finds it again if the router hands it a new address. Same interface as TapoDevice.
import { TapoDevice } from './tapo.js';
import { discover, slug } from './tapo-discover.js';
import { log } from '../log.js';

const REDISCOVER_MIN_MS = 10 * 60_000;

export class TapoHub {
  // devices: fixed [{ name, host }] from TAPO_DEVICES; want: plug name/nickname; discovery: search the LAN
  constructor({ email, password, devices = [], want = '', discovery = true, find = discover }) {
    Object.assign(this, { email, password, devices, want, discovery, find });
    this.dev = null;
    this.lastSearch = 0;
  }

  get name() { return this.dev ? this.dev.name : (this.want || 'tapo plug'); }

  matches(row) {
    const w = slug(this.want);
    return slug(row.name) === w || slug(row.nickname) === w || (row.mac && slug(row.mac) === w) || row.host === this.want;
  }

  async resolve(force = false) {
    if (this.dev && !force) return this.dev;
    const fixed = this.devices.find((d) => !this.want || slug(d.name) === slug(this.want)) || (this.want ? null : this.devices[0]);
    if (fixed && !force) return (this.dev = new TapoDevice({ ...fixed, email: this.email, password: this.password }));
    if (!this.discovery) throw new Error(`Tapo plug "${this.want}" is not in TAPO_DEVICES`);
    if (Date.now() - this.lastSearch < REDISCOVER_MIN_MS && this.lastSearch) throw new Error('Tapo plug not found on the network (will search again soon)');
    this.lastSearch = Date.now();
    const rows = (await this.find({ email: this.email, password: this.password })).filter((r) => r.auth);
    const hit = this.want ? rows.find((r) => this.matches(r)) : (rows.length === 1 ? rows[0] : null);
    if (!hit) {
      const names = rows.map((r) => r.name).join(', ') || 'none';
      throw new Error(this.want ? `No Tapo plug named "${this.want}" found (found: ${names})` : `Several Tapo plugs found (${names}): set ATTIC_FAN_DEVICE`);
    }
    log.info('tapo', `found ${hit.name} (${hit.model || '?'}) at ${hit.host}`);
    return (this.dev = new TapoDevice({ name: hit.name, host: hit.host, email: this.email, password: this.password }));
  }

  async call(fn, ...args) {
    const dev = await this.resolve();
    try { return await dev[fn](...args); } catch (e) {
      const unreachable = e.status == null && e.code == null && !/rejected/.test(e.message);
      if (!unreachable || !this.discovery) throw e;
      this.dev = null;                       // moved? look again, at most every 10 minutes
      return (await this.resolve(true))[fn](...args);
    }
  }

  info() { return this.call('info'); }
  powerW() { return this.call('powerW'); }
  setOn(on) { return this.call('setOn', on); }
}
