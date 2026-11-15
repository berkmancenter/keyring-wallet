// node --test e2e/gate/linkTrigger.test.mjs
// W1 of docs/plans/farm-test-footprint-plan.md (IN-560): the link legs leave the nightly's fixed list and run when
// (a) a link file changed, (b) a runner VTA's or pnm's version moved, (c) always in the store gate; trimmed rows when
// they run outside the store gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, fingerprintDiff, linkFiles } from './linkTrigger.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = readFileSync(path.join(here, 'gate.sh'), 'utf8');
const lib = readFileSync(path.join(here, 'lib.sh'), 'utf8');
const fn = (src, name) => src.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm'))?.[0];
const line = (src, v) => src.match(new RegExp(`^${v}=.*$`, 'm'))?.[0];
const words = (src, v) => (line(src, v) ?? '').replace(/^[A-Z_]+="|"$/g, '').split(/\s+/).filter(Boolean);
const FP = { runners: { 'mini-prague': '0.65.0' }, pnm: { 'pins/gate-pnm3': 'aaaa' } };

test('(a) the link rule: link screens, clients and harness count; tests and other files do not', () => {
  const files = [
    'bifold/packages/core/src/modules/trust-tasks/module/VtaClient.ts',
    'bifold/packages/core/src/modules/trust-tasks/module/vtaAgent.ts',
    'bifold/packages/core/src/modules/trust-tasks/screens/VtaLink.tsx',
    'bifold/packages/core/src/modules/trust-tasks/screens/MyAgent.tsx',
    'bifold/packages/core/src/modules/trust-tasks/screens/linkFailureWords.ts',
    'e2e/run-vta-link.js', 'e2e/lib/aclCleanup.js', 'e2e/lib/pages/link.js',
    'e2e/gate/legs/linkfail.sh', 'e2e/gate/legs/linkwait.sh', 'e2e/gate/legs/pnmlink.sh',
  ];
  assert.deepEqual(linkFiles(files), files);
  assert.deepEqual(linkFiles([
    'bifold/packages/core/src/modules/trust-tasks/__tests__/VtaClient.test.ts', 'e2e/lib/aclCleanup.test.mjs',
    'bifold/packages/core/src/modules/chat/inbound.ts', 'app/src/screens/Developer.tsx', 'e2e/gate/legs/kk.sh',
  ]), []);
});

test('regression (ac on #874): #974\'s own files, inside the 278.7 pin bump, trigger through the trust-tasks package', () => {
  const pr974 = [
    'bifold/packages/core/__tests__/modules/trust-tasks/sharedConnectRealKms.test.ts',
    'bifold/packages/core/src/modules/trust-tasks/module/sharedConnect.ts',
    'bifold/packages/core/src/modules/trust-tasks/module/sharedConnectCeremony.ts',
    'bifold/packages/core/src/modules/trust-tasks/module/sharedConnectStore.ts',
    'bifold/packages/trust-tasks/src/documentProof.ts',
  ];
  assert.deepEqual(linkFiles(pr974), ['bifold/packages/trust-tasks/src/documentProof.ts']);
  assert.equal(decide({ files: pr974, prevFingerprint: FP, fingerprint: FP }).run, true);
});

test('the decision: nothing moved → no; a link file, a VTA version, a pnm file, no record, an unknown range → run', () => {
  assert.equal(decide({ files: ['app/src/x.ts'], prevFingerprint: FP, fingerprint: FP }).run, false);
  assert.equal(decide({ files: ['e2e/run-vta-link.js'], prevFingerprint: FP, fingerprint: FP }).run, true);
  assert.match(decide({ files: [], prevFingerprint: FP, fingerprint: { ...FP, runners: { 'mini-prague': '0.66.0' } } }).why.join(), /VTA mini-prague: 0\.65\.0 → 0\.66\.0/);
  assert.match(decide({ files: [], prevFingerprint: FP, fingerprint: { ...FP, pnm: { 'pins/gate-pnm3': 'bbbb' } } }).why.join(), /pnm pins\/gate-pnm3/);
  assert.equal(decide({ files: [], prevFingerprint: undefined, fingerprint: FP }).run, true);
  assert.equal(decide({ files: [], rangeKnown: false, prevFingerprint: FP, fingerprint: FP }).run, true);
});

test('a runner added or gone counts as a change', () => {
  assert.equal(fingerprintDiff(FP, { ...FP, runners: { ...FP.runners, 'mini-uiux': '0.69.0' } }).length, 1);
  assert.equal(fingerprintDiff(FP, { ...FP, runners: {} }).length, 1);
});

