#!/usr/bin/env node
/**
 * After an update over the previous release (a tester's TestFlight / Play update, never a fresh install):
 * the app was linked (and joined, with more than one agent when EXPECT_AGENTS says so) on the previous build,
 * then the new build was installed over it without an uninstall. On the installed app, driven as it is:
 *   update-agents-linked   Your agent opens on an agent's home, not a link screen or "no longer linked"
 *   update-agents-kept     the chips still list EXPECT_AGENTS agents (default 1)
 *   update-community-kept  C's card is still on Your agent (when C_DID is given)
 *   update-persona-used    USE_PERSONA=1: C opened from its Wallet card, using the other agent's persona (#336)
 * Prints ROW lines and `AFTER-UPDATE <what was on screen>`; exit 0 all pass, 3 any fail, 1 the run broke.
 *   PLATFORM=ios|android UDID=… [C_DID=…] [EXPECT_AGENTS=2] node run-after-update.mjs
 */
import "./lib/cli-guard.js";
import { ensureAppium, existsTestId, screenshot, scrollToTestId, stopAppium, tapTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { communityCardKey } from "./lib/testIdKeys.js";

const PLATFORM = process.env.PLATFORM ?? "ios";
const want = Number(process.env.EXPECT_AGENTS || 1);
let failed = 0;
const row = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`ROW ${name}-${PLATFORM} ${ok ? "PASS" : "FAIL"} — ${detail}`);
};

let d;
try {
  await ensureAppium();
  d = await makeDriver({ platform: PLATFORM, udid: process.env.UDID, keepState: true });
  await unlockToHome(d);
  await tapTestId(d, "MyAgent", 15000);
  const home = await existsTestId(d, "AgentHome", 30000);
  const name = home ? (await textOf(d, "AgentHomeName").catch(() => "")).trim() : "";
  const page = await d.getPageSource();
  const words = [...page.matchAll(/(?:text|label|value|name)="([^"]*(?:no longer linked|not linked|Link your agent|not found|backend|Something went wrong|error)[^"]*)"/gi)].map((m) => m[1]).slice(0, 4);
  await screenshot(d, `after-update-${PLATFORM}`).catch(() => undefined);
  console.log(`AFTER-UPDATE home ${home} · name "${name}" · on screen ${JSON.stringify(words)}`);
  row("update-agents-linked", home && !words.some((w) => /no longer linked|not linked|Link your agent/i.test(w)), home ? `agent home "${name}"` : `no agent home; on screen ${JSON.stringify(words)}`);
  const chips = (page.match(/AgentSwitcherRow_\d+/g) || []).filter((v, i, a) => a.indexOf(v) === i).length;
  row("update-agents-kept", home && Math.max(chips, 1) >= want, `${chips} agent chip(s) (want ${want})`);
  if (process.env.C_DID) {
    const key = communityCardKey(process.env.C_DID);
    const card = page.includes(`AgentCommunityOpen_${key}`) || page.includes("AgentMembershipRow") || page.includes(`AgentCommunityStatus_${key}`);
    row("update-community-kept", card, card ? "C's card is on Your agent" : `no card for C (AgentCommunityOpen_${key})`);
  }
  // USE_PERSONA=1: use the persona the other agent holds in C (bifold #336's case): open C from its Wallet card.
  if (process.env.USE_PERSONA === "1") {
    await tapTestId(d, "Wallet", 10000).catch(() => undefined);
    for (let i = 0; i < 5 && (await existsTestId(d, "Close", 1500).catch(() => false)); i++) await tapTestId(d, "Close", 5000).catch(() => tapTestId(d, "Next", 5000));
    const card = d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/CredentialName").textContains("${process.env.C_NAME || "Keyring Lab Community"}")`);
    const opened = (await card.isExisting().catch(() => false)) && (await card.click().then(() => true, () => false));
    // The card's details put "Open the community" below the fold: scroll to it (as R7 does).
    const openBtn = opened ? await scrollToTestId(d, "CommunityCardOpenCommunity", 8).catch(() => undefined) : undefined;
    const toC = Boolean(openBtn) && (await openBtn.click().then(() => true, () => false));
    await new Promise((r) => setTimeout(r, 15000)); // the persona's session, if any, opens now
    await screenshot(d, `after-update-persona-${PLATFORM}`).catch(() => undefined);
    console.log(`USED-PERSONA card ${opened} · community screen ${toC} ${new Date().toISOString()}`);
    row("update-persona-used", Boolean(toC), toC ? "opened C (the other agent's persona) from its Wallet card" : `card ${opened}, community screen ${toC}`);
  }
  process.exitCode = failed ? 3 : 0;
} catch (e) {
  console.log(`LEG after-update BROKEN — ${String(e.message).split("\n")[0]}`);
  if (d) await screenshot(d, `after-update-failure-${PLATFORM}`).catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
