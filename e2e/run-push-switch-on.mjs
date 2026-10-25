#!/usr/bin/env node
/**
 * wallet #300 "Not now" row, steps 5–6 (Android): Settings → Notifications →
 * turn the push switch on; record whether the system permission dialog
 * appears, tap Allow on it. The host reads pushCapable afterwards.
 *   PLATFORM=android UDID=<serial> node run-push-switch-on.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { makeDriver, unlockToHome } from "./lib/keyringRoles.js";
import { printFailure, printSuccess } from "./lib/banner.js";

const UDID = process.env.UDID;
const utc = () => new Date().toISOString().slice(11, 23) + "Z";
const log = (s) => console.log(`[e2e] ${utc()} ${s}`);
const focus = () =>
  execFileSync("adb", ["-s", UDID, "shell", "dumpsys", "window"], { encoding: "utf8" })
    .split("\n")
    .find((l) => l.includes("mCurrentFocus"))
    ?.trim() ?? "";
let d;
try {
  await ensureAppium();
  d = await makeDriver({ platform: "android", udid: UDID, keepState: true });
  await unlockToHome(d);
  await tapTestId(d, "Settings", 15000);
  await scrollToTestId(d, "Notifications", 8);
  await tapTestId(d, "Notifications", 15000);
  await scrollToTestId(d, "PushNotificationSwitch", 4).catch(() => undefined);
  await screenshot(d, "push300-switch-before");
  await tapTestId(d, "PushNotificationSwitch", 15000);
  const tapped = Date.now();
  log("switched on");
  let dialog = "";
  for (const until = Date.now() + 15000; Date.now() < until && !dialog; await sleep(500)) {
    const f = focus();
    if (/GrantPermissions|permissioncontroller/i.test(f)) dialog = f;
  }
  log(`system permission dialog: ${dialog ? `shown after ${((Date.now() - tapped) / 1000).toFixed(1)} s [${dialog}]` : "NOT shown within 15 s"}`);
  if (dialog) {
    await screenshot(d, "push300-permission-dialog");
    const allow = d.$('//*[@resource-id="com.android.permissioncontroller:id/permission_allow_button"]');
    if (await allow.isExisting()) {
      await allow.click();
      log("tapped Allow");
    } else log("no Allow button found on the dialog");
  }
  await sleep(3000);
  await screenshot(d, "push300-switch-after");
  console.log(`PUSH300_DIALOG ${dialog ? "SHOWN" : "NOT_SHOWN"}`);
  printSuccess("push switch turned on");
} catch (err) {
  printFailure("push-switch-on", err);
  if (d) await screenshot(d, "push300-failure").catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
