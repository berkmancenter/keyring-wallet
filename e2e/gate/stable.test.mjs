import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { externalDisplays, hasBattery, parseLid, verdict } from './stable.mjs';

// Captured on the gate Mac (a MacBook on Apple silicon, 10-10; serial numbers and UUIDs zeroed), trimmed to the
// IOPMrootDomain dictionary and a few children. The closed-lid, no-clamshell, external-display and no-battery
// fixtures are derived from those captures: the same shape with the one field changed, or the entry added.
const FIX = fileURLToPath(new URL('./fixtures/stable/', import.meta.url));
const fx = (name) => readFileSync(`${FIX}${name}`, 'utf8');
const STABLE = fileURLToPath(new URL('./stable.mjs', import.meta.url));
const cli = (...args) => {
  const r = spawnSync(process.execPath, [STABLE, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
};
const io = (ioreg, profiler, batt) => ['--ioreg', `${FIX}${ioreg}`, '--profiler', `${FIX}${profiler}`, '--batt', `${FIX}${batt}`];

test('lid: the exact AppleClamshellState key, No = open, Yes = closed, absent = none', () => {
  assert.equal(parseLid(fx('ioreg-lid-open.txt')), 'open');
  assert.equal(parseLid(fx('ioreg-lid-closed.txt')), 'closed');
  assert.equal(parseLid(fx('ioreg-no-clamshell.txt')), null);
  // The neighbouring key is not the lid.
  assert.equal(parseLid('"AppleClamshellCausesSleep" = Yes\n'), null);
  assert.equal(parseLid(''), null);
});

test('displays: only entries that are not internal and are online count', () => {
  assert.deepEqual(externalDisplays(fx('profiler-internal-only.json')), []);
  assert.deepEqual(externalDisplays(fx('profiler-one-external.json')), [{ name: 'External 4K', connection: 'spdisplays_displayport_dongletype_dp' }]);
  assert.equal(externalDisplays(fx('profiler-two-external.json')).length, 2);
  // A mirror set whose external panel is listed but not online (asleep): two entries, zero external displays online.
  const off = JSON.parse(fx('profiler-external-offline.json'));
  assert.equal(off.SPDisplaysDataType[0].spdisplays_ndrvs.length, 2);
  assert.deepEqual(externalDisplays(off), []);
  assert.deepEqual(externalDisplays('{}'), []);
});

test('battery: an InternalBattery line in pmset -g batt', () => {
  assert.equal(hasBattery(fx('batt-present.txt')), true);
  assert.equal(hasBattery(fx('batt-none.txt')), false);
});

test('verdict: lid open is stable whatever else; closed needs an external display online', () => {
  assert.deepEqual(verdict({ lid: 'open', displays: [], battery: true }), { state: 'stable', reason: 'lid open' });
  assert.equal(verdict({ lid: 'closed', displays: [], battery: true }).state, 'unstable');
  assert.equal(verdict({ lid: 'closed', displays: [{}], battery: true }).state, 'stable');
  assert.equal(verdict({ lid: 'closed', displays: [{}, {}], battery: false }).reason, 'lid closed, 2 external displays online');
});

test('verdict: no clamshell key and no battery is a desktop, stable; with a battery it is unknown', () => {
  assert.deepEqual(verdict({ lid: null, displays: [], battery: false }), { state: 'stable', reason: 'desktop: no lid, no battery' });
  assert.equal(verdict({ lid: null, displays: [], battery: true }).state, 'unknown');
  // A monitor online makes even an unreadable lid stable.
  assert.equal(verdict({ lid: null, displays: [{}], battery: true }).state, 'stable');
});

test('cli --stable: exit 0 stable, 1 unstable, 2 unknown, with the reason on stdout', () => {
  assert.deepEqual(cli('--stable', ...io('ioreg-lid-open.txt', 'profiler-internal-only.json', 'batt-present.txt')), { code: 0, out: 'stable: lid open', err: '' });
  assert.deepEqual(cli('--stable', ...io('ioreg-lid-closed.txt', 'profiler-internal-only.json', 'batt-present.txt')), { code: 1, out: 'unstable: lid closed, no external display online', err: '' });
  assert.deepEqual(cli('--stable', ...io('ioreg-lid-closed.txt', 'profiler-one-external.json', 'batt-present.txt')), { code: 0, out: 'stable: lid closed, 1 external display online', err: '' });
  assert.deepEqual(cli('--stable', ...io('ioreg-lid-closed.txt', 'profiler-two-external.json', 'batt-present.txt')), { code: 0, out: 'stable: lid closed, 2 external displays online', err: '' });
  assert.deepEqual(cli('--stable', ...io('ioreg-lid-closed.txt', 'profiler-external-offline.json', 'batt-present.txt')).code, 1);
  assert.deepEqual(cli('--stable', ...io('ioreg-no-clamshell.txt', 'profiler-internal-only.json', 'batt-none.txt')), { code: 0, out: 'stable: desktop: no lid, no battery', err: '' });
  assert.deepEqual(cli('--stable', ...io('ioreg-no-clamshell.txt', 'profiler-internal-only.json', 'batt-present.txt')), { code: 2, out: 'unknown: no clamshell key, battery present, no external display online', err: '' });
});

test('cli --lid, --displays, --battery print the one reading; a bad argument or file is exit 3', () => {
  assert.equal(cli('--lid', '--ioreg', `${FIX}ioreg-lid-closed.txt`).out, 'closed');
  assert.equal(cli('--lid', '--ioreg', `${FIX}ioreg-no-clamshell.txt`).out, 'none');
  assert.equal(cli('--displays', '--profiler', `${FIX}profiler-two-external.json`).out, '2\nExternal 4K (spdisplays_displayport_dongletype_dp)\nExternal HDMI (spdisplays_hdmi)');
  assert.equal(cli('--displays', '--profiler', `${FIX}profiler-external-offline.json`).out, '0');
  assert.equal(cli('--battery', '--batt', `${FIX}batt-none.txt`).out, 'no');
  assert.equal(cli('--nope').code, 3);
  assert.equal(cli('--stable', '--ioreg', `${FIX}missing.txt`).code, 3);
});
