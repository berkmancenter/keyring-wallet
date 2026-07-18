// Unattended probe: fresh Android install → onboard → connect to the (mediated)
// witness → confirm the "connected to witness" banner. No biometric needed, so
// this isolates the witness-connect step cheaply. Throwaway debug script.
import { execSync } from "node:child_process";
import { createSession, ensureAppium, stopAppium, dumpSource, screenshot } from "./lib/driver.js";
import { completeOnboarding, connectToWitness, dismissTourIfPresent } from "./lib/flows.js";
import { startWitness } from "./lib/witness.js";
import { ANDROID_UDID, androidDeviceCaps } from "./lib/config.js";

const udid = ANDROID_UDID || execSync("adb devices").toString()
  .split("\n").slice(1).map(l => l.trim().split(/\s+/))
  .filter(([id, s]) => id && s === "device" && !id.startsWith("emulator-"))[0][0];

let android, witness;
try {
  try { execSync(`adb -s ${udid} logcat -c`); } catch {}
  await ensureAppium();
  witness = await startWitness({ name: "e2e-witness" });
  android = await createSession("android", androidDeviceCaps(udid));
  await completeOnboarding(android, { firstName: "Alice", lastName: "Anderson" });
  await dismissTourIfPresent(android);
  await connectToWitness(android, witness.invitationUrl);
  // Authoritative confirmation from the witness server itself
  await witness.waitForParticipants(1, 120000);
  console.log("\n[debug] ✅ witness-connect SUCCEEDED — witness announced to the wallet");
  process.exitCode = 0;
} catch (err) {
  console.error("\n[debug] ❌ witness-connect FAILED:", err.message);
  if (android) { try { await screenshot(android, "debug-witness"); await dumpSource(android, "debug-witness"); } catch {} }
  process.exitCode = 1;
} finally {
  if (android) { try { await android.deleteSession(); } catch {} }
  if (witness) { try { await witness.stop(); } catch {} }
  stopAppium();
}
