#!/usr/bin/env node
/**
 * TestFlight #21: with iOS LIMITED photo access, the first photo pick closed the
 * picker and the person had to try again. The fix (bifold 145605c3) waits for
 * the permission sheet to finish on the attempt that asked.
 *
 * This walks exactly that first attempt on a fresh install:
 *   tap the profile photo → the system asks → "Limit Access…" → select one
 *   photo → Done → Keyring's own picker must OPEN BY ITSELF (no second tap)
 *   → choose → the profile shows the photo.
 *
 * The seeded photo goes to THIS session's simulator by udid, and no photo
 * permission is granted up front: the sheet is the point. (lib/flows'
 * seedTestPhoto grants full access, and on `booted`, which is the wrong thing
 * here and the wrong sim when two are up.)
 *
 * The sheet's labels are read from the alert, not assumed.
 *
 *   simulator:  PLATFORM=ios IOS_DEVICE_NAME="…" IOS_APP=…/KeyRing.app node check-limited-photos.mjs
 *   real phone: PLATFORM=ios IOS_UDID=<udid> IOS_DEVICE_APP=…/Release-iphoneos/KeyRing.app \
 *               WDA_LOCAL_PORT=8131 MJPEG_PORT=9131 node check-limited-photos.mjs
 */
import { execFileSync } from "node:child_process";

import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, existsTestId, scrollToTestId } from "./lib/driver.js";
import { completeOnboarding, TEST_PHOTO_PATH } from "./lib/flows.js";
import { iosDeviceCaps } from "./lib/config.js";
import { printFailure, printSuccess } from "./lib/banner.js";

const LIMIT = /limit access|select photos/i;

/**
 * A photo in Apple's pickers — the limited-selection sheet and the image
 * picker both run out of process, and what XCUITest sees of them varies by iOS
 * version and by device versus simulator. Try the shapes they are known to
 * take, by label first ("Photo, <date>"), never a bare Cell[1] alone.
 */
const PHOTO_SELECTORS = [
  '-ios predicate string:(type == "XCUIElementTypeImage" OR type == "XCUIElementTypeCell" OR type == "XCUIElementTypeButton" OR type == "XCUIElementTypeOther") AND label BEGINSWITH "Photo"',
  '-ios predicate string:type == "XCUIElementTypeImage" AND label CONTAINS[c] "photo"',
  "-ios class chain:**/XCUIElementTypeCollectionView/**/XCUIElementTypeCell[1]",
  "-ios class chain:**/XCUIElementTypeCell[1]",
];

/** The first photo any picker shows, or undefined within `timeoutMs`. */
async function firstPhoto(d, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    for (const sel of PHOTO_SELECTORS) {
      const el = d.$(sel);
      if (await el.isExisting().catch(() => false)) return el;
    }
    await sleep(1000);
  }
  return undefined;
}

let driver;
try {
  await ensureAppium();
  // A real phone when IOS_UDID names one (IOS_DEVICE_APP is the signed Release
  // .app): #21 is only "fixed" once hardware says so. Otherwise a simulator.
  const deviceUdid = process.env.IOS_UDID;
  driver = deviceUdid
    ? await createSession(
        "ios",
        iosDeviceCaps(deviceUdid, {
          wdaLocalPort: Number(process.env.WDA_LOCAL_PORT) || undefined,
          mjpegServerPort: Number(process.env.MJPEG_PORT) || undefined,
        })
      )
    : await createSession("ios");
  const udid = driver.capabilities?.udid;
  if (!udid) throw new Error("no udid on the session");
  if (deviceUdid) {
    // The phone's own library; a fresh install (fullReset) leaves the app's
    // photo permission undetermined, which is what makes the sheet appear.
    console.log(`[e2e] #21: real device ${udid}; using its own photos; permission undetermined after reinstall`);
  } else {
    execFileSync("xcrun", ["simctl", "addmedia", udid, TEST_PHOTO_PATH]);
    console.log(`[e2e] #21: seeded one photo on ${udid}; photo permission left undetermined`);
  }

  await completeOnboarding(driver, {
    firstName: "Limited",
    lastName: "Photos",
    beforeRCardSubmit: async (d) => {
      // The photo sits at the top of the form, which the name fields and the
      // keyboard have scrolled past: bring it on screen, then tap it.
      await (await scrollToTestId(d, "RCardPhotoInput", 4)).click();
      // The system sheet: find its "Limit Access…" button by label.
      let buttons = [];
      for (let i = 0; i < 10 && !buttons.length; i++) {
        buttons = await d.execute("mobile: alert", { action: "getButtons" }).catch(() => []);
        if (!buttons.length) await sleep(1000);
      }
      console.log(`[e2e] #21: permission sheet buttons: ${JSON.stringify(buttons)}`);
      const limit = buttons.find((b) => LIMIT.test(b));
      if (!limit) throw new Error(`the permission sheet offers no limited access: ${JSON.stringify(buttons)}`);
      await d.execute("mobile: alert", { action: "accept", buttonLabel: limit });

      // The limited-selection sheet: select the one photo, then Done.
      const cell = await firstPhoto(d, 20000);
      if (!cell) {
        await screenshot(d, "limited-photos-no-selection-grid");
        await dumpSource(d, "limited-photos-no-selection-grid");
        throw new Error("the limited-selection sheet showed no photo this check could find (see the source dump)");
      }
      await cell.click();
      await screenshot(d, "limited-photos-selected");
      const done = d.$('-ios predicate string:type == "XCUIElementTypeButton" AND (label == "Done" OR label == "Continue")');
      await done.waitForExist({ timeout: 10000 });
      await done.click();
      console.log("[e2e] #21: limited selection done");

      // The fix: Keyring's own picker opens by itself. The bug: back on the
      // form, having to tap the photo again.
      const pickerPhoto = await firstPhoto(d, 15000);
      const picker = Boolean(pickerPhoto);
      if (!picker) {
        await screenshot(d, "limited-photos-no-picker");
        await dumpSource(d, "limited-photos-no-picker");
        const backOnForm = await existsTestId(d, "RCardPhotoInput", 2000);
        throw new Error(
          backOnForm
            ? "#21 NOT FIXED: after limited access, the picker closed and the form asks for the photo again"
            : "after limited access, neither Keyring's picker nor the profile form is showing"
        );
      }
      console.log("[e2e] #21: Keyring's picker opened by itself after the permission sheet");
      await pickerPhoto.click();
      for (const label of ["Choose", "Use Photo", "Done"]) {
        const b = d.$(`-ios predicate string:type == "XCUIElementTypeButton" AND label == "${label}"`);
        if (await b.waitForExist({ timeout: 5000 }).then(() => true).catch(() => false)) {
          await b.click();
          break;
        }
      }
      if (!(await existsTestId(d, "RCardPhotoPreview", 20000))) {
        await screenshot(d, "limited-photos-no-preview");
        throw new Error("the photo was picked but the profile shows no preview");
      }
      await screenshot(d, "limited-photos-preview");
      console.log("[e2e] #21: the profile shows the photo, on the first attempt");
    },
  });
  printSuccess("#21 LIMITED PHOTO ACCESS — the first attempt picks a photo");
} catch (err) {
  printFailure("#21 LIMITED PHOTO ACCESS", err);
  process.exitCode = 1;
} finally {
  await driver?.deleteSession().catch(() => undefined);
  stopAppium();
}
