// node --test e2e/gate/changed.test.mjs
// changed.mjs picks the gate legs whose drivers reach a testID that a changed file owns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { idsOwnedBy, ownersFrom, select, unitsOf } from './changed.mjs';

/** A small repo: two screens, a page object, three drivers, four legs. */
function fixture() {
  const top = mkdtempSync(path.join(tmpdir(), 'changed-'));
  const e2e = path.join(top, 'e2e');
  const put = (rel, body) => { const p = path.join(e2e, rel); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, body); };
  put('lib/pages/join.js', `import { existsTestId, tapTestId } from "../driver.js";
export const join = {
  ask(d) {
    return tapTestId(d, "JoinAsk", 1000);
  },
  read(d) {
    return existsTestId(d, "JoinStanding", 1000);
  },
};
`);
  put('lib/driver.js', 'export const tapTestId = () => {};\nexport const existsTestId = () => {};\n');
  put('run-join.mjs', `import { join } from "./lib/pages/join.js";
await join.ask(d);
`);
  put('run-standing.mjs', `import { join } from "./lib/pages/join.js";
await join.read(d);
`);
  put('run-link.mjs', `import { tapTestId } from "./lib/driver.js";
const JOURNEY = process.env.JOURNEY === "1";
async function journey(d) {
  await tapTestId(d, "JoinAsk", 1000);
}
await tapTestId(d, "LinkStart", 1000);
if (JOURNEY) await journey(d);
`);
  put('gate/legs/ask.sh', 'node run-link.mjs\nnode run-join.mjs\n');
  put('gate/legs/standing.sh', 'node run-link.mjs\nnode run-standing.mjs\n');
  put('gate/legs/link.sh', 'LINK_MODE=manual node run-link.mjs\n');
  put('gate/legs/journey.sh', 'JOURNEY=1 \\\n  node run-link.mjs\n');
  const manifests = [{ root: 'bifold/packages/core/', json: { keys: {
    JoinAsk: ['src/screens/VtiJoin.ids.ts'], JoinStanding: ['src/screens/Standing.tsx'], LinkStart: ['src/screens/Link.tsx'],
  }, stems: {} } }];
  return { top, e2e, manifests, done: () => rmSync(top, { recursive: true, force: true }) };
}

const legsFor = (changed) => {
  const f = fixture();
  try {
    const r = select(changed, { manifests: f.manifests, legsDir: path.join(f.e2e, 'gate/legs'), root: f.e2e, top: f.top });
    return { legs: [...r.legs.keys()].sort(), unmapped: r.unmapped, reasons: r.legs };
  } finally {
    f.done();
  }
};

test('a screen owns the testIDs of its typed ids map beside it', () => {
  const owners = ownersFrom([{ root: 'bifold/packages/core/', json: { keys: { JoinAsk: ['src/screens/VtiJoin.ids.ts'] }, stems: {} } }]);
  const r = idsOwnedBy(['bifold/packages/core/src/screens/VtiJoin.tsx'], owners);
  assert.deepEqual([...r.keys], ['JoinAsk']);
  assert.deepEqual(r.unmapped, []);
  // A screen that owns a stem itself still gets its ids map's keys too.
  const both = ownersFrom([{ root: 'r/', json: { keys: { A: ['s/X.ids.ts'] }, stems: { B_: ['s/X.tsx'] } } }]);
  const r2 = idsOwnedBy(['r/s/X.tsx'], both);
  assert.deepEqual([[...r2.keys], [...r2.stems]], [['A'], ['B_']]);
});

test('only the legs whose drivers reach the changed screen: the page-object method, not the whole object', () => {
  // VtiJoin owns JoinAsk: run-join calls join.ask (JoinAsk); run-standing calls join.read only; run-link's journey
  // names JoinAsk but runs only where JOURNEY=1.
  const r = legsFor(['bifold/packages/core/src/screens/VtiJoin.tsx']);
  assert.deepEqual(r.legs, ['ask', 'journey']);
  assert.ok(r.reasons.get('ask').some((w) => w.unit.endsWith('lib/pages/join.js#join.ask')));
});

test('a flow behind a flag counts only for the legs that switch it on', () => {
  const r = legsFor(['bifold/packages/core/src/screens/Link.tsx']);
  assert.deepEqual(r.legs, ['ask', 'journey', 'link', 'standing']);
  assert.deepEqual(legsFor(['bifold/packages/core/src/screens/Standing.tsx']).legs, ['standing']);
});

test('a source file that owns no testID is unmapped, never silently ignored', () => {
  const r = legsFor(['bifold/packages/core/src/module/VtaClient.ts', 'docs/notes.md']);
  assert.deepEqual(r.legs, []);
  assert.deepEqual(r.unmapped, ['bifold/packages/core/src/module/VtaClient.ts']);
});

test('units: top-level declarations, and an object literal’s methods as obj.method', () => {
  const names = unitsOf('export const join = {\n  ask(d) {\n  },\n  async read(d) {\n  },\n};\nfunction helper() {}\n').map((u) => u.name);
  assert.deepEqual(names, ['join', 'join.ask', 'join.read', 'helper']);
});

test('gate.sh changed refuses what it cannot narrow, and while paused', async () => {
  const { execFileSync } = await import('node:child_process');
  const home = mkdtempSync(path.join(tmpdir(), 'changed-cmd-'));
  try {
    mkdirSync(path.join(home, 'env'));
    writeFileSync(path.join(home, 'env', 'farm.env'), 'PNM_BIN=x\n');
    const gate = path.join(path.dirname(new URL(import.meta.url).pathname), 'gate.sh');
    const run = (...a) => {
      try { execFileSync('bash', [gate, 'changed', ...a], { env: { ...process.env, GATE_HOME: home }, encoding: 'utf8', stdio: 'pipe' }); return ''; }
      catch (e) { return String(e.stderr) + String(e.stdout); }
    };
    assert.match(run('--pin', 'abc', '--files', 'bifold/packages/core/src/module/NoIds.ts'), /own no testID.*Run the full gate/);
    writeFileSync(path.join(home, 'stop-after-leg'), 'test pause\n');
    assert.match(run('--pin', 'abc', '--files', 'bifold/packages/core/src/screens/PINEnter.tsx'), /paused \(test pause/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
