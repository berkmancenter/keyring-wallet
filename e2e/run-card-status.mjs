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
 *                                    On a build with IN-258's fix (bifold #386, CardStatusNotice; lostreq.sh sets
 *                                    CARD_STATUS_STRICT=1 by buildHas) no notice is a FAIL, and so is a setup that
 *                                    never reached the check (no request, no cut), saying so. On an older build both
 *                                    are SKIP "tracked (a build without bifold #386's CardStatusNotice): …".
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
export const TRACKED = "tracked (a build without bifold #386's CardStatusNotice)";

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

/**
 * Whether the cut held, from the phone's own log (bifold #410: "[VTI] card status: MembershipCredential … outcome=…"):
 * "read" when a membership card's status list was read during the cut (the cut did not hold: no verdict),
 * "blocked" when its read came back unknown (what the check needs), "none" when no membership card's status was
 * checked at all (the relaunched app never got to it: no verdict either).
 */
export function cutHeld(logText) {
  const lines = logText.split("\n").filter((l) => /\[VTI\] card status: MembershipCredential/.test(l));
  const read = lines.find((l) => /outcome=ok \(status list read/.test(l));
  if (read) return { state: "read", line: read.slice(read.indexOf("[VTI]")).trim() };
  const blocked = lines.find((l) => /outcome=unknown/.test(l));
  if (blocked) return { state: "blocked", line: blocked.slice(blocked.indexOf("[VTI]")).trim() };
  return { state: "none", line: "" };
}

/**
 * How the row ends: PASS on the notice, else SKIP as tracked (FAIL when strict). Strict is a build with bifold #386
 * (IN-258's fix, CardStatusNotice): there the row is a real check, so a setup that never reached it is a FAIL too,
 * saying so, rather than a SKIP that reads like a known gap (1014-0451, 1014-1857: it never ran on 241).
 */
export function cardStatusOutcome({ notice, observed, setup, strict = false }) {
  if (setup) return strict ? { status: "FAIL", detail: `setup did not reach the check (the harness, not a verdict on the app): ${setup}` } : { status: "SKIP", detail: `${TRACKED}: setup did not reach the check: ${setup}` };
  if (notice) return { status: "PASS", detail: `notice "${notice}"; ${observed}` };
  return strict ? { status: "FAIL", detail: `no status notice; ${observed}` } : { status: "SKIP", detail: `${TRACKED}: observed: ${observed}` };
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
  // The cut seen from the phone itself: a TLS fetch of the status host with the device's curl, before the cut (the
  // control: an HTTP code) and during it (a refusal). 1014-2239 could not tell a cut that did not block the app's
  // fetch from a card with no status entry; this says which. Logged as PROBE lines, not a row.
  const probe = (when) => {
    let said;
    try {
      said = `http ${adb("curl", "-sS", "-m", "8", "-o", "/dev/null", "-w", "%{http_code}", `https://${host}/`) || "?"}`;
    } catch (e) {
      said = `refused: ${String(e.stderr ?? e.message).replace(/\s+/g, " ").trim().slice(0, 120)}`;
    }
    console.log(`PROBE ${when} ${host}: ${said}`);
    return said;
  };
  let tried = false;
  // The server-name rule matches the host as a substring of any server name: refuse when C's messaging host or the
  // host in C's own DID would match too, or the cut would also cut the answer (or C's DID resolution).
  const overlaps = () => {
    const didHost = decodeURIComponent(String(C_DID || "").split(":")[3] ?? "");
    return [process.env.C_MEDIATOR_HOST, didHost].filter((h) => h && h.includes(host));
  };
  // CARD_STATUS_CUT=hosts (lostreq.sh, on its own writable AVD): the status host's name alone resolves to nowhere, by
  // lines in the phone's hosts file. The server-name rule below never held: the host offers ECH, and it shares its
  // Cloudflare addresses with C's messaging host, so neither SNI nor an address can cut it alone (1015-0312 diagnostic).
  const HOSTS = "/system/etc/hosts";
  const MARK = "# keyring-gate-cut";
  const hostsMode = process.env.CARD_STATUS_CUT === "hosts";
  const hostsSum = () => { try { return adb(`md5sum ${HOSTS}`).split(/\s+/)[0]; } catch { return "?"; } };
  let sumBefore = "";
  const block = () => {
    if (hostsMode) {
      tried = true;
      console.log(`STATUS_BLOCK_HOST ${host}`);
      sumBefore = hostsSum();
      adb(`printf '0.0.0.0 ${host} ${MARK}\\n:: ${host} ${MARK}\\n' >> ${HOSTS}`);
      // Proof before the approval that the name now resolves to nowhere (the phone's own resolver, via ping).
      let resolved = "";
      try { resolved = adb(`ping -c1 -W1 ${host}`); } catch (e) { resolved = String(e.stdout ?? "") + String(e.stderr ?? ""); }
      const to = (resolved.match(/\(([0-9a-f.:]+)\)/) || [])[1] ?? "unresolved";
      console.log(`CUT-CHECK hosts ${host} resolves to ${to} (hosts ${HOSTS} md5 before ${sumBefore})`);
      // 0.0.0.0 is reported as the loopback it reaches (127.0.0.1, seen on the Lostreq_API_33 proof run): any of these
      // means the name no longer reaches the host; a public address means the entry did not take.
      if (!["0.0.0.0", "127.0.0.1", "::", "::1", "unresolved"].includes(to)) throw new Error(`the hosts entry did not take: ${host} still resolves to ${to}`);
      return "by hosts file";
    }
    const shared = overlaps();
    if (shared.length) throw new Error(`${host} is part of ${shared.join(" and ")}: cutting it would cut C's messaging or DID too`);
    tried = true;
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
    adb("iptables", "-I", ...ipRule);
    try {
      adb("ip6tables", "-I", ...ipRule);
    } catch {
      // No IPv6 rule: the IPv4 one is the one the emulator's network uses; finally removes it either way.
    }
    return `by address (${ip || "?"})`;
  };
  const unblock = () => {
    if (hostsMode) {
      try { adb(`sed -i '/${MARK}$/d' ${HOSTS}`); } catch (e) { log(`hosts line not removed: ${String(e.message).split("\n")[0]}`); }
      const after = hostsSum();
      console.log(`CUT-CHECK hosts restored: md5 before ${sumBefore || "?"}, after ${after}${sumBefore && after !== sumBefore ? " — DIFFERENT" : ""}`);
      log(`${host} put back`);
      return;
    }
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
    // A fresh start: the leg's run-join-lost leaves Join on its "Your agent didn't answer" step on purpose, and
    // resuming there, join.ask found no JoinStart (1014-0451, 1014-1857). Nothing is lost: that ask never sent a
    // request, and the leg declined any that reached C.
    await d.terminateApp(BID).catch(() => undefined);
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
    probe("before the cut");
    try {
      cut = block();
    } catch (e) {
      await end(cardStatusOutcome({ setup: `the status-list host could not be cut alone: ${String(e.message).split("\n")[0]}` }));
      return rows.exitCode();
    }
    log(`${host} cut ${cut}`);
    probe("during the cut");
    // The server-name rule refuses only a NEW connection's TLS handshake: a connection the app opened before the cut
    // carried its status read straight through (1015-0249: "status list read, not withdrawn" 3 s into the cut). So
    // the app starts again now, with no connection from before the cut, and its log from here on is the card's.
    try { adb("logcat", "-c"); } catch { /* a log that cannot be cleared still carries the lines */ }
    await d.terminateApp(BID).catch(() => undefined);
    await d.activateApp(BID);
    await unlockToHome(d).catch(async (e) => {
      if (!(await existsTestId(d, "MyAgent", 10000))) throw e;
    });
    log("app restarted inside the cut: no connection from before it survives");
    // Named before the approval, so a timeout after it is still cleaned up (lostreq's fin removes the member).
    console.log(`JOIN_MEMBER ${req.applicantDid}`);
    const said = admin("join-decide", req.id, "approved");
    approved = true;
    log(`admin approves ${req.id}: ${(said.split("\n").filter((l) => /->/.test(l)).pop() ?? "").trim()}`);
    // What C issued this applicant, read-only (vtc/members/credentials/0.1): each card's types and where its status
    // list is, so a card filed without a status check can be told from one whose check got through.
    await sleep(5000);
    try {
      const creds = admin("member-credentials", req.applicantDid);
      const body = JSON.parse(creds.slice(creds.indexOf("{")));
      const cards = [];
      const walk = (o) => {
        if (Array.isArray(o)) return o.forEach(walk);
        if (!o || typeof o !== "object") return;
        if (o.type && o.credentialSubject) {
          const types = [].concat(o.type).filter((t) => t !== "VerifiableCredential").join("+");
          const st = [].concat(o.credentialStatus ?? []).map((x) => `${x.type} at ${String(x.statusListCredential ?? "").replace(/^(https?:\/\/[^/]+).*$/, "$1")}`);
          cards.push(`${types}: ${st.length ? st.join(", ") : "no status entry"}`);
        }
        Object.values(o).forEach(walk);
      };
      walk(body);
      console.log(`ISSUED ${cards.length} card(s): ${cards.join(" · ") || "none listed"}`);
    } catch (e) {
      console.log(`ISSUED unreadable: ${String(e.message).split("\n")[0].slice(0, 120)}`);
    }
    setTimeout(() => probe("30 s after the approval"), 25000);
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
    // On a build that logs its status reads (#410, CARD_STATUS_LOGS=1 from the leg), the row is a verdict only when the
    // cut demonstrably held: otherwise the leg is BROKEN (the harness), never a pass or a fail about the app.
    if (process.env.CARD_STATUS_LOGS === "1") {
      let text = "";
      try { text = adb("logcat", "-d", "-s", "ReactNativeJS:I"); } catch (e) { text = String(e.stdout ?? ""); }
      const held = cutHeld(text);
      console.log(`CUT-CHECK ${held.state}${held.line ? `: ${held.line.slice(0, 200)}` : ""}`);
      if (held.state === "read") { console.log(`CUT-NOT-HELD the phone read the membership card's status list during the cut: ${held.line.slice(0, 200)}`); return rows.exitCode(); }
      if (held.state === "none") { console.log("NO-STATUS-READ the relaunched app checked no membership card's status during the cut"); return rows.exitCode(); }
    }
    await end(cardStatusOutcome({ notice: notice ? `${notice} (${where})` : "", observed, strict }));
  } catch (e) {
    log(`error: ${String(e.message).split("\n")[0]}`);
    if (d) await screenshot(d, "card-status-failure").catch(() => undefined);
    // A row that is still tracked is not a broken leg: it says what stopped it.
    if (rows.outcome(ROW) === undefined) await end(cardStatusOutcome({ setup: `the driver stopped: ${String(e.message).split("\n")[0].slice(0, 160)}` }));
  } finally {
    if (cut || tried) unblock();
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
