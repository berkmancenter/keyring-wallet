// node --test e2e/gate/builds.test.mjs
// build_runs finds a commit's push-off and push-on test builds, dispatched ones included, told apart by artifacts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = readFileSync(path.join(here, 'lib.sh'), 'utf8');
const fn = (name) => lib.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm'))?.[0];

// commit -> { push: [ids], dispatch: [ids, newest first] }; run id -> artifact names.
const RUNS = {
  rel240: { push: [], dispatch: ['11', '22'] }, // a release branch: push-off and push-on both dispatched, push-off newest
  rel241: { push: [], dispatch: ['9', '11', '22'] }, // a newer push-off build whose artifacts expired, then good ones
  relAndroid: { push: [], dispatch: ['66'] }, // an Android-only push-off dispatch: not a full gate's build
  main1: { push: ['33'], dispatch: ['44'] },
  head2: { push: [], dispatch: ['55'] },
};
const ART = {
  9: ['!keyring-ios-sim-rel241-bfX', '!keyring-android-rel241-bfX'], // "!" = expired
  11: ['keyring-ios-sim-rel240-bfX', 'keyring-android-rel240-bfX'],
  66: ['keyring-android-relAndroid-bfX'],
  22: ['keyring-android-rel240-bfX-push-on'],
  44: ['keyring-android-main1-bfX-push-on'],
  55: ['keyring-android-head2-bfX-push-on'],
};

function buildRuns(sha, { pushOnSha = '', override = '' } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), 'builds-'));
  try {
    if (override) writeFileSync(path.join(home, `build-override-${sha.slice(0, 8)}`), `${override}\n`);
    const script = `
      set -u
      gh() {
        if [ "$1 $2" = "run list" ]; then
          local commit= event=; while [ $# -gt 0 ]; do case $1 in --commit) commit=$2;; --event) event=$2;; esac; shift; done
          node -e 'const R=JSON.parse(process.argv[1]); const r=R[process.argv[2]]||{push:[],dispatch:[]}; const ids=process.argv[3]==="push"?r.push:r.dispatch; if (ids.length) console.log(process.argv[3]==="push"?ids[0]:ids.join("\\n"))' '${JSON.stringify(RUNS)}' "$commit" "$event"
        elif [ "$1" = api ]; then
          local id=\${2#*/runs/}; id=\${id%%/*}
          local live=0; case "$*" in *'select(.expired|not)'*) live=1;; esac
          node -e 'const A=JSON.parse(process.argv[1]); for (const n of A[process.argv[2]]||[]) { if (n.startsWith("!") && process.argv[3]==="1") continue; console.log(n.replace(/^!/, "")) }' '${JSON.stringify(ART)}' "$id" "$live"
        fi
      }
      GH_REPO=x/y GATE_HOME=${JSON.stringify(home)}
      ${fn('dispatch_build')}
      ${fn('build_runs')}
      ${pushOnSha ? `GATE_PUSH_ON_SHA=${pushOnSha} ` : ''}build_runs ${sha}
    `;
    return execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('lib.sh has dispatch_build and build_runs', () => {
  assert.ok(fn('dispatch_build') && fn('build_runs'));
});

test('a release branch: the dispatched push-off build, and the push-on one, not the newest green dispatch', () => {
  assert.equal(buildRuns('rel240'), '11 22');
});

test('main: the push build, and the dispatched push-on build', () => {
  assert.equal(buildRuns('main1'), '33 44');
});

test('GATE_PUSH_ON_SHA: the push-on build of main HEAD stands for this commit', () => {
  assert.equal(buildRuns('main1', { pushOnSha: 'head2' }), '33 55');
});

test('an expired newer build is passed over; an Android-only push-off dispatch is not a full gate’s build', () => {
  assert.equal(buildRuns('rel241'), '11 22'); // not 9: its artifacts expired
  assert.equal(buildRuns('relAndroid'), '- -');
});

test('an override file still wins, and a commit with no builds says so', () => {
  assert.equal(buildRuns('rel240', { override: '7 8' }), '7 8');
  assert.equal(buildRuns('nothing'), '- -');
});
