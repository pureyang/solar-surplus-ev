// What the iPhone app shows (GET /api/mobile). Built from memory, so a request costs well under a millisecond.
//
// Car rule, same as /ev-health: only a numeric rssi proves a Bluetooth link. The bridge remembers values from
// any car and its "BLE Connection" switch stays ON with no car present, so battery, state and row presence
// prove nothing. A car with no link now shows its last real reading with that reading's time, never as current,
// and its charging state is unknown (null), not "not charging".
import { config } from './config.js';
import { reallyCharging } from './sources/tesla.js';

const BRIDGE_FRESH_MS = 120_000;
const round = (v) => (typeof v === 'number' ? Math.round(v) : null);

export class MobileStatus {
  constructor({ collector, tesla, store, pushInfo }) {
    this.collector = collector;
    this.tesla = tesla;
    this.pushInfo = pushInfo;
    this.homeSeed = store.lastHomeReading();
    // Newest real link and SOC per car: loaded once here, then kept current by onSample.
    this.last = new Map(config.tesla.cars.map((c) => [c.key, store.lastRealCar(c.key)]));
    this.pending = null; // a real SOC reading waiting for the next row to confirm it
  }

  // Call for every ev_samples row. A SOC counts once the next row is the same car with the same value,
  // which drops lone garbled readings (same rule as the database query in lastRealCar).
  onSample(ts, e) {
    const last = this.last.get(e.car);
    if (!last) return;
    const real = typeof e.rssi === 'number';
    if (real) last.link = { ts, rssi: e.rssi };
    const p = this.pending;
    if (p && p.car === e.car && p.battery === e.battery) last.soc = { ts: p.ts, battery: p.battery, limit: p.limit };
    this.pending = real && e.battery != null ? { car: e.car, ts, battery: e.battery, limit: e.limit } : null;
  }

  home() {
    const { active, latest, current } = this.collector;
    const got = active ? latest[active] : null;
    const live = got ? got.s : null;
    return {
      link: active ?? 'none', // local = gateway, cloud = Enlighten fallback, none = no data right now
      ts: got ? Math.floor(got.at / 1000) : current?.ts ?? this.homeSeed?.ts ?? null,
      soc: round(live?.soc ?? current?.soc ?? this.homeSeed?.soc),
      battW: round(live?.batt), // negative = charging
      pvW: round(live?.pv),
      loadW: round(live?.load),
      gridW: round(live?.grid), // negative = exporting
    };
  }

  bridge() {
    const t = this.tesla;
    if (!t.enabled()) return { state: 'off', activeCar: null };
    const fresh = t.status.state === 'ok' && Date.now() - t.status.lastEventAt < BRIDGE_FRESH_MS;
    return { state: fresh ? 'ok' : 'down', activeCar: t.car().key };
  }

  cars(now, bridge) {
    if (bridge.state === 'off') return [];
    const linked = this.tesla.linked();
    return config.tesla.cars.map((c) => {
      const last = this.last.get(c.key);
      const on = linked?.car === c.key ? linked : null;
      const active = bridge.state === 'ok' && bridge.activeCar === c.key;
      const soc = last.soc;
      return {
        key: c.key,
        name: c.name,
        link: on ? 'linked' : active && this.tesla.state.pairingRequired ? 'pairing' : 'none',
        checking: active, // the bridge talks to one car at a time: this is the one it is on
        rssi: on?.rssi ?? null,
        lastLinkTs: on ? now : last.link?.ts ?? null,
        soc: soc?.battery ?? null,
        socTs: on && on.battery === soc?.battery ? now : soc?.ts ?? null,
        limit: on?.limit ?? soc?.limit ?? null,
        charging: on ? reallyCharging(on) : null,
        chargeState: on?.state ?? null,
        plugged: on && on.state != null ? on.pluggedIn : null, // reads false until the car's state has arrived
        powerW: on ? on.powerW : null,
        amps: on ? on.current : null,
      };
    });
  }

  snapshot() {
    const now = Math.floor(Date.now() / 1000);
    const bridge = this.bridge();
    return { at: now, home: this.home(), bridge, cars: this.cars(now, bridge), push: this.pushInfo() };
  }
}
