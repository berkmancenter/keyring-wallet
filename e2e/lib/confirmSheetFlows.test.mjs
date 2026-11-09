import assert from "node:assert/strict";
import { test } from "node:test";

import { PIN } from "./config.js";
import { handleBiometricConfirmIfPresent } from "./flows.js";
import { fakeDriver } from "./pages/testing/fakeDriver.mjs";

// From bifold #937 on, the confirm sheet a signing act asks shows on every emulator and simulator (no biometrics
// there), and Confirm opens a Keyring PIN entry. Before, the confirm was skipped there and this helper never saw
// the sheet; a sheet it does not fill stalls the leg (join, invitation, vetting).
// These go through handleBiometricConfirmIfPresent (lib/flows.js, which imports webdriverio), so they need e2e's
// node_modules; the sheet logic itself is tested without them in confirmSheet.test.mjs.

/** The sheet as the app shows it: Confirm and Cancel. */
const SHEET = { ConfirmBiometric: {}, CancelBiometric: {} };

/** Confirm opens the PIN entry; its Confirm closes it only for the run's PIN. */
function pinSheet(d) {
  d.onTap.ConfirmBiometric = () => {
    d.hide("ConfirmBiometric", "CancelBiometric");
    d.show("ConfirmActionEnterPIN");
    d.show("ConfirmActionWithPIN");
  };
  d.onTap.ConfirmActionWithPIN = () => {
    if (d.values.ConfirmActionEnterPIN === PIN) d.hide("ConfirmActionEnterPIN", "ConfirmActionWithPIN");
  };
}

test("no sheet: nothing is tapped, as before", async () => {
  const d = fakeDriver({ platform: "ios", screen: {} });
  assert.equal(await handleBiometricConfirmIfPresent(d), false);
  assert.deepEqual(d.taps, []);
});

for (const platform of ["android", "ios"]) {
  test(`the sheet asks for the Keyring PIN (${platform}): the run's PIN is typed and the entry closes`, async () => {
    const d = fakeDriver({ platform, screen: { ...SHEET } });
    pinSheet(d);
    assert.equal(await handleBiometricConfirmIfPresent(d), true);
    // The field is tapped to focus it, as unlockIfLocked does.
    assert.deepEqual(d.taps, ["ConfirmBiometric", "ConfirmActionEnterPIN", "ConfirmActionWithPIN"]);
    assert.equal(d.values.ConfirmActionEnterPIN, PIN);
    assert.equal(d.has("ConfirmActionEnterPIN"), false);
  });
}

test("the sheet asks for the phone's biometrics (a real device): Confirm only, the OS prompt is the operator's", async () => {
  const d = fakeDriver({ platform: "ios", screen: { ...SHEET } });
  // While the OS prompt is up the sheet shows a spinner: neither button.
  d.onTap.ConfirmBiometric = () => d.hide("ConfirmBiometric", "CancelBiometric");
  assert.equal(await handleBiometricConfirmIfPresent(d), true);
  assert.deepEqual(d.taps, ["ConfirmBiometric"]);
  assert.equal(d.values.ConfirmActionEnterPIN, undefined);
});
