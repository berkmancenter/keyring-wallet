// node --test scripts/release/tier.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addedLines, applyHolds, changedFiles, classify, FLAGS, flagsOf, MIGRATION_PATHS, parseRange, verdict } from './tier.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);

const tierOf = (...files) => classify(files).tier;

test('screens, copy and app code travel over the air', () => {
  assert.equal(tierOf('bifold/packages/core/src/screens/PINEnter.tsx', 'bifold/packages/core/src/localization/en/en.json'), 'ota');
  assert.equal(tierOf('app/src/screens/Home.tsx', 'app/App.tsx', 'app/container-imp.ts'), 'ota');
});

test('native projects, build files, native modules and build-time config need a store build', () => {
  for (const f of [
    'app/ios/AriesBifold/Info.plist',
    'app/android/app/src/main/res/values-fr/strings.xml',
    'app/android/app/build.gradle',
    'app/ios/Podfile.lock',
    'bifold/packages/react-native-attestation/ios/Attestation.swift',
    'app/app.json',
    'app/.env',
  ]) assert.equal(tierOf('app/src/screens/Home.tsx', f), 'store', f);
});

test('dependency changes need a store build until a fingerprint check clears them; patches too', () => {
  assert.equal(tierOf('yarn.lock'), 'store');
  assert.equal(tierOf('app/package.json'), 'store');
  assert.equal(tierOf('.yarn/patches/react-native-npm-0.81.0.patch'), 'store');
});

test('stored-data migrations are never OTA, by policy', () => {
  assert.equal(tierOf(MIGRATION_PATHS[0]), 'store');
  assert.match(classify([MIGRATION_PATHS[0]]).reasons[MIGRATION_PATHS[0]], /migration/);
});

test('what the app never ships is none, even a manifest there', () => {
  assert.equal(tierOf('e2e/package.json', 'docs/plans/x.md', '.gitignore', 'app/.env.sample'), 'none');
  assert.equal(tierOf('bifold/packages/witness-server/package.json', 'bifold/yarn.lock', 'bifold/packages/core/jest.config.js'), 'none');
  assert.equal(tierOf('bifold/packages/core/src/__tests__/x.test.ts'), 'none');
});

test('an unknown path is store, never OTA by default; an unread bifold range too', () => {
  assert.equal(tierOf('app/assets/fonts/New.ttf'), 'store');
  assert.equal(tierOf('bifold@aaaaaaaa..bbbbbbbb (range unreadable here; set BIFOLD_GIT)'), 'store');
});

test('the whole change takes its highest tier', () => {
  assert.equal(tierOf('docs/a.md', 'app/src/x.tsx'), 'ota');
  assert.equal(tierOf('docs/a.md', 'app/src/x.tsx', 'app/ios/Podfile'), 'store');
});

test('flags: all three held back from OTA for now; a held flag moves an ota change to store', () => {
  const files = ['bifold/packages/core/src/modules/trust-tasks/module/oobSignIn.ts', 'bifold/packages/core/src/modules/trust-tasks/module/vtiJoin.ts', 'app/src/x.ts'];
  const flags = flagsOf(files, { 'app/src/x.ts': ['  await store.deleteById(id)'] });
  assert.deepEqual(flags.map((f) => f.flag).sort(), ['VTI protocol line', 'deletes stored records', 'sign-in / key handling']);
  assert.ok(flags.every((f) => f.hold));
  assert.equal(classify(files).tier, 'ota');
  const r = applyHolds(classify(files), flags);
  assert.equal(r.tier, 'store');
  assert.deepEqual(r.held.sort(), ['VTI protocol line', 'deletes stored records', 'sign-in / key handling']);
  for (const one of ['app/src/x.ts', 'bifold/packages/core/src/modules/trust-tasks/module/oobSignIn.ts']) {
    const only = [one];
    assert.equal(applyHolds(classify(only), flagsOf(only, { 'app/src/x.ts': ['  await store.deleteById(id)'] })).tier, 'store', one);
  }
  assert.deepEqual(applyHolds(classify(['app/src/y.tsx']), flagsOf(['app/src/y.tsx'])), { ...classify(['app/src/y.tsx']), held: [] });
  assert.deepEqual(flagsOf(['e2e/run-x.mjs', 'docs/a.md']), []);
});

