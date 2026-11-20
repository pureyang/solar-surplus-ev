// Builds the iPhone app and installs it on the iPhone plugged into this Mac.
// With a free Apple ID the app stops opening after 7 days. Run this again to renew it; settings are kept.
// Run from the project folder with: node scripts/ios-install.js
//   TEAM=XXXXXXXXXX  picks the signing team when Xcode has more than one
//   PUSH=1           builds with iPhone notifications (needs a paid Apple Developer membership)
//   BUNDLE_ID=...    if Apple says the app's id is taken
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer' };
const push = process.env.PUSH === '1';
const bundleId = process.env.BUNDLE_ID || 'com.lexco.solarev';
const derived = path.join(root, 'ios', 'build');

const fail = (msg) => { console.error(`\n${msg}`); process.exit(1); };
const tmpFile = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'solarev-')), name);

function readJsonFrom(args) {
  const out = tmpFile('out.json');
  const r = spawnSync('xcrun', [...args, '--json-output', out], { env, encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {}
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
  return { ok: r.status === 0, json, stderr: r.stderr || '' };
}

function pickPhone() {
  const r = readJsonFrom(['devicectl', 'list', 'devices']);
  if (/license/i.test(r.stderr)) fail('Open Xcode once and agree to the license first.');
  const phones = (r.json?.result?.devices || []).filter((d) => d.hardwareProperties?.platform === 'iOS');
  // Plugged in beats Wi-Fi: faster, and it works before the phone has been paired over the network.
  const rank = (d) => (d.connectionProperties?.transportType === 'wired' ? 0 : 1);
  const phone = phones.filter((d) => d.connectionProperties?.pairingState === 'paired').sort((a, b) => rank(a) - rank(b))[0];
  if (!phone) {
    fail(phones.length
      ? 'The iPhone isn\'t paired with this Mac yet. Unlock it, tap Trust when it asks, and run this again.'
      : 'No iPhone found. Plug it in, unlock it, and run this again.');
  }
  if (phone.deviceProperties?.developerModeStatus === 'disabled') {
    fail('Turn on Developer Mode on the iPhone: Settings > Privacy & Security > Developer Mode. It restarts the phone; then run this again.');
  }
  return phone;
}

// The teams Xcode knows from Settings > Accounts.
function pickTeam() {
  if (process.env.TEAM) return process.env.TEAM;
  const plist = tmpFile('xcode.plist');
  let teams = [];
  try {
    execFileSync('defaults', ['export', 'com.apple.dt.Xcode', plist]);
    const json = execFileSync('plutil', ['-extract', 'IDEProvisioningTeamByIdentifier', 'json', '-o', '-', plist], { encoding: 'utf8' });
    teams = Object.values(JSON.parse(json)).flat();
  } catch {}
  fs.rmSync(path.dirname(plist), { recursive: true, force: true });
  const usable = push ? teams.filter((t) => !t.isFreeProvisioningTeam) : teams;
  const ids = [...new Set(usable.map((t) => t.teamID))];
  if (ids.length === 1) return ids[0];
  if (!teams.length) fail('Sign in to Xcode first: Xcode > Settings > Accounts > + > Apple Account.');
  if (!ids.length) fail('Notifications need a paid Apple Developer team, and Xcode only has a free one. Run without PUSH=1.');
  fail(`Xcode has several teams. Pick one with TEAM=...:\n${usable.map((t) => `  TEAM=${t.teamID}  ${t.teamName}`).join('\n')}`);
}

const phone = pickPhone();
const team = pickTeam();
const name = phone.deviceProperties?.name || 'iPhone';
console.log(`Building for ${name}${push ? ' with notifications' : ''}...`);

const build = spawnSync('xcodebuild', [
  '-project', path.join(root, 'ios', 'SolarEV.xcodeproj'),
  '-scheme', 'SolarEV',
  '-configuration', 'Release', // optimized, so it opens faster than a debug build
  '-destination', `id=${phone.hardwareProperties.udid}`,
  '-derivedDataPath', derived,
  '-allowProvisioningUpdates',
  '-allowProvisioningDeviceRegistration',
  '-quiet',
  `DEVELOPMENT_TEAM=${team}`,
  `PRODUCT_BUNDLE_IDENTIFIER=${bundleId}`,
  `SOLAREV_PUSH=${push ? 'YES' : 'NO'}`,
  'build',
], { env, stdio: 'inherit' });
if (build.status !== 0) fail('The build failed (see above).');

const app = path.join(derived, 'Build', 'Products', 'Release-iphoneos', 'SolarEV.app');
console.log(`Installing on ${name}...`);
const install = spawnSync('xcrun', ['devicectl', 'device', 'install', 'app', '--device', phone.identifier, app], { env, encoding: 'utf8' });
if (install.status !== 0) fail(`Couldn't install:\n${install.stderr || install.stdout}`);

const launch = readJsonFrom(['devicectl', 'device', 'process', 'launch', '--device', phone.identifier, '--terminate-existing', bundleId]);
if (launch.ok) {
  console.log('Installed and opened.');
} else if (/trust|profile|verif|invalid code signature|Security/i.test(launch.stderr)) {
  console.log('Installed. The first time, iOS has to trust your Apple ID before the app opens:\n'
    + '  Settings > General > VPN & Device Management > your Apple ID > Trust, then open Solar EV.');
} else if (/lock/i.test(launch.stderr)) {
  console.log('Installed. Unlock the iPhone and open Solar EV.');
} else {
  console.log(`Installed, but it didn't open:\n${launch.stderr.trim()}`);
}
if (!push) console.log('With a free Apple ID this install lasts 7 days. Run this again to renew it.');
