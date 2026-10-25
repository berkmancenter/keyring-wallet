/**
 * Open the ErrorBoundary's "Show Details" and print what it says.
 *
 * The screen a person sees says only "Something went wrong"; the detail behind
 * that control is the only place the actual error appears on a Release build,
 * which emits no JS console to the system log on a simulator.
 */
import "./lib/cli-guard.js";
import { createSession, ensureAppium, stopAppium, sleep, byTestId, existsTestId, tapTestId } from "./lib/driver.js";
import { iosCaps } from "./lib/config.js";

let driver;
try {
  await ensureAppium();
  driver = await createSession("ios", {
    ...iosCaps(),
    "appium:deviceName": process.env.IOS_DEVICE_NAME || "iPhone 17 Farm B",
    "appium:fullReset": false,
    "appium:noReset": true,
    "appium:enforceAppInstall": false,
  });
  await sleep(2500);
  if (!(await existsTestId(driver, "ShowDetails", 4000))) {
    console.log("NO-ERROR-BOUNDARY: the app is not showing the error screen");
  } else {
    await tapTestId(driver, "ShowDetails", 10000);
    await sleep(2000);
    const source = await driver.getPageSource();
    const labels = [...source.matchAll(/label="([^"]{12,400})"/g)].map((m) => m[1]);
    for (const l of labels) {
      if (/error|exceed|depth|render|undefined|cannot|invariant|stack|at /i.test(l)) console.log(`DETAIL: ${l.slice(0, 380)}`);
    }
  }
} finally {
  await driver?.deleteSession().catch(() => undefined);
  stopAppium();
}
