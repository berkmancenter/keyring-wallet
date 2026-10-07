#!/usr/bin/env node
/**
 * The welcome slides (wallet #339, 238), on a fresh iOS install before onboarding:
 *   welcome-learn-more   the welcome slide's "Learn more about the Keyring project" link (LearnMoreAboutTheKeyringProject)
 *                        opens https://www.appliedtechnologylab.org/projects#keyring (Safari comes to the front)
 *   agent-slide-words    the agent slide's paragraph begins "Not that kind of agent —"
 *   agent-icon-size      its shield icon (a glyph, no testID) is about 104 pt (was 88; within 6)
 * Leaves the app on its first slide, for the onboarding that follows. Prints ROW lines; exit 0 all pass, 3 any fail.
 *   UDID=<sim> IOS_APP=<app> IOS_DEVICE_NAME=… IOS_PLATFORM_VERSION=… APPIUM_PORT=… node run-welcome.mjs
 */
import "./lib/cli-guard.js";
import { ensureAppium, existsTestId, screenshot, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { makeDriver } from "./lib/keyringRoles.js";

const BID = process.env.E2E_APP_ID || "asml.bkc.harvard.wallet";
let failed = 0;
const row = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`ROW ${name} ${ok ? "PASS" : "FAIL"} — ${detail}`);
};
const agentWords = (src) => (src.match(/(?:label|value|name)="(Not that kind of agent[^"]*)"/) || [])[1] || "";

let d;
try {
  await ensureAppium();
  d = await makeDriver({ platform: "ios", udid: process.env.UDID, keepState: true });
  await d.activateApp(BID);
  await sleep(4000);

  // The welcome slide's link, by its label-derived testID; tapping it should bring Safari forward.
  const link = await existsTestId(d, "LearnMoreAboutTheKeyringProject", 15000);
  let opened = "";
  if (link) {
    await tapTestId(d, "LearnMoreAboutTheKeyringProject", 10000);
    await sleep(4000);
    const front = await d.execute("mobile: activeAppInfo").catch(() => ({}));
    opened = front?.bundleId || "?";
    // The address Safari opened, as it shows it (its address field): kept as a screenshot.
    await screenshot(d, "welcome-learn-more-opened").catch(() => undefined);
    await d.activateApp(BID);
    await sleep(2000);
  }
  row("welcome-learn-more", link && opened === "com.apple.mobilesafari", link ? `the link is there; tapping it brought ${opened} forward` : "no LearnMoreAboutTheKeyringProject on the first slide");

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
  let icon;
  for (const m of src.matchAll(/<XCUIElementTypeStaticText [^>]*>/g)) {
    const tag = m[0];
    const label = (tag.match(/ label="([^"]*)"/) || [])[1] ?? "";
    const w = Number((tag.match(/ width="(\d+)"/) || [])[1]);
    const h = Number((tag.match(/ height="(\d+)"/) || [])[1]);
    if (/^&#\d+;$|^[-\u{F0000}-\u{FFFFD}]$/u.test(label) && h >= 60 && (!icon || h > icon.h)) icon = { w, h };
  }
  row("agent-icon-size", Boolean(icon) && Math.abs(icon.h - 104) <= 6, icon ? `the shield is ${icon.w}×${icon.h} pt (want about 104; 238 enlarged it from 88)` : "no icon glyph of 60 pt or more on the agent slide");

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
