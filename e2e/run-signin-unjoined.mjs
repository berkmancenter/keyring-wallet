#!/usr/bin/env node
/**
 * IN-249 (bifold #385): a sign-in code from a community this phone never joined names the community, never its raw
 * DID. Before it the not-joined screen read "Community: did:webvh:Qm…:webvh.storm.ws:test-vtc".
 *
 * On a linked phone that has NOT joined C (the smoke legs: linked, never joined): a sign-in code for C is handed to
 * the scanner's paste screen, as a scanned QR would be. The SignIn screen reads it offline and looks C up: a
 * community this phone is not a member of ends on "Not signed in" (SignInNotMember) with the community's row
 * (SignInCommunity) and, since #385, its DID behind Details (SignInCommunityDid…). Nothing is sent to C: the claim
 * comes only after Continue on a member's confirm step, which a non-member never gets. The one network read is the
 * community's public profile (its published name, unauthenticated, 3 s cap).
 *
 * The code: SIGNIN_LINK when set (a real one, from the community's sign-in page); otherwise one made here in the
 * trigger-link form Keyring reads (bifold trust-tasks/module/triggerLink.ts, VTI trigger links):
 *   https://link.trustoverip.org/#_from=<C_DID>&_id=<16 random bytes, base64url>&_exp=<now + 10 min>&_type=/vti/flow/sign-in/0.1
 * The reading step needs only that it parse (a DID of an allowed method, a canonical handle, a future expiry, the
 * sign-in flow 0.1); the handle is never claimed, so a made-up one is as good as a real one here.
 * Row (lib/rows.js):
 *   signin-unjoined-names-community   PASS: the SignIn screen's community row is not a DID (does not begin "did:" and
 *                                     does not hold C's DID); its words are in the detail, with which form they took
 *                                     (C_NAME, "<handle> (no name published yet)", other) and, when Details is
 *                                     offered, whether it reveals C's DID.
 *                                     SKIP "build lacks SignInCommunityDid" on a build before #385; SKIP without C_DID
 *                                     or SIGNIN_LINK; SKIP when the phone is a member of C after all (the confirm step).
 *   PLATFORM=android UDID=emulator-5570 APPIUM_PORT=4760 C_DID=… [C_NAME=…] [SIGNIN_LINK=…] node run-signin-unjoined.mjs
 *   PLATFORM=ios UDID=<sim> IOS_APP=<app> IOS_DEVICE_NAME=… IOS_PLATFORM_VERSION=… APPIUM_PORT=4768 C_DID=… node run-signin-unjoined.mjs
 */
import "./lib/cli-guard.js";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureAppium, existsTestId, screenshot, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { buildLacks } from "./lib/buildHas.js";
import { pasteLinkFromHome } from "./lib/flows.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { createRows, selectedRows } from "./lib/rows.js";

export const ROW = "signin-unjoined-names-community";
export const TRIGGER_HOST = "link.trustoverip.org";
export const SIGN_IN_TYPE = "/vti/flow/sign-in/0.1";

/** A trigger-link handle: 16 bytes as canonical unpadded base64url (22 characters). */
export const triggerId = (bytes = randomBytes(16)) => Buffer.from(bytes).toString("base64url");

/**
 * A sign-in code for `did`, as the community's sign-in page would make one: the DID percent-encoded (a did:webvh
 * can carry "%3A" for a port, which the fragment's form decoding would otherwise turn into ":").
 */
export function signInLink({ did, now = Math.floor(Date.now() / 1000), ttl = 600, id = triggerId() }) {
  if (!did) throw new Error("signInLink needs did");
  return `https://${TRIGGER_HOST}/#_from=${encodeURIComponent(did)}&_id=${id}&_exp=${now + ttl}&_type=${SIGN_IN_TYPE}`;
}

/** The community DID a sign-in code names (its `_from`), or undefined. */
export function fromOf(link) {
  const at = String(link ?? "").indexOf("#");
  if (at < 0) return undefined;
  return new URLSearchParams(link.slice(at + 1)).get("_from") ?? undefined;
}

/** Whether a label shown as a community's name is really its DID (or holds it). */
export const readsAsDid = (label, did) => /^\s*did:/i.test(String(label ?? "")) || Boolean(did && String(label ?? "").includes(did));

/** Which form a community label took: its name, its handle said as unnamed, or something else. */
export function labelForm(label, name) {
  const t = String(label ?? "").trim();
  if (!t) return "empty";
  if (name && t === name.trim()) return "its name";
  if (/\(no name published yet\)$/.test(t)) return "its handle, unnamed";
  return "other words";
}

const log = (m) => console.log(`[e2e] ${new Date().toISOString().slice(11, 23)}Z ${m}`);

