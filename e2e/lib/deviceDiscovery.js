// Shared real-device UDID discovery for the plain and witnessed devices
// runners. Pure detection — no session creation, no flow logic.
//
// Pre-existing inconsistency, flagged not fixed here: this iOS detection
// (tunnelState === "connected", falling back to idevice_id/xctrace USB
// presence) differs from run-vrc-exchange-witnessed-ios-devices.js's own
// detection (pairingState === "paired" + a present transportType, and it
// covers iPad too). That script is out of scope for this extraction — see
// docs/plans (openvtc-integration-plan family) or the port's own plan doc
// for the reasoning.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { ANDROID_UDID, ANDROID_UDID2, IOS_UDID } from "./config.js";

/** Every physical (non-emulator) android serial `adb` currently sees. */
export function listPhysicalAndroidSerials() {
  const out = execSync("adb devices").toString();
  return out
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter(([id, state]) => id && state === "device" && !id.startsWith("emulator-"))
    .map(([id]) => id);
}

/**
 * Every connected iPhone, `{name, udid, tunnel}`. Prefers CoreDevice
 * "connected" tunnel state; falls back to USB presence via idevice_id /
 * xctrace when the tunnel briefly reports "disconnected" (common after
 * sleep / cable reattach, even though the phone is usable).
 */
export function listConnectedIphones() {
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
        // only the "Devices" section (before Offline / Simulators)
        const live = xt.split("== Devices Offline ==")[0] || xt;
        usb = [...live.matchAll(/\(([0-9A-F-]{25,})\)/g)].map((m) => m[1]);
      } catch {
        /* ignore */
      }
    }
    candidates = iphones.filter((d) => usb.includes(d.udid));
  }
  return candidates;
}

/** Exactly one physical (non-emulator) android device is required. */
export function detectAndroidUdid() {
  if (ANDROID_UDID) return ANDROID_UDID;
  const physical = listPhysicalAndroidSerials();
  if (physical.length !== 1) {
    throw new Error(
      `expected exactly one physical android device (found: ${physical.join(", ") || "none"}). ` +
        `Set ANDROID_UDID to pick one.`
    );
  }
  return physical[0];
}

/** Exactly one connected iPhone is required. */
export function detectIosUdid() {
  if (IOS_UDID) return IOS_UDID;
  const candidates = listConnectedIphones();
  if (candidates.length !== 1) {
    throw new Error(
      `expected exactly one connected iPhone (found: ${candidates.map((d) => d.name).join(", ") || "none"}). ` +
        `Set IOS_UDID to pick one.`
    );
  }
  console.log(
    `[e2e] iPhone detected: ${candidates[0].name} (${candidates[0].udid}` +
      `${candidates[0].tunnel !== "connected" ? `, tunnel=${candidates[0].tunnel}` : ""})`
  );
  return candidates[0].udid;
}

/**
 * Hardware attestation needs a secure lock screen (PIN/pattern/biometric) on
 * the device — without one, Android's Keystore silently issues a non-attested
 * key instead of failing loudly. That doesn't surface until the very end of
 * an attended run, as a confusing "peer evidence missing" assertion failure
 * on the OTHER phone. Catch it up front instead, in seconds, on both devices.
 */
export function ensureLockScreenEnabled(udid) {
  const disabled = execSync(`adb -s ${udid} shell locksettings get-disabled`).toString().trim();
  if (disabled === "true") {
    throw new Error(
      `device ${udid} has no lock screen (PIN/pattern/biometric) set — hardware attestation requires ` +
        `one on BOTH phones. Set a PIN/pattern/biometric on this device and retry.`
    );
  }
}

/** Exactly two physical (non-emulator) android devices are required. */
export function detectTwoAndroidUdids() {
  if (ANDROID_UDID && ANDROID_UDID2) return { a: ANDROID_UDID, b: ANDROID_UDID2 };
  const physical = listPhysicalAndroidSerials();
  if (physical.length !== 2) {
    throw new Error(
      `expected exactly two physical android devices (found: ${physical.join(", ") || "none"}). ` +
        `Set ANDROID_UDID and ANDROID_UDID2 to pick them (see \`adb devices\`).`
    );
  }
  return { a: physical[0], b: physical[1] };
}
