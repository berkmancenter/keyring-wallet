/**
 * WITNESSED two-wallet VRC exchange on TWO REAL iOS DEVICES (attended):
 * an iPhone and an iPad. Same flow as run-vrc-exchange-witnessed-devices.js
 * (lib/witnessedExchangeFlow.js), with both sessions on XCUITest.
 *
 * Carriage matrix, by environment (didcomm_v2_subtask.md C14 and V2T on devices):
 *   (default)                      DIDComm v1 — the Credo 0.7 hop's device regression (B7)
 *   E2E_DIDCOMM_V2=1               DIDComm v2: both wallets on Coordinate Mediation 2.0,
 *                                  the witness on v1+v2, OOB 2.0 invitations
 *   E2E_DIDCOMM_V2=1 E2E_TSP=1     the TSP envelope over those v2 connections
 *
 * Real devices do hardware attestation, so the hardware-evidence marker is
 * asserted on both. Every log marker is read from each device's own
 * `idevicesyslog` capture (brew install libimobiledevice).
 *
 * Device selection: IOS_UDID (wallet A) and IOS_UDID2 (wallet B), or
 * auto-detect exactly one connected iPhone (A) and one iPad (B);
 * E2E_IPAD_FIRST=1 swaps them. Both need Developer Mode, Settings →
 * Developer → Enable UI Automation, a passcode + biometrics, and the app
 * built for devices (IOS_DEVICE_APP, see e2e/README.md) against a build
 * whose app/.env matches the carriage (MEDIATOR_V2_URL for v2 runs).
 *
 * Usage: yarn e2e:vrc:witnessed:ios-devices[:didcomm-v2[:tsp]]
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSession } from "./lib/driver.js";
import { IOS_UDID, IOS_UDID2, iosDeviceCaps } from "./lib/config.js";
import { runWitnessedExchange } from "./lib/witnessedExchangeFlow.js";

const useDidCommV2 = process.env.E2E_DIDCOMM_V2 === "1";
// E2E_LOCALITY=1: the witness REQUIRES Bluetooth co-presence, both sides'
// confirmation is asserted, and the "In-Person" badge is required beside
// "Secure Exchange" and "Verified". Both devices need Bluetooth on and must
// be near THIS Mac (the witness's sensor).
const useLocality = process.env.E2E_LOCALITY === "1";
if (useLocality) {
  process.env.WITNESS_LOCALITY_POLICY = "required";
  process.env.WITNESS_LOCALITY_REQUIRED = "true";
}
const useTspCarriage = process.env.E2E_TSP === "1";
if (useTspCarriage && !useDidCommV2) {
  console.error("E2E_TSP=1 on iOS devices is only wired with E2E_DIDCOMM_V2=1 (TSP over v2)");
  process.exit(1);
}

function connectedIosDevices() {
  execSync("xcrun devicectl list devices --json-output /tmp/e2e-devicectl-ios.json", { stdio: "ignore" });
  const json = JSON.parse(readFileSync("/tmp/e2e-devicectl-ios.json", "utf8"));
  return (json.result?.devices || [])
    .filter((d) => ["iPhone", "iPad"].includes(d.hardwareProperties?.deviceType))
    // A reachable device has a transport (wired / network); its tunnel reads
    // "disconnected" until a devicectl command opens it, and an absent device
    // reads "unavailable" with no transport.
    .filter((d) => d.connectionProperties?.pairingState === "paired" && d.connectionProperties?.transportType)
    .filter((d) => d.connectionProperties?.tunnelState !== "unavailable")
    .map((d) => ({
      name: d.deviceProperties?.name,
      type: d.hardwareProperties?.deviceType,
      udid: d.hardwareProperties?.udid,
      developerMode: d.deviceProperties?.developerModeStatus,
    }));
}

function detectDevices() {
  if (IOS_UDID && IOS_UDID2) return { a: IOS_UDID, b: IOS_UDID2 };
  const devices = connectedIosDevices();
  const phones = devices.filter((d) => d.type === "iPhone");
  const pads = devices.filter((d) => d.type === "iPad");
  if (phones.length !== 1 || pads.length !== 1) {
    throw new Error(
      `expected exactly one connected iPhone and one iPad (found: ${devices.map((d) => `${d.name} [${d.type}]`).join(", ") || "none"}). ` +
        "Set IOS_UDID and IOS_UDID2 to pick them."
    );
  }
  for (const d of [phones[0], pads[0]]) {
    if (d.developerMode && d.developerMode !== "enabled") {
      throw new Error(`${d.name}: Developer Mode is ${d.developerMode} — Settings → Privacy & Security → Developer Mode`);
    }
  }
  const [a, b] = process.env.E2E_IPAD_FIRST === "1" ? [pads[0], phones[0]] : [phones[0], pads[0]];
  console.log(`[e2e] wallet A: ${a.name} (${a.udid}); wallet B: ${b.name} (${b.udid})`);
  return { a: a.udid, b: b.udid };
}

// E2E_WDA_PORT_BASE moves both port pairs when another Appium on this Mac
// still holds a forward on the defaults.
const WDA_BASE = Number(process.env.E2E_WDA_PORT_BASE || 8123);
const ports = (udid, offset) => ({
  wdaLocalPort: WDA_BASE + offset,
  mjpegServerPort: WDA_BASE + 1000 + offset,
  derivedDataPath: join(homedir(), "Library/Developer/Xcode/DerivedData", `WDA-e2e-${udid.slice(-8)}`),
});

const carriage = (useDidCommV2 ? (useTspCarriage ? ":didcomm-v2:tsp" : ":didcomm-v2") : "") + (useLocality ? ":locality" : "");
await runWitnessedExchange({
  detectDevices,
  createSessionA: (udid) => createSession("ios", iosDeviceCaps(udid, ports(udid, 0))),
  createSessionB: (udid) => createSession("ios", iosDeviceCaps(udid, ports(udid, 1))),
  // Both sides' JS logs are already saved under artifacts/ by the flow's capture.
  dumpWitnessLogs: () => {},
  name: `vrc-exchange:witnessed:ios-devices${carriage}`,
  useDidCommV2,
  useTspCarriage,
  assertLocality: useLocality,
  // Two real iOS devices: every badge that can apply is required.
  requireSecureExchange: true,
  warmMetroPlatforms: ["ios"],
});
