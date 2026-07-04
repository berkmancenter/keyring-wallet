/**
 * Single-device smoke test: fresh install → full onboarding → main tab bar visible.
 * Usage: PLATFORM=android node run-onboarding-smoke.js   (or PLATFORM=ios)
 */
import {
  createSession,
  ensureAppium,
  stopAppium,
  screenshot,
  dumpSource,
} from "./lib/driver.js";
import { completeOnboarding } from "./lib/flows.js";

const platform = process.env.PLATFORM || "android";
let driver;
try {
  await ensureAppium();
  driver = await createSession(platform);
  await completeOnboarding(driver, { firstName: "Smoke", lastName: "Test" });
  await screenshot(driver, "onboarding-done");
  console.log("\n[e2e] ✅ onboarding smoke passed");
  process.exitCode = 0;
} catch (err) {
  console.error("\n[e2e] ❌ FAILED:", err.message);
  if (driver) {
    try {
      await screenshot(driver, "failure");
      await dumpSource(driver, "failure");
    } catch {
      /* ignore */
    }
  }
  process.exitCode = 1;
} finally {
  if (driver) {
    try {
      await driver.deleteSession();
    } catch {
      /* ignore */
    }
  }
  stopAppium();
}