async function main() {
  const PLATFORM = process.env.PLATFORM === "ios" ? "ios" : "android";
  const BID = process.env.E2E_APP_ID || "asml.bkc.harvard.wallet";
  const C_NAME = process.env.C_NAME || "";
  const rows = createRows({ label: "signin-unjoined" });
  const only = selectedRows();
  if (only && !only.has(ROW)) {
    await rows.row(ROW, () => true);
    rows.summary();
    return rows.exitCode();
  }
  const link = process.env.SIGNIN_LINK || (process.env.C_DID ? signInLink({ did: process.env.C_DID }) : "");
  const did = fromOf(link);
  const lacks = buildLacks("SignInCommunityDid", { platform: PLATFORM });
  if (lacks || !link || !did) {
    rows.skip(ROW, lacks ? `${lacks} (bifold #385, IN-249)` : "no community: set C_DID (a community this phone has not joined) or SIGNIN_LINK (a real sign-in code)");
    rows.summary();
    return rows.exitCode();
  }
  let d;
  try {
    await ensureAppium();
    d = await makeDriver({ platform: PLATFORM, udid: process.env.UDID, deviceName: process.env.IOS_DEVICE_NAME, keepState: true });
    rows.setDriver(d);
    await d.activateApp(BID);
    if (await existsTestId(d, "GetStarted", 8000)) {
      rows.skip(ROW, "no wallet on this phone (the link before this row did not finish)");
      return rows.exitCode();
    }
    await unlockToHome(d, 120000).catch(async (e) => {
      if (!(await existsTestId(d, "MyAgent", 10000))) throw e;
    });
    log(`sign-in code for …${did.slice(-24)} (${process.env.SIGNIN_LINK ? "SIGNIN_LINK" : "made here"})`);
    // A refusal on the paste screen (its error modal) is this row's failure, not the leg's.
    const refused = await pasteLinkFromHome(d, link).then(
      () => "",
      (e) => String(e.message).split("\n")[0]
    );
    // Reading the code is offline; looking the community up waits on its public profile (3 s cap) and its DID.
    let step = "";
    for (const until = Date.now() + (refused ? 0 : 45000); Date.now() < until && !step; await sleep(1000)) {
      if (await existsTestId(d, "SignInNotMember", 1000)) step = "notMember";
      else if (await existsTestId(d, "SignInConfirm", 500)) step = "confirm";
      else if (await existsTestId(d, "SignInResult", 500)) step = "result";
    }
    const label = step ? (await textOf(d, "SignInCommunity").catch(() => "")).trim() : "";
    // The DID behind Details (#385), on the not-joined step only.
    let behind = "not offered";
    if (step === "notMember" && (await existsTestId(d, "SignInCommunityDidToggle", 3000))) {
      await tapTestId(d, "SignInCommunityDidToggle", 10000).catch(() => undefined);
      const shown = (await existsTestId(d, "SignInCommunityDidDid", 5000)) ? (await textOf(d, "SignInCommunityDidDid").catch(() => "")).trim() : "";
      behind = shown === did ? "reveals C's DID" : shown ? `reveals "${shown.slice(0, 60)}", not C's DID` : "reveals nothing";
    }
    await screenshot(d, "signin-unjoined").catch(() => undefined);
    const src = step ? "" : await d.getPageSource().catch(() => "");
    log(`SignIn step ${step || "none"} · community row "${label}" · Details ${behind}`);
    if (step === "confirm") {
      rows.skip(ROW, `this phone is a member of the community after all (the confirm step); its row reads "${label}"`);
    } else {
      await rows.row(ROW, () => {
        if (refused) return { ok: false, detail: `the paste screen did not take the code: ${refused}` };
        if (!step) return { ok: false, detail: `no SignIn step in 45 s after the code was pasted${/This code|can't be used|newer version/.test(src) ? " (the scanner refused it)" : ""}` };
        if (step === "result") return { ok: false, detail: `SignIn ended at once (SignInResult), no community row` };
        if (!label) return { ok: false, detail: "the not-joined step shows no community row (SignInCommunity empty)" };
        if (readsAsDid(label, did)) return { ok: false, detail: `the community row is its DID: "${label.slice(0, 80)}"` };
        return { ok: true, detail: `"${label}" (${labelForm(label, C_NAME)}); Details ${behind}` };
      });
    }
    // Leave the sign-in: Done on the not-joined step, Cancel on the confirm step, else Back.
    if (!(await tapTestId(d, "SignInDone", 3000).then(() => true, () => false))) {
      if (!(await tapTestId(d, "SignInCancel", 2000).then(() => true, () => false))) await d.back().catch(() => undefined);
    }
  } catch (e) {
    log(`error: ${String(e.message).split("\n")[0]}`);
    if (d) await screenshot(d, "signin-unjoined-failure").catch(() => undefined);
    rows.fatal(e);
  } finally {
    rows.summary();
    if (d) await d.deleteSession().catch(() => undefined);
    stopAppium();
  }
  return rows.exitCode();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