test('(b) end to end: the fingerprint is recorded, unchanged reads no trigger, an altered /openapi.json version triggers', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'linktrig-'));
  try {
    writeFileSync(path.join(dir, 'openapi.json'), JSON.stringify({ info: { version: '0.65.0' } }));
    writeFileSync(path.join(dir, 'pnm'), 'a pnm');
    const cli = path.join(here, 'linkTrigger.mjs'), F = path.join(dir, 'fp.json');
    const common = ['--fingerprint-file', F, '--runner', `mini-prague=file://${dir}`, '--pnm', path.join(dir, 'pnm')];
    execFileSync('node', [cli, '--record', '--pin', 'abc123', ...common]);
    const rec = JSON.parse(readFileSync(F, 'utf8'));
    assert.equal(rec.pin, 'abc123');
    assert.deepEqual(rec.runners, { 'mini-prague': '0.65.0' });
    const same = spawnSync('node', [cli, '--range', 'HEAD..HEAD', ...common], { encoding: 'utf8' });
    assert.equal(same.status, 1, same.stdout + same.stderr);
    writeFileSync(path.join(dir, 'openapi.json'), JSON.stringify({ info: { version: '0.66.0' } }));
    const moved = spawnSync('node', [cli, '--range', 'HEAD..HEAD', ...common], { encoding: 'utf8' });
    assert.equal(moved.status, 0);
    assert.match(moved.stdout, /VTA mini-prague: 0\.65\.0 → 0\.66\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** gate.sh's nightly-legs and link_record against a stand-in linkTrigger.mjs (exit STUB_RC; --record writes the file). */
function gateRun(body, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nightlylegs-'));
  try {
    const src = path.join(dir, 'src'); mkdirSync(src); mkdirSync(path.join(dir, 'home'));
    symlinkSync(path.join(here, 'legs'), path.join(src, 'legs'));
    writeFileSync(path.join(src, 'linkTrigger.mjs'), `import fs from 'node:fs';
const a = process.argv.slice(2); fs.appendFileSync(process.env.ARGS, a.join(' ') + '\\n');
if (a.includes('--record')) { fs.writeFileSync(a[a.indexOf('--fingerprint-file') + 1], JSON.stringify({ pin: a[a.indexOf('--pin') + 1] })); process.exit(0); }
process.exit(Number(process.env.STUB_RC));
`);
    const vars = Object.entries({ RUNNER_MAIN_SLUG: 'mini-prague', RUNNER_MAIN_URL: 'https://vta-prague.example', ...env }).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('; ');
    const script = `set -u
      GATE_SRC=${JSON.stringify(src)}; GATE_HOME=${JSON.stringify(path.join(dir, 'home'))}; ARGS=${JSON.stringify(path.join(dir, 'args'))}; export ARGS
      say() { echo "SAY $*"; }; usage() { echo USAGE; exit 2; }
      ${vars}
      ${['LEGS_NIGHTLY_MACBOOK', 'LEGS_NIGHTLY_IOS', 'LEGS_NIGHTLY_ANDROID', 'LEGS_LINK', 'LINK_FP'].map((v) => line(gate, v)).join('\n')}
      ${fn(gate, 'link_trigger_args')}
      ${fn(gate, 'cmd_nightly_legs')}
      ${fn(gate, 'link_record')}
      ${body}`;
    const r = spawnSync('bash', ['-c', script], { env: { ...process.env, ...env }, encoding: 'utf8' });
    const home = path.join(dir, 'home');
    return { out: r.stdout, err: r.stderr, status: r.status, args: existsSync(path.join(dir, 'args')) ? readFileSync(path.join(dir, 'args'), 'utf8') : '',
      pending: existsSync(path.join(home, 'link-pending')) ? readFileSync(path.join(home, 'link-pending'), 'utf8') : null,
      fp: existsSync(path.join(home, 'link-fingerprint.json')) ? JSON.parse(readFileSync(path.join(home, 'link-fingerprint.json'), 'utf8')) : null, home };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const LINK = ['linkwait', 'linkfail', 'pnmlink'];

test('nightly-legs: with no trigger the Android part has none of the three legs; with one it has all three', () => {
  const none = gateRun('cmd_nightly_legs --part android --pin abc', { STUB_RC: '1' });
  const legs = none.out.trim().split(',');
  assert.ok(legs.includes('smoke-android') && LINK.every((l) => !legs.includes(l)), none.out);
  assert.equal(none.pending, 'abc\t0\n');
  const due = gateRun('cmd_nightly_legs --part android --pin abc', { STUB_RC: '0' });
  assert.ok(LINK.every((l) => due.out.trim().split(',').includes(l)), due.out);
  assert.equal(due.pending, 'abc\t1\n');
});

test('nightly-legs: the iOS and MacBook parts are the fixed lists, with no trigger asked', () => {
  const r = gateRun('cmd_nightly_legs --part ios --pin abc; cmd_nightly_legs --part macbook --pin abc', { STUB_RC: '0' });
  assert.deepEqual(r.out.trim().split('\n'), ['kk,smoke-ios,update-ios,signin-ios', 'pair-ios']);
  assert.equal(r.args, '');
});

test('with no recorded pin nightly-legs passes no range, and the trigger runs saying so', () => {
  const r = gateRun('cmd_nightly_legs --part android --pin new2', { STUB_RC: '0' });
  assert.doesNotMatch(r.args, /--range/);
  const cli = path.join(here, 'linkTrigger.mjs');
  for (const range of [undefined, 'abc123', '..abc', 'abc..']) {
    const out = spawnSync('node', [cli, ...(range === undefined ? [] : ['--range', range])], { encoding: 'utf8' });
    assert.equal(out.status, 0, String(range));
    assert.match(out.stdout, /no last nightly pin to compare with/, String(range));
    assert.doesNotMatch(out.stderr, /invalid object name/, String(range));
  }
});

test('nightly-legs passes the last recorded pin as the range start, and the runners by value', () => {
  const r = gateRun(`echo '{"pin":"old1"}' > "$GATE_HOME/link-fingerprint.json"; cmd_nightly_legs --part android --pin new2`, { STUB_RC: '1' });
  assert.match(r.args, /--range old1\.\.new2 /);
  assert.match(r.args, /--runner mini-prague=https:\/\/vta-prague\.example/);
});

test('link_record: a due night records only once linkfail ran; a quiet night records once the Android part ran', () => {
  const tsv = (rows) => rows.map((r) => r.join('\t')).join('\n');
  const notRun = gateRun(`mkdir -p "$GATE_HOME/r"; printf 'abc\\t1\\n' > "$GATE_HOME/link-pending"; printf '%s\\n' '${tsv([['smoke-android', 0, 1, 2]])}' > "$GATE_HOME/r/legs.tsv"; link_record "$GATE_HOME/r"`);
  assert.equal(notRun.fp, null);
  assert.match(notRun.out, /did not run; tried again next night/);
  const ran = gateRun(`mkdir -p "$GATE_HOME/r"; printf 'abc\\t1\\n' > "$GATE_HOME/link-pending"; printf '%s\\n' '${tsv([['smoke-android', 0, 1, 2], ['linkfail', 0, 3, 4]])}' > "$GATE_HOME/r/legs.tsv"; link_record "$GATE_HOME/r"`);
  assert.equal(ran.fp?.pin, 'abc');
  const killed = gateRun(`mkdir -p "$GATE_HOME/r"; printf 'abc\\t1\\n' > "$GATE_HOME/link-pending"; printf '%s\\n' '${tsv([['smoke-android', 0, 1, 2], ['linkfail', 137, 3, 4]])}' > "$GATE_HOME/r/legs.tsv"; link_record "$GATE_HOME/r"`);
  assert.equal(killed.fp, null, 'a linkfail killed (137) never records the pin (ac on #874)');
  for (const rc of [134, 139, 127, 2]) {
    const r = gateRun(`mkdir -p "$GATE_HOME/r"; printf 'abc\\t1\\n' > "$GATE_HOME/link-pending"; printf '%s\\n' '${tsv([['smoke-android', 0, 1, 2], ['linkfail', rc, 3, 4]])}' > "$GATE_HOME/r/legs.tsv"; link_record "$GATE_HOME/r"`);
    assert.equal(r.fp, null, `rc ${rc} records nothing`);
  }
  const quiet = gateRun(`mkdir -p "$GATE_HOME/r"; printf 'abc\\t0\\n' > "$GATE_HOME/link-pending"; printf '%s\\n' '${tsv([['smoke-android', 0, 1, 2]])}' > "$GATE_HOME/r/legs.tsv"; link_record "$GATE_HOME/r"`);
  assert.equal(quiet.fp?.pin, 'abc');
  const iosOnly = gateRun(`mkdir -p "$GATE_HOME/r"; printf 'abc\\t0\\n' > "$GATE_HOME/link-pending"; printf '%s\\n' '${tsv([['kk', 0, 1, 2]])}' > "$GATE_HOME/r/legs.tsv"; link_record "$GATE_HOME/r"`);
  assert.equal(iosOnly.fp, null, 'an iOS-only run (the mini runs iOS first) records nothing');
});

test('link_trigger_args: runners by value from the link legs\' *_SLUG and *_URL; a slug with no URL is left out', () => {
  const r = gateRun('link_trigger_args', { NO_REST_AGENT_SLUG: 'no-rest' });
  assert.deepEqual(r.out.trim().split('\n'), ['--runner', 'mini-prague=https://vta-prague.example']);
});

test('link_trigger_args: behind the REST wrapper, PNM_INNER and the builds it names are fingerprinted too', () => {
  const setup = `printf '%s\\n' 'exec "\$PNM_INNER" "\$@"' > "$GATE_HOME/rest"
    printf '%s\\n' "b=\\\${GATE_PNM_047:-$GATE_HOME/pnm047}" > "$GATE_HOME/inner"; : > "$GATE_HOME/pnm047"
    PNM_BIN=$GATE_HOME/rest`;
  const pnm = (out) => out.trim().split('\n').filter((l, i, a) => a[i - 1] === '--pnm').map((f) => path.basename(f));
  const r = gateRun(`${setup}; PNM_INNER=$GATE_HOME/inner; link_trigger_args`);
  assert.deepEqual(pnm(r.out), ['rest', 'inner', 'pnm047'], r.out + r.err);
  // Control: without following PNM_INNER (the code before this fix), only the REST wrapper itself was fingerprinted.
  assert.deepEqual(pnm(gateRun(`${setup}; unset PNM_INNER; link_trigger_args`).out), ['rest']);
  // PNM_BIN the wrapper itself (no REST): its builds once, no duplicate when PNM_INNER names the same file.
  const direct = gateRun(`printf '%s\\n' "b=\\\${GATE_PNM_047:-$GATE_HOME/pnm047}" > "$GATE_HOME/inner"; : > "$GATE_HOME/pnm047"; PNM_BIN=$GATE_HOME/inner; PNM_INNER=$GATE_HOME/inner; link_trigger_args`);
  assert.deepEqual(pnm(direct.out), ['inner', 'pnm047'], direct.out + direct.err);
});

test('(c) the store gate still runs all three: linkwait is an Android leg and linkfail, pnmlink run alone after', () => {
  assert.ok(words(gate, 'LEGS_ANDROID').includes('linkwait'));
  assert.deepEqual(words(gate, 'LEGS_SOLO'), ['linkfail', 'pnmlink']);
});

test('the nightly lists hold no link leg, and the Android part is the old local list minus linkwait and linkfail', () => {
  for (const v of ['LEGS_NIGHTLY_MACBOOK', 'LEGS_NIGHTLY_IOS', 'LEGS_NIGHTLY_ANDROID']) assert.ok(LINK.every((l) => !words(gate, v).includes(l)), v);
  const old = 'smoke-android,devices,testreq,waiting,lostreq,agents,update-android,relaunch-android,linkwait,refused,hv,p1,linkfail'.split(',');
  assert.deepEqual(words(gate, 'LEGS_NIGHTLY_ANDROID'), old.filter((l) => !LINK.includes(l)));
  assert.deepEqual(words(gate, 'LEGS_LINK'), LINK);
});

test('trims: only a nightly or changed run with no rows named trims; the store gate, a dry run, named rows and LINK_FULL do not', () => {
  const trimmed = (env) => spawnSync('bash', ['-c', `${fn(lib, 'link_trimmed')}\nlink_trimmed`], { env: { PATH: process.env.PATH, ...env } }).status === 0;
  assert.equal(trimmed({ GATE_KIND: 'nightly' }), true);
  assert.equal(trimmed({ GATE_KIND: 'changed' }), true);
  assert.equal(trimmed({ GATE_KIND: 'gate' }), false);
  assert.equal(trimmed({ GATE_KIND: 'dry' }), false);
  assert.equal(trimmed({}), false);
  assert.equal(trimmed({ GATE_KIND: 'nightly', E2E_ONLY_ROWS: 'swap-held-rescan' }), false);
  assert.equal(trimmed({ GATE_KIND: 'nightly', LINK_FULL: '1' }), false);
});

test('the trimmed sets: linkwait background + force-close, linkfail refused + one held, pnmlink one link', () => {
  const read = (l) => readFileSync(path.join(here, 'legs', `${l}.sh`), 'utf8');
  assert.equal(line(read('linkwait'), 'WAIT_TRIMMED'), 'WAIT_TRIMMED="create-window-paused link-address-resume"');
  assert.equal(line(read('linkfail'), 'FAIL_TRIMMED'), 'FAIL_TRIMMED="swap-held swap-refused"');
  assert.match(read('pnmlink'), /link_trimmed && \[ -z "\$\{LINK_CASES:-\}" \] && \{ link_trim_skips pnmlink pnmqr-scan "\$PNM_CASES"; LINK_CASES=pnmqr-scan; \}/);
  // Every linkfail row goes through want() (selected + the trim): a bare `selected` would run a trimmed row.
  const lf = read('linkfail');
  assert.doesNotMatch(lf.slice(lf.indexOf('want() {') + 60), /\bif selected |\|\| selected /);
});
