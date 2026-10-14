#!/usr/bin/env node
/**
 * farm-onescan (241, bifold #394): a fresh install sets up its agent by scanning the VTA Farm's one-scan setup code
 * (a vta-claim trigger link, /vti/flow/vta-claim/0.1), and ends linked to that agent, online.
 *
 * ATTENDED: the Farm shows the 6-character claim check in a signed-in browser, and a person presses "Codes match"
 * there; the app never sends it back, and the Farm has no call for anyone else to make (vtafarm-api
 * docs/mobile-connection-app-api.md @4ee367f8 §6). So:
 *   FARM_CLAIM_LINK  the setup link of a FRESH Farm test VTA, made on the Farm page for this run (never alice,
 *                    alberto3, alberto-push-vta-2 or a person's agent); without it the row is a tracked SKIP
 *   DEVICE_PIN       the emulator's screen-lock PIN, for the owner check before the claim
 * The driver pastes the link, passes the owner check, prints "FARM-CODE <code>" for the person to compare on the
 * Farm page, and waits up to 10 min for the app to finish.
 *
 *   FARM_CLAIM_LINK='https://link.trustoverip.org/t#…' DEVICE_PIN=1234 PLATFORM=android UDID=emulator-5572 \
 *     node run-farm-onescan.mjs
 */
import "./lib/cli-guard.js";
import { ensureAppium, existsTestId, screenshot, sleep, stopAppium, tapTestId, waitForTestId } from "./lib/driver.js";
import { makeDriver, textOf } from "./lib/keyringRoles.js";
import { completeOnboarding, pasteLinkFromHome } from "./lib/flows.js";
import { answerOwnerCheck, readHomeName } from "./lib/pages/agents.js";
import { createRows } from "./lib/rows.js";
import { buildLacks } from "./lib/buildHas.js";

const PLATFORM = process.env.PLATFORM === "ios" ? "ios" : "android";
const LINK = process.env.FARM_CLAIM_LINK || "";
const PIN = process.env.DEVICE_PIN || "";
const rows = createRows({ label: "farm-onescan" });
const REFUSED = /\b(alice|alberto3|alberto-push-vta-2)\b/;

const lacks = buildLacks("VtaClaimContinue", { platform: PLATFORM });
if (lacks) {
  rows.skip("farm-onescan", `${lacks} (bifold #394)`);
} else if (!LINK) {
  rows.skip("farm-onescan", "tracked (attended): needs FARM_CLAIM_LINK, a fresh Farm test VTA's setup link, and a person to press Codes match on the Farm page");
} else if (!/[#&]_type=\/vti\/flow\/vta-claim\/0\.1(&|$)/.test(LINK) || REFUSED.test(decodeURIComponent(LINK))) {
  rows.skip("farm-onescan", "FARM_CLAIM_LINK is not a vta-claim setup link for a test VTA: nothing run");
} else {
  let d;
  try {
    await ensureAppium();
    d = await makeDriver({ platform: PLATFORM, udid: process.env.UDID, keepState: false });
    rows.setDriver(d);
    await completeOnboarding(d, { firstName: "Farm", lastName: "Onescan" });
    await rows.row("farm-onescan", async () => {
      await pasteLinkFromHome(d, LINK);
      // 1. The confirmation names the Farm by its address, unverified, before anything is sent.
      await waitForTestId(d, "VtaClaimConfirm", 30000);
      const host = (await textOf(d, "VtaClaimHost").catch(() => "")).trim();
      const unverified = await existsTestId(d, "VtaClaimUnverified", 2000);
      await tapTestId(d, "VtaClaimContinue", 15000);
      // 2. The owner check comes before the claim (VtaClaim.tsx onContinue: canOwn → confirmOwner → claiming). A
      // phone that cannot own the agent (no screen lock) fails at once, with no prompt; a cancelled or failed check
      // stays on the confirmation (VtaClaim.NotConfirmed).
      const prompted = await answerOwnerCheck(d, "farm claim", { pin: PIN });
      if (await existsTestId(d, "VtaClaimFailed", 3000)) {
        const why = (await textOf(d, "VtaClaimResultMessage").catch(() => "")).trim();
        return { ok: false, detail: `host "${host}" · failed before the claim${prompted ? "" : " (no owner prompt)"}: "${why}"` };
      }
      if (!(await existsTestId(d, "VtaClaimClaiming", 20000)) && !(await existsTestId(d, "VtaClaimCodeValue", 1000))) {
        const said = (await textOf(d, "VtaClaimConfirmError").catch(() => "")).trim();
        return { ok: false, detail: `host "${host}" · the owner check did not pass${prompted ? "" : " (no prompt)"}: still on the confirmation${said ? `, "${said}"` : ""}` };
      }
      // 3. The code the person compares on the Farm page.
      await waitForTestId(d, "VtaClaimCodeValue", 90000);
      const code = (await textOf(d, "VtaClaimCodeValue")).replace(/\s+/g, "");
      console.log(`FARM-CODE ${code}`);
      console.log(`[farm-onescan] compare ${code} with the Farm page and press "Codes match" there`);
      // 4-5. Connecting, then Ready or Failed, within 10 min (a person is pressing a button).
      let end = "";
      for (const until = Date.now() + 600000; Date.now() < until && !end; await sleep(3000)) {
        if (await existsTestId(d, "VtaClaimReady", 500)) end = "ready";
        else if (await existsTestId(d, "VtaClaimFailed", 500)) end = "failed";
      }
      const said = end ? (await textOf(d, "VtaClaimResultMessage").catch(() => "")).trim() : "";
      await screenshot(d, `farm-onescan-${end || "timeout"}`);
      if (end !== "ready") return { ok: false, detail: `host "${host}" · code ${code} · ${end || "no Ready or Failed in 10 min"}${said ? `: "${said}"` : ""}` };
      await tapTestId(d, "VtaClaimDone", 10000).catch(() => undefined);
      // Then My Agent: the claimed agent, linked and online.
      // VtaClaimDone goes back to where the paste started, not to My Agent.
      await tapTestId(d, "MyAgent", 15000).catch(() => undefined);
      // A first link shows the agent intro before the home (VtaAgentHome introSeen): part of the experience, then skipped.
      const intro = await existsTestId(d, "AgentIntro", 15000);
      if (intro) await tapTestId(d, "AgentIntroSkip", 10000).catch(() => undefined);
      const name = await readHomeName(d).catch(() => "");
      // The status line passes through "Connecting to your agent…" first (VtaStatus.tsx): poll for "Online".
      let status = "";
      for (const until = Date.now() + 60000; Date.now() < until && !/^online$/i.test(status); await sleep(2000)) {
        status = (await textOf(d, "VtaStatusText").catch(() => "")).trim();
      }
      await screenshot(d, "farm-onescan-my-agent");
      return {
        ok: Boolean(name) && /^online$/i.test(status),
        detail: `host "${host}" (unverified shown ${unverified}) · code ${code} · Ready · intro ${intro} · My Agent "${name}", status "${status}"`,
      };
    });
  } catch (e) {
    rows.fatal(e);
    if (d) await screenshot(d, "farm-onescan-failure").catch(() => undefined);
  } finally {
    if (d) await d.deleteSession().catch(() => undefined);
    stopAppium();
  }
}
rows.summary();
process.exitCode = rows.exitCode();
