#!/usr/bin/env node
/**
 * Is this Mac stable enough to start a gate? The one tested answer the gate uses (mac_stable in gate.sh).
 *
 * A laptop in a bag is not a gate machine: a closed lid with no display behind it sleeps the Mac, and every leg
 * stalls with it (239 gate, 10-09: three hours). The rule, agreed with the gate lane on 10-10:
 *
 *   stable    the lid is open, or an external display is online (a closed MacBook on a desk, driving a monitor,
 *             stays awake); or the Mac has no lid at all and no battery: a desktop (a headless mini must still gate)
 *   unstable  the lid is closed and no external display is online
 *   unknown   no clamshell key, but a battery: a laptop whose lid cannot be read; treated as unstable
 *
 * There is no power-adapter condition (dropped by the project lead, 10-10).
 *
 *   node stable.mjs --stable      one line "<state>: <reason>"; exit 0 stable, 1 unstable, 2 unknown
 *   node stable.mjs --lid         open | closed | none (no clamshell key)
 *   node stable.mjs --displays    the external displays online, one per line, after their count
 *   node stable.mjs --battery     yes | no
 *   --ioreg <file> --profiler <file> --batt <file>   read captured outputs instead of running the commands (tests)
 *
 * Lid: `ioreg -r -k AppleClamshellState -d 4`, the exact key `"AppleClamshellState" = Yes|No` (Yes = closed).
 * Displays: `system_profiler SPDisplaysDataType -json`: an external display is an
 * SPDisplaysDataType[].spdisplays_ndrvs[] entry whose spdisplays_connection_type is not "spdisplays_internal" AND
 * whose spdisplays_online is "spdisplays_yes". Never a bare count of entries: that counts a panel that is listed
 * but asleep. (`ioreg -l | grep -c IODisplayConnect` is not a count on Apple silicon either: it matches a class
 * table and reads 1 with nothing attached.)
 * Battery: an "InternalBattery" line in `pmset -g batt`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CLAMSHELL = /"AppleClamshellState" = (Yes|No)\b/;

/** 'open' | 'closed' from an ioreg dump, or null when the exact key is absent (no clamshell: a desktop, or unreadable). */
export function parseLid(text) {
  const m = CLAMSHELL.exec(String(text));
  if (!m) return null;
  return m[1] === 'Yes' ? 'closed' : 'open';
}

/** The external displays that are online, from `system_profiler SPDisplaysDataType -json` (text or parsed). */
export function externalDisplays(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const gpus = (data && data.SPDisplaysDataType) || [];
  const out = [];
  for (const gpu of gpus) {
    for (const d of (gpu && gpu.spdisplays_ndrvs) || []) {
      if (!d || d.spdisplays_connection_type === 'spdisplays_internal') continue;
      if (d.spdisplays_online !== 'spdisplays_yes') continue;
      out.push({ name: String(d._name || '?'), connection: String(d.spdisplays_connection_type || '?') });
    }
  }
  return out;
}

/** Is there an internal battery, from `pmset -g batt`? */
export function hasBattery(text) {
  return /InternalBattery/.test(String(text));
}

/** The verdict: { state: 'stable' | 'unstable' | 'unknown', reason }. */
export function verdict({ lid, displays, battery }) {
  const n = displays.length;
  const ext = n === 0 ? 'no external display online' : `${n} external display${n === 1 ? '' : 's'} online`;
  if (lid === 'open') return { state: 'stable', reason: 'lid open' };
  if (n > 0) return { state: 'stable', reason: `lid ${lid === 'closed' ? 'closed' : 'unreadable'}, ${ext}` };
  if (lid === 'closed') return { state: 'unstable', reason: `lid closed, ${ext}` };
  if (!battery) return { state: 'stable', reason: 'desktop: no lid, no battery' };
  return { state: 'unknown', reason: `no clamshell key, battery present, ${ext}` };
}

export const EXIT = { stable: 0, unstable: 1, unknown: 2 };

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
const source = (file, cmd, args) => (file ? readFileSync(file, 'utf8') : run(cmd, args));

/** Read the three inputs, from files when given, else from the Mac. Each one only when `need` asks for it. */
export function readInputs(opt, need = { lid: true, displays: true, battery: true }) {
  const r = {};
  if (need.lid) r.lid = parseLid(source(opt.ioreg, 'ioreg', ['-r', '-k', 'AppleClamshellState', '-d', '4']));
  if (need.displays) r.displays = externalDisplays(source(opt.profiler, 'system_profiler', ['SPDisplaysDataType', '-json']));
  if (need.battery) r.battery = hasBattery(source(opt.batt, 'pmset', ['-g', 'batt']));
  return r;
}

function cli(argv) {
  const opt = { mode: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--ioreg', '--profiler', '--batt'].includes(a)) opt[a.slice(2)] = argv[++i];
    else if (['--stable', '--lid', '--displays', '--battery'].includes(a)) opt.mode = a.slice(2);
    else {
      process.stderr.write(`stable.mjs: unknown argument ${a}\n`);
      return 3;
    }
  }
  if (opt.mode === 'lid') {
    process.stdout.write(`${readInputs(opt, { lid: true }).lid || 'none'}\n`);
    return 0;
  }
  if (opt.mode === 'displays') {
    const d = readInputs(opt, { displays: true }).displays;
    process.stdout.write(`${d.length}\n${d.map((x) => `${x.name} (${x.connection})\n`).join('')}`);
    return 0;
  }
  if (opt.mode === 'battery') {
    process.stdout.write(`${readInputs(opt, { battery: true }).battery ? 'yes' : 'no'}\n`);
    return 0;
  }
  if (opt.mode !== 'stable') {
    process.stderr.write('stable.mjs: --stable | --lid | --displays | --battery [--ioreg f] [--profiler f] [--batt f]\n');
    return 3;
  }
  // The lid alone decides when it is open; the displays and the battery are read only when they can change the answer.
  const r = readInputs(opt, { lid: true });
  if (r.lid !== 'open') {
    r.displays = readInputs(opt, { displays: true }).displays;
    if (r.lid === null && r.displays.length === 0) r.battery = readInputs(opt, { battery: true }).battery;
  }
  const v = verdict({ lid: r.lid, displays: r.displays || [], battery: !!r.battery });
  process.stdout.write(`${v.state}: ${v.reason}\n`);
  return EXIT[v.state];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(cli(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`stable.mjs: ${e.message}\n`);
    process.exit(3);
  }
}
