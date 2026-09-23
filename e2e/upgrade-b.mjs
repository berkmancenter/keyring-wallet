/**
 * Phase B of the upgrade case: the trapped phone meets the new build.
 *
 * Installed OVER the looping app without wiping, so the persisted chosen
 * community — the thing that kept putting it back into the loop — is still
 * there. The question is the one going in front of maintainers: does updating
 * release it, or must they reinstall and link again?
 */
import { createSession, ensureAppium, stopAppium, screenshot, sleep, waitForTestId, byTestId, existsTestId } from "./lib/driver.js";
import { androidCaps } from "./lib/config.js";
import { unlockIfLocked } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";

const APP_ID = "asml.bkc.harvard.wallet";
let d;
try {
  await ensureAppium();
  // noReset: the whole point is the state the old build left behind.
  d = await createSession("android", {
    ...androidCaps(),
    "appium:fullReset": false,
    "appium:noReset": true,
    "appium:enforceAppInstall": false,
  });
  await waitForTestId(d, "EnterPIN", 120000).catch(() => undefined);
  await unlockIfLocked(d);
  await waitForTestId(d, "Contacts", 300000);
  console.log("[e2e] the updated app opened, and the wallet unlocked");

  // The tab that was trapped.
  await (await waitForTestId(d, "MyAgent", 30000)).click();
  await sleep(3000);
  if (await existsTestId(d, "HeaderText", 3000)) {
    await screenshot(d, "upgrade-b-still-broken");
    throw new Error("the error card is still up after the update — a stuck phone does NOT recover by updating");
  }
  await screenshot(d, "upgrade-b-agent");
  console.log("[e2e] My Agent renders after the update, no error card");

  // And the community it had chosen is still the phone's, by name.
  const named = await byTestId(d, "AgentHolds").isExisting().catch(() => false);
  console.log(`[e2e] what the phone holds is on screen: ${named}`);
  await screenshot(d, "upgrade-b-holds");
  printSuccess("upgrade: a trapped phone recovers by updating, with its community intact");
  process.exitCode = 0;
} catch (e) {
  if (d) await screenshot(d, "upgrade-b-failure").catch(() => undefined);
  printFailure("upgrade case", e);
  process.exitCode = 1;
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
  await stopAppium();
}
