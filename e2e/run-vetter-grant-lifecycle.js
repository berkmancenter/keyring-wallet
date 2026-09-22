/**
 * A vetter grant's life, as the vetter's phone shows it.
 *
 * The seat that lets a person vet others follows a grant that still stands —
 * in its window and not revoked — not one that was ever issued. This runner
 * moves the lab community's grant for the phone's persona through each state
 * and reads the agent home after each:
 *
 *   L1  granted     → the seat is the vetter's
 *   L2  revoked     → the seat is the applicant's (on the agent home, the
 *                     lapsed line says the role was withdrawn)
 *   L3  re-granted  → the vetter's again; the lab keeps a standing vetter
 *
 * Expiry is not staged live: the community's grant schema has a minimum
 * validity of one day (86400 s), so an expired grant is a day's wait. The
 * window check is covered by vtiGrantState's unit tests instead.
 *
 * Each state is read after the app is relaunched; before relaunching, the
 * runner also records whether the open screen noticed by itself, after a tab
 * round trip — the agent home loads its holdings when it mounts.
 *
 *   PLATFORM=android node run-vetter-grant-lifecycle.js      # the suite's vetter
 *   STRICT_ARRIVAL=1 …   # fail unless each change shows on the open screen by itself
 *
 * Needs a phone that is already the lab community's vetter (the vetting
 * suite's `invite` + grant steps). Runner VTA only; never alice.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createSession, ensureAppium, screenshot, dumpSource, sleep, waitForTestId, byTestId, scrollToTestId } from "./lib/driver.js";
import { androidCaps, iosCaps } from "./lib/config.js";
import { unlockIfLocked, dismissTourIfPresent } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM = process.env.PLATFORM || "android";
const APP_ID = "asml.bkc.harvard.wallet";
const RUNNER_VTA = process.env.RUNNER_VTA || "bob";
if (RUNNER_VTA === "alice") throw new Error("alice is reserved for the TestFlight phone — use a runner VTA");
const ADMIN = path.resolve(here, "../tsp-reference/ref-20-local-vetting/vtc-admin.mjs");
const STACK_ENV = path.join(process.env.STACK_DIR || path.join(process.env.HOME, "vti-stack"), "stack.env");
const log = (m) => console.log(`[lifecycle] ${m}`);

function admin(...args) {
  const env = Object.fromEntries(
    readFileSync(STACK_ENV, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
  );
  const out = execFileSync("node", [ADMIN, `${env.VTC_URL}/v1`, env.VTC_DID, path.join(path.dirname(STACK_ENV), "vtc-admin-credential.json"), ...args], { encoding: "utf8" });
  // vtc-admin prints the status and exits 0 whatever it was.
  const status = /-> (\d{3})/.exec(out)?.[1];
  if (status && !status.startsWith("2")) throw new Error(`vtc-admin ${args[0]} answered ${status}: ${out.slice(out.indexOf("{")).trim().slice(0, 300)}`);
  const json = out.slice(out.indexOf("{"));
  return json ? JSON.parse(json) : undefined;
}
/** The vetter whose profile was published last — the suite's vetter phone. */
function currentVetter() {
  const { vetters = [] } = admin("vetters-list") ?? {};
  const live = vetters.filter((v) => v.live && !v.revoked);
  live.sort((a, b) => String(b.profile?.updatedAt ?? "").localeCompare(String(a.profile?.updatedAt ?? "")));
  if (!live[0]) throw new Error("no live vetter grant: run the vetting suite first");
  return live[0];
}
/** Issue a grant and hand it to the phone; the resend is what reaches a phone that was not listening. */
async function grant(memberDid, seconds) {
  const issued = admin("vetter-grant", memberDid, ...(seconds ? [String(seconds)] : []));
  await sleep(4000);
  try {
    admin("vetter-resend", memberDid);
  } catch {
    await sleep(4000);
    admin("vetter-resend", memberDid);
  }
  return issued;
}

