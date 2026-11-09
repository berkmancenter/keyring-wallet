// node --test e2e/gate/hvVetterBuild.test.mjs
// The seated vetters run the build under test: kk's and hv's both install the candidate over the seat (data kept).
// hv did not until 10-23, so 268's hv judged a 268 applicant against a 267 vetter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const leg = (name) => readFileSync(path.join(here, 'legs', `${name}.sh`), 'utf8');

test('kk installs the build over its seated vetter, after booting it', () => {
  const src = leg('kk');
  const boot = src.indexOf('sim_boot "$VETTER_SIM_UDID"');
  const install = src.indexOf('xcrun simctl install "$VETTER_SIM_UDID" "$CAND_APP"');
  assert.ok(boot > 0 && install > boot);
});

test('hv installs the build over its seated Keyring vetter, after booting it and before the driver', () => {
  const src = leg('hv');
  const boot = src.indexOf('sim_boot "$HV_VETTER_UDID"');
  const install = src.indexOf('xcrun simctl install "$HV_VETTER_UDID" "$CAND_APP"');
  assert.ok(boot > 0 && install > boot, 'installed after the boot');
  assert.ok(install < src.indexOf('node e2e/openvtc/run-hv.mjs'), 'before run-hv');
  assert.match(src.slice(install, src.indexOf('\n', install)), /\|\| broken /, 'a failed install breaks the leg');
});
