// node --test e2e/lib/otaEvidence.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { crashRolledBack, servedPattern } from "./otaEvidence.js";

// Lines from the green run's server log (gate-ota, run 38200722948, 10-12).
const LOG = [
  "2026-10-12T04:31:36.423Z GET /files/bundles/01a12e5b-e650-7e81-a4a3-29294b6b2fe8/bundle.zip",
  "2026-10-12T04:39:48.350Z GET /hot-updater/fingerprint/android/878f7c1d/ci/01a12e3e-ba3b-7000-8000-000000000000/01a12e5b-e650-7e81-a4a3-29294b6b2fe8/ring0",
  "2026-10-12T04:39:49.517Z GET /files/bundles/01a12e63-a06a-742c-86f6-10d6ed04575c/manifest.json",
].join("\n");
const GOOD = "01a12e5b-e650-7e81-a4a3-29294b6b2fe8";
const BAD = "01a12e63-a06a-742c-86f6-10d6ed04575c";

test("served: a full or an incremental download of that bundle, not another's", () => {
  assert.ok(servedPattern(GOOD).test(LOG));
  assert.ok(servedPattern(BAD).test(LOG));
  assert.ok(!servedPattern("01a12e70-0000-7000-8000-000000000000").test(LOG));
  assert.ok(servedPattern(null).test(LOG));
  assert.ok(!servedPattern(null).test(LOG.split("\n")[0]));
  assert.throws(() => servedPattern("x).*("), /not a bundle id/);
});

test("crash row: passes only when the bad bundle was served AND rolled back AND the app is on the good one at Home", () => {
  const ran = { served: true, rolledBackLabel: BAD, running: GOOD, good: GOOD, bad: BAD, home: true };
  assert.equal(crashRolledBack(ran).ok, true);
  // The path never ran: still on good, but nothing served and nothing rolled back. This used to pass.
  assert.equal(crashRolledBack({ ...ran, served: false, rolledBackLabel: "" }).ok, false);
  assert.equal(crashRolledBack({ ...ran, served: false }).ok, false);
  assert.equal(crashRolledBack({ ...ran, rolledBackLabel: "" }).ok, false);
  assert.equal(crashRolledBack({ ...ran, rolledBackLabel: `${GOOD}` }).ok, false);
  assert.equal(crashRolledBack({ ...ran, running: BAD }).ok, false);
  assert.equal(crashRolledBack({ ...ran, home: false }).ok, false);
  assert.equal(crashRolledBack({ ...ran, rolledBackLabel: `01a12e00-0000-7000-8000-000000000000, ${BAD}` }).ok, true);
});
