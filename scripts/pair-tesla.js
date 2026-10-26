// Guided Tesla key pairing through the BLE bridge. Usage: node --env-file=.env scripts/pair-tesla.js [1|2]
// Asks nothing but "are you in the car with the key card"; finds the car, presses Pair, and watches the result.
import readline from 'node:readline/promises';

const host = process.env.TESLA_BLE_HOST;
const auth = 'Basic ' + Buffer.from(`${process.env.TESLA_BLE_USER}:${process.env.TESLA_BLE_PASSWORD}`).toString('base64');
if (!host) { console.error('TESLA_BLE_HOST is not set in .env'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const enc = encodeURIComponent;
async function call(method, p) {
  const res = await fetch(`http://${host}${p}`, { method, headers: { Authorization: auth }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${p}: ${res.status}`);
  return method === 'GET' ? res.json() : null;
}
const get = (p) => call('GET', p).catch(() => null);
const post = (p) => call('POST', p);
async function until(label, fn, seconds) {
  for (let t = 0; t < seconds; t += 3) { const v = await fn(); if (v) return v; await sleep(3000); }
  return null;
}
const ask = (q) => rl.question(`\n${q} `);

const cars = process.argv[2] ? [Number(process.argv[2])] : [1, ...(process.env.TESLA_CAR2_NAME ? [2] : [])];
for (const n of cars) {
  const name = (n === 1 ? process.env.TESLA_CAR1_NAME : process.env.TESLA_CAR2_NAME) || `Car ${n}`;
  console.log(`\n=== ${name} ===`);
  console.log('Sit in the car with the key card. Wake it (open a door), and park within a few meters of the bridge.');
  await ask('Press Enter when ready.');

  await post(`/select/Active%20Car/set?option=Car%20${n}`);
  process.stdout.write('Looking for the car over Bluetooth');
  const found = await until('addr', async () => {
    process.stdout.write('.');
    const a = await get(`/text_sensor/${enc(`Car ${n} Address`)}`);
    return a && a.value !== 'searching' ? a.value : null;
  }, 90);
  if (!found) { console.log('\nNot found. Check the VIN, wake the car, move the bridge closer, then re-run this script.'); continue; }
  console.log(`\nFound ${found}.`);

  const rssi = await until('rssi', async () => {
    const s = await get(`/sensor/${enc('BLE Signal')}`);
    return s && typeof s.value === 'number' && !Number.isNaN(s.value) ? s.value : null;
  }, 60);
  if (rssi == null) { console.log('Connected to nothing yet; wake the car and re-run.'); continue; }
  console.log(`Signal ${rssi} dBm${rssi < -85 ? ' (weak: move the bridge closer to where the car parks)' : rssi < -75 ? ' (usable)' : ' (good)'}.`);

  const pr = async () => (await get(`/binary_sensor/${enc('Pairing Required')}`))?.state;
  if ((await pr()) === 'OFF' && !/^y/i.test(await ask('The bridge reports this car as already paired. Pair again anyway? (y/N)'))) continue;

  await post(`/button/${enc('Pair BLE Key')}/press`);
  console.log('\nNow tap the key card on the console reader (behind the cupholders). The car shows the prompt only after the tap.');
  console.log('Confirm "Allow" on the car screen.');
  await ask('Press Enter after you confirmed on the screen.');

  let ok = await until('pair', async () => (await pr()) === 'OFF', 15);
  if (!ok) {
    console.log('Restarting the bridge to finish the handshake...');
    await post(`/button/${enc('Restart')}/press`).catch(() => {});
    await sleep(20000);
    await post(`/select/Active%20Car/set?option=Car%20${n}`).catch(() => {});
    ok = await until('pair2', async () => (await pr()) === 'OFF', 60);
  }
  console.log(ok ? `${name} paired.` : `${name} not paired. Delete the new "Key Card" in the car (Controls > Locks) and run: node --env-file=.env scripts/pair-tesla.js ${n}`);
}
rl.close();
