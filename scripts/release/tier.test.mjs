// node --test scripts/release/tier.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, flagsOf, MIGRATION_PATHS } from './tier.mjs';

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

test('flags for the approver: data beside the tier, never the tier itself', () => {
  const files = ['bifold/packages/core/src/modules/trust-tasks/module/oobSignIn.ts', 'bifold/packages/core/src/modules/trust-tasks/module/vtiJoin.ts', 'app/src/x.ts'];
  const flags = flagsOf(files, { 'app/src/x.ts': ['  await store.deleteById(id)'] });
  assert.deepEqual(flags.map((f) => f.flag).sort(), ['VTI protocol line', 'deletes stored records', 'sign-in / key handling']);
  assert.equal(classify(files).tier, 'ota');
  assert.deepEqual(flagsOf(['e2e/run-x.mjs', 'docs/a.md']), []);
});
