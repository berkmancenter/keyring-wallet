#!/usr/bin/env node
/**
 * Several agents on one phone (bifold #277–#281) and a refusal on Your agent (#282), on an Android
 * built app. Rows, run in this order whatever ROWS lists:
 *   R1 add a second agent and keep the first; switch to it
 *   R2 an identity belongs to its agent: A joins C; on B, Join offers no chooser and goes ahead with B (#334)
 *   R5 a refusal reaches Your agent: the card's own status, and "Check now" if the session holds another identity
 *   R3 requests from the other agent ("Ask me before…" on A, a held task, Requests on B)
 *   R6 both agents join one community; both memberships survive a relaunch; the Wallet names each card's agent
 *   R7 a membership of another agent (#320): A a member of C (R2), on B open C from its Wallet card → "on A"
 *   R4 unlink one of several, then the last
 * The rows are lib/rows.js rows: a failing row never stops the ones after it, and a row that needs an earlier
 * one SKIPs when that one did not pass; E2E_ONLY_ROWS (the gate's --only-failed) picks rows by name. The screens
 * are driven through the page objects lib/pages/agents.js and lib/pages/join.js, one step per function, each
 * with a screenshot and the page source when it fails.
 *
 * The caller links the phone to agent A first (run-vta-link.js, LINK_MODE=manual), and cleans up after:
 * the phone's keys on both agents, any approval rules and approver sets, and the test members of C.
 * A must enforce approvals for R3. DEVICE_PIN is set after the first link, never before.
 *
 *   E2E_APP_ID=… UDID=emulator-5572 A_SLUG=… A_DID=… A_NAME=… B_SLUG=… B_DID=… B_NAME=…
 *   C_DID=… C_ADMIN="<rest did cred>" PNM_BIN=… DEVICE_PIN=1234 ROWS="R1 R2 R5 R3 R4" LOGCAT=<file> node run-several-agents.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dumpSource, ensureAppium, existsTestId, scrollToTestId, sleep, stopAppium, tapTestId, waitForTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { pasteLinkOnScanScreen } from "./lib/flows.js";
import { APP_ID } from "./lib/config.js";
import { communityCardKey } from "./lib/testIdKeys.js";
import { createRows } from "./lib/rows.js";
import { agents, answerOwnerCheck, readCommunityCard, readHomeName, readScanKey, readSwitcherRows, splitRows } from "./lib/pages/agents.js";
import { community, join, readEntry } from "./lib/pages/join.js";
import { idsWithPrefix, rowText, said, shot } from "./lib/pages/step.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = path.resolve(here, "../tsp-reference/ref-20-local-vetting/vtc-admin.mjs");
const ENROL = path.resolve(here, "../scripts/openvtc/local-vti-stack/enrol-manager.sh");
const E = process.env;
const UDID = E.UDID;
const PIN = E.DEVICE_PIN || "";
const ROWS = (E.ROWS || "R1 R2 R5 R3 R4").split(/\s+/);
const C_KEY = communityCardKey(E.C_DID || "");
const C_ADMIN = (E.C_ADMIN || "").split(" ").filter(Boolean);
const utc = () => new Date().toISOString().slice(11, 23) + "Z";
const log = (s) => console.log(`[e2e] ${utc()} ${s}`);
const firstLine = (err) => String(err?.message ?? err).split("\n")[0];
// The rows, and a copy of each ROW line for the SUMMARY at the end.
const summary = [];
const rows = createRows({
  label: "agents",
  log: (s) => {
    console.log(s);
    if (s.startsWith("ROW ")) summary.push(s.slice(4));
  },
});
const t0 = {};
const since = (k) => `${((Date.now() - t0[k]) / 1000).toFixed(1)} s`;
const adb = (...a) => execFileSync("adb", ["-s", UDID, ...a], { encoding: "utf8" });
const pnm = (slug, ...a) => {
  try {
    return execFileSync(E.PNM_BIN, ["--vta", slug, ...a], { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
};
const admin = (...a) => {
  const out = execFileSync("node", [ADMIN, ...C_ADMIN, ...a], { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] });
  return out;
};
const json = (s) => JSON.parse(s.slice(s.indexOf("{")));
const txt = (d, id) => said(d, id);
/** The phone's temporary key granted on `slug` (the enrolment script), for the page objects' link steps. */
const grant = async (temp, slug) => execFileSync("bash", [ENROL, temp, slug, "admin"], { stdio: "ignore", env: { ...process.env, EXPIRES: "1h" } });
const logcatSince = (mark) => {
  try {
    const lines = readFileSync(E.LOGCAT, "utf8").split("\n");
    const i = mark ? lines.findIndex((l) => l.includes(mark)) : 0;
    return lines.slice(Math.max(0, i));
  } catch {
    return [];
  }
};

/**
 * Run a group's actions. A throw is kept for the group's rows (FAIL "threw: …", as rows.js words it) instead of
 * ending the run, so the groups after it still run; each re-syncs the phone with a switch of its own.
 */
async function attempt(tag, fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    log(`${tag} stopped: ${firstLine(error)}`);
    if (d) await shot(d, "agents-failure");
    return { ok: false, error };
  }
}
const threw = (a) => ({ ok: false, detail: `threw: ${firstLine(a.error).slice(0, 300)}` });

/** Answer Android's device-credential prompt, only if one is on screen. */
const owner = (tag) => answerOwnerCheck(d, tag, { pin: PIN });

/** Your agent, and its name. */
const myAgent = async () => (await agents.open(d)).value.name;

/** Back on agent `name` whatever the group before left; a miss is logged, never fatal. */
const resync = (name) => attempt(`switch to ${name}`, () => agents.switchTo(d, { name, owner }));

