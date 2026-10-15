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

test('gate.sh has leg_wanted and the nightly window functions to test', () => {
  for (const name of ['leg_wanted', 'nightly_marker', 'nightly_hour', 'nightly_due', 'nightly_missed']) assert.ok(fn(name), `${name}() { … } not found in gate.sh`);
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
  assert.deepEqual(list('LEGS_NIGHTLY'), ['p2', 'lostreq', 'linkwait']);
  for (const leg of list('LEGS_NIGHTLY')) {
    assert.ok(placed.has(leg), `${leg} is in no platform list, so run_legs would never run it`);
    assert.ok(existsSync(path.join(here, 'legs', `${leg}.sh`)), `no legs/${leg}.sh`);
  }
  for (const leg of list('LEGS_NIGHTLY_ONLY')) assert.ok(list('LEGS_NIGHTLY').includes(leg), `${leg} is nightly only but not a nightly leg`);
});

test('nightly_due: inside the window, once a day, unless turned off; nightly_missed after it, unmarked', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'nightly-'));
  try {
    const now = new Date();
    const h = now.getHours();
    const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const fns = ['nightly_marker', 'nightly_hour', 'nightly_due', 'nightly_missed'].map(fn).join('\n');
    const due = (env) => bash(`${fns}\nnightly_due`, { GATE_HOME: home, ...env });
    const missed = (env) => bash(`${fns}\nnightly_missed`, { GATE_HOME: home, ...env });
    // A window that holds this hour, one that ended before it, and one that starts after it.
    const inside = { GATE_NIGHTLY_HOUR: String(h), GATE_NIGHTLY_UNTIL: String(h + 1) };
    const passed = h > 0 ? { GATE_NIGHTLY_HOUR: '0', GATE_NIGHTLY_UNTIL: String(h) } : null;
    const ahead = h < 23 ? { GATE_NIGHTLY_HOUR: String(h + 1), GATE_NIGHTLY_UNTIL: '24' } : null;
    assert.equal(due(inside), true, 'inside the window, none yet today');
    assert.equal(missed(inside), false, 'not missed while the window is open');
    if (passed) {
      assert.equal(due(passed), false, 'outside the window: it has passed');
      assert.equal(missed(passed), true, 'the window passed with no run: missed');
    }
    if (ahead) {
      assert.equal(due(ahead), false, 'outside the window: not yet');
      assert.equal(missed(ahead), false, 'a window still to come is not missed');
    }
    assert.equal(due({ ...inside, GATE_NIGHTLY: '0' }), false, 'turned off');
    if (passed) assert.equal(missed({ ...passed, GATE_NIGHTLY: '0' }), false, 'turned off: nothing missed');
    writeFileSync(path.join(home, `nightly-${day}`), '');
    assert.equal(due(inside), false, 'already started today');
    if (passed) assert.equal(missed(passed), false, 'marked: said only once');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Structural, not behavioural: the loop runs for ever against GitHub and the Mac, so this reads cmd_watch_main's and
// cmd_run's source for the rules (review on #487); nightly_due and nightly_missed above are run for real.
test('the watcher starts the nightly legs only when nothing else started, and the run marks its day once it holds the lock', () => {
  const watch = fn('cmd_watch_main');
  assert.ok(watch, 'cmd_watch_main() not found');
  const at = watch.indexOf('nightly_due');
  assert.ok(at > 0, 'the watcher never asks nightly_due');
  const block = watch.slice(watch.lastIndexOf('if ', at), watch.indexOf('\n    fi', at));
  assert.match(block, /"\$started" = 0/, 'a gate started this cycle comes first');
  assert.match(block, /! paused/);
  assert.match(block, /mac_busy/);
  assert.match(block, /GATE_NIGHTLY_MARK=\$\(nightly_marker\) cmd_run --pin "\$sha" --kind nightly/);
  assert.match(block, /elif nightly_missed; then[\s\S]*nightly_marker[\s\S]*say "nightly: the/, 'a missed window is said and marked');
  const run = fn('cmd_run');
  assert.ok(run.indexOf('GATE_NIGHTLY_MARK') > run.indexOf('run_lock'), 'the day is marked only once the run holds the lock');
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

// The real-clocks build behind the nightly linkwait: gh, git, samebuild and the wait are stubbed; the choice is run.
test('nightly_real_build: an existing build, HEAD standing in, an app change, and one request then a wait', () => {
  const run = ({ head, same = 'same', builds = {}, appearsAfterWait = '' }) => {
    const home = mkdtempSync(path.join(tmpdir(), 'real-'));
    try {
      const script = `
        say() { echo "say: $*"; }
        git() { echo "${head}"; }
        node() { echo "${same}"; }
        sleep() { touch "$GATE_HOME/waited"; }
        gh() { echo "$*" >> "$GATE_HOME/gh"; }
        dispatch_build() {
          case "$1" in ${Object.entries(builds).map(([k, v]) => `${k}) echo ${v}; return ;;`).join(' ')} esac
          [ -n "${appearsAfterWait}" ] && [ -f "$GATE_HOME/waited" ] && [ "$1" = "${appearsAfterWait}" ] && echo 999
        }
        REPO=. GATE_SRC=. GH_REPO=x/y
        ${fn('nightly_real_build')}
        nightly_real_build sha1
      `;
      const out = execFileSync('bash', ['-c', script], { env: { ...process.env, GATE_HOME: home }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      const gh = existsSync(path.join(home, 'gh')) ? readFileSync(path.join(home, 'gh'), 'utf8').trim().split('\n') : [];
      return { out, gh, marked: existsSync(path.join(home, 'watch-requested-real-sha1')) || existsSync(path.join(home, 'watch-requested-real-head2')) };
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  };
  // Of this very commit, already built: no request.
  assert.deepEqual(run({ head: 'sha1', builds: { sha1: '77' } }), { out: 'sha1', gh: [], marked: false });
  // Main moved on with no app change: HEAD's build stands for this commit.
  assert.deepEqual(run({ head: 'head2', builds: { head2: '88' } }), { out: 'head2', gh: [], marked: false });
  // Main moved on with an app change: none can be made, and nothing is asked for.
  assert.deepEqual(run({ head: 'head2', same: 'differs: app/src', builds: { head2: '88' } }), { out: '', gh: [], marked: false });
  // None yet: asked for once (Android, real clocks, on main), then found after a wait.
  const asked = run({ head: 'sha1', appearsAfterWait: 'sha1' });
  assert.equal(asked.out, 'sha1');
  assert.deepEqual(asked.gh, ['workflow run test-builds.yml -R x/y --ref main -f platform=android -f clocks=real']);
  assert.equal(asked.marked, true);
});

test('linkwait in a nightly run takes the real-clocks build, and skips saying why without one', () => {
  const leg = readFileSync(path.join(here, 'legs', 'linkwait.sh'), 'utf8');
  const nightly = leg.indexOf('if [ "${GATE_KIND:-}" = nightly ]; then');
  assert.ok(nightly > 0 && nightly < leg.indexOf('leg_begin linkwait "$(shasum'), 'the nightly choice comes before the leg starts on a build');
  assert.match(leg, /row linkwait SKIP "nightly: no real-clocks build/);
  assert.match(leg, /APK=\$APK_REAL/);
  // The watcher hands the run the commit whose real-clocks build stands for the nightly one.
  assert.match(fn('cmd_watch_main'), /real_sha=\$\(nightly_real_build "\$sha"\)[\s\S]*GATE_REAL_SHA=\$real_sha [^\n]*--kind nightly/);
});
