/**
 * WITNESSED two-wallet VRC exchange on REAL DEVICES (attended): an Android
 * phone paired with an iPhone. Flow lives in lib/witnessedExchangeFlow.js —
 * see that file's header for the phase breakdown; this script only wires up
 * device discovery and the two sessions.
 *
 * Same hardware-attested exchange as run-vrc-exchange-devices.js, but both
 * wallets first connect to a locally-run witness server, so the exchange
 * auto-routes through the witness and each wallet ends up with a Verifiable
 * Witness Credential (VWC) in addition to the peer VRC.
 *
 * With the DI cryptosuite work, this proves the witness issues a
 * DataIntegrityProof/eddsa-rdfc-2022 VWC and both wallets store it. See
 * docs/CRYPTO_SUITE_FOLLOWUP.md and e2e/README.md.
 *
 * ATTENDED: satisfy the OS biometric/PIN prompts at the OPERATOR banners.
 * The witness runs behind a cloudflared HTTPS tunnel, so no shared LAN is
 * needed between the phones and the machine running this script.
 *
 * Usage: npm run vrc-exchange:witnessed:devices
 *        (or: yarn e2e:vrc:witnessed:devices from repo root)
 *
 * No macOS/Xcode? See run-vrc-exchange-witnessed-android-only-devices.js —
 * same flow, a second physical Android phone stands in for the iPhone
 * (preserves hardware-attestation coverage; two-emulator variants can't,
 * since emulators can't do hardware attestation).
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { createSession } from "./lib/driver.js";
import {
  ANDROID_APK,
  ANDROID_UDID,
  IOS_DEVICE_APP,
  IOS_UDID,
  androidDeviceCaps,
  iosDeviceCaps,
} from "./lib/config.js";
import { runWitnessedExchange, dumpAndroidWitnessLogs } from "./lib/witnessedExchangeFlow.js";

// ---------- device discovery ----------

function detectAndroidUdid() {
  if (ANDROID_UDID) return ANDROID_UDID;
  const out = execSync("adb devices").toString();
  const physical = out
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter(([id, state]) => id && state === "device" && !id.startsWith("emulator-"))
    .map(([id]) => id);
  if (physical.length !== 1) {
    throw new Error(
      `expected exactly one physical android device (found: ${physical.join(", ") || "none"}). ` +
        `Set ANDROID_UDID to pick one.`
    );
  }
  return physical[0];
}

function detectIosUdid() {
  if (IOS_UDID) return IOS_UDID;
  execSync("xcrun devicectl list devices --json-output /tmp/e2e-devicectl.json", {
    stdio: "ignore",
  });
  const json = JSON.parse(readFileSync("/tmp/e2e-devicectl.json", "utf8"));
  const iphones = (json.result?.devices || [])
    .filter((d) => d.hardwareProperties?.deviceType === "iPhone")
    .map((d) => ({
      name: d.deviceProperties?.name,
      udid: d.hardwareProperties?.udid,
      tunnel: d.connectionProperties?.tunnelState,
    }));
  let candidates = iphones.filter((d) => d.tunnel === "connected");
  if (candidates.length === 0) {
    let usb = [];
    try {
      usb = execSync("idevice_id -l").toString().trim().split(/\n/).filter(Boolean);
    } catch {
      /* libimobiledevice may be missing */
    }
    if (usb.length === 0) {
      try {
        const xt = execSync("xcrun xctrace list devices").toString();
        const live = xt.split("== Devices Offline ==")[0] || xt;
        usb = [...live.matchAll(/\(([0-9A-F-]{25,})\)/g)].map((m) => m[1]);
      } catch {
        /* ignore */
      }
    }
    candidates = iphones.filter((d) => usb.includes(d.udid));
  }
  if (candidates.length !== 1) {
    throw new Error(
      `expected exactly one connected iPhone (found: ${candidates.map((d) => d.name).join(", ") || "none"}). ` +
        `Set IOS_UDID to pick one.`
    );
  }
  console.log(`[e2e] iPhone detected: ${candidates[0].name} (${candidates[0].udid})`);
  return candidates[0].udid;
}

function preflight() {
  if (!existsSync(ANDROID_APK)) {
    throw new Error(
      `Android APK not found: ${ANDROID_APK}\n  Build it: cd app/android && ./gradlew assembleDebug`
    );
  }
  if (!existsSync(IOS_DEVICE_APP)) {
    throw new Error(
      `iOS device build not found: ${IOS_DEVICE_APP}\n  Build it (see e2e/README.md "Real devices").`
    );
  }
}

preflight();
const androidUdid = detectAndroidUdid();
try {
  execSync(`adb -s ${androidUdid} logcat -c`);
} catch {
  /* non-fatal */
}

await runWitnessedExchange({
  detectDevices: () => ({ a: androidUdid, b: detectIosUdid() }),
  createSessionA: (udid) => createSession("android", androidDeviceCaps(udid)),
  createSessionB: (udid) => createSession("ios", iosDeviceCaps(udid)),
  // only session A is Android here — an iOS udid isn't reachable via `adb logcat`
  dumpWitnessLogs: () => dumpAndroidWitnessLogs([androidUdid]),
});
