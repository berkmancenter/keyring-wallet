import assert from "node:assert/strict";
import { test } from "node:test";

import { answerConfirmSheet } from "./confirmSheet.js";

// From bifold #937 on, the confirm sheet a signing act asks shows on every emulator and simulator (no biometrics
// there), and Confirm opens a Keyring PIN entry. Before, the confirm was skipped there and this helper never saw
// the sheet; a sheet it does not fill stalls the leg (join, invitation, vetting).

/** The sheet as the app shows it: Confirm and Cancel. */
const SHEET = { ConfirmBiometric: {}, CancelBiometric: {} };

// The sheet logic, driven directly with a scripted screen and no waiting. No driver and no webdriverio, so these run in
// CI without e2e's node_modules; the cases through handleBiometricConfirmIfPresent are in confirmSheetFlows.test.mjs.
function io(screen, onTap = {}) {
  const shown = new Set(Object.keys(screen));
  const taps = [];
  const typed = [];
  let t = 0;
  return {
    taps,
    typed,
    shown,
    exists: async (key) => shown.has(key),
    tap: async (key) => {
      taps.push(key);
      onTap[key]?.(shown);
    },
    typePin: async (key, pin) => typed.push([key, pin]),
    sleep: async (ms) => void (t += ms),
    now: () => t,
  };
}

test("the sheet asks for the Keyring PIN: Confirm, the PIN typed, its Confirm, and the entry closes", async () => {
  const s = io(SHEET, {
    ConfirmBiometric: (shown) => {
      shown.delete("ConfirmBiometric");
      shown.delete("CancelBiometric");
      shown.add("ConfirmActionEnterPIN");
      shown.add("ConfirmActionWithPIN");
    },
    ConfirmActionWithPIN: (shown) => {
      shown.delete("ConfirmActionEnterPIN");
      shown.delete("ConfirmActionWithPIN");
    },
  });
  assert.equal(await answerConfirmSheet(s, { pin: "135790" }), "pin");
  assert.deepEqual(s.taps, ["ConfirmBiometric", "ConfirmActionWithPIN"]);
  assert.deepEqual(s.typed, [["ConfirmActionEnterPIN", "135790"]]);
});

test("the biometric key not there: the first Confirm leaves the sheet up offering the PIN, the second opens it", async () => {
  let first = true;
  const s = io(SHEET, {
    ConfirmBiometric: (shown) => {
      if (first) return void (first = false); // the sheet stays, now in its PIN mode
      shown.delete("ConfirmBiometric");
      shown.add("ConfirmActionEnterPIN");
    },
    ConfirmActionWithPIN: (shown) => shown.delete("ConfirmActionEnterPIN"),
  });
  assert.equal(await answerConfirmSheet(s, { pin: "135790" }), "pin");
  assert.deepEqual(s.taps, ["ConfirmBiometric", "ConfirmBiometric", "ConfirmActionWithPIN"]);
});

test("only Cancel on the sheet (Keyring can't check the PIN here): the step fails in words, nothing is tapped", async () => {
  const s = io({ CancelBiometric: {} });
  await assert.rejects(answerConfirmSheet(s, { pin: "135790" }), /offers only Cancel/);
  assert.deepEqual(s.taps, []);
});

test("only Cancel left after Confirm: the step fails in words", async () => {
  const s = io(SHEET, { ConfirmBiometric: (shown) => shown.delete("ConfirmBiometric") });
  await assert.rejects(answerConfirmSheet(s, { pin: "135790" }), /offers only Cancel/);
});

test("the PIN entry still open after its Confirm: the step fails, it does not pass as confirmed", async () => {
  const s = io(SHEET, {
    ConfirmBiometric: (shown) => {
      shown.delete("ConfirmBiometric");
      shown.add("ConfirmActionEnterPIN");
    },
  });
  await assert.rejects(answerConfirmSheet(s, { pin: "135790", closeWithin: 2000 }), /still open/);
  assert.deepEqual(s.typed, [["ConfirmActionEnterPIN", "135790"]]);
});