test('flags: one set to hold false is shown only, and the change stays ota', () => {
  const advisory = FLAGS.map((f) => ({ ...f, hold: false }));
  const files = ['bifold/packages/core/src/modules/trust-tasks/module/oobSignIn.ts'];
  const flags = flagsOf(files, {}, advisory);
  assert.deepEqual(flags.map((f) => [f.flag, f.hold]), [['sign-in / key handling', false]]);
  const r = applyHolds(classify(files), flags);
  assert.equal(r.tier, 'ota');
  assert.deepEqual(r.held, []);
});

test('flags: a held flag never lowers a store change, and a none change stays none', () => {
  const store = ['app/ios/Podfile', 'bifold/packages/core/src/modules/trust-tasks/module/oobSignIn.ts'];
  assert.equal(applyHolds(classify(store), flagsOf(store)).tier, 'store');
  assert.equal(applyHolds(classify(['docs/a.md']), flagsOf(['docs/a.md'])).tier, 'none');
});

test('review cases that need a store build (codegen specs, fonts, CMake, app-root config, install files)', () => {
  for (const f of [
    'bifold/packages/react-native-attestation/src/NativeAttestation.ts',
    'bifold/packages/react-native-locality-peripheral/src/NativeLocalityPeripheral.ts',
    'app/src/assets/fonts/Keyring.ttf',
    'bifold/packages/core/src/assets/fonts/MaterialIcons.ttf',
    'bifold/packages/react-native-attestation/android/CMakeLists.txt',
    'app/android/app/src/main/assets/licenses.txt',
    'app/react-native.config.ts',
    'app/metro.config.ts',
    'app/babel.config.ts',
    'app/app.config.mjs',
    '.yarnrc.yml',
    '.env',
    'scripts/ensure-bifold-ready.js',
    'scripts/fix-portal-symlinks.js',
    'app/some-new-root-file.ts',
  ]) assert.equal(tierOf(f), 'store', f);
  assert.equal(tierOf('bifold/packages/core/tsconfig.build.json'), 'none');
  assert.equal(tierOf('app/index.js', 'app/App.tsx', 'app/container-imp.ts'), 'ota');
});

/** A wallet repo whose bifold is a gitlink into a second repo, two commits each. */
function repos() {
  const top = mkdtempSync(path.join(tmpdir(), 'tier-'));
  const wallet = path.join(top, 'wallet'), bifold = path.join(top, 'bifold');
  const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  const commit = (dir, m) => { if (dir !== wallet) git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m); return git(dir, 'rev-parse', 'HEAD'); };
  const put = (dir, f, body) => { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); writeFileSync(path.join(dir, f), body); };
  for (const d of [wallet, bifold]) { mkdirSync(d); git(d, 'init', '-q'); }
  put(bifold, 'packages/core/src/x.ts', 'a\n');
  const b1 = commit(bifold, 'b1');
  put(bifold, 'packages/react-native-attestation/ios/A.swift', 'native\n');
  put(bifold, 'packages/core/src/x.ts', 'a\nawait store.deleteById(id)\n');
  const b2 = commit(bifold, 'b2');
  put(wallet, 'app/src/hooks/useBCAgentSetup.ts', 'migration\n');
  git(wallet, 'add', 'app/src/hooks/useBCAgentSetup.ts');
  git(wallet, 'update-index', '--add', '--cacheinfo', `160000,${b1},bifold`);
  const w1 = commit(wallet, 'w1');
  git(wallet, 'mv', 'app/src/hooks/useBCAgentSetup.ts', 'app/src/hooks/useAgentSetup.ts');
  git(wallet, 'update-index', '--cacheinfo', `160000,${b2},bifold`);
  const w2 = commit(wallet, 'w2');
  return { wallet, bifold, w1, w2, done: () => rmSync(top, { recursive: true, force: true }) };
}

