#!/usr/bin/env node
/**
 * After an update over the previous release (a tester's TestFlight / Play update, never a fresh install):
 * the app was linked (and joined, with more than one agent when EXPECT_AGENTS says so) on the previous build,
 * then the new build was installed over it without an uninstall. On the installed app, driven as it is:
 *   update-agents-linked   Your agent opens on an agent's home, not a link screen or "no longer linked"
 *   update-agents-kept     the chips still list EXPECT_AGENTS agents (default 1); needs update-agents-linked
 *   update-community-kept  C's card is still on Your agent (when C_DID is given); needs update-agents-linked
 *   update-persona-used    USE_PERSONA=1: C opened from its Wallet card, using the other agent's persona (#336);
 *                          needs update-agents-linked, and a build with CommunityCardOpenCommunity
 * Rows through lib/rows.js (each suffixed -<platform>), plus `AFTER-UPDATE <what was on screen>`; exit 0 all
 * pass or skipped, 3 any fail, 1 the run broke.
 *   PLATFORM=ios|android UDID=… [C_DID=…] [EXPECT_AGENTS=2] node run-after-update.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { ensureAppium, existsTestId, screenshot, scrollToTestId, stopAppium, tapTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { communityCardKey } from "./lib/testIdKeys.js";
import { buildLacks } from "./lib/buildHas.js";
import { createRows } from "./lib/rows.js";

const PLATFORM = process.env.PLATFORM ?? "ios";
const want = Number(process.env.EXPECT_AGENTS || 1);
const rows = createRows({ label: "after-update" });
const LINKED = `update-agents-linked-${PLATFORM}`;
const row = (name, ok, detail, opts) => rows.row(`${name}-${PLATFORM}`, () => ({ ok, detail }), opts);

let d;
try {
  await ensureAppium();
  d = await makeDriver({ platform: PLATFORM, udid: process.env.UDID, keepState: true });
  rows.setDriver(d);
  await unlockToHome(d);
  await tapTestId(d, "MyAgent", 15000);
  const home = await existsTestId(d, "AgentHome", 30000);
  const name = home ? (await textOf(d, "AgentHomeName").catch(() => "")).trim() : "";
  const page = await d.getPageSource();
  const words = [...page.matchAll(/(?:text|label|value|name)="([^"]*(?:no longer linked|not linked|Link your agent|not found|backend|Something went wrong|error)[^"]*)"/gi)].map((m) => m[1]).slice(0, 4);
  await screenshot(d, `after-update-${PLATFORM}`).catch(() => undefined);
  console.log(`AFTER-UPDATE home ${home} · name "${name}" · on screen ${JSON.stringify(words)}`);
  await row("update-agents-linked", home && !words.some((w) => /no longer linked|not linked|Link your agent/i.test(w)), home ? `agent home "${name}"` : `no agent home; on screen ${JSON.stringify(words)}`);
  const chips = (page.match(/AgentSwitcherRow_\d+/g) || []).filter((v, i, a) => a.indexOf(v) === i).length;
  await row("update-agents-kept", home && Math.max(chips, 1) >= want, `${chips} agent chip(s) (want ${want})`, { needs: [LINKED] });
  if (process.env.C_DID) {
    const key = communityCardKey(process.env.C_DID);
    const hasCard = (p) => p.includes(`AgentCommunityOpen_${key}`) || p.includes("AgentMembershipRow") || p.includes(`AgentCommunityStatus_${key}`);
    let card = hasCard(page);
    let where = `"${name}"`;
    // C's card is on the home of the agent that joined it. With two agents the current one may be the other
    // (the update leg switches to B before the update, #336's case): switch to the other chip and look there.
    if (!card && chips > 1) {
      const other = [];
      for (const el of await d.$$(`//*[starts-with(@resource-id,"com.ariesbifold:id/AgentSwitcherRow_") or starts-with(@name,"com.ariesbifold:id/AgentSwitcherRow_")]`)) {
        const desc = (await el.getAttribute(PLATFORM === "ios" ? "label" : "content-desc").catch(() => "")) || "";
        if (!/Current/.test(desc)) other.push({ el, desc });
      }
      if (other.length === 1) {
        await other[0].el.click();
        if (PLATFORM === "android" && process.env.DEVICE_PIN) {
          // A switch can ask for the phone's owner (screen lock): answer it as the agents run does.
          const adb = (...a) => execFileSync("adb", ["-s", process.env.UDID, ...a], { encoding: "utf8" });
          for (let i = 0; i < 16; i++) {
            await new Promise((r) => setTimeout(r, 500));
            if (/AuthContainer|BiometricPrompt|ConfirmDeviceCredential/i.test(adb("shell", "dumpsys", "window", "windows"))) {
              adb("shell", "input", "text", process.env.DEVICE_PIN); adb("shell", "input", "keyevent", "66");
              break;
            }
          }
        }
        for (let i = 0; i < 15 && !card; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          card = hasCard(await d.getPageSource());
        }
        where = `the other agent ("${other[0].desc.split(",")[0]}")`;
        await screenshot(d, `after-update-other-agent-${PLATFORM}`).catch(() => undefined);
      } else where += ` (other chips: ${other.length})`;
    }
    await row("update-community-kept", card, card ? `C's card is on ${where}'s home` : `no card for C (AgentCommunityOpen_${key}) on ${where}`, { needs: [LINKED] });
  }
  // USE_PERSONA=1: use the persona the other agent holds in C (bifold #336's case): open C from its Wallet card.
  const lacksOpen = process.env.USE_PERSONA === "1" ? buildLacks("CommunityCardOpenCommunity", { platform: PLATFORM }) : undefined;
  if (process.env.USE_PERSONA === "1" && !lacksOpen) {
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
    await row("update-persona-used", Boolean(toC), toC ? "opened C (the other agent's persona) from its Wallet card" : `card ${opened}, community screen ${toC}`, { needs: [LINKED] });
  } else if (process.env.USE_PERSONA === "1") await row("update-persona-used", false, "", { skip: lacksOpen });
} catch (e) {
  rows.fatal(e);
  if (d) await screenshot(d, `after-update-failure-${PLATFORM}`).catch(() => undefined);
} finally {
  rows.summary();
  process.exitCode = rows.exitCode();
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
