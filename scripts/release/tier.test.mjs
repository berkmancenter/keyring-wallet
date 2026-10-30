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
  // App.tsx composes its containers here (#658): the same bundled app JavaScript as container-imp.ts.
  assert.equal(tierOf('app/container-compose.ts'), 'ota');
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
  // The e2e test-id manifest: a pin range that changes only it is `none`, like the wallet's own e2e manifests.
  assert.equal(tierOf('bifold/packages/core/testids.json'), 'none');
  // And its `none` never masks the source change that added the id, which is the shape of a UI fix that adds
  // one: classify takes the highest tier, so the pair classifies `ota`. (The CLI still answers `unchecked` for
  // that pair without --range, as it does for any path-ota change: a held flag reads added lines.)
  assert.equal(
    tierOf('bifold/packages/core/testids.json', 'bifold/packages/core/src/components/chat/Chat.ids.ts'),
    'ota'
  );
  assert.equal(tierOf('bifold/packages/core/src/__tests__/x.test.ts'), 'none');
  // The app's tooling: a hot fix branch carries its publisher, which must not make the fix read store.
  assert.equal(tierOf('app/scripts/ota-deploy.mjs', 'app/scripts/refresh-ledgers.cjs'), 'none');
  assert.equal(tierOf('app/scripts/ota-deploy.mjs', 'app/src/screens/Home.tsx'), 'ota');
  // Only its script files: a manifest or anything deeper there is not tooling by this rule.
  assert.equal(tierOf('app/scripts/package.json'), 'store');
  assert.equal(tierOf('app/scripts/lib/x.mjs'), 'store');
});

test('an unknown path is store, never OTA by default; an unread bifold range too', () => {
  assert.equal(tierOf('app/assets/fonts/New.ttf'), 'store');
  assert.equal(tierOf('bifold@aaaaaaaa..bbbbbbbb (range unreadable here; set BIFOLD_GIT)'), 'store');
});

test('the whole change takes its highest tier', () => {
  assert.equal(tierOf('docs/a.md', 'app/src/x.tsx'), 'ota');
  assert.equal(tierOf('docs/a.md', 'app/src/x.tsx', 'app/ios/Podfile'), 'store');
});

test('flags: a storage delete forces store; sign-in and the VTI protocol line make an ota change ota-strict', () => {
  const signIn = 'bifold/packages/core/src/modules/trust-tasks/module/oobSignIn.ts';
  const vti = 'bifold/packages/core/src/modules/trust-tasks/module/vtiJoin.ts';
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
  const files = ['bifold/packages/core/src/modules/trust-tasks/module/oobSignIn.ts'];
  const flags = flagsOf(files, {}, advisory);
  assert.deepEqual(flags.map((f) => [f.flag, f.policy]), [['sign-in / key handling', 'advisory']]);
  const r = applyHolds(classify(files), flags);
  assert.equal(r.tier, 'ota');
  assert.deepEqual([r.held, r.strict], [[], []]);
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

test('flags: the current policy (changing one must change this test)', () => {
  assert.deepEqual(FLAGS.map((f) => [f.flag, f.policy]), [['deletes stored records', 'store'], ['sign-in / key handling', 'strict'], ['VTI protocol line', 'strict']]);
});
test('deletes stored records: storage deletes hold, a Map or Set delete does not', () => {
  const held = (line) => flagsOf(['app/src/screens/X.tsx'], { 'app/src/screens/X.tsx': [line] }).some((f) => f.flag === 'deletes stored records');
  for (const l of ['seen.delete(id)', 'new Map().delete(k)', 'this.pending.delete(key)', 'selected.remove(i)']) assert.equal(held(l), false, l);
  for (const l of ['await this.credentialRepository.deleteById(agentContext, id)', 'await agent.credentials.deleteById(id)', 'await agent.genericRecords.delete(rec)',
    'await walletStorage.remove(key)', 'await store.delete(id)', 'await deleteRecord(r)', 'forgetConnection(id)', 'wipeWallet()']) assert.equal(held(l), true, l);
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
  const signIn = ['bifold/packages/core/src/modules/trust-tasks/module/oobSignIn.ts'];
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
  assert.deepEqual(Object.keys(JSON.parse(err.out)).sort(), ['error', 'flags', 'held', 'reasons', 'strict', 'tier', 'unchecked']);
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
  const signIn = ['bifold/packages/core/src/modules/trust-tasks/module/oobSignIn.ts'];
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
  for (const f of ['scripts/ota/x.mjs', 'e2e/gate/x.mjs', 'bifold/packages/witness-server/src/x.ts', 'bifold/packages/mediator-server/src/x.ts', 'docs/x.md']) {
    assert.deepEqual(flagsOf([f], { [f]: added[server] }), [], f);
  }
  assert.equal(verdict([app], { added: { [app]: added[server] } }).tier, 'store');
  // An unknown path is store, and still raises its flags, so the approver sees them.
  assert.equal(flagsOf(['somewhere/new.ts'], { 'somewhere/new.ts': added[server] }).length, 1);
});

test('the VTI protocol line reads strict whatever the case of its file names', () => {
  const module = 'bifold/packages/core/src/modules/trust-tasks/module/'
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
