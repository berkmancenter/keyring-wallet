/**
 * WITNESSED two-wallet VRC exchange on REAL DEVICES (attended): an Android
 * phone paired with an iPhone, with LOCALITY (BLE co-presence) OFFERED —
 * attempted on both, gated on neither, and each side's outcome REPORTED.
 *
 * This is the first-run variant. The `required`-policy runner
 * (run-vrc-exchange-witnessed-locality-android-only-devices.js) asserts both
 * phones' co-presence was confirmed, which is the right bar once both
 * peripherals are known to work. Until then it would only ever tell you
 * "something failed" — this one tells you WHAT each peripheral did:
 *
 *   - Android: the [TrustTasks:Witness] locality confirmed / not confirmed
 *     marker, from run-scoped logcat (verified live against BlueZ 2026-08-21;
 *     this is its first run against the noble/CoreBluetooth witness).
 *   - iOS: the peripheral's own [Locality:Peripheral:iOS] NSLog lines via
 *     Appium syslog, including `signingElapsedMs` — the latency App Attest's
 *     generateAssertion spends INSIDE the witness's 400ms RTT bound, which
 *     the iOS design cannot pre-authorize away (locality-plan/2026-09-12-al.md)
 *     and which only a device run can measure. This is that peripheral's
 *     first run, full stop.
 *
 * The WITNESS runs on THIS machine. On macOS it uses the CoreBluetooth/noble
 * sensor (keyring-bifold #49), so no Linux host is needed; on Linux it uses
 * BlueZ. Either way this machine needs a real Bluetooth adapter and the
 * phones within radio range of it — the DIDComm task channel still goes
 * through the cloudflared tunnel like every other witnessed variant.
 *
 * ATTENDED: satisfy the OS biometric/PIN prompts at the OPERATOR banners on
 * BOTH phones; tap Allow on the Bluetooth pre-flight sheet on each phone
 * right after it connects to the witness; and accept the OS Bluetooth
 * permission prompt that follows (Android 12+: advertise + scan; iOS: the
 * "uses Bluetooth to confirm you are in the same room" prompt).
 *
 * Usage: npm run vrc-exchange:witnessed:locality:devices
 *        (or: yarn e2e:vrc:witnessed:locality:devices from repo root)
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

// Offered, not required: the witness attempts the radio leg for each party
// and issues the VWC regardless (locality-plan.md §8.2). WITNESS_LOCALITY_REQUIRED
// stays at the harness default ("false") for the same reason.
process.env.WITNESS_LOCALITY_POLICY = "offered";

// ---------- device discovery (same as run-vrc-exchange-witnessed-devices.js) ----------

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
  execSync("xcrun devicectl list devices --json-output /tmp/e2e-devicectl.json", { stdio: "ignore" });
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
  console.log(`[e2e] iPhone: ${candidates[0].name} (${candidates[0].udid})`);
  return candidates[0].udid;
}

function preflight() {
  if (!existsSync(ANDROID_APK)) {
    throw new Error(`Android APK not found: ${ANDROID_APK}\n  Build it: cd app/android && ./gradlew assembleDebug`);
  }
  if (!existsSync(IOS_DEVICE_APP)) {
    throw new Error(`iOS device build not found: ${IOS_DEVICE_APP}\n  Build it (see e2e/README.md "Real devices").`);
  }
}

preflight();
const androidUdid = detectAndroidUdid();
try {
  execSync(`adb -s ${androidUdid} logcat -c`);
} catch {
  /* non-fatal */
}

// E2E_IOS_FIRST=1 makes the iPhone wallet A — it then connects to the witness
// (and hits the pre-flight sheet) before the Android phone does. Useful when
// one phone's witness connect is the thing under investigation: the other
// phone's outcome lands first instead of never being reached (2026-09-13, a
// Galaxy A03s timing out on the mediator round trip on every attempt).
const iosFirst = process.env.E2E_IOS_FIRST === "1";
const android = { detect: () => androidUdid, create: (udid) => createSession("android", androidDeviceCaps(udid)) };
const ios = { detect: () => detectIosUdid(), create: (udid) => createSession("ios", iosDeviceCaps(udid)) };
const [first, second] = iosFirst ? [ios, android] : [android, ios];
if (iosFirst) console.log("[e2e] E2E_IOS_FIRST=1 — iPhone is wallet A, Android is wallet B");

await runWitnessedExchange({
  detectDevices: () => ({ a: first.detect(), b: second.detect() }),
  createSessionA: first.create,
  createSessionB: second.create,
  dumpWitnessLogs: () => dumpAndroidWitnessLogs([androidUdid]),
  name: "vrc-exchange:witnessed:locality:devices",
  reportLocality: true,
});
