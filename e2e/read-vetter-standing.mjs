/**
 * One read: what the VETTER's own app thinks its standing is.
 *
 * My Agent computes it with `ownVetterGrantState`, which evaluates every grant
 * the phone holds and prefers an active one — the evaluation the vetting desk
 * does NOT do. So an active standing here means the live grant was delivered
 * and held, and the stale-grant signing is purely a selection defect. A revoked
 * or absent standing means delivery failed too, and there is a second fix.
 */
import { unlockIfLocked, openMyAgentSurface } from "./lib/flows.js";
import { createSession, ensureAppium, stopAppium, sleep, waitForTestId, byTestId, existsTestId, dumpSource } from "./lib/driver.js";
import { iosCaps } from "./lib/config.js";

const textOf = async (d, key) => (await byTestId(d, key).getAttribute("label").catch(() => "")) || "";

let driver;
try {
  await ensureAppium();
  driver = await createSession("ios", {
    ...iosCaps(),
    "appium:deviceName": "iPhone 17 Release repro",
    "appium:fullReset": false,
    "appium:noReset": true,
    "appium:enforceAppInstall": false,
  });
  await sleep(3000);
  // The wallet may be locked, or sitting on whatever screen the last run left.
  await unlockIfLocked(driver).catch(() => undefined);
  await sleep(2000);
  // A linked phone has no panel on the one-agent screen: it reads the agent home.
  const surface = await openMyAgentSurface(driver);
  await sleep(4000);
  console.log(`surface: ${surface}`);
  const keys = [
    "AgentSeat",
    "AgentVetterCard",
    "AgentVetterLapsed",
    "AgentContinueVetting",
    "AgentMembershipRow",
    "MyAgentSeatBadge",
    "MyAgentVettingRow",
    "MyAgentVetterRow",
    "MyAgentCommunityRow",
    "MyAgentMembershipCard",
    "MyAgentIdentityCard",
    "VettingRoleBadge",
  ];
  for (const k of keys) {
    if (await existsTestId(driver, k, 1500)) console.log(`${k}: ${(await textOf(driver, k)).slice(0, 120)}`);
  }
  await dumpSource(driver, "vetter-my-agent-standing");
} finally {
  await driver?.deleteSession().catch(() => undefined);
  stopAppium();
}
