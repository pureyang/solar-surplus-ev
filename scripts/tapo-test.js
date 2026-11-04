// Checks the attic-fan plug: login, on/off state, power. Run: npm run tapo
// Plugs come from TAPO_DEVICES, or are found on the LAN by name (npm run tapo:setup picks it).
// It never switches anything unless you pass --toggle, which flips the fan plug once and back.
//   npm run tapo -- --list     show every Tapo device found on the LAN
import { config } from '../src/config.js';
import { TapoHub } from '../src/sources/tapo-hub.js';
import { discover } from '../src/sources/tapo-discover.js';

const { email, password } = config.tapo;
if (!email || !password) { console.log('FAIL no Tapo login yet. Run: npm run tapo:setup'); process.exit(1); }

if (process.argv.includes('--list')) {
  const rows = await discover({ email, password });
  if (!rows.length) console.log('none found');
  for (const r of rows) console.log(`${r.name.padEnd(22)} ${r.host.padEnd(15)} ${(r.model || '?').padEnd(6)} ${r.auth ? `${r.on ? 'ON' : 'off'}${r.powerW != null ? `, ${r.powerW.toFixed(1)} W` : ''}` : `skipped: ${r.error}`}`);
  process.exit(0);
}

const hub = new TapoHub({ email, password, devices: config.tapo.devices, want: config.fan.device, discovery: config.tapo.discover });
try {
  const i = await hub.info();
  const w = await hub.powerW();
  const dev = hub.dev;
  console.log(`OK   ${dev.name} (${dev.host}) ${i.model || '?'} ${i.nickname ? `"${i.nickname}" ` : ''}${i.on ? 'ON' : 'off'}${w != null ? `, ${w.toFixed(1)} W` : ', no power metering'}, wifi ${i.rssi ?? '?'}`);
  if (process.argv.includes('--toggle')) {
    await hub.setOn(!i.on);
    await new Promise((r) => setTimeout(r, 3000));
    console.log(`     toggled: now ${(await hub.info()).on ? 'ON' : 'off'}`);
    await hub.setOn(i.on);
    console.log(`     restored: ${(await hub.info()).on ? 'ON' : 'off'}`);
  }
} catch (e) {
  console.log(`FAIL ${e.message}`);
  process.exitCode = 1;
}
