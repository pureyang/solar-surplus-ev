// Optional push notifications via ntfy (https://ntfy.sh), on with NOTIFY=1. Install the ntfy app and subscribe to the topic.
// Once the iPhone app has registered, charging starts go to it instead, with ntfy as the fallback.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { writeNotification } from './db.js';
import { log } from './log.js';
import { deviceCount, pushToDevices } from './apns.js';

const topicFile = path.join(config.dataDir, 'ntfy.json');
const IPHONE_KINDS = new Set(['EV_STARTED']);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Keeps the same delivery id across retries, so a retry can't show twice on the phone. Returns the last error, or null if a phone got it.
async function sendToIphone({ title, body, collapseId }) {
  let error = null;
  for (let attempt = 0; attempt < 3 && deviceCount(); attempt++) {
    if (attempt) await wait(attempt * 5000);
    const r = await pushToDevices({ title, body, collapseId });
    if (r.sent) return null;
    error = r.error;
  }
  return error;
}

// Topic name is the only secret on public ntfy.sh, so generate an unguessable one.
export function ntfyTopic() {
  if (config.ev.ntfyTopic) return config.ev.ntfyTopic;
  try { return JSON.parse(fs.readFileSync(topicFile, 'utf8')).topic; } catch {}
  const topic = `enphase-ev-${crypto.randomBytes(9).toString('hex')}`;
  fs.writeFileSync(topicFile, JSON.stringify({ topic }, null, 2));
  return topic;
}

export function ntfyUrl() {
  return `${config.ev.ntfyServer.replace(/\/$/, '')}/${ntfyTopic()}`;
}

export async function notify({ kind, title, body, amps, priority = 3, tags = [], collapseId }) {
  const ts = Math.floor(Date.now() / 1000);
  let iphoneError = null;
  if (IPHONE_KINDS.has(kind) && deviceCount()) {
    iphoneError = await sendToIphone({ title, body, collapseId });
    if (!iphoneError) {
      writeNotification({ ts, kind, title, body, amps, sent: true, error: null });
      log.info('notify', `${kind}: ${title} (iPhone)`);
      return true;
    }
    log.warn('notify', `iPhone push failed: ${iphoneError}`);
  }
  // Pushes off: keep the message in the dashboard log only, and count it as delivered.
  if (!config.ev.notify) {
    writeNotification({ ts, kind, title, body, amps, sent: !iphoneError, error: iphoneError || 'push off' });
    return !iphoneError;
  }
  let sent = false, error = null;
  // Laptop Wi-Fi drops briefly after waking; retry a few times before giving up.
  for (let attempt = 0; attempt < 4 && !sent; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt * 5000));
    try {
      const res = await fetch(ntfyUrl(), {
        method: 'POST',
        // ntfy headers must be ASCII; emoji go through Tags.
        headers: { Title: title.replace(/[^\x20-\x7e]/g, ''), Priority: String(priority), Tags: tags.join(',') },
        body,
      });
      sent = res.ok;
      error = res.ok ? null : `ntfy ${res.status}`;
    } catch (e) {
      error = (e.cause && e.cause.code) || e.message;
    }
  }
  writeNotification({ ts, kind, title, body, amps, sent, error });
  log.info('notify', `${kind}: ${title}${error ? ` (FAILED: ${error})` : ''}`);
  return sent;
}
