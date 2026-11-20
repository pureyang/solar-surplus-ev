// Makes the link that sets up the iPhone app in one tap: this computer's addresses plus APP_KEY.
// On a Mac it goes straight to the clipboard, so the key isn't left in the terminal. With Universal Clipboard
// on, tap Paste in the app. Run from the project folder with: node scripts/ios-link.js
import { execFileSync } from 'node:child_process';
import os from 'node:os';

// Reads .env like npm start does. config.js reads the environment when it loads, so it's imported after.
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch {}
const { config } = await import('../src/config.js');

if (!config.appKey) {
  console.error('Set APP_KEY in .env first (and HOST=0.0.0.0 so other devices can reach this computer).');
  process.exit(1);
}

const v4 = Object.values(os.networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address);
const isTailscale = (ip) => { const [a, b] = ip.split('.').map(Number); return a === 100 && b >= 64 && b <= 127; };
const lan = v4.filter((ip) => !isTailscale(ip));
const tail = v4.filter(isTailscale);
const host = os.hostname();
const name = host.endsWith('.local') ? host : `${host}.local`;

// The app tries these together and uses whichever answers first.
const urls = [...lan, name, ...tail].map((h) => `http://${h}:${config.port}`);
const q = new URLSearchParams();
q.set('key', config.appKey);
for (const u of urls) q.append('url', u);
const link = `solarev://setup?${q}`;

console.log('Addresses in the link:');
for (const u of urls) console.log(`  ${u}`);
if (!tail.length) console.log('No Tailscale address found, so the app will only work on your home Wi-Fi.');

if (process.platform === 'darwin') {
  execFileSync('pbcopy', { input: link });
  console.log('\nThe setup link is on the clipboard. In the app, tap Paste.');
} else {
  console.log(`\n${link}`);
}
