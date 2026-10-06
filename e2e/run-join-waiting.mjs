#!/usr/bin/env node
/**
 * 235 evidence (Alberto, 10-06): the community card's "Show the code they see" WHILE a join is still waiting.
 * On a linked Android phone: open C by its link, Ask to join (the admin-review way), then My Agent → the card's
 * identity line → screenshot community-card-waiting.png into PERSONA_SHOTS. Prints `PERSONA-DID …` and
 * `WAITING-STATUS …`. The caller declines the request afterwards.
 *   E2E_APP_ID=… UDID=emulator-5572 C_DID=… C_NAME="Keyring Lab Community" PERSONA_SHOTS=<dir> node run-join-waiting.mjs
 */
import "./lib/cli-guard.js";
import { existsTestId, scrollToTestId, sleep, stopAppium, tapTestId, waitForTestId, ensureAppium, screenshot } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { handleBiometricConfirmIfPresent, pasteLinkFromHome } from "./lib/flows.js";
import { capturePersonaDid, footClear } from "./lib/personaDid.js";
import { communityCardKey } from "./lib/testIdKeys.js";

const C_DID = process.env.C_DID;
const key = communityCardKey(C_DID || "");
const log = (m) => console.log(`[e2e] ${new Date().toISOString().slice(11, 23)}Z ${m}`);
let d;
try {
  await ensureAppium();
  d = await makeDriver({ platform: "android", udid: process.env.UDID, keepState: true });
  await d.activateApp(process.env.E2E_APP_ID);
  await unlockToHome(d).catch(async (e) => {
    if (!(await existsTestId(d, "MyAgent", 10000))) throw e;
  });
  await pasteLinkFromHome(d, `keyring://vti/community?d=${encodeURIComponent(C_DID)}&n=${encodeURIComponent(process.env.C_NAME || "Keyring Lab Community")}`);
  await scrollToTestId(d, "JoinAsk", 6, { from: 0.45 }).catch(() => undefined);
  const ask = (await existsTestId(d, "JoinAsk", 5000)) ? "JoinAsk" : "JoinStart";
  await tapTestId(d, ask, 15000);
  await waitForTestId(d, "JoinMakeIdentity", 30000).catch(() => undefined);
  if (await existsTestId(d, "JoinAsContinue", 3000)) await tapTestId(d, "JoinAsContinue", 10000);
  await handleBiometricConfirmIfPresent(d).catch(() => undefined);
  log(`asked to join by ${ask}`);
  // Sent: the standing, or the "request was sent" line when the answer is late. Either way, it is waiting.
  const shown = await waitForTestId(d, "JoinStanding", 120000).then(() => "standing", () => "no standing in 120 s");
  log(`Join after sending: ${shown}`);
  // 236: #319 the Join screen names the identity it asked with; #322 its actions end above the tab bar.
  const nameLine = (await existsTestId(d, "JoinStandingIdentityName", 3000)) ? (await textOf(d, "JoinStandingIdentityName")).trim() : "";
  console.log(`JOIN-IDENTITY-NAME ${nameLine || "(none)"}`);
  await capturePersonaDid(d, "JoinStandingIdentity", "join-standing-identity");
  // To the very end of the page: the question is whether its last line can rise above the tab bar.
  const { width: w, height: h } = await d.getWindowSize();
  for (let i = 0; i < 4; i++) {
    await d.action("pointer").move({ x: Math.floor(w / 2), y: Math.floor(h * 0.7) }).down().pause(80).move({ x: Math.floor(w / 2), y: Math.floor(h * 0.3), duration: 400 }).up().perform();
    await sleep(600);
  }
  await footClear(d, "JoinActions", "join-actions");
  await tapTestId(d, "MyAgent", 15000);
  // The status settles after the journey read; it is the row's own label after the first ", " (one accessible
  // element: AgentCommunityOpen_<key> or AgentMembershipRow), or the status child's text on Android.
  let status = "";
  for (let i = 0; i < 10 && !status; i++) {
    await sleep(1500);
    status = (await textOf(d, `AgentCommunityStatus_${key}`).catch(() => "")).replace(/\s+/g, " ").trim();
    if (!status) {
      for (const row of [`AgentCommunityOpen_${key}`, "AgentMembershipRow"]) {
        const el = await d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/${row}")`);
        const label = String((await el.getAttribute("content-desc").catch(() => "")) || "");
        if (label.includes(", ")) status = label.slice(label.indexOf(", ") + 2).trim();
        if (status) break;
      }
    }
  }
  console.log(`WAITING-STATUS ${status || "(no status line)"}`);
  await capturePersonaDid(d, `AgentCommunityIdentity_${key}`, "community-card-waiting");
  await screenshot(d, "community-card-waiting").catch(() => undefined);
} catch (e) {
  log(`error: ${e.message.split("\n")[0]}`);
  if (d) await screenshot(d, "community-card-waiting-failure").catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
