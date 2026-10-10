#!/usr/bin/env node
/**
 * The welcome slides (wallet #339, 238), on a fresh install before onboarding:
 *   welcome-learn-more   the welcome slide's "Learn more about the Keyring project" link (LearnMoreAboutTheKeyringProject)
 *                        opens https://www.appliedtechnologylab.org/projects#keyring (Safari comes to the front; on
 *                        Android, a browser package takes the foreground)
 *   agent-slide-words    the agent slide's paragraph begins "Not that kind of agent —"
 *   agent-icon-size      its shield icon (a glyph, no testID) is about 104 pt (was 88; within 6). iOS only: the page
 *                        source gives sizes in points there; on Android the row is SKIP.
 * Leaves the app on its first slide, for the onboarding that follows. Prints ROW lines; exit 0 all pass, 3 any fail.
 * Also prints "[welcome] appium ready <s>" and "[welcome] session ready <s>" (seconds), for a runner that times them.
 *   UDID=<sim> IOS_APP=<app> IOS_DEVICE_NAME=… IOS_PLATFORM_VERSION=… APPIUM_PORT=… node run-welcome.mjs
 *   PLATFORM=android UDID=<emulator serial> E2E_RELEASE=1 APPIUM_PORT=… node run-welcome.mjs
 */
import "./lib/cli-guard.js";
import { ensureAppium, existsTestId, screenshot, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { makeDriver } from "./lib/keyringRoles.js";

const BID = process.env.E2E_APP_ID || "asml.bkc.harvard.wallet";
const PLATFORM = process.env.PLATFORM === "android" ? "android" : "ios";
let failed = 0;
const row = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`ROW ${name} ${ok ? "PASS" : "FAIL"} — ${detail}`);
};
const skip = (name, why) => console.log(`ROW ${name} SKIP — ${why}`);
const secs = (t0) => ((Date.now() - t0) / 1000).toFixed(1);
// iOS page source labels the text; Android's has it in text=.
const agentWords = (src) => (src.match(/(?:label|value|name|text)="(Not that kind of agent[^"]*)"/) || [])[1] || "";
// Which app is in front: the bundle id on iOS, the package on Android.
const frontApp = async (d) =>
  PLATFORM === "android"
    ? await d.getCurrentPackage().catch(() => "?")
    : (await d.execute("mobile: activeAppInfo").catch(() => ({})))?.bundleId || "?";

let d;
try {
  let t = Date.now();
  await ensureAppium();
  console.log(`[welcome] appium ready ${secs(t)}`);
  t = Date.now();
  d = await makeDriver({ platform: PLATFORM, udid: process.env.UDID, keepState: true });
  console.log(`[welcome] session ready ${secs(t)}`);
  await d.activateApp(BID);
  await sleep(4000);

  // The welcome slide's link, by its label-derived testID; tapping it should bring Safari forward. An emulator
  // on a loaded CI runner shows its first slide late, and can have System UI's own "isn't responding" dialog
  // over it (run 38045665103): Android waits longer, and once dismisses that dialog (its Wait button) and looks again.
  let link = await existsTestId(d, "LearnMoreAboutTheKeyringProject", PLATFORM === "android" ? 45000 : 15000);
  let anr = "";
  if (!link && PLATFORM === "android") {
    const wait = await d.$("id=android:id/aerr_wait");
    if (await wait.isExisting().catch(() => false)) {
      await wait.click().catch(() => undefined);
      console.log("[welcome] a System UI ANR dialog was over the app; tapped Wait");
      await sleep(2000);
      link = await existsTestId(d, "LearnMoreAboutTheKeyringProject", 20000);
      anr = link ? "; found after dismissing a System UI ANR dialog" : " (a System UI ANR dialog was over the app; dismissed, still no link)";
    }
  }
  let opened = "";
  if (link) {
    await tapTestId(d, "LearnMoreAboutTheKeyringProject", 10000);
    await sleep(4000);
    opened = await frontApp(d);
    // The address Safari opened, as it shows it (its address field): kept as a screenshot.
    await screenshot(d, "welcome-learn-more-opened").catch(() => undefined);
    await d.activateApp(BID);
    await sleep(2000);
  }
  const browserCame = PLATFORM === "android" ? opened !== "?" && opened !== BID : opened === "com.apple.mobilesafari";
  row("welcome-learn-more", link && browserCame, link ? `the link is there; tapping it brought ${opened} forward${anr}` : `no LearnMoreAboutTheKeyringProject on the first slide${anr}`);

  // To the agent slide: Next until its words show (4th of 5).
  let src = await d.getPageSource();
  for (let i = 0; i < 5 && !agentWords(src); i++) {
    if (!(await existsTestId(d, "Next", 3000))) break;
    await tapTestId(d, "Next", 5000);
    await sleep(1200);
    src = await d.getPageSource();
  }
  const words = agentWords(src);
  await screenshot(d, "welcome-agent-slide").catch(() => undefined);
  row("agent-slide-words", /^Not that kind of agent —/.test(words), words ? `"${words.slice(0, 90)}…"` : "no paragraph beginning \"Not that kind of agent\" within five slides");

  // The icon: the one-glyph text (a private-use character) on the slide, measured in points.
  if (PLATFORM === "android") {
    skip("agent-icon-size", "measured in points from the iOS page source; Android's gives pixel bounds, not ported");
  } else {
    let icon;
    for (const m of src.matchAll(/<XCUIElementTypeStaticText [^>]*>/g)) {
      const tag = m[0];
      const label = (tag.match(/ label="([^"]*)"/) || [])[1] ?? "";
      const w = Number((tag.match(/ width="(\d+)"/) || [])[1]);
      const h = Number((tag.match(/ height="(\d+)"/) || [])[1]);
      if (/^&#\d+;$|^[-\u{F0000}-\u{FFFFD}]$/u.test(label) && h >= 60 && (!icon || h > icon.h)) icon = { w, h };
    }
    row("agent-icon-size", Boolean(icon) && Math.abs(icon.h - 104) <= 6, icon ? `the shield is ${icon.w}×${icon.h} pt (want about 104; 238 enlarged it from 88)` : "no icon glyph of 60 pt or more on the agent slide");
  }

  // Back to the first slide for the onboarding that follows.
  for (let i = 0; i < 5 && (await existsTestId(d, "Back", 1500)); i++) await tapTestId(d, "Back", 5000).catch(() => undefined);
  process.exitCode = failed ? 3 : 0;
} catch (e) {
  console.log(`LEG welcome BROKEN — ${String(e.message).split("\n")[0]}`);
  if (d) await screenshot(d, "welcome-failure").catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
