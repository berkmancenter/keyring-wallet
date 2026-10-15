// node --test e2e/gate/nightly.test.mjs
// The nightly run (gate efficiency item 9): which legs `all` runs, when the watcher starts the nightly legs, and that
// lostreq's offline-ask row runs only there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = readFileSync(path.join(here, 'gate.sh'), 'utf8');
const fn = (name) => gate.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm'))?.[0];
const list = (name) => (gate.match(new RegExp(`^${name}="([^"]*)"`, 'm'))?.[1] ?? '').split(/\s+/).filter(Boolean);

const bash = (script, env = {}) => {
  try {
    execFileSync('bash', ['-c', `set -u\n${script}`], { env: { ...process.env, ...env }, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

test('gate.sh has leg_wanted and nightly_due to test', () => {
  assert.ok(fn('leg_wanted'), 'leg_wanted() { … } not found in gate.sh');
  assert.ok(fn('nightly_due'), 'nightly_due() { … } not found in gate.sh');
});

test('"all" leaves the nightly-only legs out; naming one still runs it', () => {
  const wanted = (leg, want) => bash(`LEGS_NIGHTLY_ONLY="${list('LEGS_NIGHTLY_ONLY').join(' ')}"\n${fn('leg_wanted')}\nleg_wanted "${leg}" "${want}"`);
  assert.equal(wanted('p2', 'all'), false, 'p2 is nightly only');
  assert.equal(wanted('p2', 'p2,lostreq'), true, 'named, it runs');
  assert.equal(wanted('lostreq', 'all'), true, 'lostreq still runs in the gate (its other rows)');
  assert.equal(wanted('kk', 'all'), true);
  assert.equal(wanted('kk', 'p1,testreq'), false);
  assert.equal(wanted('p1', 'p1,testreq'), true);
});

test('every nightly leg has a leg file and a platform list that places it', () => {
  const placed = new Set([...list('LEGS_IOS'), ...list('LEGS_ANDROID'), ...list('LEGS_SOLO')]);
  assert.deepEqual(list('LEGS_NIGHTLY'), ['p2', 'lostreq']);
  for (const leg of list('LEGS_NIGHTLY')) {
    assert.ok(placed.has(leg), `${leg} is in no platform list, so run_legs would never run it`);
    assert.ok(existsSync(path.join(here, 'legs', `${leg}.sh`)), `no legs/${leg}.sh`);
  }
  for (const leg of list('LEGS_NIGHTLY_ONLY')) assert.ok(list('LEGS_NIGHTLY').includes(leg), `${leg} is nightly only but not a nightly leg`);
});

test('nightly_due: at its hour, once a day, unless turned off', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'nightly-'));
  try {
    const now = new Date();
    const hour = String(now.getHours());
    const other = String((now.getHours() + 12) % 24);
    const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const due = (env) => bash(`${fn('nightly_due')}\nnightly_due`, { GATE_HOME: home, ...env });
    assert.equal(due({ GATE_NIGHTLY_HOUR: hour }), true, 'its hour, none yet today');
    assert.equal(due({ GATE_NIGHTLY_HOUR: other }), false, 'not its hour');
    assert.equal(due({ GATE_NIGHTLY_HOUR: hour, GATE_NIGHTLY: '0' }), false, 'turned off');
    writeFileSync(path.join(home, `nightly-${day}`), '');
    assert.equal(due({ GATE_NIGHTLY_HOUR: hour }), false, 'already started today');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the watcher starts the nightly legs only when nothing else started, and marks the day first', () => {
  const watch = fn('cmd_watch_main');
  assert.ok(watch, 'cmd_watch_main() not found');
  const at = watch.indexOf('nightly_due');
  assert.ok(at > 0, 'the watcher never asks nightly_due');
  const block = watch.slice(watch.lastIndexOf('if ', at), watch.indexOf('fi', at));
  assert.match(block, /"\$started" = 0/, 'a gate started this cycle comes first');
  assert.match(block, /! paused/);
  assert.match(block, /mac_busy/);
  assert.ok(block.indexOf('touch "$GATE_HOME/nightly-') < block.indexOf('cmd_run'), 'the day is marked before the run starts');
  assert.match(block, /--kind nightly/);
});

test("lostreq runs its offline-ask driver only in a nightly run, or when a rerun names the row", () => {
  const leg = readFileSync(path.join(here, 'legs', 'lostreq.sh'), 'utf8');
  const guard = leg.indexOf('if [ "${GATE_KIND:-}" = nightly ] || [[ ",${E2E_ONLY_ROWS:-}," == *",lost-ask-offline-error,"* ]]; then');
  const driver = leg.indexOf('node run-join-lost.mjs');
  const skip = leg.indexOf('row lost-ask-offline-error SKIP "nightly only');
  assert.ok(guard > 0, 'no nightly guard in lostreq.sh');
  assert.ok(driver > guard && skip > driver, 'run-join-lost.mjs must sit inside the guard, with the SKIP row in its else');
  // gate.sh hands every leg its run's kind.
  assert.match(fn('run_leg'), /GATE_KIND=\$\(sed -n 's\/\^kind=\/\/p' "\$rd\/meta"/);
});
