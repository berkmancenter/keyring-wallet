#!/usr/bin/env node
/**
 * IN-258 (queued, no fix yet): a membership card whose status list cannot be read is held silently for ever. Where
 * it is held: a card is checked before it is kept (bifold trust-tasks/module/vtiDeliveredCheck.ts), and a status list
 * that cannot be read (vtiStatusList.ts, state "unknown") throws VtiCardStatusUnreadable, so the card in the verdict
 * is dropped (vtiJoin.ts, 'statusUnreadable', no event) and its delivery is left on the mediator to come again,
 * failing the same way each time. A card already kept is not affected: its standing read (joinStanding) takes an
 * unreadable list as not revoked. So the row cuts the status-list host BEFORE the community's answer arrives.
 *
 * On a linked Android phone (rootable emulator) that is not a member of C and has no open request there (the lostreq
 * leg, after run-join-lost.mjs): Ask to join C (the admin-review way), wait for C to list the request, cut the
 * status-list host only, have C's admin approve the request, then watch Your agent's card for C (and Check now, and
 * C's Join screen) for the notice the fix is to add: "couldn't check this card's status" with a retry. The host is
 * put back in `finally`, and for a minute after that the card is watched again (logged, not a row).
 *
 * The status-list host: STATUS_LIST_HOST, else C_REST's host. The VTC publishes its lists at
 * `{public_url}/v1/status-lists/{purpose}` (vtc-service server.rs) and every card's credentialStatus names that URL;
 * C_REST is that public URL plus /v1 on the Farm. When the admin's answer carries a statusListCredential, its host is
 * compared with the one cut, and a mismatch is said in the row.
 * The cut: iptables on the phone, by the TLS server name (`-m string`, the hostname in the ClientHello), so another
 * host on the same address (C's messaging host, the VTA) stays reachable; when the phone's kernel has no string match,
 * by address (`-d host`), refused when that address is also C_MEDIATOR_HOST's (it would cut the answer too).
 *
 * Row (lib/rows.js):
 *   card-status-unreachable-notice   PASS: a notice about the card's status shows (words like "couldn't check" with
 *                                    "status" on the page, or a testID with "StatusUnreadable"/"CardStatus").
 *                                    TRACKED until the IN-258 fix lands: without the notice the row is
 *                                    SKIP "tracked: IN-258 fix pending; observed: <what the card said>", and FAIL only
 *                                    with CARD_STATUS_STRICT=1 (set it, or gate the row on the fix's testID with
 *                                    buildHas, when the fix lands). A setup that never reached the check (no request,
 *                                    no cut) is a SKIP with the same prefix.
 * Prints `STATUS_BLOCK_HOST <host>` (the caller drops both rule forms for it in its cleanup), `JOIN_MEMBER <did>` for
 * the member it made, and `ARRIVED_REQ <id>` for a request it made and did not approve (the caller declines it).
 *   E2E_APP_ID=… UDID=emulator-5572 APPIUM_PORT=4762 C_DID=… C_NAME=… C_REST=… C_ADMIN="<rest> <did> <cred>"
 *     [STATUS_LIST_HOST=…] [C_MEDIATOR_HOST=…] [OBSERVE_MS=180000] [CARD_STATUS_STRICT=1] node run-card-status.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureAppium, existsTestId, screenshot, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { createRows, selectedRows } from "./lib/rows.js";
import { communityCardKey } from "./lib/testIdKeys.js";
import { join } from "./lib/pages/join.js";

export const ROW = "card-status-unreachable-notice";
export const TRACKED = "tracked: IN-258 fix pending";

/** The host the status lists are served from: the override, else the community's REST host. */
export function statusHostOf(cRest, override) {
  if (override) return override.trim();
  try {
    return new URL(cRest).hostname;
  } catch {
    return "";
  }
}

/** The first statusListCredential URL's host in a JSON answer's text (the admin's decide answer), or "". */
export function statusListHostIn(text) {
  const m = String(text ?? "").match(/"statusListCredential"\s*:\s*"(https?:\/\/[^"]+)"/);
  if (!m) return "";
  try {
    return new URL(m[1]).hostname;
  } catch {
    return "";
  }
}

/**
 * The notice IN-258 asks for, in a page source: the words ("couldn't check" / "could not check" … "status", or
 * "status … couldn't be checked") or a testID naming it. Returns the matched words, or "".
 */
export function noticeIn(source) {
  const s = String(source ?? "");
  const words = s.match(/[^"<>]{0,40}could(?:n['’]t| not) (?:check|verify|read)[^"<>]{0,80}status[^"<>]{0,40}/i) ?? s.match(/[^"<>]{0,40}status[^"<>]{0,60}could(?:n['’]t| not) be (?:checked|read|verified)[^"<>]{0,40}/i);
  if (words) return words[0].trim();
  const id = s.match(/(?:resource-id|name)="[^"]*?((?:Card)?Status(?:Unreadable|Unknown|Unchecked|Notice)[A-Za-z_]*)"/);
  return id ? `testID ${id[1]}` : "";
}