/** How many Wallet cards name C (CredentialName), after closing the Wallet's first-visit tour. */
async function walletCardsForC(d) {
  await tapTestId(d, "Wallet", 10000).catch(() => undefined);
  await sleep(2000);
  for (let i = 0; i < 5 && (await existsTestId(d, "Close", 1500).catch(() => false)); i++) await tapTestId(d, "Close", 5000).catch(() => tapTestId(d, "Next", 5000));
  return (await d.$$(`android=new UiSelector().resourceId("com.ariesbifold:id/CredentialName").textContains("${E.C_NAME}")`)).length;
}
let walletBefore = -1;

/** Ask to join C on the current agent (the review way); answers the owner check; returns the request id. */
async function askToJoinC(d, tag) {
  const before = new Set((json(admin("join-list")).items ?? []).map((r) => r.id));
  await join.openCommunity(d, { did: E.C_DID, via: "intent", appId: APP_ID, udid: UDID });
  await join.ask(d, { owner, tag });
  await join.awaitSent(d, { timeoutMs: 240000 });
  let req;
  for (const until = Date.now() + 60000; Date.now() < until && !req; await sleep(3000)) req = (json(admin("join-list")).items ?? []).find((r) => !before.has(r.id));
  if (!req) throw new Error(`${tag}: the community lists no new join request`);
  log(`${tag}: request ${req.id} ${req.status} from …${String(req.applicantDid).slice(-24)}`);
  return req;
}

