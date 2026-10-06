#!/usr/bin/env node
/**
 * 235 gate, bifold #305 on iOS (10-05): on the K↔K applicant's simulator, right after K↔K, open the community
 * card's "Show the code they see" and print the DID it shows, to compare with the VTC's member list.
 *   UDID=<sim> E2E_APP_ID=asml.bkc.harvard.wallet C_DID=<community DID> WDA_LOCAL_PORT=8122 node run-identity-ios.mjs
 */
import "./lib/cli-guard.js";
import { ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { communityCardKey } from "./lib/testIdKeys.js";

const key = communityCardKey(process.env.C_DID || "");
let d;
try {
  await ensureAppium();
  d = await makeDriver({ platform: "ios", udid: process.env.UDID, keepState: true });
  await d.activateApp(process.env.E2E_APP_ID);
  await unlockToHome(d);
  await tapTestId(d, "MyAgent", 15000);
  await sleep(2000);
  await scrollToTestId(d, `AgentCommunityIdentity_${key}Toggle`, 8).catch(() => undefined);
  if (!(await existsTestId(d, `AgentCommunityIdentity_${key}Toggle`, 5000))) {
    await screenshot(d, "id305-no-toggle");
    console.log("ID305 NO-TOGGLE");
  } else {
    const label = (await textOf(d, `AgentCommunityIdentity_${key}Toggle`).catch(() => "")).replace(/\s+/g, " ").trim();
    await tapTestId(d, `AgentCommunityIdentity_${key}Toggle`, 10000);
    await sleep(1200);
    await scrollToTestId(d, `AgentCommunityIdentity_${key}Did`, 4).catch(() => undefined);
    const did = (await textOf(d, `AgentCommunityIdentity_${key}Did`).catch(() => "")).replace(/\s+/g, "").trim();
    await screenshot(d, "id305-identity-code");
    console.log(`ID305 LABEL ${label}`);
    console.log(`ID305 DID ${did}`);
  }
} catch (e) {
  console.log(`ID305 ERROR ${e.message.split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
