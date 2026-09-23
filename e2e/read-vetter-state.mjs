/**
 * One read of the vetter sim's state, with the app parked where the caller
 * says. Used to answer, for the delivery diagnosis, which listener a grant
 * reaches: the app-wide persona inbox, or the vetting screen's own.
 *
 *   PARK=myagent   leave it on My Agent (the inbox is mounted, the desk is not)
 *   PARK=vetting   leave it on the vetting screen (both listeners mounted)
 *
 * Prints the seat and whether the desk offers a ticket, which is what changes
 * when a live grant arrives.
 */
import { createSession, ensureAppium, stopAppium, sleep, waitForTestId, byTestId, existsTestId } from "./lib/driver.js";
import { iosCaps } from "./lib/config.js";
import { unlockIfLocked, openMyAgentPanel } from "./lib/flows.js";

const PARK = process.env.PARK || "myagent";
const textOf = async (d, key) => (await byTestId(d, key).getAttribute("label").catch(() => "")) || "";

let driver;
try {
  await ensureAppium();
  driver = await createSession("ios", {
    ...iosCaps(),
    "appium:deviceName": process.env.IOS_DEVICE_NAME || "iPhone 17 Release repro",
    "appium:fullReset": false,
    "appium:noReset": true,
    "appium:enforceAppInstall": false,
  });
  await sleep(2500);
  await unlockIfLocked(driver).catch(() => undefined);
  await openMyAgentPanel(driver);
  await sleep(4000);

  for (const k of ["MyAgentVettingRow", "MyAgentMembershipRole", "MyAgentPersonaDid", "MyAgentCommunityRow"]) {
    if (await existsTestId(driver, k, 1500)) console.log(`${k}: ${(await textOf(driver, k)).slice(0, 110)}`);
  }

  if (PARK === "vetting") {
    const row = await byTestId(driver, "MyAgentVettingRow");
    if (await row.isExisting().catch(() => false)) {
      await row.click();
      await sleep(4000);
      for (const k of ["VettingYouVetFor", "VettingNewTicketButton", "VettingRoleBadge", "VettingStandingNotice"]) {
        if (await existsTestId(driver, k, 1500)) console.log(`${k}: ${(await textOf(driver, k)).slice(0, 110)}`);
      }
      console.log("[parked] vetting screen open — both listeners mounted");
    }
  } else {
    console.log("[parked] My Agent — the app-wide inbox is mounted, the vetting screen is not");
  }
} finally {
  // Deliberately NOT deleting the session: the app must stay where it is
  // parked while the grant is re-issued, or the experiment tests nothing.
  if (process.env.CLOSE === "1") {
    await driver?.deleteSession().catch(() => undefined);
    stopAppium();
  }
}
