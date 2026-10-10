#!/usr/bin/env node
/**
 * bifold #347: a join request that never reached the community is said, and sent again. On a linked Android phone
 * (emulator) with no open request for C, the way the UI/UX lane gave for forcing it (10-07):
 *   1. the phone's network off (airplane mode); C's link → Ask to join → continue: the ask cannot leave the phone
 *   2. the network back; leave Join and open C's link again: Join reads the stored request as sent, asks C for its
 *      status, gets notFound, and shows JoinRequestLost
 *   3. JoinSendAgain → JoinAsContinue: a fresh request, which C lists
 * Rows (lib/rows.js: a failing row never stops the rest; each needs the one before it):
 *   lost-ask-offline       what Join showed with the network off (an error line, or "Sent"); FAIL only if the ask
 *                          reached C anyway (then the case was not forced)
 *   join-lost-request      JoinRequestLost after reopening, within 120 s
 *   join-lost-send-again   after JoinSendAgain, Join is waiting again and C lists a new pending request
 * The Join screen is driven through lib/pages/join.js. Prints `LOST_REQ <id>` for the request sent again, so the
 * caller declines it.
 *   E2E_APP_ID=… UDID=emulator-5572 C_DID=… C_NAME=… C_ADMIN="<rest> <did> <cred>" node run-join-lost.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsTestId, sleep, stopAppium, tapTestId, ensureAppium, screenshot } from "./lib/driver.js";
import { makeDriver, unlockToHome } from "./lib/keyringRoles.js";
import { createRows } from "./lib/rows.js";
import { join, readStanding } from "./lib/pages/join.js";

const C_DID = process.env.C_DID;
const C_NAME = process.env.C_NAME || "Keyring Lab Community";
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
// BLOCK_HOST (239, the UI/UX lane): cut only the community's messaging host (iptables on the rootable emulator), so
// the persona is made and the request recorded as sent, and only its delivery fails. Without it, airplane mode,
// which on 238 cut the network before the persona existed (nothing was recorded, so nothing could be lost).
const BLOCK = process.env.BLOCK_HOST || "";
const blockRule = (op) => {
  for (const t of ["iptables", "ip6tables"]) {
    try {
      adb(t, op, "OUTPUT", "-d", BLOCK, "-j", "REJECT");
    } catch (e) {
      if (op === "-I") log(`${t} ${op} ${BLOCK}: ${String(e.message).split("\n")[0].slice(0, 120)}`);
    }
  }
};
const network = async (on) => {
  if (BLOCK) {
    blockRule(on ? "-D" : "-I");
    const ip = (() => { try { return adb("ping", "-c", "1", "-W", "3", BLOCK).match(/\(([0-9.]+)\)/)?.[1] ?? "?"; } catch (e) { return `unreachable (${String(e.stdout ?? "").match(/\(([0-9.]+)\)/)?.[1] ?? "?"})`; } })();
    log(`${BLOCK} ${on ? "unblocked" : "blocked"}: ${ip}`);
    return;
  }
  adb("cmd", "connectivity", "airplane-mode", on ? "disable" : "enable");
  for (let i = 0; i < 20 && online() !== on; i++) await sleep(1000);
  log(`network ${on ? "on" : "off"}: online ${online()}`);
};
const rows = createRows({ label: "lostreq" });
const log = (m) => console.log(`[e2e] ${new Date().toISOString().slice(11, 23)}Z ${m}`);

let d;
let netOff = false;
try {
  await ensureAppium();
  d = await makeDriver({ platform: "android", udid: process.env.UDID, keepState: true });
  rows.setDriver(d);
  await d.activateApp(process.env.E2E_APP_ID);
  await unlockToHome(d).catch(async (e) => {
    if (!(await existsTestId(d, "MyAgent", 10000))) throw e;
  });
  const before = pendingIds();

  // 1 — the ask, with the network off: once the ask is in view, before it is tapped.
  await join.openCommunity(d, { did: C_DID, name: C_NAME });
  await join.ask(d, {
    beforeTap: async () => {
      await network(false);
      netOff = true;
    },
  });
  await sleep(20000);
  const after = await readStanding(d);
  const offline = (after.error ?? "") || (after.requestSent ? `"Sent" (${after.standingText ?? ""})` : "");
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
    rows.skip("lost-ask-offline", "the network went off while the identity was still being made: no request was recorded as sent, so the loss was not forced");
    rows.skip("join-lost-request", "not forced (see lost-ask-offline)");
    rows.skip("join-lost-send-again", "not forced (see lost-ask-offline)");
  } else if (arrived.length) {
    await rows.row("lost-ask-offline", () => ({ ok: false, detail: `the ask reached C anyway (${arrived.join(", ")}): the loss was not forced; Join showed ${offline || "nothing"}` }));
    arrived.forEach((id) => console.log(`LOST_REQ ${id}`));
    rows.skip("join-lost-request", "the request was not lost");
    rows.skip("join-lost-send-again", "the request was not lost");
  } else {
    await rows.row("lost-ask-offline", () => ({ ok: true, detail: `C has no new request; Join showed ${offline || "nothing"}` }));
    await rows.row(
      "join-lost-request",
      async () => {
        await tapTestId(d, "MyAgent", 15000).catch(() => undefined);
        await join.openCommunity(d, { did: C_DID, name: C_NAME });
        const { lost, words, checked, standingText } = (await join.awaitLost(d, { timeoutMs: 120000, checkAgainAfterMs: 30000 })).value;
        await screenshot(d, "join-lost-request").catch(() => undefined);
        return {
          ok: lost && /didn.t reach/i.test(words),
          detail: lost ? `"${words}"${checked ? " (after Check again)" : ""}` : `no JoinRequestLost in 120 s; Join shows "${standingText ?? ""}"`,
        };
      },
      { needs: ["lost-ask-offline"] }
    );

    // 3 — send it again.
    await rows.row(
      "join-lost-send-again",
      async () => {
        const before2 = pendingIds();
        await join.sendAgain(d);
        const waiting = (await join.awaitSent(d, { timeoutMs: 120000, required: false })).value.shown === "standing";
        let fresh = [];
        for (const until = Date.now() + 90000; Date.now() < until && !fresh.length; await sleep(3000)) fresh = [...pendingIds()].filter((id) => !before2.has(id));
        fresh.forEach((id) => console.log(`LOST_REQ ${id}`));
        await screenshot(d, "join-lost-send-again").catch(() => undefined);
        return { ok: waiting && fresh.length === 1, detail: `Join waiting ${waiting} ("${(await readStanding(d)).standingText ?? ""}"); C lists ${fresh.length} new pending request(s)` };
      },
      { needs: ["join-lost-request"] }
    );
  }
} catch (e) {
  log(`error: ${e.message.split("\n")[0]}`);
  if (d) await screenshot(d, "join-lost-failure").catch(() => undefined);
  rows.fatal(e);
} finally {
  if (netOff) await network(true).catch(() => undefined);
  rows.summary();
  process.exitCode = rows.exitCode();
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
