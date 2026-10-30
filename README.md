# Solar Surplus EV

Per-second monitoring for an Enphase solar + battery system, from your IQ Gateway on your own
network. Optionally, charge a Tesla from **excess solar only** with a $10 Bluetooth board. No Tesla
API, no cloud subscriptions.

**Independent open-source project. Not affiliated with, endorsed by or supported by Enphase Energy
or Tesla.** Read [Safety, liability and trademarks](#safety-liability-and-trademarks) before you use it.

**Core (everything you need is an Enphase system and an always-on computer on your home network):**

- **Live dashboard** updated every second: solar, house, IQ Battery, grid, per-phase meters,
  microinverters, battery units.
- **History**: the last 26 h at 1 s, plus minute averages forever (about 60 MB for the 26 h, plus ~130 MB a year).
- **Grid leakage**: grid import while the battery still had charge, per minute and per night
  (see `docs/grid-leakage.md`).
- **EV advisor**: learns your solar and load by hour, reads the weather forecast and shows on the
  dashboard when and how fast to charge an EV so the house battery still ends the day full.

**Optional (off unless you turn it on):**

| Feature | Turn on with | Needs |
| --- | --- | --- |
| Full per-second history (every second, forever) | `RECORD_HISTORY=1` | ~20 GB of disk a year |
| Phone push notifications | `NOTIFY=1` | Free [ntfy](https://ntfy.sh) app |
| Automatic Tesla charging over Bluetooth | Installer's Tesla step | [M5Stack NanoC6](https://shop.m5stack.com/products/m5stack-nanoc6-dev-kit) (~$10) |
| Enlighten cloud features (see below) | `ENLIGHTEN_CLOUD=1` | Your Enlighten login and site id |

The NanoC6 is only needed for Tesla control. Without it, everything else works.

### Enlighten cloud features (optional)

By default everything comes from your own gateway on your own network. The only Enphase cloud call
is getting a local gateway token about once a year, the way Enphase's local API tech brief
describes (or paste `GATEWAY_TOKEN` yourself and skip even that).

`ENLIGHTEN_CLOUD=1` adds three things from Enlighten's web endpoints:

- **15-min history**, 1 year back by default (`ENLIGHTEN_BACKFILL_DAYS`, or `all` for everything
  since your system was installed). History charts and totals show it wherever there's no 1 s data
  (before this app was installed, or while the computer slept), and the EV advisor learns from it on day one.
- **Live-stream fallback**: if the gateway stops answering, the dashboard keeps updating from the
  cloud feed the Enlighten app uses.
- **Gateway serial lookup**, so you don't have to type it.

These are not a published API. Enphase's Terms of Service restrict automated access to its
websites, so turning this on is your decision and may put your Enlighten account at risk.

## What you need

| Item | Notes |
| --- | --- |
| Enphase IQ Gateway with consumption CTs | Your Enlighten login, to get a local gateway token once a year (or paste a token) |
| Always-on computer on the same network | Windows, macOS, Linux or Raspberry Pi. Node 24+ or Docker. Wi-Fi or Ethernet on the same LAN as the gateway (and the NanoC6). Must stay awake 24/7, see [Keep the computer awake](#keep-the-computer-awake) |
| *Tesla control only:* [M5Stack NanoC6](https://shop.m5stack.com/products/m5stack-nanoc6-dev-kit) | ~$10, USB powered, within Bluetooth range of where the car parks, plus a USB-C data cable to flash it |
| *Tesla control only:* a Tesla on a charger it controls | Tested: Model 3 on a Mobile Connector, 240 V, 5–32 A |

## Install

1. Get the code:
   ```
   git clone https://github.com/pureyang/solar-surplus-ev.git
   cd solar-surplus-ev
   ```
2. Run the installer:
   - **Windows**: `powershell -ExecutionPolicy Bypass -File install.ps1`
   - **macOS / Linux / Pi**: `./install.sh`
3. Open http://localhost:8787.
4. Keep the computer awake: see below.

The installer asks, in order:

1. **Docker or Node**, and checks it's installed.
2. **Enphase**: Enlighten email and password, gateway serial and IP, ZIP code (for the forecast).
3. **Full per-second history?** Default no. **Enlighten cloud features?** Default no; if yes, it
   also asks for your site id.
4. **Phone push notifications?** Default no. If yes, install the ntfy app and subscribe to the topic
   shown on the EV tab.
5. **Tesla control?** Default no. Answer yes only if you have a NanoC6. It writes
   `esphome/secrets.yaml` (Wi-Fi, VIN, generated passwords), can flash the
   NanoC6 over USB, and stores the bridge IP. Then follow [Pairing the car](#pairing-the-car).
6. **Start**: `docker compose up -d`, or `npm ci` + start at logon on Windows.

Re-running the installer keeps existing values, so it is also how you turn features on later.
Everything it writes (`.env`, `esphome/secrets.yaml`, `data/`) is git-ignored.

### Keep the computer awake

The app only works while the computer is running and on the network. When it sleeps, nothing is
recorded (the dashboard and history show a gap), the EV advisor and push notifications stop, and Tesla
control stops: a car that is charging keeps going at its last amps, and the night top-off cap isn't
enforced. Locking the screen or turning the display off is fine. Sleep is not.

- **Windows**: Settings > System > Power > Screen and sleep: "When plugged in, put my device to
  sleep after: Never". Most PCs with Modern Standby freeze desktop apps while asleep, even though
  Wi-Fi stays connected.
- **Laptop**: keep it plugged in (on battery it sleeps on its own timer) and set closing the lid to
  do nothing when plugged in. Windows: Control Panel > Power Options > Choose what closing the lid
  does, or `powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0` then
  `powercfg /setactive SCHEME_CURRENT`. macOS: `sudo pmset -c sleep 0` (a closed MacBook lid still
  sleeps without an external display).
- **Linux / Raspberry Pi**: disable suspend (for example
  `sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target`).
- Prefer Ethernet or a reliable Wi-Fi spot: the gateway and the NanoC6 are reached over the LAN.

On Windows the `EnphaseLive` task restarts the app within 5 minutes of waking or logging on. Time
spent asleep is not recovered at 1 s (with `ENLIGHTEN_CLOUD=1` the 15-min cloud history fills it in).

### Manual setup

1. `cp .env.example .env` and fill in the Enphase section. Optional features stay off until you set them.
2. `npm install`, then `npm run probe` to check login, gateway token and live data.
3. `npm start`, or `docker compose up -d --build`.

Try the UI with fake data: `DEMO=1 npm start` (writes to `data/demo.db`).

### Turning a feature on later

Edit `.env` (or re-run the installer), then restart the app (`docker compose restart`, or
restart the `EnphaseLive` scheduled task on Windows).

- `RECORD_HISTORY=1`: keeps every second from now on. Seconds already pruned don't come back.
- `NOTIFY=1`: the EV tab then shows your topic and a **Send test** button.
- `ENLIGHTEN_CLOUD=1`: also set `ENLIGHTEN_SITE_ID`. History backfills within a minute of restart.
- Tesla: re-run the installer and answer yes at the Tesla step.

## Pairing the car

Only for Tesla control. You need the NanoC6 flashed by the installer.

1. Flash the NanoC6 (installer Tesla step, or `esphome run esphome/tesla-ble.yaml --device COM3`).
   You only give it the car's VIN. The bridge works out the car's Bluetooth address itself from the
   VIN (the car advertises as `S` + first 16 hex chars of `sha1(VIN)` + `C`), so no MAC is needed.
2. Plug the NanoC6 into USB power near where the car parks. Better than −75 dBm is solid, −85 dBm is
   the limit; move it if pairing times out.
3. Run the guided pairing (the installer offers it): `node --env-file=.env scripts/pair-tesla.js`.
   Sit in the car with your key card. The script finds the car, presses **Pair BLE Key**, then tells
   you to tap the card on the console reader and confirm on the car screen. The car shows no prompt
   until the card is tapped. If the bridge still says pairing is required, the script restarts it.
   With a second car it walks you through that one too.
4. The EV tab now shows the car's real amps, battery % and charge limit.

The bridge pairs as a **charging-only key** (`role: CHARGING_MANAGER` in `esphome/tesla-ble.yaml`).
The car only lets it start/stop charging, set amps and the charge limit, and open the charge port.
It can't unlock the car or open the trunk, even if someone gets onto the bridge's web page.

**Paired before this setting existed?** Your key is a full DRIVER key. To swap it:

1. Flash the updated firmware over Wi-Fi: `esphome run esphome/tesla-ble.yaml`.
2. In the car, open **Controls > Locks** and delete the old key for the bridge.
3. Pair again (step 4 above).

### Two cars, one bridge

One NanoC6 can serve two Teslas that share a charger. The bridge talks to one car at a time
("Active Car" on its web page); the app picks the car:

- **Searching**: while the active car's charge port is closed (or it isn't home), the bridge moves to
  the other car every 4 minutes. The charge port state comes from the car's security controller,
  which the bridge reads without waking the car.
- **Locked**: as soon as a car's charge port is open (cable in), the bridge stays with it until the
  port closes. Control, messages ("Model Y: EV charging started …") and the charge-limit raise follow
  that car.

Setup:

1. Set `TESLA_CAR2_NAME` (and `TESLA_CAR1_NAME`) in `.env`, and `tesla_vin_2` in
   `esphome/secrets.yaml` (the installer asks for the VIN).
2. Flash the bridge: `esphome run esphome/tesla-ble.yaml`.
3. Pair car 2: `node --env-file=.env scripts/pair-tesla.js 2`, sitting in that car with the key card.
   The same key is now paired with both cars.

## How the car control works

Only runs when the Tesla bridge is set up.

Every `EV_CONTROL_INTERVAL_S` (default 60 s), `src/controller.js` sets the car's amps. Priorities:

1. **Use all excess solar.** If the house is exporting and the car can take more, amps go up.
2. **Then minimise grid use.** The car never charges from the house battery or the grid: amps are
   capped at live excess and cut if the house imports while the car charges.

- House battery below 95%: follows the advisor's plan, so the battery still reaches `EV_TARGET_SOC`.
- 95% and above: tracks live excess minute by minute, keeping back what the battery needs to top off.
- Starts need 2 good minutes in a row. During a cloud the car drops to min amps and borrows from the
  house battery (up to `EV_LOAN_WH`, default 200 Wh/day) instead of stopping; the loan is repaid from
  solar before the car gets more. It stops ~3 min after the loan runs out.
- A plan that only moves the car's window back by an hour or less doesn't stop a running session.
- **Cloudy days** (solar 20%+ below forecast, or 70%+ cloud cover this hour): a start needs 5 good
  minutes instead of 2, and at least 1 kWh / 30 min of planned charging left.
- **After each stop** it rests 20 min before starting again, unless the house exports enough for
  min amps 5 minutes in a row.
- **Steadier amps**: amps follow a 3-minute average and only change by 2 A or more. Cuts for grid
  import, and raises when clearly exporting, still happen at once.
- When the house battery is full and the car reaches its own charge limit, the limit is raised to
  `EV_LIMIT_RAISE_TO` (default 90%) so solar goes to the car instead of the grid, then put back after sunset.
- Session, loan and plan are saved in `data/ev_state.json`, so a restart doesn't reset them.
- At night it only stops sessions it started; your own overnight charging is left alone.
- **Night top-off** (`NIGHT_CHARGE=1`): between `NIGHT_CHARGE_FROM` and `NIGHT_CHARGE_UNTIL` (default
  midnight-7 AM, PG&E's off-peak start) it charges a plugged-in car at `EV_MAX_AMPS` until the car reaches its
  own charge limit (Oct-May: `NIGHT_CHARGE_WINTER_MAX`, default 70%, if lower; the session is stopped there,
  the car's limit isn't changed, and daytime solar can still take it to the limit). This is the one exception to "never from the house battery": any charge the battery
  still has at midnight goes to the car first. At the end of the window, solar control takes over (or, if
  it's still dark, the session is stopped).
- A change in the Tesla app pauses control for `EV_OVERRIDE_MIN` (default 120).
- Messages when charging starts (with the expected ending car battery %) and when it stops: on the
  dashboard, and on your phone with `NOTIFY=1`.

`EV_AUTO_CONTROL=0` turns control off; the advisor then posts "start / stop / set N A" messages instead
(dashboard, plus phone with `NOTIFY=1`), at most one per `NOTIFY_MIN_INTERVAL_MIN`.

## Settings (`.env`)

| Key | Default | Meaning |
| --- | --- | --- |
| `GATEWAY_HOST` | `envoy.local` | Gateway IP (use an IP under Docker) |
| `GATEWAY_SERIAL` | | Gateway serial (required unless `ENLIGHTEN_CLOUD=1`) |
| `GATEWAY_TOKEN` | | Optional: paste a token from entrez.enphaseenergy.com instead of using your login |
| `LOCAL_POLL_MS` | 1000 | Gateway livedata poll interval (min 1000; see [Gateway load](#gateway-load)) |
| `METER_POLL_MS` | 5000 | Gateway CT meter readings poll interval (min 1000) |
| `ENLIGHTEN_CLOUD` | 0 | 1 = Enlighten history, cloud fallback and serial lookup (see above) |
| `ENLIGHTEN_BACKFILL_DAYS` | 365 | Days of Enlighten history to import, or `all` |
| `RECORD_HISTORY` | 0 | 1 = keep every per-second row forever (~20 GB/yr) |
| `HISTORY_HOURS` | 26 | Per-second rows kept when `RECORD_HISTORY=0` (min 26) |
| `NOTIFY` | 0 | 1 = push messages to your phone via ntfy |
| `LOCATION` | | ZIP or city for the forecast (or `LAT`/`LON`) |
| `EV_MIN_AMPS` / `EV_MAX_AMPS` | 5 / 32 | Charger range |
| `EV_TARGET_SOC` | 99 | House battery must reach this before solar fades |
| `EV_SAFETY` | 0.85 | Fraction of forecast solar the plan relies on |
| `EV_AUTO_CONTROL` | 1 | Drive the car over Bluetooth (only with a bridge set up) |
| `EV_CONTROL_INTERVAL_S` | 60 | Seconds between updates to the car (min 30) |
| `EV_AUTO_FROM` | | First day (YYYY-MM-DD) to take control |
| `EV_OVERRIDE_MIN` | 120 | Back-off after a manual change |
| `EV_CAR_KWH` | 75 | Usable pack size, for the expected-SOC estimate |
| `TESLA_CAR1_NAME` / `TESLA_CAR2_NAME` | | Car names; setting car 2 turns on two-car switching |
| `EV_CAR2_KWH` | 75 | Second car's usable pack size |
| `EV_LOAN_WH` | 200 | Daily house-battery loan to ride through clouds at min amps |
| `EV_LIMIT_RAISE_TO` | 90 | Car charge limit used when the house battery is full (0 = off) |
| `NIGHT_CHARGE` | 0 | 1 = top off a plugged-in car at `EV_MAX_AMPS` overnight, up to the car's own limit |
| `NIGHT_CHARGE_FROM` / `_UNTIL` | 00:00 / 07:00 | Night top-off window (local time; PG&E EV2-A / E-ELEC off-peak starts at midnight) |
| `NIGHT_CHARGE_WINTER_MAX` | 70 | Oct-May: night top-off stops at this % if below the car's limit (0 = off) |
| `TESLA_BLE_HOST` / `_USER` / `_PASSWORD` | | Bridge address and web login |
| `NTFY_TOPIC` | auto | Push topic (generated if blank; setting it also turns on `NOTIFY`) |

## Data sources

| Source | Rate | How |
| --- | --- | --- |
| Local IQ Gateway (preferred) | 1 s / 5 s | `GET /ivp/livedata/status` (stream enabled via `POST /ivp/livedata/stream`), `GET /ivp/meters/readings` (skipped without enabled CT meters) |
| Enlighten cloud live stream (fallback, `ENLIGHTEN_CLOUD=1` only) | 1 s | Same feed as the Enlighten app's live view |
| Gateway battery inventory | 30 s | `GET /ivp/ensemble/inventory` (per-unit SOC, temperature) |
| Gateway microinverters | 5 min | `GET /api/v1/production/inverters` |
| 15-min history | 15 min | Built from this app's own minute data; with `ENLIGHTEN_CLOUD=1`, Enlighten's history |
| Open-Meteo | hourly | Solar radiation and cloud forecast |
| Tesla BLE bridge | ~10 s | ESPHome web_server `/events` (SSE); commands via its REST API |

The collector writes exactly one row per second from whichever source is healthy. If local data is
older than `FALLBACK_AFTER_S` (10 s) and `ENLIGHTEN_CLOUD=1`, it starts the cloud stream, and puts
it back on standby once local has been healthy for 2 min.

### Gateway load

This app polls the gateway far more often than Home Assistant's Enphase integration (60 s by default).
Fast polling can make some gateways unresponsive, depending on firmware version, whether CT meters are
installed, and other factors; HA's docs warn of dropped connections, freezes and restarts. To limit that:

- Each poll loop runs one request at a time and backs off on errors (2 s, 4 s, ... up to 30 s), then
  returns to its normal rate after a success.
- The livedata stream enable `POST` is sent at most once every 30 s.
- Meter readings aren't polled when the gateway has no enabled CT meters.

If your gateway drops out, restarts, or the log shows repeated timeouts, raise `LOCAL_POLL_MS` and
`METER_POLL_MS` (e.g. 5000 and 15000).

### Quiet mode (evening and overnight)

Between `QUIET_FROM` and `QUIET_UNTIL` (default 20:00 to 06:00) the app polls much less, but only while
solar is under `QUIET_DAYLIGHT_W` (100 W) and no car is charging:

| What | Normal | Quiet |
|---|---|---|
| Gateway live data | 1 s | 15 s |
| Gateway CT meters | 5 s | 60 s |
| Battery units | 30 s | 2 min |
| Inverters | 5 min | 15 min |
| Car switching (neither plugged in) | 4 min per car | 10 min per car |
| `ev_samples` rows | 10 s | 60 s |

The last reading is held and logged every second, so energy totals stay correct and the dashboard just
updates every 15 s. Polling returns to normal when the sun comes up or a car starts charging (the
controller needs fast data to manage a session). `QUIET_POLLING=0` turns it off; `/api/status` shows
`quiet: true` while it is on.

Signs follow Enphase: battery **+ = discharging**, grid **+ = importing**.

## Storage (`data/enphase.db`, SQLite)

- `samples`: 1 row/s of solar, battery, grid, house W, SOC, reserve, relay, mode, per-phase JSON.
  With `RECORD_HISTORY=0`, this and the other per-second tables (`meter_readings`, `battery_units`,
  `inverters`, `ev_samples`) keep only the last `HISTORY_HOURS`; minute rollups and leakage are kept.
- `rollup_1m`: per-minute avg/min/max + Wh. `leakage_1m`: per-minute grid leakage.
- `meter_readings`, `battery_units`, `inverters`, `cloud_intervals`, `weather_hourly`.
- `ev_samples`: car state every 10 s. `notifications`: messages and car commands.
- `data/reports/<day>.json`: nightly report (23:55).

API: `/api/stream` (SSE), `/api/series`, `/api/energy`, `/api/meters`, `/api/battery`, `/api/inverters`,
`/api/ev`, `/api/tesla`, `/api/leakage`, `/api/status`, `/api/export.csv?from=&to=` (unix seconds).

## Docker

```
docker compose up -d --build                 # app on http://localhost:8787
docker compose --profile esphome up -d       # optional ESPHome dashboard (OTA updates) on :6052
```

Uses `.env` and keeps the database in `./data`. Containers can't resolve `envoy.local`, so set
`GATEWAY_HOST` and `TESLA_BLE_HOST` to IP addresses. Run only one copy (Docker **or** Node): two
copies would both send commands to the car.

## Safety, liability and trademarks

- **No warranty.** This software is provided "as is" under the MIT license, without warranty of
  any kind. You use it at your own risk. The authors are not liable for any damage, loss or cost
  that results from using it.
- **It acts on real equipment.** With Tesla control on, it starts and stops your car's charging,
  sets the charging amps and can raise the car's charge limit. Make sure your charger, circuit and
  wiring are rated for the amps you allow (`EV_MAX_AMPS`). The car and charger enforce their own
  limits, but you are responsible for your equipment.
- **Advice and estimates can be wrong.** Forecasts, plans, expected battery % and energy figures
  are estimates. Don't rely on them for safety, backup power or billing decisions.
- **Your accounts, your terms.** You are responsible for following Enphase's and Tesla's terms
  for your own accounts and devices. The optional `ENLIGHTEN_CLOUD` features use Enlighten's web
  endpoints, which those terms may not allow.
- **Your data stays with you.** Credentials live in `.env` on your computer. The dashboard only
  listens on this computer by default (`HOST=127.0.0.1`). With `NOTIFY=1`, push messages go
  through ntfy.sh.
- **Trademarks.** Enphase, Enlighten and IQ are trademarks of Enphase Energy, Inc. Tesla is a
  trademark of Tesla, Inc. They are used only to describe what this software works with.
- **Firmware license.** The Tesla Bluetooth firmware
  ([yoziru/esphome-tesla-ble](https://github.com/yoziru/esphome-tesla-ble)) is AGPL-3.0. This repo
  only references it; your build downloads it.

## Credits

- [yoziru/esphome-tesla-ble](https://github.com/yoziru/esphome-tesla-ble): Tesla BLE firmware for ESP32
- [Open-Meteo](https://open-meteo.com): weather forecast
- [uPlot](https://github.com/leeoniya/uPlot): charts

## License

MIT, see [LICENSE](LICENSE).
