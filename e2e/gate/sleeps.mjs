#!/usr/bin/env node
/**
 * Did the Mac sleep during a leg, and is it on battery? The one tested answer the gate uses for both.
 *
 * A gate leg that overlaps a sleep is not a verdict on the app: on 2026-10-09 (auto-run 1009-1608) a lid-closed sleep
 * on battery (682 s) ended both kk iOS sessions by Appium's 300 s newCommandTimeout, and the rows read as FAILs. caffeinate
 * does not hold off a clamshell sleep on battery, so the gate also refuses to start on battery.
 *
 *   node sleeps.mjs --from <epoch s> --to <epoch s> [--log <file>]   sleeps overlapping the window: one line each, exit 0;
 *                                                                    none: no output, exit 1
 *   node sleeps.mjs --battery [--batt <file>]                         "battery" (exit 0) or "ac" (exit 1)
 * Without --log / --batt it reads `pmset -g log` / `pmset -g batt`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// "2026-10-09 18:14:22 +0200 Sleep  Entering Sleep state due to 'Clamshell Sleep':TCPKeepAlive=active Using Batt (Charge:100%) 682 secs"
const SLEEP = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})\s+Sleep\s+Entering Sleep state due to '([^']+)'.*?(\d+) secs/;

/** Every sleep in a `pmset -g log` text: { start, end } in epoch seconds, the cause, and its length. */
export function parseSleeps(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = SLEEP.exec(line);
    if (!m) continue;
    const start = Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) / 1000;
    if (Number.isNaN(start)) continue;
    const secs = Number(m[6]);
    out.push({ start, end: start + secs, secs, cause: m[5] });
  }
  return out;
}

/** The sleeps that overlap [from, to] (epoch seconds). */
export function sleepsDuring(sleeps, from, to) {
  return sleeps.filter((s) => s.start < to && s.end > from);
}

/** `pmset -g batt`'s first line names the source: "Now drawing from 'Battery Power'" or "'AC Power'". */
export function onBattery(battText) {
  return /drawing from 'Battery Power'/.test(String(battText));
}

const hms = (t) => new Date(t * 1000).toISOString().slice(11, 19);
export function describe(s) {
  return `Mac slept ${hms(s.start)}Z–${hms(s.end)}Z (${s.secs} s, ${s.cause})`;
}

function cli(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--battery') opt.battery = true;
    else if (['--from', '--to', '--log', '--batt'].includes(a)) opt[a.slice(2)] = argv[++i];
  }
  if (opt.battery) {
    const text = opt.batt ? readFileSync(opt.batt, 'utf8') : execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8' });
    const b = onBattery(text);
    process.stdout.write(b ? 'battery\n' : 'ac\n');
    return b ? 0 : 1;
  }
  const from = Number(opt.from);
  const to = Number(opt.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    process.stderr.write('sleeps.mjs: --from <epoch> --to <epoch> [--log file], or --battery\n');
    return 3;
  }
  const text = opt.log ? readFileSync(opt.log, 'utf8') : execFileSync('pmset', ['-g', 'log'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const hits = sleepsDuring(parseSleeps(text), from, to);
  for (const s of hits) process.stdout.write(`${describe(s)}\n`);
  return hits.length ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(cli(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`sleeps.mjs: ${e.message}\n`);
    process.exit(3);
  }
}
