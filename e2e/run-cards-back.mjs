#!/usr/bin/env node
/**
 * Cards back on a new install (226, agent-kept cards): after the waiting leg's flow B made this phone's identity a
 * member of C, the leg wipes the app (uninstall), installs and links it to the same runner agent again
 * (run-vta-link.js), and runs this. On Your agent's Agent settings: "Get your cards from your agent"
 * (AgentGetCards → AgentGetCardsButton), then Your agent's card for C must show BOTH cards again, the membership card
 * and the role card (CardKeptRow: AgentCard_membership_<key>, AgentCard_role_<key>).
 *
 * Row cards-back-new-install is TRACKED (lib/rows.js `tracked`): a new install does not adopt the agent's identities
 * yet (planned for 242, Alberto 10-14); the vault query by purpose only was fixed by bifold #389. Formerly:
 * recoverCardsFromAgent asked the vault by purpose only
 * (membership, role, endorsement: bifold vtiCardVault.ts), and the vault files C's role card (AuthorityCredential)
 * with no purpose (vta-vault receive.rs infer_purpose), so the role card does not come back; the UI/UX fix is
 * pending. A further gap the detail names when it shows: a new install holds no identity for C until it adopts its
 * agent's identities (GetCardsFromAgent renders nothing without one), so AgentGetCards may be absent altogether.
 * A failure of any kind, the driver's own start included, is the tracked row's detail, never a broken leg.
 *   E2E_APP_ID=… UDID=emulator-5572 C_DID=… C_NAME="Keyring Lab Community" node run-cards-back.mjs
 */
import "./lib/cli-guard.js";
import { ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestId, waitForTestId } from "./lib/driver.js";
import { makeDriver, unlockToHome } from "./lib/keyringRoles.js";
import { communityCardKey } from "./lib/testIdKeys.js";
import { createRows } from "./lib/rows.js";

const CARDS_BACK_TRACKED = "new install: identities not adopted from the agent (planned for 242, Alberto 10-14)";

const C_DID = process.env.C_DID || "";
const key = communityCardKey(C_DID);
const rows = createRows({ label: "cards-back" });
const log = (m) => console.log(`[e2e] ${new Date().toISOString().slice(11, 23)}Z ${m}`);

/** Every text under an element, in order: the result card's words. */
async function wordsUnder(d, id) {
  const el = await d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/${id}")`);
  if (!(await el.isExisting().catch(() => false))) return "";
  const words = [];
  for (const c of await el.$$(".//*")) {
    const t = await c.getAttribute("text").catch(() => "");
    if (t) words.push(String(t));
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

let d;
try {
  await rows.row(
    "cards-back-new-install",
    async () => {
      if (!C_DID) return { ok: false, detail: "C_DID is required" };
      await ensureAppium();
      d = await makeDriver({ platform: "android", udid: process.env.UDID, keepState: true });
      rows.setDriver(d);
      await d.activateApp(process.env.E2E_APP_ID);
      await unlockToHome(d).catch(async (e) => {
        if (!(await existsTestId(d, "MyAgent", 10000))) throw e;
      });
      // Your agent → its gear → Agent settings, where "Get your cards from your agent" sits.
      await tapTestId(d, "MyAgent", 15000);
      await sleep(2000);
      await scrollToTestId(d, "AgentSettings", 8).catch(() => undefined);
      await tapTestId(d, "AgentSettings", 10000);
      await waitForTestId(d, "AgentSettingsScreen", 15000);
      const offered = Boolean(await scrollToTestId(d, "AgentGetCards", 8).catch(() => undefined)) || (await existsTestId(d, "AgentGetCards", 3000));
      if (!offered) {
        await screenshot(d, "cards-back-not-offered").catch(() => undefined);
        return { ok: false, detail: "Agent settings offers no \"Get your cards\" (AgentGetCards): this new install holds no identity for C to take its cards back into" };
      }
      await scrollToTestId(d, "AgentGetCardsButton", 4).catch(() => undefined);
      await tapTestId(d, "AgentGetCardsButton", 10000);
      const answered = await existsTestId(d, "AgentGetCardsResult", 120000);
      const said = answered ? await wordsUnder(d, "AgentGetCardsResult") : "";
      log(`Get your cards: ${said || "(no answer in 120 s)"}`);
      await screenshot(d, "cards-back-result").catch(() => undefined);
      // Both cards on Your agent's card for C.
      await d.back().catch(() => undefined);
      await tapTestId(d, "MyAgent", 10000).catch(() => undefined);
      let membership = false;
      let role = false;
      for (const until = Date.now() + 60000; Date.now() < until && !(membership && role); await sleep(2000)) {
        await scrollToTestId(d, `AgentCard_membership_${key}`, 6).catch(() => undefined);
        membership = await existsTestId(d, `AgentCard_membership_${key}`, 1500);
        await scrollToTestId(d, `AgentCard_role_${key}`, 2).catch(() => undefined);
        role = await existsTestId(d, `AgentCard_role_${key}`, 1000);
      }
      await screenshot(d, "cards-back-new-install").catch(() => undefined);
      return {
        ok: membership && role,
        detail: `Get your cards said "${said || "nothing in 120 s"}" · membership card back ${membership} · role card back ${role}`,
      };
    },
    { tracked: CARDS_BACK_TRACKED }
  );
} catch (e) {
  rows.fatal(e);
} finally {
  rows.summary();
  process.exitCode = rows.exitCode();
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
