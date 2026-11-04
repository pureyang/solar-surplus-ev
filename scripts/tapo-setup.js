// One-time Tapo setup. Run in a real terminal:  npm run tapo:setup [-- --email you@example.com]
//   1. asks for the Tapo account password (typed or pasted, never shown, never printed)
//   2. searches the LAN for Tapo plugs and lists them by their Tapo app names
//   3. you pick the attic fan; TAPO_EMAIL, TAPO_PASSWORD and ATTIC_FAN_DEVICE go into .env
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { discover } from '../src/sources/tapo-discover.js';

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const envFile = path.resolve(arg('--env') || '.env');

if (!process.stdin.isTTY) {
  console.log('FAIL needs a real terminal (the password prompt is hidden). Open PowerShell in the project folder and run: npm run tapo:setup');
  process.exit(1);
}

function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let s = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(s);
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') s = s.slice(0, -1);
        else if (ch >= ' ') s += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

// .env value that node's --env-file reads back unchanged
function quote(v) {
  if (/^[\w@.+\-/:!%^*()]*$/.test(v)) return v;
  for (const q of ['"', "'", '`']) if (!v.includes(q) && !v.includes('\n')) return q + v + q;
  throw new Error('password has quote characters of every kind; edit .env by hand');
}

function setEnv(file, values) {
  let lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^\\s*${k}=`);
    const i = lines.findIndex((l) => re.test(l));
    const row = `${k}=${quote(v)}`;
    if (i >= 0) lines[i] = row;
    else {
      const c = lines.findIndex((l) => new RegExp(`^\\s*#\\s*${k}=`).test(l));
      if (c >= 0) lines.splice(c + 1, 0, row); else lines.push(row);
    }
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const email = (await rl.question(`Tapo account email [${arg('--email') || process.env.TAPO_EMAIL || ''}]: `)).trim() || arg('--email') || process.env.TAPO_EMAIL;
rl.close();
if (!email) { console.log('FAIL no email'); process.exit(1); }
const password = await askHidden('Tapo account password (hidden): ');
if (!password) { console.log('FAIL no password'); process.exit(1); }

console.log('\nSearching the network for Tapo devices (about 10 seconds)...');
const rows = await discover({ email, password });
if (!rows.length) {
  console.log('FAIL found nothing. Check: this PC is on the same Wi-Fi/LAN as the plugs, the plugs are online in the Tapo app, and the router does not isolate Wi-Fi clients.');
  process.exit(1);
}
const usable = rows.filter((r) => r.auth);
rows.forEach((r) => {
  const idx = r.auth ? String(usable.indexOf(r) + 1).padStart(2) : ' -';
  console.log(`${idx}  ${r.name.padEnd(22)} ${r.host.padEnd(15)} ${(r.model || '?').padEnd(6)} ${r.auth ? `${r.on ? 'ON ' : 'off'}${r.powerW != null ? ` ${r.powerW.toFixed(0)} W` : ''}` : `skipped: ${r.error}`}`);
});
if (!usable.length) { console.log('\nFAIL no device accepted the account. Check the email/password (TP-Link / Tapo app login, case sensitive).'); process.exit(1); }

const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
let pick = usable.length === 1 ? usable[0] : null;
while (!pick) {
  const a = (await rl2.question('\nWhich one runs the attic fan? number: ')).trim();
  pick = usable[Number(a) - 1] || usable.find((r) => r.name === a) || null;
}
rl2.close();

setEnv(envFile, { TAPO_EMAIL: email, TAPO_PASSWORD: password, ATTIC_FAN_DEVICE: pick.name });
console.log(`\nOK   saved TAPO_EMAIL, TAPO_PASSWORD, ATTIC_FAN_DEVICE=${pick.name} to ${envFile}`);
console.log('     The server finds the plug by that name each start, so a new IP from the router does not matter.');
console.log('     Rename it in the Tapo app and re-run this, or set ATTIC_FAN_DEVICE by hand.');
console.log('     Test: npm run tapo');