/** How the row ends: PASS on the notice, else SKIP as tracked (FAIL when strict). */
export function cardStatusOutcome({ notice, observed, setup, strict = false }) {
  if (setup) return { status: "SKIP", detail: `${TRACKED}; setup did not reach the check: ${setup}` };
  if (notice) return { status: "PASS", detail: `notice "${notice}"; ${observed}` };
  return strict ? { status: "FAIL", detail: `no status notice; ${observed}` } : { status: "SKIP", detail: `${TRACKED}; observed: ${observed}` };
}

const ADMIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tsp-reference/ref-20-local-vetting/vtc-admin.mjs");
const log = (m) => console.log(`[e2e] ${new Date().toISOString().slice(11, 23)}Z ${m}`);

async function main() {
  const BID = process.env.E2E_APP_ID || "asml.bkc.harvard.wallet";
  const UDID = process.env.UDID;
  const C_DID = process.env.C_DID;
  const C_NAME = process.env.C_NAME || "Keyring Lab Community";
  const OBSERVE_MS = Number(process.env.OBSERVE_MS || 180000);
  const strict = process.env.CARD_STATUS_STRICT === "1";
  const host = statusHostOf(process.env.C_REST, process.env.STATUS_LIST_HOST);
  const key = communityCardKey(C_DID || "");
  const rows = createRows({ label: "card-status" });
  const only = selectedRows();
  if (only && !only.has(ROW)) {
    await rows.row(ROW, () => true);
    rows.summary();
    return rows.exitCode();
  }
  const end = async (outcome) => {
    if (outcome.status === "SKIP") rows.skip(ROW, outcome.detail);
    else await rows.row(ROW, () => ({ ok: outcome.status === "PASS", detail: outcome.detail }));
  };
  if (!C_DID || !process.env.C_ADMIN || !host || !UDID) {
    await end(cardStatusOutcome({ setup: "needs C_DID, C_ADMIN, UDID and C_REST (or STATUS_LIST_HOST)" }));
    rows.summary();
    return rows.exitCode();
  }

  const admin = (...a) =>
    execFileSync("node", [ADMIN, ...process.env.C_ADMIN.split(" ").filter(Boolean), ...a], { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] });
  const pending = () => {
    const t = admin("join-list", "pending");
    return JSON.parse(t.slice(t.indexOf("{"))).items ?? [];
  };
  const adb = (...a) => execFileSync("adb", ["-s", UDID, "shell", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const ipOf = (h) => {
    try {
      return adb("ping", "-c", "1", "-W", "3", h).match(/\(([0-9.]+)\)/)?.[1] ?? "";
    } catch (e) {
      return String(e.stdout ?? "").match(/\(([0-9.]+)\)/)?.[1] ?? "";
    }
  };
  // Both rule forms for the host, so a cut is always put back whichever form went in.
  const sniRule = ["OUTPUT", "-p", "tcp", "-m", "string", "--string", host, "--algo", "bm", "-j", "REJECT", "--reject-with", "tcp-reset"];
  const ipRule = ["OUTPUT", "-d", host, "-j", "REJECT"];
  let cut = "";
  const block = () => {
    console.log(`STATUS_BLOCK_HOST ${host}`);
    try {
      adb("iptables", "-I", ...sniRule);
      try {
        adb("ip6tables", "-I", ...sniRule);
      } catch {
        // No IPv6 string match: the IPv4 rule is the one the emulator's network uses.
      }
      return "by server name";
    } catch (e) {
      log(`iptables string match refused (${String(e.stderr ?? e.message).split("\n")[0].slice(0, 100)}); by address instead`);
    }
    const ip = ipOf(host);
    const mediator = process.env.C_MEDIATOR_HOST;
    if (mediator && ip && ip === ipOf(mediator)) throw new Error(`${host} and C's messaging host ${mediator} share ${ip}: cutting the address would cut the answer too`);
    for (const t of ["iptables", "ip6tables"]) adb(t, "-I", ...ipRule);
    return `by address (${ip || "?"})`;
  };
  const unblock = () => {
    for (const t of ["iptables", "ip6tables"])
      for (const r of [sniRule, ipRule])
        for (let i = 0; i < 3; i++) {
          try {
            adb(t, "-D", ...r);
          } catch {
            break;
          }
        }
    log(`${host} put back`);
  };

  let d;
  let reqId = "";
  let approved = false;
  try {
    await ensureAppium();
    d = await makeDriver({ platform: "android", udid: UDID, keepState: true });
    rows.setDriver(d);
    await d.activateApp(BID);
    await unlockToHome(d).catch(async (e) => {
      if (!(await existsTestId(d, "MyAgent", 10000))) throw e;
    });
    const before = new Set(pending().map((r) => r.id));
    await join.openCommunity(d, { did: C_DID, name: C_NAME });
    await join.ask(d);
    await join.awaitSent(d, { timeoutMs: 120000, required: false });
    // C's own list says which request is this phone's: the one that was not there before the ask.
    let req;
    for (const until = Date.now() + 90000; Date.now() < until && !req; ) {
      req = pending()
        .filter((r) => !before.has(r.id))
        .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)))
        .pop();
      if (!req) await sleep(5000);
    }
    if (!req) {
      await end(cardStatusOutcome({ setup: `no new pending request at C 90 s after the ask (${before.size} before)` }));
      return rows.exitCode();
    }
    reqId = req.id;
    log(`request ${req.id} from …${String(req.applicantDid).slice(-24)}`);

    // The cut, then the answer.
    try {
      cut = block();
    } catch (e) {
      await end(cardStatusOutcome({ setup: `the status-list host could not be cut alone: ${String(e.message).split("\n")[0]}` }));
      return rows.exitCode();
    }
    log(`${host} cut ${cut}`);
    const said = admin("join-decide", req.id, "approved");
    approved = true;
    console.log(`JOIN_MEMBER ${req.applicantDid}`);
    log(`admin approves ${req.id}: ${(said.split("\n").filter((l) => /->/.test(l)).pop() ?? "").trim()}`);
    const listed = statusListHostIn(said);
    const mismatch = listed && listed !== host ? ` (the card names its status list at ${listed}, not ${host}: the wrong host was cut)` : "";

    // Watch the card: Your agent, then Check now, then C's Join screen.
    const statusNow = async () => (await textOf(d, `AgentCommunityStatus_${key}`).catch(() => "")).replace(/\s+/g, " ").trim();
    let notice = "";
    let status = "";
    let where = "";
    const t0 = Date.now();
    for (const until = Date.now() + OBSERVE_MS; Date.now() < until && !notice; await sleep(10000)) {
      await tapTestId(d, "MyAgent", 10000).catch(() => undefined);
      await sleep(1500);
      status = (await statusNow()) || status;
      notice = noticeIn(await d.getPageSource().catch(() => ""));
      if (notice) where = `Your agent, ${Math.round((Date.now() - t0) / 1000)} s after the approval`;
    }
    if (!notice && (await existsTestId(d, `AgentCommunityCheck_${key}`, 3000))) {
      await tapTestId(d, `AgentCommunityCheck_${key}`, 10000).catch(() => undefined);
      for (const until = Date.now() + 30000; Date.now() < until && !notice; await sleep(5000)) {
        status = (await statusNow()) || status;
        notice = noticeIn(await d.getPageSource().catch(() => ""));
      }
      if (notice) where = "Your agent, after Check now";
    }
    let joinSaid = "";
    if (!notice) {
      await join.openCommunity(d, { did: C_DID, name: C_NAME }).catch((e) => log(`C's Join did not open: ${String(e.message).split("\n")[0]}`));
      notice = noticeIn(await d.getPageSource().catch(() => ""));
      if (notice) where = "C's Join screen";
      joinSaid = (await textOf(d, "JoinStandingText").catch(() => "")).replace(/\s+/g, " ").trim();
    }
    await screenshot(d, "card-status-unreachable").catch(() => undefined);
    const observed = `card status "${status || "(none)"}"${joinSaid ? `, Join "${joinSaid}"` : ""} for ${Math.round((Date.now() - t0) / 1000)} s with ${host} cut ${cut}${mismatch}`;
    await end(cardStatusOutcome({ notice: notice ? `${notice} (${where})` : "", observed, strict }));
  } catch (e) {
    log(`error: ${String(e.message).split("\n")[0]}`);
    if (d) await screenshot(d, "card-status-failure").catch(() => undefined);
    // A row that is still tracked is not a broken leg: it says what stopped it.
    if (rows.outcome(ROW) === undefined) await end(cardStatusOutcome({ setup: `the driver stopped: ${String(e.message).split("\n")[0].slice(0, 160)}` }));
  } finally {
    if (cut) unblock();
    if (reqId && !approved) console.log(`ARRIVED_REQ ${reqId}`);
    // After the host is back: does the held card arrive? Logged, not a row.
    if (cut && d) {
      let after = "";
      for (const until = Date.now() + 60000; Date.now() < until && !/you(?:'|’)?re a member/i.test(after); await sleep(10000)) {
        await tapTestId(d, "MyAgent", 10000).catch(() => undefined);
        after = (await textOf(d, `AgentCommunityStatus_${key}`).catch(() => "")).replace(/\s+/g, " ").trim();
      }
      log(`a minute after ${host} came back: card status "${after || "(none)"}"`);
    }
    rows.summary();
    if (d) await d.deleteSession().catch(() => undefined);
    stopAppium();
  }
  return rows.exitCode();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