test('range mode: renames as delete + add, the bifold pin bump read through, added lines for the flags', () => {
  const r = repos();
  try {
    const files = changedFiles(`${r.w1}..${r.w2}`, { repo: r.wallet, bifold: r.bifold }).sort();
    assert.deepEqual(files, ['app/src/hooks/useAgentSetup.ts', 'app/src/hooks/useBCAgentSetup.ts', 'bifold/packages/core/src/x.ts', 'bifold/packages/react-native-attestation/ios/A.swift']);
    assert.equal(classify(files).tier, 'store');
    assert.match(classify(files).reasons['app/src/hooks/useBCAgentSetup.ts'], /migration/);
    const added = addedLines(`${r.w1}..${r.w2}`, { repo: r.wallet, bifold: r.bifold });
    assert.ok(added['bifold/packages/core/src/x.ts'].some((l) => /deleteById/.test(l)));
    assert.deepEqual(flagsOf(files, added).map((f) => f.flag), ['deletes stored records']);
  } finally {
    r.done();
  }
});

test('range mode: an unreadable bifold range is store; only a..b is accepted', () => {
  const r = repos();
  try {
    const files = changedFiles(`${r.w1}..${r.w2}`, { repo: r.wallet, bifold: path.join(r.wallet, 'no-such-clone') });
    assert.ok(files.some((f) => f.startsWith('bifold@')));
    assert.equal(classify(files).tier, 'store');
    assert.throws(() => parseRange(`${r.w1}...${r.w2}`), /base>\.\.<tip/);
    assert.throws(() => parseRange('HEAD'), /base>\.\.<tip/);
    assert.deepEqual(parseRange('staging-v0.2.0-237..staging-v0.2.0-238'), ['staging-v0.2.0-237', 'staging-v0.2.0-238']);
  } finally {
    r.done();
  }
});

test('flags: the three current flags are all held (flipping one off must change this test)', () => {
  assert.deepEqual(FLAGS.map((f) => [f.flag, f.hold]), [['deletes stored records', true], ['sign-in / key handling', true], ['VTI protocol line', true]]);
});

test('deletes stored records: storage deletes hold, a Map or Set delete does not', () => {
  const held = (line) => flagsOf(['app/src/screens/X.tsx'], { 'app/src/screens/X.tsx': [line] }).some((f) => f.flag === 'deletes stored records');
  for (const l of ['seen.delete(id)', 'new Map().delete(k)', 'this.pending.delete(key)', 'selected.remove(i)']) assert.equal(held(l), false, l);
  for (const l of ['await this.credentialRepository.deleteById(agentContext, id)', 'await agent.credentials.deleteById(id)', 'await agent.genericRecords.delete(rec)',
    'await walletStorage.remove(key)', 'await store.delete(id)', 'await deleteRecord(r)', 'forgetConnection(id)', 'wipeWallet()']) assert.equal(held(l), true, l);
});

test('verdict: --files never says ota while a held flag reads added lines; --range (added lines) can', () => {
  const f = ['app/src/screens/X.tsx'];
  const v = verdict(f);
  assert.equal(v.tier, 'unchecked');
  assert.deepEqual(v.unchecked, ['deletes stored records']);
  assert.equal(verdict(f, { added: {} }).tier, 'ota');
  assert.equal(verdict(f, { added: { [f[0]]: ['await store.delete(id)'] } }).tier, 'store');
  assert.equal(verdict(['app/ios/Podfile']).tier, 'store');
  assert.equal(verdict(['docs/a.md']).tier, 'none');
  assert.equal(verdict(['bifold/packages/core/src/modules/trust-tasks/module/oobSignIn.ts']).tier, 'store');
  assert.equal(verdict(f, { flags: FLAGS.map((x) => ({ ...x, hold: false })) }).tier, 'ota');
});

test('the command line: only exit 0 is ota; --files on a JS change exits 4; an error carries every field', () => {
  const run = (...a) => { try { return { out: execFileSync('node', [path.join(here, 'tier.mjs'), ...a], { encoding: 'utf8' }), code: 0 }; } catch (e) { return { out: e.stdout, code: e.status }; } };
  const js = run('--files', 'app/src/screens/X.tsx');
  assert.equal(js.code, 4);
  assert.match(js.out, /tier=unchecked \(ota by its paths; not checked without --range: deletes stored records\)/);
  assert.equal(run('--files', 'docs/a.md').code, 1);
  assert.equal(run('--files', 'app/ios/Podfile').code, 2);
  const err = run('--range', 'not-a-range', '--json');
  assert.equal(err.code, 3);
  assert.deepEqual(Object.keys(JSON.parse(err.out)).sort(), ['error', 'flags', 'held', 'reasons', 'tier', 'unchecked']);
});
