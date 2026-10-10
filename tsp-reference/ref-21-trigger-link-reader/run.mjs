// Runs every conformance vector against reader.mjs. Exits 0 only if all pass.
import { readFileSync } from 'node:fs';
import { readTrigger, selectService } from './reader.mjs';

const file = JSON.parse(readFileSync(new URL('./fixtures/vectors.json', import.meta.url), 'utf8'));
const { config } = file;

// Deep equality that ignores object key order.
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
}

function runSet(label, vectors, run) {
  let pass = 0;
  for (const v of vectors) {
    let got;
    try {
      got = run(v);
    } catch (e) {
      got = { error: e.message };
    }
    if (same(got, v.expect)) pass++;
    else console.log(`FAIL ${label} ${v.id}\n  expected ${JSON.stringify(v.expect)}\n  got      ${JSON.stringify(got)}`);
  }
  console.log(`${label}: ${pass}/${vectors.length} passed`);
  return pass === vectors.length;
}

const okTrigger = runSet('trigger', file.vectors, (v) => readTrigger(v.input, { channel: v.channel, config }));
const okSelection = runSet('selection', file.selectionVectors ?? [], (v) => selectService(v.input, config.selection));
process.exit(okTrigger && okSelection ? 0 : 1);
