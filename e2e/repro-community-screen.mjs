/**
 * A/B for the ErrorBoundary crash: open the community screen for a community
 * this phone is NOT a member of, and say what happens.
 *
 * Prints one of:
 *   CRASH: <the detail behind "Show Details">   — the boundary, with its reason
 *   OK: <what the screen showed>                — no crash
 *
 * The detail is read in the SAME session, before anything can relaunch the app:
 * a Release build on a simulator emits no JS console to the system log, so that
 * control is the only place the reason appears.
 */
import { createSession, ensureAppium, stopAppium, sleep, byTestId, existsTestId, tapTestId, waitForTestId } from "./lib/driver.js";
import { iosCaps } from "./lib/config.js";
import { unlockIfLocked, dismissTourIfPresent, pasteLinkFromHome } from "./lib/flows.js";

const textOf = async (d, key) => (await byTestId(d, key).getAttribute("label").catch(() => "")) || "";

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
  await unlockIfLocked(driver).catch(() => undefined);
  await dismissTourIfPresent(driver).catch(() => undefined);
  // COMMUNITY_LINK: view a named community instead of the build's own. The
  // discriminator needs a community with NO published branding on the SAME
  // build — varying the suspected variable rather than varying builds, which
  // is what my first A/B got wrong.
  if (process.env.COMMUNITY_LINK) {
    await pasteLinkFromHome(driver, process.env.COMMUNITY_LINK);
    await sleep(8000);
    if (await existsTestId(driver, "ShowDetails", 4000)) {
      await tapTestId(driver, "ShowDetails", 10000);
      await sleep(2000);
      const src = await driver.getPageSource();
      const det = [...src.matchAll(/label="([^"]{10,600})"/g)].map((m) => m[1]).filter((l) => /exceed|depth|render/i.test(l));
      console.log(`CRASH: ${(det[0] ?? "(no detail)").slice(0, 300)}`);
    } else {
      const bits = [];
      for (const k of ["JoinAsks", "CommunityCriteria", "CommunityDid", "CommunityError", "ApplyToCommunityButton"]) {
        if (await existsTestId(driver, k, 1500)) bits.push(k);
      }
      console.log(`OK: unnamed community opened without looping — ${bits.join(", ") || "(no ids matched)"}`);
    }
    process.exit(0);
  }
  await (await waitForTestId(driver, "MyAgent", 60000)).click();
  await sleep(4000);

  const row = byTestId(driver, "MyAgentCommunityRow");
  if (!(await row.isExisting().catch(() => false))) {
    console.log("OK: no community row on My Agent — nothing to open");
  } else {
    console.log(`opening: ${(await textOf(driver, "MyAgentCommunityRow")).slice(0, 90)}`);
    await row.click();
    await sleep(6000);
    if (await existsTestId(driver, "ShowDetails", 4000)) {
      await tapTestId(driver, "ShowDetails", 10000);
      await sleep(2500);
      const source = await driver.getPageSource();
      const labels = [...source.matchAll(/label="([^"]{10,600})"/g)].map((m) => m[1]);
      const detail = labels.filter((l) => /exceed|depth|render|undefined|cannot|invariant|Error|at /i.test(l));
      console.log(`CRASH: ${(detail[0] ?? "(no detail text found)").slice(0, 400)}`);
      for (const d of detail.slice(1, 4)) console.log(`  more: ${d.slice(0, 300)}`);
    } else {
      const bits = [];
      for (const k of ["CommunityError", "CommunityDid", "ApplyToCommunityButton", "LeaveCommunityButton", "CommunityCriteria"]) {
        if (await existsTestId(driver, k, 1200)) bits.push(`${k}="${(await textOf(driver, k)).slice(0, 70)}"`);
      }
      console.log(`OK: ${bits.join(" | ") || "(screen showed none of the expected ids)"}`);
    }
  }
} finally {
  await driver?.deleteSession().catch(() => undefined);
  stopAppium();
}
