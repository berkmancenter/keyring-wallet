#!/usr/bin/env node
/**
 * Push is built in and OFF in the testers' configuration (keyring-bifold #196:
 * the Notifications row and the onboarding step appear only when the build
 * sets PUSH_GATEWAY_URL). Every release gate runs this on both platforms on
 * the build it ships, after the link: a switch a tester can turn on, for a
 * push service the build has no gateway for, is a broken promise.
 *
 *   PLATFORM=ios|android UDID=<sim udid or emulator serial> [APPIUM_PORT=…] \
 *     [EXPECT=off|on] node run-push-off-probe.mjs
 *
 * EXPECT says what the build under test is meant to be, and the probe fails
 * when the app disagrees, in either direction. `off` (the default) is the
 * testers' configuration. `on` is a build that names a push gateway: the
 * Notifications row must be there and must lead to the push switch. `on` only
 * proves the screens are reachable; that a phone registers and is woken is a
 * real-device check (README, "Push is on"). It does not tap the switch, so it
 * raises no system prompt. It leaves the app on the push-switch screen, where
 * `off` leaves it on Settings: a step chained after it must go back first.
 *
 * On the installed app (driven as it is, never reset): unlock, open Settings,
 * and look for the Notifications row (testID Notifications, which leads to
 * the push switch) from the top of the list to the bottom, plus any readable
 * "notification" text there. The onboarding half is checked from the link
 * run's own transcript: no PushNotificationContinue step and no notification
 * permission alert.
 *
 * Prints `PUSH_OFF PASS|FAIL <what>` or `PUSH_ON PASS|FAIL <what>`. Exit 0
 * pass, 3 fail, 1 the run failed.
 */
import "./lib/cli-guard.js";
import { ensureAppium, existsTestId, screenshot, scrollToTestId, stopAppium, tapTestId } from "./lib/driver.js";
import { makeDriver, unlockToHome } from "./lib/keyringRoles.js";

const PLATFORM = process.env.PLATFORM ?? "ios";
const EXPECT = process.env.EXPECT ?? "off";
let driver;
try {
  if (!process.env.UDID) throw new Error("UDID is required: the sim or emulator with the build installed");
  if (EXPECT !== "off" && EXPECT !== "on") throw new Error(`EXPECT must be off or on, not '${EXPECT}'`);
  await ensureAppium();
  driver = await makeDriver({ platform: PLATFORM, udid: process.env.UDID, keepState: true });
  await unlockToHome(driver);
  await tapTestId(driver, "Settings", 15000);
  let row = await existsTestId(driver, "Notifications", 3000);
  if (!row) {
    // Settings is a long list: search the whole of it, both ways.
    try {
      await scrollToTestId(driver, "Notifications", 8);
      row = true;
    } catch {
      row = false;
    }
  }
  // Component names that merely contain the word are not text a person reads.
  const source = (await driver.getPageSource()).replace(/NotificationListItem|OpenIDNotification/g, "");
  const text = /notification/i.test(source);
  await screenshot(driver, `push-${EXPECT}-settings-${PLATFORM}`);
  if (EXPECT === "on") {
    if (!row) {
      console.log("PUSH_ON FAIL — Settings has no Notifications row: this build names no push gateway");
      process.exitCode = 3;
    } else {
      // The row must lead to the push switch, not just exist. On iOS it can
      // exist in the tree below the fold: bring it on screen before the tap.
      await scrollToTestId(driver, "Notifications", 8).catch(() => undefined);
      await tapTestId(driver, "Notifications", 15000);
      const toggle = await existsTestId(driver, "PushNotificationSwitch", 15000);
      await screenshot(driver, `push-on-switch-${PLATFORM}`);
      if (toggle) {
        console.log("PUSH_ON PASS — Settings has the Notifications row and it opens the push switch");
      } else {
        console.log("PUSH_ON FAIL — the Notifications row did not open the push switch");
        process.exitCode = 3;
      }
    }
  } else if (row || text) {
    console.log(`PUSH_OFF FAIL — Settings shows ${row ? "the Notifications row" : "notification text"}`);
    process.exitCode = 3;
  } else {
    console.log("PUSH_OFF PASS — Settings has no Notifications row and no notification text (scrolled end to end)");
  }
} catch (err) {
  process.exitCode = 1;
  console.error(err);
} finally {
  await driver?.deleteSession().catch(() => undefined);
  stopAppium();
}
