// node --test e2e/gate/repro.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowSkeleton, slugOf, unitSkeleton, unitTestPath } from './repro.mjs';

test('a slug from the report id and the first words of what the tester saw', () => {
  assert.equal(slugOf('IN-257', 'After a wrong PIN, the six dots stay filled'), 'in-257-after-a-wrong-pin-the');
  assert.equal(slugOf('IN-259'), 'in-259');
});

test('a unit test goes in the module’s __tests__, a screen’s as .tsx', () => {
  assert.equal(unitTestPath('bifold/packages/core/src/modules/trust-tasks/module/VtaClient.ts', 'in-259'), 'bifold/packages/core/src/modules/trust-tasks/__tests__/in-259.test.ts');
  assert.equal(unitTestPath('bifold/packages/core/src/screens/PINEnter.tsx', 'in-257'), 'bifold/packages/core/src/__tests__/in-257.test.tsx');
});

test('both starting tests fail until they are written: red first', () => {
  assert.match(unitSkeleton({ id: 'IN-259', saw: "it's minted in contexts[0]" }), /expect\('replace this'\)\.toBe\(/);
  assert.match(unitSkeleton({ id: 'IN-259', saw: "it's minted" }), /describe\('IN-259: it\\'s minted'/);
  const row = rowSkeleton({ id: 'IN-257', saw: 'dots stay', slug: 'in-257-dots' });
  assert.match(row, /rows\.row\("in-257-dots"/);
  assert.match(row, /ok: false/);
  assert.match(row, /tracked: "IN-257: until the fix ships"/);
});