let d;
try {
  await ensureAppium();
  d = await makeDriver({ platform: "android", udid: UDID, keepState: true });
  rows.setDriver(d);
  await d.activateApp(APP_ID);
  await unlockToHome(d);
  if (PIN) {
    adb("shell", "locksettings", "set-pin", PIN);
    log("device PIN set (after the first link); waiting past the 5 s key window");
    await sleep(8000);
  }

  // R11 (239 finding, UI/UX 10-08): an Add whose key swap is held by an approval rule on B's agent, then Back: the
  // phone returns to A (current), and B is not left in the chips. The rule goes on B's runner (the gate's) for this
  // row only and comes off whatever happens; the held temporary key on B goes in the leg's cleanup.
  // H: the agent whose swap is held, on a runner that ENFORCES approval rules (239 final: B's openvtc runner ignored the
  // rule and the link simply completed). Defaults to B.
  const H = { slug: E.H_SLUG || E.B_SLUG, did: E.H_DID || E.B_DID, name: E.H_NAME || E.B_NAME };
  if (ROWS.includes("R11")) {
    t0.R11 = Date.now();
    const TASK = "https://trusttasks.org/spec/acl/swap-key/0.1";
    const SET = "gate-r11-held";
    log(`R11: approver set ${pnm(H.slug, "approvals", "approvers", "add", SET, E.A_DID).trim().split("\n").pop()?.slice(0, 60)}`);
    log(`R11: rule ${pnm(H.slug, "approvals", "require", TASK, "--consent", "--set", SET).trim().split("\n").pop()?.slice(0, 60)}`);
    await sleep(3000);
    try {
      const r11 = await attempt("R11", async () => {
        const before = await myAgent();
        await agents.add(d, { owner, tag: "add agent (held)" });
        await agents.enterAddress(d, { did: H.did, timeoutMs: 60000 });
        await grant(await agents.readOwnerCode(d), H.slug);
        const { said: held } = (await agents.connect(d, { owner: (tag) => owner(`${tag} (held)`) })).value;
        await shot(d, "agents-r11-held");
        for (let i = 0; i < 4 && !(await existsTestId(d, "MyAgent", 2000)); i++) await d.back().catch(() => undefined);
        const now = await myAgent();
        const switcher = await readSwitcherRows(d).catch(() => []);
        const { current } = splitRows(switcher);
        const bListed = switcher.some((r) => r.desc.includes(H.name));
        await shot(d, "agents-r11-after-back");
        return { held, before, now, switcher, current, bListed };
      });
      await rows.row("swap-held-add-returns", () => {
        if (!r11.ok) return threw(r11);
        const { held, before, now, switcher, current, bListed } = r11.value;
        return {
          ok: /holding this phone's link/i.test(held) && now.includes(E.A_NAME) && (!switcher.length || current.includes(E.A_NAME)) && !bListed,
          detail: `held "${held.slice(0, 60)}" · back on "${now}" (was "${before}") · current "${current}" · ${H.name} in the chips ${bListed}`,
        };
      });
    } finally {
      log(`R11: rule off ${pnm(H.slug, "approvals", "remove", TASK).trim().split("\n").pop()?.slice(0, 60)}`);
      log(`R11: approver off ${pnm(H.slug, "approvals", "approvers", "remove", SET, E.A_DID).trim().split("\n").pop()?.slice(0, 60)}`);
    }
  }

  if (ROWS.includes("R1")) {
    t0.R1 = Date.now();
    const added = await attempt("R1", async () => {
      await agents.openSwitcher(d);
      await shot(d, "agents-r1-switcher-one");
      await agents.add(d, { owner });
      const link = (await agents.linkTo(d, { did: E.B_DID, slug: E.B_SLUG, grant, owner })).value;
      const kept = (await agents.keepFirst(d, { owner, introSeen: Boolean(link.doneLanding?.intro) })).value;
      return { link, kept };
    });
    await rows.row("add-done-lands", () => {
      if (!added.ok) return threw(added);
      const { link, kept } = added.value;
      return {
        ok: Boolean(link.doneLanding?.intro) && kept.keepAtOnce,
        detail: `after Done: introduction ${link.doneLanding?.intro ?? "?"}, link panel ${link.doneLanding?.linkPanel ?? "?"}; Keep card without opening My Agent ${kept.keepAtOnce} (#349)`,
      };
    });
    const read = added.ok
      ? await attempt("R1", async () => {
          const switcher = (await agents.openSwitcher(d)).value;
          const { current, others } = splitRows(switcher);
          await shot(d, "agents-r1-switcher-two");
          await d.back().catch(() => undefined);
          const name = await myAgent();
          log(`R1: switcher current "${current}" · others ${others.length} · home "${name}" (${since("R1")})`);
          return { switcher, current, otherName: others[0]?.desc ?? "", name };
        })
      : added;
    await rows.row("R1 add + keep", () => {
      if (!read.ok) return threw(read);
      const { switcher, current, otherName, name } = read.value;
      return {
        ok: switcher.length === 2 && current.includes(E.A_NAME) && otherName.includes(E.B_NAME) && name.includes(E.A_NAME),
        detail: `rows ${JSON.stringify(switcher.map((r) => r.desc))}, home "${name}"`,
      };
    });
    t0.R1b = Date.now();
    await rows.row(
      "R1 switch to B",
      async () => {
        await agents.switchTo(d, { name: E.B_NAME, owner });
        const nameB = await myAgent();
        const online = await txt(d, "AgentHomeStatus");
        log(`R1: after switching, home "${nameB}" · status "${online}" (${since("R1b")})`);
        return { ok: nameB.includes(E.B_NAME), detail: `home "${nameB}", status "${online}" in ${since("R1b")}` };
      },
      { needs: ["R1 add + keep"] }
    );
    if (added.ok) console.log(`TEMP_B ${added.value.link.temp}`);
  }

  // R8 (IN-132, bifold #350): Add an agent this phone already has (B). By address: refused with "This phone already
  // has that agent." and "Switch to it", no code, no key added to B; Switch to it lands on B. By scan: refused.
  if (ROWS.includes("R8")) {
    t0.R8 = Date.now();
    const aclCount = () => { const t = pnm(E.B_SLUG, "acl", "list", "--json"); try { return JSON.parse(t.slice(t.indexOf("["))).length; } catch { return -1; } };
    const before = aclCount();
    const byAddress = await attempt("R8", async () => {
      await myAgent();
      await agents.add(d, { owner, tag: "add agent (existing)" });
      const entered = (await agents.enterAddress(d, { did: E.B_DID })).value;
      await shot(d, "agents-r8-add-existing");
      return { ...entered, after: aclCount() };
    });
    await rows.row("add-existing-refused", () => {
      if (!byAddress.ok) return threw(byAddress);
      const { said: words, code, switchToExisting, after } = byAddress.value;
      return {
        ok: /already has that agent/i.test(words) && switchToExisting && !code && before >= 0 && after === before,
        detail: `said "${words}" · Switch to it ${switchToExisting} · code step ${code} · B's ACL ${before} → ${after}`,
      };
    });
    if (byAddress.ok && byAddress.value.switchToExisting) {
      await rows.row("add-existing-switch", async () => {
        const { home } = (await agents.switchToExisting(d, { name: E.B_NAME, owner })).value;
        return { ok: home.includes(E.B_NAME), detail: `Switch to it → home "${home}"` };
      });
    } else await rows.row("add-existing-switch", () => ({ ok: false, detail: byAddress.ok ? "no AgentCreateSwitchToExisting" : threw(byAddress).detail }));
    // By scan: Add, the scanner, B's bare address pasted.
    await rows.row("add-existing-scan-refused", async () => {
      await myAgent();
      await agents.add(d, { owner, tag: "add agent (existing, scan)" });
      if (await existsTestId(d, "VtaLinkScanAgain", 8000)) await tapTestId(d, "VtaLinkScanAgain", 10000);
      let scanSaid = "";
      if (await existsTestId(d, "PasteUrlButton", 10000)) {
        // The scanner refuses it in its own error card ("Keyring can't use this code" + Try Again), which the paste
        // helper reports as a refused paste: here that refusal is the row (239 gate: the helper's throw stopped R8).
        await pasteLinkOnScanScreen(d, E.B_DID).catch((e) => log(`R8 scan: ${String(e.message).split("\n")[0]}`));
        for (const until = Date.now() + 30000; Date.now() < until && !scanSaid; await sleep(1000)) {
          const src = await d.getPageSource();
          scanSaid = (src.match(/(?:text|content-desc)="([^"]*already has that agent[^"]*)"/i) || [])[1] || "";
        }
      }
      await shot(d, "agents-r8-scan-existing");
      if (await existsTestId(d, "Try Again", 1500)) await tapTestId(d, "Try Again", 5000).catch(() => undefined);
      // Out of the scanner and the link screen behind it, back to the tabs (239 rerun: one Back left no tab bar).
      for (let i = 0; i < 4 && !(await existsTestId(d, "MyAgent", 2000)); i++) await d.back().catch(() => undefined);
      return { ok: /already has that agent/i.test(scanSaid), detail: scanSaid ? `"${scanSaid}"` : "no \"already has that agent\" words after pasting B's address" };
    });
    await myAgent().catch(() => "");
    if (!(await readHomeName(d)).includes(E.A_NAME)) await resync(E.A_NAME);
    log(`R8 done in ${since("R8")}`);
  }

  // R9 (IN-138, bifold #356): an Add that fails returns to the agent the phone was on (A), by each way out: back, the
  // My Agent tab, or the scanner then the tab. The failure: a community's own agent, scanned (CA_DID), refused once
  // its key is granted. Proof: A's home and A current, no link card, A online within 30 s, no key added to A, and
  // logcat's "[VTI] agent switch: to … done in N ms" (the return ran; nothing re-linked).
  if (ROWS.includes("R9") && E.CA_DID && E.CA_SLUG) {
    t0.R9 = Date.now();
    const aclA = () => { const t = pnm(E.A_SLUG, "acl", "list", "--json"); try { return JSON.parse(t.slice(t.indexOf("["))).length; } catch { return -1; } };
    const logLines = () => { try { return readFileSync(E.LOGCAT, "utf8").split("\n"); } catch { return []; } };
    await myAgent().catch(() => "");
    if (!(await readHomeName(d)).includes(E.A_NAME)) await resync(E.A_NAME);
    for (const way of ["back", "tab", "scanner"]) {
      await rows.row(`add-fail-return-${way}`, async () => {
        const n0 = logLines().length;
        const before = aclA();
        await myAgent();
        await agents.add(d, { owner, tag: `add a community's agent (${way})` });
        if (await existsTestId(d, "VtaLinkScanAgain", 8000)) await tapTestId(d, "VtaLinkScanAgain", 10000);
        let words = "";
        if (await existsTestId(d, "PasteUrlButton", 10000)) {
          await pasteLinkOnScanScreen(d, E.CA_DID);
          const temp = await readScanKey(d).catch(() => "");
          if (temp) await grant(temp, E.CA_SLUG);
          for (const until = Date.now() + 240000; Date.now() < until && !words; ) {
            if (await existsTestId(d, "VtaLinkError", 2000)) words = (await textOf(d, "VtaLinkError").catch(() => "")).replace(/\s+/g, " ").trim();
            else if (await existsTestId(d, "VtaLinkCheckAgain", 500)) await tapTestId(d, "VtaLinkCheckAgain", 5000).catch(() => undefined);
          }
        }
        await shot(d, `agents-r9-refused-${way}`);
        // Out, the way under test.
        if (way === "back") await d.back();
        else if (way === "tab") await tapTestId(d, "MyAgent", 10000);
        else {
          if (await existsTestId(d, "VtaLinkScanAgain", 3000)) await tapTestId(d, "VtaLinkScanAgain", 10000);
          await sleep(1500);
          await d.back();
          await tapTestId(d, "MyAgent", 10000);
        }
        await sleep(3000);
        const home = await existsTestId(d, "AgentHome", 15000);
        const name = home ? await readHomeName(d) : "";
        const { current } = splitRows(await readSwitcherRows(d).catch(() => []));
        const linkCard = (await existsTestId(d, "MyAgentLinkCard", 1000)) || (await existsTestId(d, "AgentHomeLink", 500));
        let status = "";
        for (const until = Date.now() + 30000; Date.now() < until && !/online/i.test(status); await sleep(1500)) status = await txt(d, "VtaStatusText");
        const after = aclA();
        const switched = logLines().slice(n0).find((l) => l.includes("[VTI] agent switch: to") && l.includes("done in")) || "";
        await shot(d, `agents-r9-returned-${way}`);
        const ok = /community's agent/i.test(words) && name.includes(E.A_NAME) && current.includes(E.A_NAME) && !linkCard && /online/i.test(status) && before >= 0 && after === before && Boolean(switched);
        return {
          ok,
          detail: `refused "${words.slice(0, 70)}" · home "${name}" · current "${current}" · link card ${linkCard} · status "${status}" · A's ACL ${before} → ${after} · ${switched ? `logcat "${switched.slice(switched.indexOf("agent switch")).slice(0, 70)}"` : "no agent-switch line"}`,
        };
      });
    }
    log(`R9 done in ${since("R9")}`);
  }

  if (ROWS.includes("R2")) {
    t0.R2 = Date.now();
    const r2 = await attempt("R2", async () => {
      if (!(await readHomeName(d)).includes(E.A_NAME)) await agents.switchTo(d, { name: E.A_NAME, owner });
      const req = await askToJoinC(d, "R2 on A");
      log(`R2: admin approves: ${admin("join-decide", req.id, "approved").trim().split("\n").filter((l) => /->/.test(l)).pop()}`);
      console.log(`R2_MEMBER ${req.applicantDid}`);
      await sleep(5000);
      await agents.switchTo(d, { name: E.B_NAME, owner });
      await join.openCommunity(d, { did: E.C_DID, via: "intent", appId: APP_ID, udid: UDID });
      // bifold #334 took Join's agent chooser away: on B, Join offers no other agent and goes ahead with B.
      const entry = await readEntry(d);
      await shot(d, "agents-r2-join-on-b");
      await dumpSource(d, "agents-r2-join-on-b").catch(() => undefined);
      log(`R2: on B, Join shows a chooser ${entry.chooser} · its own way in ${entry.wayIn} · standing on B "${entry.standing}" (${since("R2")})`);
      return entry;
    });
    await rows.row("R2 Join on B goes ahead with B", () => {
      if (!r2.ok) return threw(r2);
      const { chooser, wayIn, standing } = r2.value;
      return { ok: !chooser && wayIn && !standing, detail: `chooser ${chooser}; way in ${wayIn}; standing on B "${standing}"` };
    });
    await d.back().catch(() => undefined);
    await resync(E.A_NAME);
  }

  if (ROWS.includes("R7")) {
    // #320: what the phone knows of C is A's. On B, C's screen says so and offers A, not Leave.
    t0.R7 = Date.now();
    const r7 = await attempt("R7", async () => {
      await agents.switchTo(d, { name: E.B_NAME, owner });
      await tapTestId(d, "Wallet", 10000).catch(() => undefined);
      await sleep(3000);
      // Which tap opens the "Add credentials" sheet (236 gate, both runs): the screen between the two.
      await shot(d, "agents-r7-wallet-before-card");
      await dumpSource(d, "agents-r7-wallet-before-card").catch(() => undefined);
      // The Wallet remounts on each tab tap and can show EmptyList (its AddFirstCredential sits where a card
      // row is) until its records load (the UI/UX lane, 10-06). Tap only once the card has held, with no empty state, for 1 s;
      // say whether the empty state showed meanwhile: that is the app-side evidence.
      let emptySeen = false;
      let steadySince = 0;
      for (const until = Date.now() + 20000; Date.now() < until; await sleep(200)) {
        const empty = (await existsTestId(d, "NoCredentials", 100).catch(() => false)) || (await existsTestId(d, "AddFirstCredential", 100).catch(() => false));
        const card = await d.$('android=new UiSelector().resourceId("com.ariesbifold:id/CredentialName").textContains("Keyring Lab Community")').isExisting().catch(() => false);
        if (empty) emptySeen = true;
        if (card && !empty) {
          steadySince ||= Date.now();
          if (Date.now() - steadySince >= 1000) break;
        } else steadySince = 0;
      }
      log(`R7: Wallet empty state seen before the card held: ${emptySeen}`);
      console.log(`R7-CARD-TAP ${new Date().toISOString()} empty-seen ${emptySeen}`); // to line up with logcat's Wallet render
      // The Wallet's first-visit tour ("Add credentials", step 1) sits over the list and takes the tap (the UI/UX lane, 10-06:
      // CredentialsTourSteps; the same since 235). Close it first: its ✕ is `Close`, its "Done" is `Next`.
      const tour = await existsTestId(d, "Close", 1500).catch(() => false);
      if (tour) {
        await tapTestId(d, "Close", 5000).catch(() => tapTestId(d, "Next", 5000));
        await sleep(1000);
      }
      log(`R7: Wallet open; first-visit tour was up: ${tour}`);
      // The card by its name line (CredentialName), not by any text naming C: the first text match can be
      // something else on the page (236 gate, 05:27Z: the run ended on Wallet behind "Add credentials").
      const cardEl = await d.$('android=new UiSelector().resourceId("com.ariesbifold:id/CredentialName").textContains("Keyring Lab Community")');
      if (!(await cardEl.isExisting().catch(() => false))) {
        await dumpSource(d, "agents-r7-wallet").catch(() => undefined);
        throw new Error("R7: no Wallet card for C (R2 makes A a member first)");
      }
      await cardEl.click();
      if (!(await existsTestId(d, "CommunityCardDetails", 15000)) && !(await scrollToTestId(d, "CommunityCardDetails", 4).catch(() => undefined))) {
        await shot(d, "agents-r7-after-card-tap");
        await dumpSource(d, "agents-r7-after-card-tap").catch(() => undefined);
        throw new Error("R7: the Wallet card opened no community details (CommunityCardDetails)");
      }
      const open = await scrollToTestId(d, "CommunityCardOpenCommunity", 8).catch(() => undefined);
      if (!open) {
        await dumpSource(d, "agents-r7-details").catch(() => undefined);
        throw new Error("R7: the card's details offer no way to open C");
      }
      await open.click();
      const holding = (await community.readHolding(d, { timeoutMs: 20000 })).value;
      await shot(d, "agents-r7-held-elsewhere");
      log(`R7: on B, C shows held elsewhere ${holding.held} "${holding.heldText}" · use A ${holding.useHolder} · Leave ${holding.leave} (${since("R7")})`);
      return holding;
    });
    await rows.row("R7 C says it is A's", () => {
      if (!r7.ok) return threw(r7);
      const { held, heldText, useHolder, leave } = r7.value;
      return { ok: held && (heldText ?? "").includes(E.A_NAME) && useHolder && !leave, detail: `held ${held} "${heldText}"; use A ${useHolder}; Leave offered ${leave}` };
    });
    if (r7.ok && r7.value.useHolder) {
      await rows.row("R7 use A", async () => {
        const { heldGone } = (await community.useHolderAgent(d, { name: E.A_NAME, owner, tag: "R7 use A" })).value;
        await shot(d, "agents-r7-after-use-a");
        const nameAfter = await myAgent();
        return { ok: heldGone && nameAfter.includes(E.A_NAME), detail: `held card gone ${heldGone}; home "${nameAfter}"` };
      });
    } else rows.skip("R7 use A", r7.ok ? "C's screen offers no CommunityUseHolderAgent" : "C's screen was not reached");
  }

  if (ROWS.includes("R5")) {
    t0.R5 = Date.now();
    // A second identity for C, made on B; its request is declined while the shared session holds A's identity.
    const r5 = await attempt("R5", async () => {
      await agents.switchTo(d, { name: E.B_NAME, owner });
      const req = await askToJoinC(d, "R5 on B");
      await agents.switchTo(d, { name: E.A_NAME, owner });
      await myAgent();
      log(`R5: admin declines: ${admin("join-decide", req.id, "rejected").trim().split("\n").filter((l) => /->/.test(l)).pop()}`);
      console.log(`R5_APPLICANT ${req.applicantDid}`);
      console.log(`R5-SWITCH-B ${new Date().toISOString()}`);
      await agents.switchTo(d, { name: E.B_NAME, owner });
      await myAgent();
      let heldStatus = "";
      const holds = async (tag) => {
        const { card, status, check } = await readCommunityCard(d, C_KEY);
        await shot(d, `agents-r5-holds-${tag}`);
        await dumpSource(d, `agents-r5-holds-${tag}`).catch(() => undefined);
        heldStatus = status || heldStatus;
        log(`R5 holds (${tag}): AgentCommunityCard ${card} · status "${status}" · AgentCommunityCheck ${check}`);
      };
      await holds("0s");
      await sleep(30000);
      await holds("30s");
      await scrollToTestId(d, `AgentCommunityCheck_${C_KEY}`, 4).catch(() => undefined);
      const hasCheck = await existsTestId(d, `AgentCommunityCheck_${C_KEY}`, 5000);
      const tc = Date.now();
      if (hasCheck) await tapTestId(d, `AgentCommunityCheck_${C_KEY}`, 5000);
      // Looking for "Check now" swipes; with none, the card can be off screen now (237: status read null). Back to it.
      else await scrollToTestId(d, `AgentCommunityStatus_${C_KEY}`, 6).catch(() => undefined);
      // Without "Check now", a refusal the card already showed while it held (0 s / 30 s) is the card learning it by itself.
      let refused = !hasCheck && /turned down/i.test(heldStatus) ? heldStatus : null;
      let toast = null;
      for (const until = Date.now() + 30000; Date.now() < until && !refused; await sleep(1000)) {
        toast = toast ?? (await txt(d, "ToastTitle"));
        // The status as the hold check reads it (rowText: the line, or its children on Android): txt() read null on 237.
        const st = (await rowText(d, `AgentCommunityStatus_${C_KEY}`)) || (await txt(d, `AgentCommunityStatus_${C_KEY}`));
        if (/turned down/i.test(st ?? "") || /turned down/i.test(toast ?? "")) refused = st ?? toast;
      }
      await shot(d, "agents-r5-refusal");
      log(`R5: "Check now" ${hasCheck ? "tapped" : "ABSENT"} · refusal "${refused}" after ${((Date.now() - tc) / 1000).toFixed(1)} s · toast "${toast}"`);
      return { hasCheck, refused };
    });
    // Two ways a refusal reaches the card. With the session on this identity, the card learns it by itself and
    // offers no "Check now"; with the session on another identity, "Check now" is the way. Either is a pass; the
    // other is reported as not reached, not as a failure.
    if (!r5.ok) await rows.row("R5 refusal on the card by itself", () => threw(r5));
    else if (r5.value.hasCheck) {
      await rows.row("R5 refusal via Check now", () => ({ ok: Boolean(r5.value.refused), detail: `Check now shown; "${r5.value.refused}"` }));
    } else {
      await rows.row("R5 refusal on the card by itself", () => ({ ok: Boolean(r5.value.refused), detail: `no Check now needed; "${r5.value.refused}"` }));
      console.log('NOT-REACHED R5 "Check now": the session held this identity, so the card learned the refusal by itself');
    }
  }

  // R10 (#348): B joins C too (approved), so the Wallet holds two cards for C: A's (R2) and B's. R4 then unlinks B,
  // and B's card must leave the Wallet (wallet-hidden-unlinked in R4).
  if (ROWS.includes("R10")) {
    t0.R10 = Date.now();
    await rows.row("wallet-both-cards", async () => {
      await agents.switchTo(d, { name: E.B_NAME, owner });
      const req = await askToJoinC(d, "R10 on B");
      log(`R10: admin approves: ${admin("join-decide", req.id, "approved").trim().split("\n").filter((l) => /->/.test(l)).pop()}`);
      console.log(`R10_MEMBER ${req.applicantDid}`);
      for (const until = Date.now() + 90000; Date.now() < until && walletBefore < 2; await sleep(5000)) walletBefore = await walletCardsForC(d);
      await shot(d, "agents-r10-wallet-two");
      return { ok: walletBefore === 2, detail: `${walletBefore} Wallet card(s) name ${E.C_NAME} with A and B both members (want 2)` };
    });
    await resync(E.A_NAME);
  }

  if (ROWS.includes("R3")) {
    t0.R3 = Date.now();
    const r3 = await attempt("R3", async () => {
      await agents.switchTo(d, { name: E.A_NAME, owner });
      await myAgent();
      await tapTestId(d, "AgentSegment_manage", 8000).catch(() => undefined);
      await scrollToTestId(d, "AgentAskMeRow", 6).catch(() => undefined);
      await tapTestId(d, "AgentAskMeRow", 15000);
      await waitForTestId(d, "AskMeSwitch_contextsCreate", 30000);
      await tapTestId(d, "AskMeSwitch_contextsCreate", 10000);
      await owner("rule on");
      await sleep(3000);
      const rulesOn = pnm(E.A_SLUG, "approvals", "list");
      log(`R3: A's rules after "on": ${rulesOn.replace(/\s+/g, "").slice(0, 160)}`);
      await d.back().catch(() => undefined);
      await agents.switchTo(d, { name: E.B_NAME, owner });
      await myAgent();
      const held = pnm(E.A_SLUG, "contexts", "create", "--id", `agents-r3-${Math.floor(Date.now() / 1000)}`, "--name", "several agents check");
      log(`R3: pnm on A: ${held.replace(/\s+/g, " ").slice(-120)}`);
      let waiting = [];
      for (const until = Date.now() + 90000; Date.now() < until && !waiting.length; await sleep(3000)) {
        await myAgent();
        waiting = await idsWithPrefix(d, "AgentOtherWaiting_");
        // 236 (#316): the count sits on the other agent's chip instead.
        if (!waiting.length) waiting = await idsWithPrefix(d, "AgentSwitcherBadge_");
      }
      const wText = waiting.length ? await txt(d, waiting[0]) : null;
      await shot(d, "agents-r3-other-waiting");
      log(`R3: AgentOtherWaiting ${waiting.join(",") || "none"} "${wText}" (${since("R3")})`);
      await scrollToTestId(d, "AgentRequestsRow", 6).catch(() => undefined);
      await tapTestId(d, "AgentRequestsRow", 10000).catch(() => undefined);
      const others = await existsTestId(d, "RequestsOtherAgents", 10000);
      const sw = await idsWithPrefix(d, "RequestsSwitch_");
      await shot(d, "agents-r3-requests");
      return { waiting, others, sw };
    });
    await rows.row("R3 other agent waiting", () => {
      if (!r3.ok) return threw(r3);
      const { waiting, others, sw } = r3.value;
      return { ok: waiting.length > 0 && others && sw.length > 0, detail: `AgentOtherWaiting ${waiting.length}; RequestsOtherAgents ${others}; switch ${sw.length}` };
    });
    if (r3.ok && r3.value.sw.length) {
      await rows.row("R3 decided on A", async () => {
        await tapTestId(d, r3.value.sw[0], 10000);
        await owner("requests switch");
        let card = false;
        for (let i = 0; i < 20 && !card; i++) card = await existsTestId(d, "DenyConsentButton", 1000);
        if (!card) return { ok: false, detail: "no card after switching" };
        await tapTestId(d, "DenyConsentButton", 5000);
        let left = true;
        for (let i = 0; i < 20 && left; i++) {
          await sleep(1000);
          left = await existsTestId(d, "DenyConsentButton", 500);
        }
        return { ok: !left, detail: left ? "the card stays" : "declined" };
      });
    } else rows.skip("R3 decided on A", r3.ok ? "no RequestsSwitch_ to tap" : "the Requests screen was not reached");
    await rows.row("R3 rule off", async () => {
      await agents.switchTo(d, { name: E.A_NAME, owner }); // the rule lives on A: turn it off there, never on B
      await myAgent();
      await tapTestId(d, "AgentSegment_manage", 8000).catch(() => undefined);
      await scrollToTestId(d, "AgentAskMeRow", 6).catch(() => undefined);
      await tapTestId(d, "AgentAskMeRow", 15000);
      await waitForTestId(d, "AskMeSwitch_contextsCreate", 30000);
      if ((await rowText(d, "AskMeSwitch_contextsCreate")) !== null && String(await (await d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/AskMeSwitch_contextsCreate")`)).getAttribute("checked")) !== "true") log("R3: A's switch already reads off; not tapping");
      else {
        await tapTestId(d, "AskMeSwitch_contextsCreate", 10000);
        await owner("rule off");
      }
      await sleep(3000);
      const rulesOff = pnm(E.A_SLUG, "approvals", "list").replace(/\s+/g, "");
      log(`R3: A's rules after "off": ${rulesOff.slice(0, 160)}`);
      await d.back().catch(() => undefined);
      return { ok: /"rules":\[\]/.test(rulesOff), detail: rulesOff.slice(0, 100) };
    });
  }

  if (ROWS.includes("R6")) {
    t0.R6 = Date.now();
    // Both agents' identities join C; both memberships must survive (#289).
    const memberHere = async (who) => {
      await myAgent();
      const header = Boolean(await d.$('android=new UiSelector().textContains("Member of")').isExisting().catch(() => false));
      await scrollToTestId(d, `AgentCommunityStatus_${C_KEY}`, 4).catch(() => undefined);
      const card = await rowText(d, `AgentCommunityStatus_${C_KEY}`);
      const name = await readHomeName(d);
      await shot(d, `agents-r6-${who}`);
      log(`R6 ${who}: home "${name}" · header member ${header} · C card "${card}"`);
      return { ok: name.includes(who === "A" ? E.A_NAME : E.B_NAME) && /member/i.test(card ?? "") && !/turned down|removed/i.test(card ?? ""), card, header };
    };
    const joined = await attempt("R6", async () => {
      await agents.switchTo(d, { name: E.A_NAME, owner });
      // After R2, A is already a member of C (Join then has no JoinStart, 23:28:47Z): keep that membership.
      const a0 = await memberHere("A");
      if (a0.ok) {
        log(`R6: A is already a member of C (from R2): "${a0.card}"`);
      } else {
        const ra = await askToJoinC(d, "R6 on A");
        log(`R6: admin approves A: ${admin("join-decide", ra.id, "approved").trim().split("\n").filter((l) => /->/.test(l)).pop()}`);
        console.log(`R6_MEMBER ${ra.applicantDid}`);
        await sleep(5000);
      }
      await agents.switchTo(d, { name: E.B_NAME, owner });
      const rb = await askToJoinC(d, "R6 on B (B kept as the joining agent)");
      log(`R6: admin approves B: ${admin("join-decide", rb.id, "approved").trim().split("\n").filter((l) => /->/.test(l)).pop()}`);
      console.log(`R6_MEMBER ${rb.applicantDid}`);
      await sleep(8000);
      const b1 = await memberHere("B");
      const nRows = (await agents.openSwitcher(d)).value.length;
      await d.back().catch(() => undefined);
      return { b1, nRows };
    });
    await rows.row("R6 B member, both agents listed", () => (joined.ok ? { ok: joined.value.b1.ok && joined.value.nRows === 2, detail: `B C card "${joined.value.b1.card}"; switcher rows ${joined.value.nRows}` } : threw(joined)));
    await rows.row("R6 A still member", async () => {
      await agents.switchTo(d, { name: E.A_NAME, owner });
      const a1 = await memberHere("A");
      return { ok: a1.ok, detail: `A C card "${a1.card}"` };
    });
    const relaunched = await attempt("R6", async () => {
      // Kill and relaunch.
      await d.terminateApp(APP_ID).catch(() => undefined);
      await sleep(2000);
      await d.activateApp(APP_ID);
      await unlockToHome(d);
      const a2 = await memberHere("A");
      await agents.switchTo(d, { name: E.B_NAME, owner });
      const b2 = await memberHere("B");
      await tapTestId(d, "Wallet", 10000).catch(() => undefined);
      await sleep(3000);
      const texts = [];
      for (const el of await d.$$('//*[contains(@text,"Keyring Lab Community") or contains(@content-desc,"Keyring Lab Community")]')) {
        texts.push(String((await el.getAttribute("text").catch(() => "")) || (await el.getAttribute("content-desc").catch(() => ""))));
      }
      await shot(d, "agents-r6-wallet");
      await dumpSource(d, "agents-r6-wallet").catch(() => undefined);
      // 7c4219d9: with several agents each Wallet community card names its agent ("… · <agent name>").
      const namesA = texts.some((t) => t.includes(`· ${E.A_NAME}`));
      const namesB = texts.some((t) => t.includes(`· ${E.B_NAME}`));
      log(`R6: after relaunch A ${a2.ok} ("${a2.card}") · B ${b2.ok} ("${b2.card}") · Wallet texts naming the community ${JSON.stringify(texts)}`);
      return { a2, b2, texts, namesA, namesB };
    });
    await rows.row("R6 after relaunch", () => (relaunched.ok ? { ok: relaunched.value.a2.ok && relaunched.value.b2.ok, detail: `A "${relaunched.value.a2.card}", B "${relaunched.value.b2.card}"; Wallet mentions ${relaunched.value.texts.length}` } : threw(relaunched)));
    await rows.row("R6 Wallet names each agent", () => (relaunched.ok ? { ok: relaunched.value.namesA && relaunched.value.namesB, detail: `card for A ${relaunched.value.namesA}, card for B ${relaunched.value.namesB}; ${JSON.stringify(relaunched.value.texts)}` } : threw(relaunched)));
  }

  if (ROWS.includes("R4")) {
    t0.R4 = Date.now();
    await rows.row("R4 unlink B", async () => {
      if (!(await readHomeName(d)).includes(E.A_NAME)) await agents.switchTo(d, { name: E.A_NAME, owner });
      const { left } = (await agents.unlinkOther(d, { owner })).value;
      const name = await readHomeName(d);
      const bAcl = pnm(E.B_SLUG, "acl", "list");
      const phoneOnB = (process.env.B_PHONE && bAcl.includes(process.env.B_PHONE)) || false;
      log(`R4: others left ${left} · home "${name}" · B's ACL still has the phone: ${phoneOnB}`);
      return { ok: left === 0 && name.includes(E.A_NAME) && !phoneOnB, detail: `others ${left}; home "${name}"; on B's ACL ${phoneOnB}` };
    });
    // #348: B's card leaves the Wallet once B is unlinked; A's stays (the mirror re-runs on unlink: ~10 s).
    if (walletBefore >= 0) {
      await rows.row(
        "wallet-hidden-unlinked",
        async () => {
          let now = walletBefore;
          for (const until = Date.now() + 20000; Date.now() < until && now !== walletBefore - 1; await sleep(4000)) now = await walletCardsForC(d);
          await shot(d, "agents-r4-wallet-after-unlink");
          await myAgent().catch(() => "");
          return { ok: walletBefore === 2 && now === 1, detail: `Wallet cards for ${E.C_NAME}: ${walletBefore} with B linked → ${now} after unlinking B (want 1: A's)` };
        },
        { needs: ["wallet-both-cards"] }
      );
    }
    await rows.row(
      "R4 unlink the last",
      async () => {
        const { linkOffered } = (await agents.unlinkLast(d, { owner })).value;
        await shot(d, "agents-r4-unlinked");
        return { ok: linkOffered, detail: linkOffered ? "the phone offers to link an agent" : "no link offer" };
      },
      { needs: ["R4 unlink B"] }
    );
  }
} catch (err) {
  log(`error: ${err.message}`);
  if (d) await shot(d, "agents-failure");
  rows.fatal(err);
} finally {
  // IN-114 (bifold #302): with several agents, the persona inbox signs in only with an identity under the
  // agent the phone acts with now. Before the fix it tried another agent's persona and logged "key not found".
  if (E.LOGCAT && ROWS.some((r) => ["R1", "R2", "R5", "R6"].includes(r))) {
    try {
      const lines = logcatSince();
      const notFound = lines.filter((l) => /ReactNativeJS/.test(l) && /key not found/i.test(l));
      const signIns = lines.filter((l) => /\[VTI\] persona inbox .*signing in as the persona/.test(l));
      log(`IN-114: ${signIns.length} persona-inbox sign-ins; ${notFound.length} "key not found" line(s)`);
      for (const l of notFound.slice(0, 3)) log(`  ${l.slice(0, 200)}`);
      await rows.row("IN-114 no \"key not found\" with several agents", () => ({ ok: notFound.length === 0, detail: `${notFound.length} "key not found" line(s) in ${signIns.length} persona-inbox sign-ins` }));
    } catch (e) {
      log(`IN-114 log check skipped: ${String(e.message).slice(0, 100)}`);
    }
  }
  if (PIN) {
    try {
      adb("shell", "locksettings", "clear", "--old", PIN);
      log("device PIN cleared");
    } catch (e) {
      log(`device PIN NOT cleared: ${String(e.message).slice(0, 100)}`);
    }
  }
  for (const line of summary) console.log(`SUMMARY ${line}`);
  rows.summary();
  process.exitCode = rows.exitCode();
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
