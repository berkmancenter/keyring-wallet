#!/usr/bin/env node
/**
 * Keyring's own Firebase / FCM token lines in an Android logcat, and nobody else's. The one tested answer the
 * smoke-android leg uses for its no-token rows.
 *
 * The leg grepped the whole logcat, so another app's Firebase start counted against Keyring: in the dry run
 * 1011-0020 the emulator's Google Messages (pid 2272) logged StrictMode frames through FirebaseInstallationsRegistrar
 * while Keyring ran as 3480, 4685 and 5704. Now a line counts only when its pid is one of Keyring's: every
 * "Start proc <pid>:<bundle id>" in the window (a relaunch is a new pid), plus the pids the leg sampled itself.
 *
 *   node tokenlines.mjs --log <logcat -v time|threadtime file> --bid <bundle id> [--pid <n>]...
 *     prints Keyring's token lines (200 characters each), one per line; exit 0. Its pids go to stderr.
 */
import { readFileSync } from 'node:fs';

// The same words the leg looked for, and the one PACKAGE_ADDED line Play services logs for every install.
export const TOKEN = /firebaseinstallations\.googleapis|fcmtoken\.googleapis|fcm\.googleapis|FirebaseMessaging|FirebaseInstallations|FirebaseInstanceId|FirebaseIid|Firebase-Installations|\bFCM\b|\bGCM\b|\bc2dm\b|registration token/;
const IGNORED = /GCM.*Unexpected forwarded intent.*PACKAGE_ADDED/;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pids the bundle id ran as in this logcat: ActivityManager's "Start proc <pid>:<bid>/…" lines. */
export function startedPids(text, bid) {
  const re = new RegExp(`Start proc (\\d+):${esc(bid)}(?:/|\\s|$)`);
  const out = new Set();
  for (const line of String(text).split('\n')) {
    const m = re.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

/** A logcat line's pid: "-v time" puts it in parentheses after the tag, "-v threadtime" after the time. */
export function pidOf(line) {
  const t = /^\d\d-\d\d \d\d:\d\d:\d\d\.\d+ [VDIWEF]\/[^(]*\(\s*(\d+)\):/.exec(line);
  if (t) return t[1];
  const th = /^\d\d-\d\d \d\d:\d\d:\d\d\.\d+\s+(\d+)\s+\d+\s+[VDIWEF]\s/.exec(line);
  return th ? th[1] : undefined;
}

/** The token lines whose pid is one of `pids`. */
export function tokenLines(text, pids) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!TOKEN.test(line) || IGNORED.test(line)) continue;
    const pid = pidOf(line);
    if (pid && pids.has(pid)) out.push(line);
  }
  return out;
}

function cli(argv) {
  const opt = { pids: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--log') opt.log = argv[++i];
    else if (a === '--bid') opt.bid = argv[++i];
    else if (a === '--pid') opt.pids.push(...String(argv[++i] || '').split(/\s+/).filter((p) => /^\d+$/.test(p)));
  }
  if (!opt.log || !opt.bid) {
    process.stderr.write('tokenlines.mjs: --log <file> --bid <bundle id> [--pid <n>]...\n');
    return 3;
  }
  const text = readFileSync(opt.log, 'utf8');
  const pids = new Set([...startedPids(text, opt.bid), ...opt.pids]);
  process.stderr.write(`tokenlines: ${opt.bid} ran as ${[...pids].join(', ') || 'no pid seen'}\n`);
  for (const line of tokenLines(text, pids)) process.stdout.write(`${line.slice(0, 200)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(cli(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`tokenlines.mjs: ${e.message}\n`);
    process.exit(3);
  }
}
