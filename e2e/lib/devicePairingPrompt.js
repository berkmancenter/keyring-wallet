// Interactive fallback for choosing a device/emulator pairing when the env
// var that normally decides it (PLATFORMS, DEVICE_PLATFORMS) is unset. Never
// overrides the env var — it only fires when there's nothing else to go on,
// and only when stdin is a real terminal (never in CI/scripted/non-TTY runs,
// where guessing would be the actual risk).
import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

import { listConnectedIphones, listPhysicalAndroidSerials } from "./deviceDiscovery.js";

/** `choices`: `{label, value}[]`. Returns the chosen `value`. */
export async function promptSelect(question, choices) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\n[e2e] ${question}`);
    choices.forEach((c, i) => console.log(`  [${i + 1}] ${c.label}`));
    for (;;) {
      const answer = (await rl.question(`[e2e] choice (1-${choices.length}): `)).trim();
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1].value;
      console.log(`[e2e] enter a number from 1 to ${choices.length}`);
    }
  } finally {
    rl.close();
  }
}

/**
 * Real-device pairing (run-vrc-exchange-devices.js,
 * run-vrc-exchange-witnessed-devices.js). `DEVICE_PLATFORMS`, when set,
 * always wins — this only resolves the choice when it's unset. Only prompts
 * when the attached hardware genuinely supports more than one pairing (e.g.
 * 2 Android phones + 1 iPhone all connected); if only one pairing is
 * physically possible, returns it directly, no prompt. If neither is
 * possible, returns today's default and leaves the "nothing attached" error
 * to the runner's own detectAndroidUdid/detectIosUdid calls — this function
 * only resolves which pairing to attempt, never device-not-found errors.
 */
export async function resolveDevicePlatforms({ envVar = "DEVICE_PLATFORMS" } = {}) {
  const envVal = process.env[envVar];
  if (envVal) return envVal.split(",").map((s) => s.trim());

  const androidCount = tryCount(listPhysicalAndroidSerials);
  const iphoneCount = tryCount(listConnectedIphones);
  const canAndroidIos = androidCount >= 1 && iphoneCount >= 1;
  const canAndroidAndroid = androidCount >= 2;

  if (canAndroidIos && canAndroidAndroid) {
    if (!process.stdin.isTTY) return ["android", "ios"];
    return promptSelect(
      `Multiple device pairings possible (found ${androidCount} Android phone(s), ${iphoneCount} iPhone(s)) — which do you want?`,
      [
        { label: "android + iPhone", value: ["android", "ios"] },
        { label: "android + android", value: ["android", "android"] },
      ]
    );
  }
  if (canAndroidAndroid) return ["android", "android"];
  return ["android", "ios"];
}

/**
 * Emulator pairing (run-vrc-exchange.js). No hardware is "attached" —
 * emulators only exist once booted by AVD name — so this always offers the
 * choice when interactive, rather than only when ambiguous.
 */
export async function resolveEmulatorPlatforms({ envVar = "PLATFORMS" } = {}) {
  const envVal = process.env[envVar];
  if (envVal) return envVal.split(",").map((s) => s.trim());
  if (!process.stdin.isTTY) return ["android", "ios"];

  const avds = listAndroidAvds();
  if (avds.length < 2) return ["android", "ios"]; // no second AVD — android,android isn't practical

  const choice = await promptSelect("Which emulator pairing do you want?", [
    { label: "android + iOS simulator (default)", value: "ios" },
    { label: "android + android (two emulators)", value: "android" },
  ]);
  return choice === "android" ? ["android", "android"] : ["android", "ios"];
}

/** Every AVD `emulator -list-avds` currently reports; `[]` on any failure. */
export function listAndroidAvds() {
  try {
    return execSync("emulator -list-avds")
      .toString()
      .split("\n")
      .map((s) => s.trim())
      // `emulator` sometimes also prints an "INFO | Storing crashdata..."
      // line to stdout, not stderr — AVD names never contain a space, so
      // this is enough to drop it without a fragile "starts with INFO" check.
      .filter((s) => s && /^\S+$/.test(s));
  } catch {
    return [];
  }
}

/**
 * The second AVD for a android,android emulator pairing, when ANDROID_AVD2
 * isn't set: 0 other AVDs → null (caller keeps its own "set ANDROID_AVD2"
 * error); 1 → use it, no prompt; 2+ on a real terminal → prompt; 2+ without
 * one (CI/scripted) → null too, same as 0 — ambiguous and non-interactive
 * must fail loudly via the caller's existing error, never hang on a prompt
 * nothing will ever answer.
 */
export async function resolveSecondAvd(avds, firstAvd) {
  const candidates = avds.filter((a) => a !== firstAvd);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  if (!process.stdin.isTTY) return null;
  return promptSelect(
    `Which AVD is wallet B? (wallet A is ${firstAvd})`,
    candidates.map((a) => ({ label: a, value: a }))
  );
}

function tryCount(listFn) {
  try {
    return listFn().length;
  } catch {
    return 0;
  }
}