const textOf = async (d, key) => (await byTestId(d, key).getAttribute(PLATFORM === "ios" ? "label" : "text")) || "";
// Two surfaces show the seat. A phone LINKED to its agent opens the agent home
// from My Agent ("Your agent"): "Vet someone" is enabled or locked, and a
// lapsed grant says why. A phone whose build names its agent (a debug build
// with VTI_VTA_DID) shows My Agent's vetting card, whose badge reads "You are
// the vetter" or "You are being vetted" and refreshes by itself.
async function toAgentHome(d) {
  await dismissTourIfPresent(d).catch(() => undefined);
  await (await waitForTestId(d, "MyAgent", 30000)).click();
  const open = await waitForTestId(d, "OpenYourAgentButton", 20000).catch(() => undefined);
  if (open) {
    await open.click();
    await waitForTestId(d, "AgentGetVetted", 120000);
  } else {
    await waitForTestId(d, "MyAgentVettingSeat", 180000);
  }
  await sleep(2500);
}
/** What the seat says: { surface, vetter, lapsed }. */
async function seat(d) {
  if (await byTestId(d, "AgentGetVetted").isExisting().catch(() => false)) {
    await scrollToTestId(d, "AgentVetOthers", 4).catch(() => undefined);
    const enabled = (await byTestId(d, "AgentVetOthers").getAttribute("enabled").catch(() => "false")) === "true";
    const lapsed = (await byTestId(d, "AgentVetterLapsed").isExisting().catch(() => false)) ? await textOf(d, "AgentVetterLapsed") : "";
    return { surface: "agent home", vetter: enabled && !lapsed, lapsed };
  }
  // The card's accessible name carries its seat ("Vetting. You are the
  // vetter"); the badge's own text is a flattened sibling on Android.
  const row = byTestId(d, "MyAgentVettingRow");
  const badge = (await row.getAttribute(PLATFORM === "ios" ? "label" : "content-desc").catch(() => "")) || "";
  return { surface: "My Agent card", vetter: /you are the vetter/i.test(badge), lapsed: "", badge };
}
async function relaunch(d) {
  await d.terminateApp(APP_ID);
  await sleep(2000);
  await d.activateApp(APP_ID);
  await waitForTestId(d, "EnterPIN", 60000).catch(() => undefined);
  await unlockIfLocked(d);
  await waitForTestId(d, "Contacts", 180000);
  await toAgentHome(d);
}
/** Record whether the open screen noticed on its own, then relaunch and require `want`. */
async function expectSeat(d, step, want, { waitMs = 90000 } = {}) {
  await (await waitForTestId(d, "Contacts", 30000)).click();
  await sleep(1500);
  await toAgentHome(d);
  // The open screen, polled: My Agent's card refreshes every few seconds and
  // re-reads the status list at most once a minute.
  let live = await seat(d);
  const liveUntil = Date.now() + 45000;
  while (!want(live) && Date.now() < liveUntil) {
    await sleep(5000);
    live = await seat(d);
  }
  log(`${step} on the open screen: ${JSON.stringify(live)}`);
  // A grant is a message to the persona. If the seat has not moved, open
  // Vetting once — the screen that holds the persona's session — and come back:
  // this records whether a grant is collected without the person going there.
  // STRICT_ARRIVAL=1: a grant must show on its own; opening Vetting is not allowed to help.
  if (!want(live) && process.env.STRICT_ARRIVAL === "1") throw new Error(`${step}: the seat did not move on the open screen: ${JSON.stringify(live)}`);
  if (!want(live) && (await byTestId(d, "MyAgentVettingRow").isExisting().catch(() => false))) {
    await (await scrollToTestId(d, "MyAgentVettingRow", 4)).click();
    await sleep(15000);
    await d.back().catch(() => undefined);
    await sleep(3000);
    await toAgentHome(d);
    const until2 = Date.now() + 45000;
    live = await seat(d);
    while (!want(live) && Date.now() < until2) {
      await sleep(5000);
      live = await seat(d);
    }
    live = { ...live, afterOpeningVetting: true };
    log(`${step} after opening Vetting once: ${JSON.stringify(live)}`);
  }
  const until = Date.now() + waitMs;
  let s;
  do {
    await relaunch(d);
    s = await seat(d);
    if (want(s)) break;
    await sleep(10000);
  } while (Date.now() < until);
  log(`${step} after relaunch: ${JSON.stringify(s)}`);
  await screenshot(d, `lifecycle-${step}`);
  if (!want(s)) throw new Error(`${step}: the seat shows ${JSON.stringify(s)}`);
  return { live, relaunched: s };
}

let d;
let vetterDid;
const report = [];
try {
  // VETTER_DID names the phone's persona outright; otherwise the vetter whose
  // profile was published last.
  const P = process.env.VETTER_DID || currentVetter().memberDid;
  vetterDid = P;
  log(`vetter persona ${P}`);
  await ensureAppium();
  const caps = PLATFORM === "android" ? androidCaps() : iosCaps();
  d = await createSession(PLATFORM, { ...caps, "appium:fullReset": false, "appium:noReset": true, "appium:enforceAppInstall": false });
  await waitForTestId(d, "EnterPIN", 120000).catch(() => undefined);
  await unlockIfLocked(d);
  await waitForTestId(d, "Contacts", 300000);

  // L1 — granted.
  await toAgentHome(d);
  const active = (s) => s.vetter;
  const lapsedFor = (re) => (s) => !s.vetter && (s.surface !== "agent home" || re.test(s.lapsed));
  report.push(["L1 granted", await expectSeat(d, "L1-granted", active)]);

  // L2 — revoked.
  const mine = ((admin("vetters-list") ?? {}).vetters ?? []).find((v) => v.memberDid === P && v.live && !v.revoked);
  if (!mine) throw new Error(`${P} holds no live grant to revoke`);
  const revoked = admin("revoke-endorsement", mine.endorsementId);
  log(`revoked (status-list bit ${revoked?.statusListIndex})`);
  report.push(["L2 revoked", await expectSeat(d, "L2-revoked", lapsedFor(/revok|withdr/i))]);

  // L3 — granted again; the lab keeps a standing vetter.
  await grant(P);
  report.push(["L3 re-granted", await expectSeat(d, "L3-regranted", active)]);

  for (const [step, r] of report) log(`${step}: relaunched ${JSON.stringify(r.relaunched)}; before relaunch ${JSON.stringify(r.live)}`);
  printSuccess("vetter-grant lifecycle (granted → revoked → granted)");
  process.exitCode = 0;
} catch (err) {
  printFailure("vetter-grant lifecycle", err);
  if (d) {
    try {
      await screenshot(d, "lifecycle-failure");
      await dumpSource(d, "lifecycle-failure");
    } catch {
      /* ignore */
    }
  }
  // Whatever happened, leave a standing vetter for the next run.
  try {
    if (vetterDid) await grant(vetterDid);
  } catch {
    /* best effort */
  }
  process.exitCode = 1;
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
}
