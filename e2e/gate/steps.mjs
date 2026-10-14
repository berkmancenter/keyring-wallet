#!/usr/bin/env node
// Step times of a leg (gate-efficiency phase 0): sums a leg's steps.tsv ("<name>\t<start epoch>\t<seconds>", written by
// lib.sh's galarm, emu_start, sim_boot and key cleanup, or by smoke-ci) by step name, longest first.
//   node e2e/gate/steps.mjs <steps.tsv> [top]   prints "steps: <name> <n>× <time>, …" for gate.sh report
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The lines of a steps.tsv as { name, start, seconds }; malformed lines are skipped. */
export function parseSteps(text) {
  return text
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((f) => f.length >= 3 && f[0] && /^\d+$/.test(f[1]) && /^\d+$/.test(f[2]))
    .map(([name, start, seconds]) => ({ name, start: Number(start), seconds: Number(seconds) }));
}

/** Steps summed by name: [{ name, count, seconds }], longest total first, ties by name. */
export function sumSteps(steps) {
  const by = new Map();
  for (const s of steps) {
    const t = by.get(s.name) ?? { name: s.name, count: 0, seconds: 0 };
    t.count++;
    t.seconds += s.seconds;
    by.set(s.name, t);
  }
  return [...by.values()].sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
}

/** 75 → "1m15s", 3600 → "60m", 9 → "9s". */
export function dur(s) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m${s % 60}s` : `${m}m`;
}

/** The report line: the top steps and their share of the timed total. */
export function stepsLine(steps, top = 4) {
  const sums = sumSteps(steps);
  if (!sums.length) return '';
  const total = sums.reduce((a, s) => a + s.seconds, 0);
  const shown = sums.slice(0, top).map((s) => `${s.name} ${s.count > 1 ? `${s.count}× ` : ''}${dur(s.seconds)}`);
  return `steps: ${shown.join(', ')}${sums.length > top ? `, +${sums.length - top} more` : ''} (timed ${dur(total)})`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [file, top] = process.argv.slice(2);
  if (!file || !existsSync(file)) process.exit(0);
  const line = stepsLine(parseSteps(readFileSync(file, 'utf8')), Number(top) || 4);
  if (line) console.log(line);
}
