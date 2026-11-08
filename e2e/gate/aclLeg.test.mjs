// node --test e2e/gate/aclLeg.test.mjs
// W3 of docs/plans/farm-test-footprint-plan.md (IN-560): a link run inside a gate leg leaves its keys to the leg's own
// cleanup (keys_since), which lists and removes every phone key the leg made once at its end, instead of listing the
// ACL again per link. Outside a gate leg, and for a refused link, a JOURNEY or `never`, nothing changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aclEndAction } from '../lib/aclCleanup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = readFileSync(path.join(here, 'lib.sh'), 'utf8');
const gate = readFileSync(path.join(here, 'gate.sh'), 'utf8');
const driver = readFileSync(path.join(here, '..', 'run-vta-link.js'), 'utf8');
const legCleaned = lib.match(/^leg_cleaned_slugs\(\) \{[\s\S]*?^\}$/m)?.[0];

/** The rule the driver used before W3, verbatim: anything here removes now, else the keys are kept for the next step. */
const before = ({ journey, expectRefusal, mode, failed }) =>
  failed || journey || expectRefusal || mode === 'always' || mode === 'never' ? 'remove' : 'keep';

const cases = [];
for (const failed of [false, true]) for (const journey of [false, true]) for (const expectRefusal of ['', 'swapHeld'])
  for (const mode of ['', 'always', 'never']) cases.push({ failed, journey, expectRefusal, mode });

test('outside a gate leg (legCleans false) every case does what it did before W3', () => {
  for (const c of cases) assert.equal(aclEndAction({ ...c, legCleans: false }), before(c), JSON.stringify(c));
});

test('in a leg that cleans the slug: a successful `always` run leaves its keys to the leg', () => {
  assert.equal(aclEndAction({ legCleans: true, mode: 'always' }), 'leg');
});

test('a failed run removes its keys at once even when the leg cleans the slug (ac on #872)', () => {
  assert.equal(aclEndAction({ legCleans: true, failed: true }), 'remove');
  assert.equal(aclEndAction({ legCleans: true, mode: 'always', failed: true }), 'remove');
});

test('in such a leg a success still hands its keys on for the next step (last-link.json is read by p1, refused, devices)', () => {
  assert.equal(aclEndAction({ legCleans: true }), 'keep');
});

test('a refused link, a JOURNEY and `never` keep their own handling even in such a leg', () => {
  assert.equal(aclEndAction({ legCleans: true, expectRefusal: 'swapRefused', failed: true }), 'remove');
  assert.equal(aclEndAction({ legCleans: true, journey: true }), 'remove');
  assert.equal(aclEndAction({ legCleans: true, mode: 'never', failed: true }), 'remove');
});

test('control: a decision that ignores legCleans fails the leg cases', () => {
  const ignoring = (c) => before(c);
  assert.notEqual(ignoring({ legCleans: true, mode: 'always' }), aclEndAction({ legCleans: true, mode: 'always' }));
});

/** leg_cleaned_slugs <leg> with the given env values, against the real leg scripts. */
function cleaned(leg, env) {
  const vars = Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('; ');
  return execFileSync('bash', ['-c', `GATE_SRC=${JSON.stringify(here)}; ${vars}\n${legCleaned}\nleg_cleaned_slugs ${leg}`]).toString().trim().split(/\s+/).filter(Boolean).sort();
}
const ENV = { RUNNER_MAIN_SLUG: 'mini-prague', RUNNER_A_SLUG: 'mini-uiux', RUNNER_B_SLUG: 'mini-openvtc', COMMUNITY_AGENT_SLUG: 'mini-community' };

test('leg_cleaned_slugs names the slugs a leg\'s own keys_since lines clean, by value', () => {
  assert.ok(legCleaned, 'lib.sh has leg_cleaned_slugs');
  assert.deepEqual(cleaned('smoke-android', ENV), ['mini-prague']);
  assert.deepEqual(cleaned('agents', ENV), ['mini-community', 'mini-prague']);
  assert.deepEqual(cleaned('update-android', ENV), ['mini-openvtc', 'mini-prague']);
  assert.deepEqual(cleaned('linkwait', ENV), ['mini-prague']);
});

test('a slug the leg cleans only when it is set (pnmlink\'s NO_REST_AGENT_SLUG) is left out when unset', () => {
  assert.deepEqual(cleaned('pnmlink', ENV), ['mini-prague']);
  assert.deepEqual(cleaned('pnmlink', { ...ENV, NO_REST_AGENT_SLUG: 'no-rest' }), ['mini-prague', 'no-rest']);
});

test('a leg with no keys_since (smoke-ci) or no script names nothing, so its drivers clean per link as before', () => {
  assert.deepEqual(cleaned('smoke-ci', ENV), []);
  assert.deepEqual(cleaned('no-such-leg', ENV), []);
});

test('run_leg hands each leg its cleaned slugs, and the driver reads them for its own slug', () => {
  assert.match(gate, /E2E_ACL_LEG_SLUGS="\$\(leg_cleaned_slugs "\$leg"\)"/);
  assert.match(driver, /const LEG_CLEANS = \(process\.env\.E2E_ACL_LEG_SLUGS \|\| ""\)\.split\(\/\\s\+\/\)\.includes\(VTA_SLUG\);/);
});

test('keepForNextStep writes last-link.json before it returns early, and lists the ACL only when the leg does not clean', () => {
  const fn = driver.match(/function keepForNextStep\([\s\S]*?\n\}\n/)?.[0] ?? '';
  const write = fn.indexOf('writeFileSync(file');
  const early = fn.indexOf('if (LEG_CLEANS)');
  const list = fn.indexOf('listAcl(');
  assert.ok(write > 0 && early > write && list > early, `order write ${write} < early return ${early} < list ${list}`);
});
