// node --test scripts/release/tier.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addedLines, applyHolds, changedFiles, classify, exemptionOf, FLAGS, flagsOf, layoutAt, MIGRATION_PATHS, parseRange, verdict } from './tier.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);

const tierOf = (...files) => classify(files).tier;

test('screens, copy and app code travel over the air', () => {
  assert.equal(tierOf('packages/core/src/screens/PINEnter.tsx', 'packages/core/src/localization/en/en.json'), 'ota');
  assert.equal(tierOf('app/src/screens/Home.tsx', 'app/App.tsx', 'app/container-imp.ts'), 'ota');
  // App.tsx composes its containers here (#658): the same bundled app JavaScript as container-imp.ts.
  assert.equal(tierOf('app/container-compose.ts'), 'ota');
});

test('native projects, build files, native modules and build-time config need a store build', () => {
  for (const f of [
    'app/ios/AriesBifold/Info.plist',
    'app/android/app/src/main/res/values-fr/strings.xml',
    'app/android/app/build.gradle',
    'app/ios/Podfile.lock',
    'packages/react-native-attestation/ios/Attestation.swift',
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
  assert.equal(tierOf('packages/witness-server/package.json', 'packages/core/jest.config.js'), 'none');
  // The e2e test-id manifest: a pin range that changes only it is `none`, like the wallet's own e2e manifests.
  assert.equal(tierOf('packages/core/testids.json'), 'none');
  // And its `none` never masks the source change that added the id, which is the shape of a UI fix that adds
  // one: classify takes the highest tier, so the pair classifies `ota`. (The CLI still answers `unchecked` for
  // that pair without --range, as it does for any path-ota change: a held flag reads added lines.)
  assert.equal(
    tierOf('packages/core/testids.json', 'packages/core/src/components/chat/Chat.ids.ts'),
    'ota'
  );
  assert.equal(tierOf('packages/core/src/__tests__/x.test.ts'), 'none');
  // A package's jest setup files (jest.config names them; nothing in src imports them): none, like jest.config.
  // 278.21's pin read store on core's jestSetup.js alone (#1079 stubbed a mock there).
  assert.equal(tierOf('packages/core/jestSetup.js'), 'none');
  assert.equal(tierOf('packages/core/jestSetupAfterEnv.js'), 'none');
  // Controls: only at a package's root. A source file named like one ships, and so does one nested in src.
  assert.equal(tierOf('packages/core/src/jestSetupLike.ts'), 'ota');
  assert.equal(tierOf('packages/core/src/x/jestSetup.js'), 'ota');
  // And the fail-safe default is untouched: an unknown file at a package's root, or one only starting like it in
  // another type, still reads store.
  assert.equal(tierOf('packages/core/setup.js'), 'store');
  assert.equal(tierOf('packages/core/jestSetup.json'), 'store');
  // On purpose: the tail is [jt]s, not [jt]sx?. A .jsx setup file nobody has written fails safe to store, and widening
  // the tail would reach into .jsx, which does ship.
  assert.equal(tierOf('packages/core/jestSetup.jsx'), 'store');
  // The same tooling dotfiles at packages/ (the framework's, applying to that subtree since the move), its shared
  // tsconfig base there, and its lint config and rules at the root; any other dotfile there, or a babel config, still
  // reads store.
  assert.equal(tierOf('packages/.prettierignore', 'packages/.gitignore', 'packages/.prettierrc', 'packages/tsconfig-base.json'), 'none');
  assert.equal(tierOf('eslint.config.mjs', 'eslint-rules/no-foo.js', 'packages/__mocks__/x.js'), 'none');
  assert.equal(tierOf('packages/.babelrc'), 'store');
  assert.equal(tierOf('packages/.env'), 'store');
  assert.equal(tierOf('packages/core/.prettierignore'), 'store');
  // The app's tooling: a hot fix branch carries its publisher, which must not make the fix read store.
  assert.equal(tierOf('app/scripts/ota-deploy.mjs', 'app/scripts/refresh-ledgers.cjs'), 'none');
  // A bifold package's dev-time generators are tooling; a native package's scripts and core's src still grade as before.
  assert.equal(tierOf('packages/core/scripts/gen-testids.mjs', 'packages/core/scripts/emoji/generate-emoji-data.mjs'), 'none');
  assert.equal(tierOf('packages/react-native-attestation/scripts/x.mjs'), 'store');
  assert.equal(tierOf('packages/core/src/scripts/x.ts'), 'ota');
  assert.equal(tierOf('packages/core/scripts/gen-testids.mjs', 'packages/core/src/screens/X.tsx'), 'ota');
  assert.equal(tierOf('app/scripts/ota-deploy.mjs', 'app/src/screens/Home.tsx'), 'ota');
  // Only its script files: a manifest or anything deeper there is not tooling by this rule.
  assert.equal(tierOf('app/scripts/package.json'), 'store');
  assert.equal(tierOf('app/scripts/lib/x.mjs'), 'store');
});

test('a third react-native-* package is native too, specs in src included; the rule follows test-builds.yml\'s glob', () => {
  // Review of the fold (2026-11-21): with a two-name allowlist, packages/react-native-foo/src/Foo.ts graded ota.
  assert.equal(tierOf('packages/react-native-foo/src/Foo.ts'), 'store');
  assert.equal(tierOf('packages/react-native-foo/android/build.gradle'), 'store');
  assert.equal(tierOf('packages/react-native-foo/README.md'), 'none');
  assert.equal(tierOf('packages/react-native-foo/__tests__/x.test.ts'), 'none');
  // Every packages/… path the Test build triggers on is a native input by the workflow's reckoning, so a sample
  // path under each must grade store here too: a glob added to the workflow under a new name fails this until the rule
  // learns it (review of the fold: a differently named native package would otherwise grade its specs as JavaScript).
  // The premise is that test-builds.yml's list names native inputs only. If a trigger path is ever added there that is
  // deliberately NOT a native input (say a jest config), exclude it HERE, in this test; do not widen tier.mjs to grade
  // it store, which would hold OTA-safe changes back from the air.
  const wf = readFileSync(path.join(here, '../../.github/workflows/test-builds.yml'), 'utf8');
  const globs = [...wf.matchAll(/^\s+- "(packages\/[^"]+)"/gm)].map((m) => m[1]);
  assert.ok(globs.includes('packages/react-native-*/**'), 'test-builds.yml names the packages/react-native-*/** trigger');
  for (const g of globs) {
    const sample = g.replace(/\*\*$/, 'src/NativeZzz.ts').replace(/\*/g, 'zzz');
    assert.equal(tierOf(sample), 'store', `${sample} is under the workflow's trigger ${g} and must be store here`);
  }
});

test('an unknown path is store, never OTA by default; a range marker and a bifold/… path too', () => {
  assert.equal(tierOf('app/assets/fonts/New.ttf'), 'store');
  assert.equal(tierOf('bifold@aaaaaaaa..bbbbbbbb (the range reaches back before the move of the framework into packages/)'), 'store');
  // The framework's old place: a path there is from before the move, and never reads ota or none, whatever it was.
  for (const f of ['bifold/packages/core/src/screens/X.tsx', 'bifold/packages/core/README.md', 'bifold/yarn.lock', 'bifold']) {
    assert.equal(tierOf(f), 'store', f);
    assert.match(classify([f]).reasons[f], /lives at packages\/ since the move/);
  }
});

test('the whole change takes its highest tier', () => {
  assert.equal(tierOf('docs/a.md', 'app/src/x.tsx'), 'ota');
  assert.equal(tierOf('docs/a.md', 'app/src/x.tsx', 'app/ios/Podfile'), 'store');
});

test('flags: a storage delete forces store; sign-in and the VTI protocol line make an ota change ota-strict', () => {
  const signIn = 'packages/core/src/modules/trust-tasks/module/oobSignIn.ts';
  const vti = 'packages/core/src/modules/trust-tasks/module/vtiJoin.ts';
  const del = { 'app/src/x.ts': ['  await store.deleteById(id)'] };
  const all = [signIn, vti, 'app/src/x.ts'];
  const flags = flagsOf(all, del);
  assert.deepEqual(flags.map((f) => [f.flag, f.policy]).sort(), [['VTI protocol line', 'strict'], ['deletes stored records', 'store'], ['sign-in / key handling', 'strict']]);
  assert.ok(flags.every((f) => !('hold' in f)));
  assert.equal(classify(all).tier, 'ota');
  const r = applyHolds(classify(all), flags);
  assert.equal(r.tier, 'store');
  assert.deepEqual(r.held, ['deletes stored records']);
  assert.deepEqual(r.strict.sort(), ['VTI protocol line', 'sign-in / key handling']);
  for (const one of [signIn, vti]) {
    const v = applyHolds(classify([one]), flagsOf([one], {}));
    assert.equal(v.tier, 'ota-strict', one);
    assert.deepEqual(v.held, []);
  }
  assert.equal(applyHolds(classify(['app/src/x.ts']), flagsOf(['app/src/x.ts'], del)).tier, 'store');
  assert.deepEqual(applyHolds(classify(['app/src/y.tsx']), flagsOf(['app/src/y.tsx'])), { ...classify(['app/src/y.tsx']), held: [], strict: [] });
  assert.deepEqual(flagsOf(['e2e/run-x.mjs', 'docs/a.md']), []);
});
test('flags: an advisory flag is shown only, and the change stays ota', () => {
  const advisory = FLAGS.map((f) => ({ ...f, policy: 'advisory' }));
  const files = ['packages/core/src/modules/trust-tasks/module/oobSignIn.ts'];
  const flags = flagsOf(files, {}, advisory);
  assert.deepEqual(flags.map((f) => [f.flag, f.policy]), [['sign-in / key handling', 'advisory']]);
  const r = applyHolds(classify(files), flags);
  assert.equal(r.tier, 'ota');
  assert.deepEqual([r.held, r.strict], [[], []]);
});
test('flags: a held flag never lowers a store change, and a none change stays none', () => {
  const store = ['app/ios/Podfile', 'packages/core/src/modules/trust-tasks/module/oobSignIn.ts'];
  assert.equal(applyHolds(classify(store), flagsOf(store)).tier, 'store');
  assert.equal(applyHolds(classify(['docs/a.md']), flagsOf(['docs/a.md'])).tier, 'none');
});

test('review cases that need a store build (codegen specs, fonts, CMake, app-root config, install files)', () => {
  for (const f of [
    'packages/react-native-attestation/src/NativeAttestation.ts',
    'packages/react-native-locality-peripheral/src/NativeLocalityPeripheral.ts',
    'app/src/assets/fonts/Keyring.ttf',
    'packages/core/src/assets/fonts/MaterialIcons.ttf',
    'packages/react-native-attestation/android/CMakeLists.txt',
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
  assert.equal(tierOf('packages/core/tsconfig.build.json'), 'none');
  assert.equal(tierOf('app/index.js', 'app/App.tsx', 'app/container-imp.ts'), 'ota');
});

/**
 * A wallet repo across the move (Phase 2 of docs/plans/single-codebase-plan.md): `gitlink` carries bifold as a submodule
 * (the pin into a stand-in clone), `fold` has the same files as a tree under bifold/, `move` renames that tree to
 * packages/, and `screen`, `vti` change files under packages/ after it.
 */
function movedRepos() {
  const top = mkdtempSync(path.join(tmpdir(), 'tier-move-'));
  const wallet = path.join(top, 'wallet'), clone = path.join(top, 'clone');
  const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
  // `add -A` would drop a gitlink whose directory is not on disk, so the gitlink-era commit stages by name.
  const commit = (dir, m, all = true) => { if (all) git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', m); return git(dir, 'rev-parse', 'HEAD'); };
  const put = (dir, f, body) => { mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); writeFileSync(path.join(dir, f), body); };
  for (const d of [wallet, clone]) { mkdirSync(d); git(d, 'init', '-q'); }
  put(clone, 'packages/core/src/x.ts', 'a\n');
  const pin = commit(clone, 'b1');
  put(wallet, 'app/src/a.ts', 'a\n');
  git(wallet, 'add', 'app/src/a.ts');
  git(wallet, 'update-index', '--add', '--cacheinfo', `160000,${pin},bifold`);
  const gitlink = commit(wallet, 'gitlink era', false);
  // The fold: the gitlink goes, the same files come in as a tree under bifold/.
  git(wallet, 'rm', '-q', '--cached', 'bifold');
  put(wallet, 'bifold/packages/core/src/x.ts', 'a\n');
  put(wallet, 'bifold/packages/core/src/hooks/useBifoldAgentSetup.ts', 'setup\n');
  const fold = commit(wallet, 'fold');
  // The move: bifold/packages/* to packages/*, renames only.
  git(wallet, 'mv', 'bifold/packages', 'packages');
  const move = commit(wallet, 'move');
  put(wallet, 'packages/core/src/screens/Home.tsx', 'screen\n');
  const screen = commit(wallet, 'a screen after the move');
  put(wallet, 'packages/core/src/modules/trust-tasks/module/VtiMediatorTransport.ts', 'line\nawait store.deleteById(id)\n');
  git(wallet, 'mv', 'app/src/a.ts', 'app/src/b.ts');
  const vti = commit(wallet, 'vti after the move, and a rename');
  return { wallet, gitlink, fold, move, screen, vti, done: () => rmSync(top, { recursive: true, force: true }) };
}

test('range mode: a range after the move reads packages/… from the wallet diff, renames as delete + add, added lines for the flags', () => {
  const r = movedRepos();
  try {
    assert.deepEqual([r.gitlink, r.fold, r.move, r.screen].map((rev) => layoutAt(r.wallet, rev)), ['bifold submodule', 'bifold tree', 'packages', 'packages']);
    const files = changedFiles(`${r.move}..${r.screen}`, { repo: r.wallet });
    assert.deepEqual(files, ['packages/core/src/screens/Home.tsx']);
    assert.equal(verdict(files, { added: addedLines(`${r.move}..${r.screen}`, { repo: r.wallet }) }).tier, 'ota');
    // The content flags read the packages/ lines from the same diff: the VTI line is strict, the storage delete holds.
    const more = changedFiles(`${r.screen}..${r.vti}`, { repo: r.wallet }).sort();
    assert.deepEqual(more, ['app/src/a.ts', 'app/src/b.ts', 'packages/core/src/modules/trust-tasks/module/VtiMediatorTransport.ts']);
    const added = addedLines(`${r.screen}..${r.vti}`, { repo: r.wallet });
    assert.ok(added['packages/core/src/modules/trust-tasks/module/VtiMediatorTransport.ts'].some((l) => /deleteById/.test(l)));
    const v = verdict(more, { added });
    assert.equal(v.tier, 'store');
    assert.deepEqual(v.held, ['deletes stored records']);
    assert.deepEqual(v.flags.map((f) => f.flag).sort(), ['VTI protocol line', 'deletes stored records']);
    // A migration path keeps its policy under its new name.
    assert.equal(classify(['packages/core/src/hooks/useBifoldAgentSetup.ts']).tier, 'store');
  } finally {
    r.done();
  }
});

test('range mode: a range with an end from before the move grades store, with the crossing named, never empty', () => {
  const r = movedRepos();
  try {
    // From the folded tree to after the move (the shape of an OTA range whose last store build predates the move).
    const files = changedFiles(`${r.fold}..${r.screen}`, { repo: r.wallet });
    assert.ok(files.some((f) => /^bifold@.*before the move.*a tree at the base, packages at the tip/.test(f)), files.join());
    assert.ok(!files.some((f) => /^(bifold|packages)\//.test(f)), 'the moved paths are not listed file by file (the marker stands for them)');
    assert.deepEqual(files.filter((f) => !f.startsWith('bifold@')), [], 'the wallet side of this range changed nothing else');
    const v = verdict(files, { added: addedLines(`${r.fold}..${r.screen}`, { repo: r.wallet }) });
    assert.equal(v.tier, 'store');
    assert.match(v.reasons[files.find((f) => f.startsWith('bifold@'))], /before the move/);
    // From the submodule era: the same, naming the gitlink.
    assert.ok(changedFiles(`${r.gitlink}..${r.screen}`, { repo: r.wallet }).some((f) => /^bifold@.*a submodule at the base/.test(f)));
    // Both ends before the move: this tool knows only the packages/ layout, so it says so rather than reading the old
    // paths as nothing (a range of two bifold-era commits is graded by the tier.mjs of that era).
    const old = changedFiles(`${r.gitlink}..${r.fold}`, { repo: r.wallet });
    assert.ok(old.some((f) => /^bifold@/.test(f)));
    assert.equal(classify(old).tier, 'store');
    // Only a..b is accepted.
    assert.throws(() => parseRange(`${r.move}...${r.screen}`), /base>\.\.<tip/);
    assert.throws(() => parseRange('HEAD'), /base>\.\.<tip/);
    assert.deepEqual(parseRange('staging-v0.2.0-237..staging-v0.2.0-238'), ['staging-v0.2.0-237', 'staging-v0.2.0-238']);
  } finally {
    r.done();
  }
});

test('flags: the current policy (changing one must change this test)', () => {
  assert.deepEqual(FLAGS.map((f) => [f.flag, f.policy]), [['deletes stored records', 'store'], ['sign-in / key handling', 'strict'], ['VTI protocol line', 'strict']]);
});
test('deletes stored records: storage deletes hold, a Map or Set delete does not', () => {
  const held = (line) => flagsOf(['app/src/screens/X.tsx'], { 'app/src/screens/X.tsx': [line] }).some((f) => f.flag === 'deletes stored records');
  for (const l of ['seen.delete(id)', 'new Map().delete(k)', 'this.pending.delete(key)', 'selected.remove(i)']) assert.equal(held(l), false, l);
  for (const l of ['await this.credentialRepository.deleteById(agentContext, id)', 'await agent.credentials.deleteById(id)', 'await agent.genericRecords.delete(rec)',
    'await walletStorage.remove(key)', 'await store.delete(id)', 'await deleteRecord(r)', 'forgetConnection(id)', 'wipeWallet()']) assert.equal(held(l), true, l);
});

test('tier-exempt: a named, reasoned exemption keeps one line out of one content flag, and is always reported', () => {
  const F = 'packages/core/src/modules/rooms/agentRoomsService.ts';
  const held = (line) => flagsOf([F], { [F]: [line] }).some((f) => f.flag === 'deletes stored records');
  // bifold #933's line: an in-memory Map named for records. Without the note it holds; with it, it does not.
  assert.equal(held('      this.recordMembers.delete(k)'), true);
  const ok = '      this.recordMembers.delete(k) // tier-exempt(deletes stored records): in-memory Map cache, not storage';
  assert.equal(held(ok), false);
  // The exemption is reported, never silent.
  const v = verdict([F], { added: { [F]: [ok] } });
  assert.deepEqual(v.exempted, [{ flag: 'deletes stored records', file: F, line: ok.trim(), reason: 'in-memory Map cache, not storage' }]);
  assert.equal(v.tier, 'ota');
  // It must name this exact flag, carry a real reason, and be a comment: anything else still holds.
  for (const l of [
    '      this.recordMembers.delete(k) // tier-exempt(sign-in / key handling): in-memory Map cache, not storage',
    '      this.recordMembers.delete(k) // tier-exempt(deletes stored records): ok',
    '      this.recordMembers.delete(k) // tier-exempt(deletes stored records):',
    '      this.recordMembers.delete(k) /* tier-exempt(deletes stored records): in-memory Map cache */',
    '      this.recordMembers.delete(k) // tier-exempt deletes stored records: in-memory Map cache',
  ]) assert.equal(held(l), true, l);
  // A real storage delete still holds when the note sits on another line.
  assert.equal(flagsOf([F], { [F]: [ok, 'await agent.genericRecords.delete(rec)'] }).some((f) => f.flag === 'deletes stored records'), true);
  assert.equal(exemptionOf('x.delete(k) // tier-exempt(deletes stored records): in-memory Set of ids', 'deletes stored records'), 'in-memory Set of ids');
});

test('tier-exempt: a path flag cannot be exempted', () => {
  const F = 'packages/core/src/modules/trust-tasks/module/VtaClient.ts';
  const note = '// tier-exempt(sign-in / key handling): a comment cannot clear a path rule';
  const v = verdict([F], { added: { [F]: [note] } });
  assert.equal(v.tier, 'ota-strict');
  assert.deepEqual(v.exempted, []);
});

test('deletes stored records: the device-store deletes hold; their reads and writes do not', () => {
  const held = (line) => flagsOf(['app/src/screens/X.tsx'], { 'app/src/screens/X.tsx': [line] }).some((f) => f.flag === 'deletes stored records');
  for (const l of ["await AsyncStorage.removeItem('draft:' + id)", 'await AsyncStorage.multiRemove(keys)', 'await AsyncStorage.clear()',
    'await SecureStore.deleteItemAsync(KEY, { keychainService })']) assert.equal(held(l), true, l);
  for (const l of ["await AsyncStorage.setItem('draft:' + id, text)", 'await AsyncStorage.getItem(key)', 'await AsyncStorage.multiGet(keys)',
    'await SecureStore.setItemAsync(KEY, value)', 'await SecureStore.getItemAsync(KEY)']) assert.equal(held(l), false, l);
  // The false-positive side, pinned: clear() is the commonest Map and Set method, so it holds only on AsyncStorage. A bare
  // \bclear\( would grade in-memory bookkeeping as store and keep ordinary JS changes off OTAs.
  for (const l of ['listeners.clear()', 'controllers.clear()', 'seen.clear()', 'map.clear()', 'this.cache.clear()', 'pending.removeItem(i)'])
    assert.equal(held(l), false, l);
  // A shipped file's added delete moves the range to store.
  const f = 'packages/core/src/modules/chat/useChatDraft.ts';
  assert.equal(verdict([f], { added: { [f]: ['    await AsyncStorage.removeItem(key)'] } }).tier, 'store');
});

test('verdict: --files never says ota (or ota-strict) while a store flag reads added lines; --range (added lines) can', () => {
  const f = ['app/src/screens/X.tsx'];
  const v = verdict(f);
  assert.equal(v.tier, 'unchecked');
  assert.deepEqual(v.unchecked, ['deletes stored records']);
  assert.equal(verdict(f, { added: {} }).tier, 'ota');
  assert.equal(verdict(f, { added: { [f[0]]: ['await store.delete(id)'] } }).tier, 'store');
  assert.equal(verdict(['app/ios/Podfile']).tier, 'store');
  assert.equal(verdict(['docs/a.md']).tier, 'none');
  const signIn = ['packages/core/src/modules/trust-tasks/module/oobSignIn.ts'];
  assert.equal(verdict(signIn).tier, 'unchecked');
  assert.equal(verdict(signIn, { added: {} }).tier, 'ota-strict');
  assert.equal(verdict(f, { flags: FLAGS.map((x) => ({ ...x, policy: 'advisory' })) }).tier, 'ota');
});
test('the command line: exit 0 ota, 5 ota-strict, 4 unchecked; an error carries every field', () => {
  const run = (...a) => { try { return { out: execFileSync('node', [path.join(here, 'tier.mjs'), ...a], { encoding: 'utf8' }), code: 0 }; } catch (e) { return { out: e.stdout, code: e.status }; } };
  const js = run('--files', 'app/src/screens/X.tsx');
  assert.equal(js.code, 4);
  assert.match(js.out, /tier=unchecked \(ota by its paths; not checked without --range: deletes stored records\)/);
  assert.equal(run('--files', 'docs/a.md').code, 1);
  assert.equal(run('--files', 'app/ios/Podfile').code, 2);
  const err = run('--range', 'not-a-range', '--json');
  assert.equal(err.code, 3);
  assert.deepEqual(Object.keys(JSON.parse(err.out)).sort(), ['error', 'exempted', 'flags', 'held', 'reasons', 'strict', 'tier', 'unchecked']);
});

test('the command line: a sign-in change read from a range exits 5 and names the strict conditions', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tier-strict-'));
  try {
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 'T'); git('config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(dir, 'app/src'), { recursive: true });
    writeFileSync(path.join(dir, 'app/src/SignIn.tsx'), 'a\n'); git('add', '.'); git('commit', '-qm', 'a');
    writeFileSync(path.join(dir, 'app/src/SignIn.tsx'), 'a\nb\n'); git('commit', '-qam', 'b');
    const out = execFileSync('node', ['--input-type=module', '-e', `
      import { changedFiles, addedLines, verdict } from ${JSON.stringify(path.join(here, 'tier.mjs'))};
      const o = { repo: ${JSON.stringify(dir)} };
      const v = verdict(changedFiles('HEAD~1..HEAD', o), { added: addedLines('HEAD~1..HEAD', o) });
      console.log(v.tier, JSON.stringify(v.strict));`], { encoding: 'utf8' }).trim();
    assert.equal(out, 'ota-strict ["sign-in / key handling"]');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('flags: an unknown or misspelt policy throws, never a plain ota', () => {
  const signIn = ['packages/core/src/modules/trust-tasks/module/oobSignIn.ts'];
  const typo = FLAGS.map((f) => (f.policy === 'strict' ? { ...f, policy: 'Strict' } : f));
  assert.throws(() => verdict(signIn, { added: {}, flags: typo }), /policy must be store, strict, advisory, not "Strict"/);
  assert.throws(() => flagsOf(['docs/a.md'], {}, [{ flag: 'x', policy: 'later', path: /x/ }]), /policy must be/);
});

test("flags read only what the app ships: the update server's own store.remove holds nothing (OTA dry run, 10-19)", () => {
  // The line that raised "deletes stored records" in the dry run, in the update server, which the app never bundles.
  const server = 'deploy/keyring-ota/src/server.mjs';
  const added = { [server]: ['    await store.remove(storageUri)'] };
  assert.equal(classify([server]).tier, 'none');
  assert.deepEqual(flagsOf([server], added), []);
  assert.equal(verdict([server], { added }).tier, 'none');
  // Beside an app change it holds nothing either: the app change keeps its own tier.
  const app = 'app/src/screens/X.tsx';
  const both = verdict([server, app], { added });
  assert.equal(both.tier, 'ota');
  assert.deepEqual([both.flags, both.held], [[], []]);
  // Every other folder the rules call none behaves the same; the same line in the app still holds.
  for (const f of ['scripts/ota/x.mjs', 'e2e/gate/x.mjs', 'packages/witness-server/src/x.ts', 'packages/mediator-server/src/x.ts', 'docs/x.md']) {
    assert.deepEqual(flagsOf([f], { [f]: added[server] }), [], f);
  }
  assert.equal(verdict([app], { added: { [app]: added[server] } }).tier, 'store');
  // An unknown path is store, and still raises its flags, so the approver sees them.
  assert.equal(flagsOf(['somewhere/new.ts'], { 'somewhere/new.ts': added[server] }).length, 1);
});

test('the VTI protocol line reads strict whatever the case of its file names', () => {
  const module = 'packages/core/src/modules/trust-tasks/module/'
  // Every protocol-line file at bifold main on 10-29, both namings.
  const files = ['TspCarriage.ts', 'VtiCommunityStore.ts', 'VtiIdentityStore.ts', 'VtiMediatorTransport.ts', 'joinManifest.ts',
    'joinSubmission.ts', 'joinWire.ts', 'triggerLink.ts', 'tspCapability.ts', 'tspFrameUnopenable.ts', 'tspProbe.ts', 'vtcBusy.ts',
    'vtiAdoptIdentities.ts', 'vtiAgent.ts', 'vtiCardStanding.ts', 'vtiCardStatusRetry.ts', 'vtiCardVault.ts', 'vtiCommunityLink.ts',
    'vtiCommunityNotices.ts', 'vtiDeliveredCheck.ts', 'vtiEligibility.ts', 'vtiGrantState.ts', 'vtiIdentityListeners.ts', 'vtiInbox.ts',
    'vtiInvitation.ts', 'vtiInvitationOffer.ts', 'vtiJoin.ts', 'vtiJoinSeed.ts', 'vtiLinks.ts', 'vtiMemberVmc.ts', 'vtiPersonaInbox.ts',
    'vtiReciprocate.ts', 'vtiStatusList.ts', 'vtiTsp.ts', 'vtiVetting.ts', 'vtiWalletCards.ts']
  for (const f of files) {
    const v = verdict([module + f], { added: {} })
    assert.deepEqual([f, v.tier, v.strict], [f, 'ota-strict', ['VTI protocol line']])
  }
  // A module file outside the line stays plain ota.
  assert.equal(verdict([module + 'cardVault.ts'], { added: {} }).tier, 'ota')
})
