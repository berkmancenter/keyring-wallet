/**
 * Two-wallet VRC exchange on REAL DEVICES (attended) — proves hardware
 * attestation + biometric-confirmed signing end to end:
 *
 *   fresh install on a physical Android phone (USB) + physical iPhone →
 *   onboarding → invitation → bidirectional VRC exchange where each side
 *   signs with its hardware key (TEE / App Attest) and each receiver
 *   chain-validates the peer's evidence (Google roots / Apple roots).
 *   The run FAILS unless BOTH offer screens show the "Secure Exchange"
 *   (AttestationVerified) banner.
 *
 * ATTENDED: a human operator must satisfy the OS biometric/PIN prompts —
 * watch the console for the "OPERATOR: authenticate on ..." banners
 * (roughly twice per device: once per issuance direction).
 *
 * Usage:
 *   npm run vrc-exchange:devices        (or: yarn e2e:vrc:devices from repo root)
 *
 * Env overrides: ANDROID_UDID, IOS_UDID, IOS_TEAM_ID, IOS_DEVICE_APP, ANDROID_APK.
 * Prerequisites + build commands: see e2e/README.md ("Real devices").
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";

import {
  createSession,
  ensureAppium,
  stopAppium,
  screenshot,
  dumpSource,
  sleep,
} from "./lib/driver.js";
import {
  acceptCredentialOfferFromChat,
  acceptInvitationViaPaste,
  assertVrcReceived,
  completeOnboarding,
  enableHardwareAttestation,
  showRelationshipInvitation,
} from "./lib/flows.js";
import {
  ANDROID_APK,
  ANDROID_UDID,
  IOS_DEVICE_APP,
  IOS_UDID,
  androidDeviceCaps,
  iosDeviceCaps,
} from "./lib/config.js";

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
  // Prefer CoreDevice "connected" tunnel state; fall back to USB presence via
  // idevice_id / xctrace when the tunnel briefly reports "disconnected"
  // (common after sleep / cable reattach, even though the phone is usable).
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

// ---------- preflight ----------

function preflight() {
  if (!existsSync(ANDROID_APK)) {
    throw new Error(
      `Android APK not found: ${ANDROID_APK}\n  Build it: cd app/android && ./gradlew assembleDebug`
    );
  }
  if (!existsSync(IOS_DEVICE_APP)) {
    throw new Error(
      `iOS device build not found: ${IOS_DEVICE_APP}\n  Build it (see e2e/README.md "Real devices" for the full command).`
    );
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
  });
}

let metroProc;
async function ensureMetro() {
  // the Android debug APK loads JS from metro on this machine via `adb reverse`
  if (await portInUse(8081)) {
    console.log("[e2e] metro already running on :8081");
    return;
  }
  console.log("[e2e] starting metro (yarn start in app/)…");
  metroProc = spawn("yarn", ["start"], {
    cwd: new URL("../app", import.meta.url).pathname,
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let i = 0; i < 60; i++) {
    if (await portInUse(8081)) return;
    await sleep(1000);
  }
  throw new Error("metro did not start within 60s");
}

// ---------- attestation log evidence ----------

function dumpAndroidAttestationLogs(udid) {
  try {
    mkdirSync("artifacts", { recursive: true });
    const raw = execSync(`adb -s ${udid} logcat -d`, {
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
    const lines = raw
      .split("\n")
      .filter((l) => /VRC:|Attestation|BiometricSignature|GoogleAttestation/i.test(l));
    const file = `artifacts/attestation-logcat-${Date.now()}.txt`;
    writeFileSync(file, lines.join("\n"));
    console.log(`[e2e] android attestation log lines saved: ${file} (${lines.length} lines)`);

    // Extract slim issued-credential JSON dumps (PEMs already omitted in-app).
    let n = 0;
    for (const line of raw.split("\n")) {
      const marker = "[VRC:IssuedCredentialJSON]";
      const idx = line.indexOf(marker);
      if (idx < 0) continue;
      const payload = line.slice(idx + marker.length).trim();
      // payload: side=… exchange=… record=… {json}
      const jsonStart = payload.indexOf("{");
      if (jsonStart < 0) continue;
      const meta = payload.slice(0, jsonStart).trim();
      const side = (meta.match(/side=(\w+)/) || [])[1] || "unknown";
      try {
        const obj = JSON.parse(payload.slice(jsonStart));
        const types = (obj.type || []).join("-") || "credential";
        const out = `artifacts/issued-credential-${side}-${types}-${Date.now()}-${n++}.json`;
        writeFileSync(out, JSON.stringify(obj, null, 2));
        console.log(`[e2e] issued credential dump: ${out}`);
        if (obj.proof) {
          console.log(
            `[e2e]   proof.type=${obj.proof.type} proofPurpose=${obj.proof.proofPurpose}`
          );
        }
      } catch (e) {
        console.warn(`[e2e] could not parse IssuedCredentialJSON: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`[e2e] logcat capture failed (non-fatal): ${e.message}`);
  }
}

async function dumpIosAttestationLogs(driver) {
  try {
    const logs = await driver.getLogs("syslog");
    const lines = logs
      .map((l) => (typeof l === "string" ? l : l.message || ""))
      .filter((l) => /VRC:|Attestation|AppAttest/i.test(l));
    mkdirSync("artifacts", { recursive: true });
    const file = `artifacts/attestation-syslog-${Date.now()}.txt`;
    writeFileSync(file, lines.join("\n"));
    console.log(`[e2e] ios attestation log lines saved: ${file} (${lines.length} lines)`);
  } catch (e) {
    console.warn(`[e2e] ios syslog capture failed (non-fatal): ${e.message}`);
  }
}

// ---------- run ----------

let android, ios;
try {
  preflight();
  const androidUdid = detectAndroidUdid();
  const iosUdid = detectIosUdid();
  console.log(`[e2e] android device: ${androidUdid}`);

  try {
    execSync(`adb -s ${androidUdid} logcat -c`);
    console.log("[e2e] cleared android logcat");
  } catch {
    /* non-fatal */
  }

  await ensureMetro();
  await ensureAppium();

  console.log(
    "\n[e2e] ATTENDED RUN — keep both phones unlocked and within reach.\n" +
      "[e2e] You will be asked to authenticate (biometric or device PIN) when\n" +
      "[e2e] the OPERATOR banner appears in this console.\n"
  );

  android = await createSession("android", androidDeviceCaps(androidUdid));
  ios = await createSession("ios", iosDeviceCaps(iosUdid));

  await Promise.all([
    completeOnboarding(android, { firstName: "Alice", lastName: "Anderson" }),
    completeOnboarding(ios, { firstName: "Bob", lastName: "Baker" }),
  ]);

  // Hardware attestation is OFF by default — without it no evidence is
  // attached and the Secure Exchange banner can never show.
  await Promise.all([
    enableHardwareAttestation(android),
    enableHardwareAttestation(ios),
  ]);

  const invitationUrl = await showRelationshipInvitation(android);
  await acceptInvitationViaPaste(ios, invitationUrl);

  // Bidirectional exchange. expectAttestation makes each receiver REQUIRE the
  // Secure Exchange banner (peer evidence chain-validated on-device).
  // Longer timeout than emulators: two hardware signings + human auth in the loop.
  await Promise.all([
    acceptCredentialOfferFromChat(android, 600000, { expectAttestation: true }),
    acceptCredentialOfferFromChat(ios, 600000, { expectAttestation: true }),
  ]);

  await Promise.all([
    assertVrcReceived(android, "Bob Baker"),
    assertVrcReceived(ios, "Alice Anderson"),
  ]);

  console.log(
    "\n[e2e] ✅ REAL-DEVICE VRC exchange succeeded on both phones with" +
      " hardware attestation verified in both directions"
  );
  process.exitCode = 0;

  dumpAndroidAttestationLogs(androidUdid);
  await dumpIosAttestationLogs(ios);
} catch (err) {
  console.error("\n[e2e] ❌ FAILED:", err.message);
  for (const d of [android, ios].filter(Boolean)) {
    try {
      await screenshot(d, "failure");
      await dumpSource(d, "failure");
    } catch {
      /* session may be dead */
    }
  }
  try {
    dumpAndroidAttestationLogs(detectAndroidUdid());
  } catch {
    /* best-effort */
  }
  process.exitCode = 1;
} finally {
  for (const d of [android, ios].filter(Boolean)) {
    try {
      await d.deleteSession();
    } catch {
      /* already gone */
    }
  }
  if (metroProc) metroProc.kill("SIGTERM");
  stopAppium();
}
