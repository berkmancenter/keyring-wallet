#!/usr/bin/env node
/**
 * bifold #347: a join request that never reached the community is said, and sent again. On a linked Android phone
 * (emulator) with no open request for C, the way f7 gave for forcing it (10-07):
 *   1. the phone's network off (airplane mode); C's link → Ask to join → continue: the ask cannot leave the phone
 *   2. the network back; leave Join and open C's link again: Join reads the stored request as sent, asks C for its
 *      status, gets notFound, and shows JoinRequestLost
 *   3. JoinSendAgain → JoinAsContinue: a fresh request, which C lists
 * Rows:
 *   lost-ask-offline       what Join showed with the network off (an error line, or "Sent"); FAIL only if the ask
 *                          reached C anyway (then the case was not forced)
 *   join-lost-request      JoinRequestLost after reopening, within 120 s
 *   join-lost-send-again   after JoinSendAgain, Join is waiting again and C lists a new pending request
 * Prints `LOST_REQ <id>` for the request sent again, so the caller declines it.
 *   E2E_APP_ID=… UDID=emulator-5572 C_DID=… C_NAME=… C_ADMIN="<rest> <did> <cred>" node run-join-lost.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsTestId, scrollToTestId, sleep, stopAppium, tapTestId, waitForTestId, ensureAppium, screenshot } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { handleBiometricConfirmIfPresent, pasteLinkFromHome } from "./lib/flows.js";

const C_DID = process.env.C_DID;
const C_NAME = process.env.C_NAME || "Keyring Lab Community";
const LINK = `keyring://vti/community?d=${encodeURIComponent(C_DID || "")}&n=${encodeURIComponent(C_NAME)}`;
const ADMIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tsp-reference/ref-20-local-vetting/vtc-admin.mjs");
const admin = (...a) =>
  execFileSync("node", [ADMIN, ...(process.env.C_ADMIN || "").split(" ").filter(Boolean), ...a], { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] });
const pendingIds = () => {
  const t = admin("join-list", "pending");
  return new Set((JSON.parse(t.slice(t.indexOf("{"))).items ?? []).map((r) => r.id));
};
const adb = (...a) => execFileSync("adb", ["-s", process.env.UDID, "shell", ...a], { encoding: "utf8" }).trim();
const online = () => {
  try {
    adb("ping", "-c", "1", "-W", "3", "1.1.1.1");
    return true;
  } catch {
    return false;
  }
};
const network = async (on) => {
  adb("cmd", "connectivity", "airplane-mode", on ? "disable" : "enable");
  for (let i = 0; i < 20 && online() !== on; i++) await sleep(1000);
  log(`network ${on ? "on" : "off"}: online ${online()}`);
};
let failed = 0;
const row = (name, ok, detail) => {
  if (ok !== true && ok !== "skip") failed++;
  console.log(`ROW ${name} ${ok === "skip" ? "SKIP" : ok ? "PASS" : "FAIL"} — ${detail}`);
};
const log = (m) => console.log(`[e2e] ${new Date().toISOString().slice(11, 23)}Z ${m}`);
const said = async (id) => (await existsTestId(d, id, 1000)) ? (await textOf(d, id).catch(() => "")).replace(/\s+/g, " ").trim() : "";

let d;
let netOff = false;
try {
  await ensureAppium();
  d = await makeDriver({ platform: "android", udid: process.env.UDID, keepState: true });
  await d.activateApp(process.env.E2E_APP_ID);
  await unlockToHome(d).catch(async (e) => {
    if (!(await existsTestId(d, "MyAgent", 10000))) throw e;
  });
  const before = pendingIds();

  // 1 — the ask, with the network off.
  await pasteLinkFromHome(d, LINK);
  await scrollToTestId(d, "JoinAsk", 6, { from: 0.45 }).catch(() => undefined);
  const ask = (await existsTestId(d, "JoinAsk", 5000)) ? "JoinAsk" : "JoinStart";
  await network(false);
  netOff = true;
  await tapTestId(d, ask, 15000);
  await waitForTestId(d, "JoinMakeIdentity", 30000).catch(() => undefined);
  if (await existsTestId(d, "JoinAsContinue", 5000)) await tapTestId(d, "JoinAsContinue", 10000);
  await handleBiometricConfirmIfPresent(d).catch(() => undefined);
  await sleep(20000);
  const offline = (await said("JoinError")) || ((await existsTestId(d, "JoinRequestSent", 1000)) ? `"Sent" (${await said("JoinStandingText")})` : "");
  // Still making the identity (it needs the agent, so the network): nothing was recorded as sent, so nothing can be
  // lost. Seen on the 238 gate: "Getting your identity ready…" with the network off.
  const stillMaking = !offline && (await d.getPageSource()).includes("Getting your identity ready");
  await screenshot(d, "lost-ask-offline").catch(() => undefined);
  log(`with the network off, Join shows: ${offline || "(no error line, no standing)"}`);

  // 2 — the network back; Join opened again.
  await network(true);
  netOff = false;
  await sleep(10000);
  const arrived = [...pendingIds()].filter((id) => !before.has(id));
  if (stillMaking) {
    row("lost-ask-offline", "skip", "the network went off while the identity was still being made: no request was recorded as sent, so the loss was not forced");
    row("join-lost-request", "skip", "not forced (see lost-ask-offline)");
    row("join-lost-send-again", "skip", "not forced (see lost-ask-offline)");
  } else if (arrived.length) {
    row("lost-ask-offline", false, `the ask reached C anyway (${arrived.join(", ")}): the loss was not forced; Join showed ${offline || "nothing"}`);
    arrived.forEach((id) => console.log(`LOST_REQ ${id}`));
    row("join-lost-request", "skip", "the request was not lost");
    row("join-lost-send-again", "skip", "the request was not lost");
  } else {
    row("lost-ask-offline", true, `C has no new request; Join showed ${offline || "nothing"}`);
    await tapTestId(d, "MyAgent", 15000).catch(() => undefined);
    await pasteLinkFromHome(d, LINK);
    let lost = false;
    let checked = false;
    for (const until = Date.now() + 120000; Date.now() < until && !lost; ) {
      lost = Boolean(await scrollToTestId(d, "JoinRequestLost", 2, { from: 0.5 }).catch(() => undefined));
      if (!lost && !checked && Date.now() > until - 90000 && (await existsTestId(d, "JoinCheckAgain", 1000))) {
        await tapTestId(d, "JoinCheckAgain", 5000).catch(() => undefined);
        checked = true;
        log("Join still waiting after 30 s: Check again");
      }
      if (!lost) await sleep(2000);
    }
    const words = lost ? await said("JoinRequestLost") : "";
    await screenshot(d, "join-lost-request").catch(() => undefined);
    row("join-lost-request", lost && /didn.t reach/i.test(words), lost ? `"${words}"${checked ? " (after Check again)" : ""}` : `no JoinRequestLost in 120 s; Join shows "${await said("JoinStandingText")}"`);

    // 3 — send it again.
    if (lost && (await existsTestId(d, "JoinSendAgain", 3000))) {
      const before2 = pendingIds();
      await tapTestId(d, "JoinSendAgain", 10000);
      await waitForTestId(d, "JoinAsContinue", 30000).catch(() => undefined);
      if (await existsTestId(d, "JoinAsContinue", 3000)) await tapTestId(d, "JoinAsContinue", 10000);
      await handleBiometricConfirmIfPresent(d).catch(() => undefined);
      const waiting = await waitForTestId(d, "JoinStanding", 120000).then(() => true, () => false);
      let fresh = [];
      for (const until = Date.now() + 90000; Date.now() < until && !fresh.length; await sleep(3000)) fresh = [...pendingIds()].filter((id) => !before2.has(id));
      fresh.forEach((id) => console.log(`LOST_REQ ${id}`));
      await screenshot(d, "join-lost-send-again").catch(() => undefined);
      row("join-lost-send-again", waiting && fresh.length === 1, `Join waiting ${waiting} ("${await said("JoinStandingText")}"); C lists ${fresh.length} new pending request(s)`);
    } else row("join-lost-send-again", false, "no JoinSendAgain");
  }
  process.exitCode = failed ? 3 : 0;
} catch (e) {
  log(`error: ${e.message.split("\n")[0]}`);
  if (d) await screenshot(d, "join-lost-failure").catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (netOff) await network(true).catch(() => undefined);
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
