/**
 * WITNESSED two-wallet VRC exchange on REAL DEVICES (attended).
 *
 * Same hardware-attested exchange as run-vrc-exchange-devices.js, but both
 * wallets first connect to a locally-run witness server, so the exchange
 * auto-routes through the witness and each wallet ends up with a Verifiable
 * Witness Credential (VWC) in addition to the peer VRC.
 *
 *   start witness (LAN-reachable) → fresh installs → onboarding →
 *   BOTH wallets connect to the witness → invitation → bidirectional,
 *   hardware-attested, witnessed VRC exchange → assert VRC + VWC on both.
 *
 * With the DI cryptosuite work, this proves the witness issues a
 * DataIntegrityProof/eddsa-rdfc-2022 VWC and both wallets store it — the last
 * uncovered cell of the DI matrix. See docs/spikes/witnessed-e2e-spec.md and
 * docs/CRYPTO_SUITE_FOLLOWUP.md.
 *
 * ATTENDED: satisfy the OS biometric/PIN prompts at the OPERATOR banners.
 * Both phones + the Mac must share a Wi-Fi (phones reach the witness at the
 * Mac's LAN IP). Override the IP with WITNESS_HOST_IP if auto-detect is wrong.
 *
 * Usage: npm run vrc-exchange:witnessed:devices
 *        (or: yarn e2e:vrc:witnessed:devices from repo root)
 *
 * NOTE: the device-discovery / preflight / metro / log-dump helpers are
 * duplicated from run-vrc-exchange-devices.js on purpose — keeps each runner
 * self-contained (repo convention) and leaves the proven direct-exchange
 * runner untouched.
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
  assertContactShields,
  completeOnboarding,
  connectToWitness,
  enableHardwareAttestation,
  showRelationshipInvitation,
} from "./lib/flows.js";
import { startWitness } from "./lib/witness.js";
import {
  ANDROID_APK,
  ANDROID_UDID,
  IOS_DEVICE_APP,
  IOS_UDID,
  androidDeviceCaps,
  iosDeviceCaps,
} from "./lib/config.js";

const WITNESS_NAME = process.env.WITNESS_NAME || "e2e-witness";

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

// ---------- preflight / metro ----------

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

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
  });
}

let metroProc;
async function ensureMetro() {
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

function dumpAndroidWitnessLogs(udid) {
  try {
    mkdirSync("artifacts", { recursive: true });
    const raw = execSync(`adb -s ${udid} logcat -d`, { maxBuffer: 64 * 1024 * 1024 }).toString();
    const lines = raw
      .split("\n")
      .filter((l) => /VRC:|Attestation|BiometricSignature|Witness|VWC|proofType|cryptosuite/i.test(l));
    const file = `artifacts/witnessed-logcat-${Date.now()}.txt`;
    writeFileSync(file, lines.join("\n"));
    console.log(`[e2e] android witnessed log lines saved: ${file} (${lines.length} lines)`);
    // Surface any DI proof lines for the VWC/VRC
    for (const l of lines) {
      if (/proofType=DataIntegrityProof|cryptosuite/i.test(l)) {
        console.log(`[e2e]   ${l.replace(/^.*ReactNativeJS:\s*/, "").trim().slice(0, 140)}`);
      }
    }
  } catch (e) {
    console.warn(`[e2e] logcat capture failed (non-fatal): ${e.message}`);
  }
}

// ---------- run ----------

let android, ios, witness;
try {
  preflight();
  const androidUdid = detectAndroidUdid();
  const iosUdid = detectIosUdid();
  console.log(`[e2e] android device: ${androidUdid}`);

  try {
    execSync(`adb -s ${androidUdid} logcat -c`);
  } catch {
    /* non-fatal */
  }

  await ensureMetro();
  await ensureAppium();

  // The witness runs in direct mode behind a cloudflared HTTPS tunnel: the app
  // blocks cleartext http, and production witnesses are HTTPS (real mediators
  // like aaleon have SSL). The tunnel mirrors that locally without the
  // instability of routing the witness through the app's mediator.
  witness = await startWitness({ name: WITNESS_NAME });

  console.log(
    "\n[e2e] ATTENDED WITNESSED RUN — keep both phones unlocked and within reach.\n" +
      "[e2e] Witness is reachable via an HTTPS tunnel; no LAN needed.\n" +
      "[e2e] Authenticate at the OPERATOR banners.\n"
  );

  android = await createSession("android", androidDeviceCaps(androidUdid));
  ios = await createSession("ios", iosDeviceCaps(iosUdid));

  await Promise.all([
    completeOnboarding(android, { firstName: "Alice", lastName: "Anderson" }),
    completeOnboarding(ios, { firstName: "Bob", lastName: "Baker" }),
  ]);

  await Promise.all([
    enableHardwareAttestation(android),
    enableHardwareAttestation(ios),
  ]);

  // Both wallets connect to the witness FIRST — if either isn't connected when
  // the exchange starts, the 15s session-challenge timeout fires and the
  // exchange silently falls back to direct (no VWC). Confirm BOTH connections
  // completed via the witness's own log (no "connected" banner exists in the
  // app — witness participation only surfaces as a VWC after the exchange).
  await connectToWitness(android, witness.invitationUrl);
  await connectToWitness(ios, witness.invitationUrl);
  await witness.waitForParticipants(2, 120000);
  console.log("[e2e] both wallets connected to the witness");

  const invitationUrl = await showRelationshipInvitation(android);
  await acceptInvitationViaPaste(ios, invitationUrl);

  await Promise.all([
    acceptCredentialOfferFromChat(android, 600000, { expectAttestation: true }),
    acceptCredentialOfferFromChat(ios, 600000, { expectAttestation: true }),
  ]);

  await Promise.all([
    assertVrcReceived(android, "Bob Baker"),
    assertVrcReceived(ios, "Alice Anderson"),
  ]);

  // The culminating check: each contact must show BOTH shields together —
  // "Secure Exchange" (device attestation on the DI VRC) AND "Verified" +
  // Witness Records (VWC from the witness). VWC is issued after the VRC, so
  // this polls both.
  await Promise.all([
    assertContactShields(android, "Bob Baker"),
    assertContactShields(ios, "Alice Anderson"),
  ]);

  console.log(
    "\n[e2e] ✅ WITNESSED + ATTESTED VC 2.0 (eddsa-rdfc-2022) exchange succeeded on both phones —\n" +
      "[e2e]    each contact shows BOTH shields: Secure Exchange (attestation) + Witnessed"
  );
  process.exitCode = 0;

  dumpAndroidWitnessLogs(androidUdid);
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
    dumpAndroidWitnessLogs(detectAndroidUdid());
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
  if (witness) {
    try {
      await witness.stop();
    } catch {
      /* best-effort */
    }
  }
  if (metroProc) metroProc.kill("SIGTERM");
  stopAppium();
}
