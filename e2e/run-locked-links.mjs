#!/usr/bin/env node
/**
 * A link that reaches the app while the wallet is LOCKED is kept and followed
 * after the unlock, once (keyring-bifold #258). iOS simulator only: the link is
 * opened by the system (`xcrun simctl openurl`), as a tapped notification or a
 * link from another app would open it.
 *
 *   UDID=<sim> COMMUNITY_LINK=keyring://vti/community?d=…&n=… [LOCK_S=330] \
 *     node run-locked-links.mjs
 *
 * The phone must already be linked (run-vta-link.js with E2E_KEEP_APP=1).
 * Rows, each with a PASS/FAIL line:
 *   locked-community   home → Home button → LOCK_S in the background (past the
 *                      auto-lock) → openurl the community link → the PIN screen
 *                      shows → unlock → the Join screen
 *   locked-approvals   the same with keyring://vta/approvals → the agent home
 *   unlocked-community / unlocked-approvals   openurl while unlocked, on home
 *   once               after each landing: back to Contacts, 20 s, the target
 *                      did not come back; then one more lock/unlock with no link
 *                      → stays on Contacts
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { ensureAppium, existsTestId, screenshot, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { unlockIfLocked } from "./lib/flows.js";
import { makeDriver, unlockToHome } from "./lib/keyringRoles.js";

const UDID = process.env.UDID;
const LOCK_S = Number(process.env.LOCK_S ?? 330);
const COMMUNITY_LINK = process.env.COMMUNITY_LINK;
const APPROVALS_LINK = "keyring://vta/approvals";
const JOIN = ["JoinAsks", "JoinWaysTitle", "JoinWays"];
const AGENT = ["AgentDoors", "AgentDetailsToggle", "AgentActivity", "AgentApprovals"];
const utc = () => new Date().toISOString().slice(11, 23) + "Z";
const log = (s) => console.log(`[e2e] ${utc()} ${s}`);
const results = [];
const verdict = (row, ok, what) => {
  results.push({ row, ok });
  console.log(`ROW ${row} ${ok ? "PASS" : "FAIL"} — ${what}`);
};

/** The first of `ids` on screen within `ms`, or null. */
async function anyOf(d, ids, ms) {
  for (const until = Date.now() + ms; Date.now() < until; ) {
    for (const id of ids) if (await existsTestId(d, id, 700)) return id;
  }
  return null;
}
const openUrl = (url) => execFileSync("xcrun", ["simctl", "openurl", UDID, url], { stdio: "pipe", timeout: 30000 });

async function toContacts(d) {
  await unlockIfLocked(d);
  await tapTestId(d, "Contacts", 15000).catch(() => undefined);
  await sleep(1500);
}

/** Lock by leaving the app in the background past the auto-lock, then open `url` (or just return). */
async function lockedOpen(d, url, tag) {
  await toContacts(d);
  await d.execute("mobile: pressButton", { name: "home" });
  log(`${tag}: in the background for ${LOCK_S} s`);
  // A question to the driver every 30 s, which touches nothing in the app:
  // an Appium session left without a command for minutes is closed.
  for (const until = Date.now() + LOCK_S * 1000; Date.now() < until; await sleep(Math.min(30000, Math.max(0, until - Date.now())))) {
    await d.execute("mobile: queryAppState", { bundleId: "asml.bkc.harvard.wallet" }).catch(() => undefined);
  }
  if (url) {
    log(`${tag}: openurl ${url.slice(0, 60)}`);
    openUrl(url);
  } else {
    await d.execute("mobile: activateApp", { bundleId: "asml.bkc.harvard.wallet" });
  }
  const pin = await existsTestId(d, "EnterPIN", 20000);
  await screenshot(d, `locked-links-${tag}-pin`);
  log(`${tag}: PIN screen ${pin ? "shown (locked)" : "NOT shown"}`);
  if (pin) await unlockIfLocked(d);
  return pin;
}

/** After a landing: back to Contacts, and the target must not come back by itself. */
async function deliveredOnce(d, ids, tag) {
  await toContacts(d);
  const again = await anyOf(d, ids, 20000);
  await screenshot(d, `locked-links-${tag}-after-back`);
  return !again;
}

let d;
try {
  if (!UDID || !COMMUNITY_LINK) throw new Error("UDID and COMMUNITY_LINK are required");
  await ensureAppium();
  d = await makeDriver({ platform: "ios", udid: UDID, keepState: true });
  await unlockToHome(d);
  log("home");

  // Unlocked first: as today.
  // CONTROL=1: one locked row only, for a build WITHOUT the fix (it should fail there).
  const CONTROL = process.env.CONTROL === "1";
  for (const [tag, url, ids] of CONTROL ? [] : [["unlocked-community", COMMUNITY_LINK, JOIN], ["unlocked-approvals", APPROVALS_LINK, AGENT]]) {
    await toContacts(d);
    openUrl(url);
    const at = await anyOf(d, ids, 30000);
    await screenshot(d, `locked-links-${tag}`);
    verdict(tag, Boolean(at), at ? `reached ${at}` : "the target screen did not show");
    if (at) verdict(`${tag}-once`, await deliveredOnce(d, ids, tag), "back on Contacts, the target did not come back in 20 s");
  }

  // Locked.
  for (const [tag, url, ids] of [["locked-community", COMMUNITY_LINK, JOIN], ["locked-approvals", APPROVALS_LINK, AGENT]].slice(0, CONTROL ? 1 : 2)) {
    const locked = await lockedOpen(d, url, tag);
    if (!locked) {
      verdict(tag, false, "the wallet did not lock: the row is not measured");
      continue;
    }
    const at = await anyOf(d, ids, 30000);
    await screenshot(d, `locked-links-${tag}-after-unlock`);
    verdict(tag, Boolean(at), at ? `after the unlock reached ${at}` : "after the unlock the target screen did not show");
    if (at) verdict(`${tag}-once`, await deliveredOnce(d, ids, tag), "back on Contacts, the target did not come back in 20 s");
  }

  if (CONTROL) throw Object.assign(new Error("control done"), { done: true });
  // One more lock and unlock with no link: nothing is delivered again.
  const locked = await lockedOpen(d, null, "relock");
  const stray = locked ? await anyOf(d, [...JOIN, ...AGENT], 20000) : "not locked";
  await screenshot(d, "locked-links-relock-after-unlock");
  verdict("relock-nothing-again", locked && !stray, locked ? (stray ? `${stray} came back after a later lock/unlock` : "stayed put after a later lock/unlock") : "the wallet did not lock");
} catch (err) {
  if (!err?.done) {
    console.error(err);
    process.exitCode = 1;
    if (d) await screenshot(d, "locked-links-failure").catch(() => undefined);
  }
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
const failed = results.filter((r) => !r.ok).map((r) => r.row);
console.log(process.exitCode === 1 ? "LOCKED_LINKS ERROR — the run failed" : failed.length ? `LOCKED_LINKS FAIL — ${failed.join(", ")}` : `LOCKED_LINKS PASS — ${results.length} rows`);
if (process.exitCode !== 1 && failed.length) process.exitCode = 3;
