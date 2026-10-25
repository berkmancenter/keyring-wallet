#!/usr/bin/env node
/**
 * bifold #347, the part a device can prove: a join ask that cannot reach the community says so. On a linked Android
 * phone (emulator) with no open request for C, the community's messaging host is blocked (BLOCK_HOST, iptables on the
 * rootable emulator; airplane mode without it) once the ask is in view, before it is tapped; then Ask to join →
 * continue. Everything up to the send (the session with C's mediator, the manifest) needs that host, so the ask fails
 * before the phone records a request.
 * Row (lib/rows.js):
 *   lost-ask-offline-error   PASS needs all three: Join shows an error line (quoted in the detail), C's pending list
 *                            is unchanged, and Join never shows JoinRequestSent
 * A request recorded as sent whose delivery then fails (said lost, and sent again) cannot be forced from the phone:
 * no cut lands between the record and the send. bifold holds it in joinLostRequest.test.tsx (red before #347).
 * Prints `ARRIVED_REQ <id>` for any request that reached C anyway, including one the app sent by itself in the ~30 s
 * after the host came back (logged, not a row), so the caller declines it.
 *   E2E_APP_ID=… UDID=emulator-5572 C_DID=… C_NAME=… C_ADMIN="<rest> <did> <cred>" [BLOCK_HOST=…] node run-join-lost.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsTestId, sleep, stopAppium, ensureAppium, screenshot } from "./lib/driver.js";
import { makeDriver, unlockToHome } from "./lib/keyringRoles.js";
import { createRows } from "./lib/rows.js";
import { join, readStanding } from "./lib/pages/join.js";

const C_DID = process.env.C_DID;
const C_NAME = process.env.C_NAME || "Keyring Lab Community";
// The app tries C's mediator a few times (8 s a socket) after making the identity (up to 2 min).
const ERROR_WAIT_MS = 180000;
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
// BLOCK_HOST: cut only the community's messaging host (iptables on the rootable emulator), so the phone's own
// mediator and its VTA stay reachable and only C cannot be. Without it, airplane mode cuts everything.
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

  // The ask, with C unreachable: once the ask is in view, before it is tapped.
  await join.openCommunity(d, { did: C_DID, name: C_NAME });
  await join.ask(d, {
    beforeTap: async () => {
      await network(false);
      netOff = true;
    },
  });
  // Wait for what the screen answers, an error line or "Request sent", not a fixed time.
  const t0 = Date.now();
  let seen = await readStanding(d);
  let everSent = seen.requestSent;
  while (!seen.error && !seen.requestSent && Date.now() - t0 < ERROR_WAIT_MS) {
    await sleep(5000);
    seen = await readStanding(d);
    everSent = everSent || seen.requestSent;
  }
  const waited = Math.round((Date.now() - t0) / 1000);
  await screenshot(d, "lost-ask-offline-error").catch(() => undefined);
  // The busy button reads "Getting your identity ready…" for the whole join, not only the identity step.
  const busy = !seen.error && !seen.requestSent && (await d.getPageSource()).includes("Getting your identity ready");
  const shown = seen.error ? `error "${seen.error}"` : seen.requestSent ? `"Request sent" (${seen.standingText ?? ""})` : busy ? "still busy" : "no error line, no standing";
  log(`with ${BLOCK || "the network"} cut, after ${waited} s Join shows: ${shown}`);

  // C's list, with the host back: nothing new may be there.
  await network(true);
  netOff = false;
  await sleep(10000);
  const arrived = [...pendingIds()].filter((id) => !before.has(id));
  arrived.forEach((id) => console.log(`ARRIVED_REQ ${id}`));
  await rows.row("lost-ask-offline-error", () => {
    const wrong = [
      !seen.error && `no error line in ${waited} s (${shown})`,
      arrived.length > 0 && `the ask reached C anyway (${arrived.join(", ")})`,
      everSent && `Join showed JoinRequestSent ("${seen.standingText ?? ""}")`,
    ].filter(Boolean);
    return wrong.length
      ? { ok: false, detail: wrong.join("; ") }
      : { ok: true, detail: `error "${seen.error}" after ${waited} s; C's pending list unchanged (${before.size}); no JoinRequestSent` };
  });
  // Once more, ~30 s after the host is back: does the app send the failed ask by itself? It should not (nothing was
  // recorded); logged, not a row, and anything new is declined by the caller like any arrival.
  await sleep(30000);
  const late = [...pendingIds()].filter((id) => !before.has(id) && !arrived.includes(id));
  late.forEach((id) => console.log(`ARRIVED_REQ ${id}`));
  log(late.length ? `after the host came back, C received ${late.length} request(s) by itself: ${late.join(", ")}` : "after the host came back, C received nothing more in 30 s");
} catch (e) {
  log(`error: ${e.message.split("\n")[0]}`);
  if (d) await screenshot(d, "lost-ask-offline-failure").catch(() => undefined);
  rows.fatal(e);
} finally {
  if (netOff) await network(true).catch(() => undefined);
  rows.summary();
  process.exitCode = rows.exitCode();
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
