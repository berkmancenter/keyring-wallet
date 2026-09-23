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
import { iosCaps, iosDeviceCaps } from "./lib/config.js";
import { printFailure, printSuccess } from "./lib/banner.js";

const LIMIT = /limit access|select photos/i;

/**
 * A photo in Apple's pickers — the limited-selection sheet and the image
 * picker both run out of process, and what XCUITest sees of them varies by iOS
 * version and by device versus simulator. Try the shapes they are known to
 * take, by label first ("Photo, <date>"), never a bare Cell[1] alone.
 */
/**
 * The test photo, and only it. A phone's library holds real, sometimes
 * private, pictures, so this never takes "the first photo": it lists every item
 * Apple's picker labels "Photo, <date>", keeps those dated TODAY (the neutral
 * test image was added on the day of the run), and takes the newest of them.
 * No match → undefined, and the caller aborts; nothing else is ever tapped.
 */
const PHOTO_ITEMS =
  '-ios predicate string:(type == "XCUIElementTypeImage" OR type == "XCUIElementTypeCell" OR type == "XCUIElementTypeButton" OR type == "XCUIElementTypeOther") AND label BEGINSWITH "Photo, "';

/** The date a picker label names, or NaN. Formats vary: "Photo, 23 September 2026, 14:02", "… at 2:02 PM". */
function dateOfLabel(label) {
  const text = String(label).replace(/^Photo,\s*/, "").replace(/\s+at\s+/i, " ").replace(/,(?=\s*\d{1,2}:\d{2})/, "");
  return Date.parse(text);
}

async function todaysNewestPhoto(d, timeoutMs) {
  const today = new Date().toDateString();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const items = await d.$$(PHOTO_ITEMS).catch(() => []);
    const dated = [];
    let parsed = 0;
    for (const el of items) {
      const label = await el.getAttribute("label").catch(() => "");
      const at = dateOfLabel(label);
      if (!Number.isNaN(at)) parsed++;
      if (!Number.isNaN(at) && new Date(at).toDateString() === today) dated.push({ el, at });
    }
    // Counts only: labels carry dates, and nothing of a photo's content.
    // "parsed" tells an unreadable label format apart from no photo of today.
    if (items.length) {
      console.log(`[e2e] #21: ${items.length} photo item(s) in view, ${parsed} with a readable date, ${dated.length} dated today`);
      if (dated.length) return dated.sort((x, y) => y.at - x.at)[0].el;
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
  // The harness answers system alerts by itself (autoAcceptAlerts), and on the
  // iPhone 11 it answered this very sheet — "Don't Allow" — before the check
  // could choose (2026-09-23). This check is about choosing, so for its own
  // session it answers nothing on its own.
  const noAutoAnswer = { "appium:autoAcceptAlerts": false };
  driver = deviceUdid
    ? await createSession("ios", {
        ...iosDeviceCaps(deviceUdid, {
          wdaLocalPort: Number(process.env.WDA_LOCAL_PORT) || undefined,
          mjpegServerPort: Number(process.env.MJPEG_PORT) || undefined,
        }),
        ...noAutoAnswer,
      })
    : await createSession("ios", { ...iosCaps(), ...noAutoAnswer });
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
      // The system sheet. Read its buttons through the alert API, then choose
      // "Limit Access…". On a real phone WDA can list the sheet's buttons and
      // then refuse to accept it ("no modal dialog open", iPhone 11,
      // 2026-09-23), so fall back to tapping the button as an element by its
      // label — which works whether or not WDA treats the sheet as an alert.
      let buttons = [];
      for (let i = 0; i < 20 && !buttons.length; i++) {
        buttons = await d.execute("mobile: alert", { action: "getButtons" }).catch(() => []);
        if (!buttons.length) await sleep(1000);
      }
      console.log(`[e2e] #21: permission sheet buttons: ${JSON.stringify(buttons)}`);
      const limitByLabel = d.$('-ios predicate string:type == "XCUIElementTypeButton" AND (label BEGINSWITH "Limit Access" OR label BEGINSWITH "Select Photos")');
      if (!buttons.length && !(await limitByLabel.isExisting().catch(() => false))) {
        await screenshot(d, "limited-photos-no-sheet");
        await dumpSource(d, "limited-photos-no-sheet");
        throw new Error("the photo permission sheet did not appear within 20 s");
      }
      const limit = buttons.find((b) => LIMIT.test(b));
      if (buttons.length && !limit) throw new Error(`the permission sheet offers no limited access: ${JSON.stringify(buttons)}`);
      const accepted = limit
        ? await d.execute("mobile: alert", { action: "accept", buttonLabel: limit }).then(() => true).catch(() => false)
        : false;
      if (!accepted) {
        if (!(await limitByLabel.isExisting().catch(() => false))) {
          await screenshot(d, "limited-photos-sheet-untappable");
          await dumpSource(d, "limited-photos-sheet-untappable");
          throw new Error("could not choose Limit Access: the alert API refused and no button by that label was found");
        }
        await limitByLabel.click();
        console.log("[e2e] #21: chose Limit Access by tapping the button (the alert API refused)");
      } else {
        console.log("[e2e] #21: chose Limit Access through the alert API");
      }

      // The limited-selection sheet: select the one photo, then Done.
      // No screenshots or source dumps from here until the photo is on the
      // profile: Apple's grid shows the rest of the library.
      const cell = await todaysNewestPhoto(d, 20000);
      if (!cell) throw new Error("ABORTED: the selection sheet shows no photo dated today — the neutral test image is not there, and nothing else will be picked");
      await cell.click();
      const done = d.$('-ios predicate string:type == "XCUIElementTypeButton" AND (label == "Done" OR label == "Continue")');
      await done.waitForExist({ timeout: 10000 });
      await done.click();
      console.log("[e2e] #21: limited selection done");

      // The fix: Keyring's own picker opens by itself. The bug: back on the
      // form, having to tap the photo again.
      const pickerPhoto = await todaysNewestPhoto(d, 15000);
      const picker = Boolean(pickerPhoto);
      if (!picker) {
        // Text only: the picker, if it is up at all, shows the library.
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
        // Text only: Apple's picker may still be open over the library.
        throw new Error("the test photo was tapped but the profile shows no preview");
      }
      // No screenshot even now: the photo on the profile came from a real library.
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
