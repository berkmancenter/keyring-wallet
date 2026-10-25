#!/usr/bin/env node
/**
 * A member signs in to a community website with Keyring (auth/oob), end to end. The phone (Android emulator on the
 * dedicated Signin_API_33 AVD: device PIN plus an enrolled fingerprint, since Keyring's UV key is biometric-only) is
 * linked to an agent already (the leg runs run-vta-link.js first). This driver:
 *   1. joins the community by its review way, and the harness admin approves (the community lists the phone);
 *   2. plays the community's member portal (openvtc/signinPortal.js): auth/oob/request, then the trigger link the
 *      portal would show as a QR, pasted into the phone;
 *   3. on the phone: SignInConfirm → SignInContinue → the two digits the portal's redeem reports → SignInNumberContinue
 *      → SignInReview → SignInApprove → the fingerprint prompt (adb emu finger touch 1) → SignInResult;
 *   4. reads the portal's redeem: approved, for the phone's member DID, with "uv" in amr.
 * Rows (lib/rows.js):
 *   signin-member-joined     the community lists the phone after its review-way request is approved
 *   signin-claimed           the phone claimed the code: the portal's redeem shows a match number
 *   signin-version           0.1 today: no SignInSigningScope on the review (a VTC with VTI #2190 offers one: 0.2)
 *   signin-approved          redeem approved: subject = the phone's member DID, amr includes "uv"
 *   signin-phone-done        the phone's result screen says it signed in (SignInResult / SignInDone)
 * uvUnavailable / noUvKey on the phone is BROKEN (an environment without biometrics), never a sign-in FAIL.
 * Cleanup removes the member this run made.
 *
 *   UDID=emulator-5574 APPIUM_PORT=4764 SIGNIN_C_DID=… SIGNIN_C_REST=… SIGNIN_C_ADMIN_CRED=… SIGNIN_PORTAL=https://…/members/ \
 *     node run-signin-member.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestId, waitForTestId } from "./lib/driver.js";

/**
 * Tap a button that may sit below a long screen's fold (the review: community, website, identity, browser, …). With
 * `enabledWithin`, wait that long for the button to report enabled first: SignInContinue stays disabled until the
 * community's identities are read (about 1–2 s), and a tap on a disabled button is lost without a word.
 */
async function tapBelow(d, key, { enabledWithin = 0 } = {}) {
  await scrollToTestId(d, key, 6, { from: 0.7 }).catch(() => undefined);
  if (enabledWithin) {
    // The element is found again on each poll, and a failed read is reported as one: "still disabled" means the
    // button said so, not that a stale handle or a lost session was read as false.
    const start = Date.now();
    let enabled = false;
    let lastError;
    while (!enabled) {
      try {
        enabled = await (await waitForTestId(d, key, 15000)).isEnabled();
        lastError = undefined;
      } catch (err) {
        lastError = err;
      }
      if (enabled) break;
      if (Date.now() - start > enabledWithin) {
        throw new Error(
          lastError
            ? `${key} could not be read for ${enabledWithin / 1000} s: ${lastError.message}`
            : `${key} still disabled after ${enabledWithin / 1000} s`
        );
      }
      await sleep(500);
    }
    // Whether the wait ran at all: a 0 here with a slow community read would mean the disabled state is not reaching
    // the driver.
    console.log(`[e2e] ${key} enabled after ${Date.now() - start} ms`);
  }
  await tapTestId(d, key, 15000);
}
import { pasteLinkFromHome } from "./lib/flows.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { join } from "./lib/pages/join.js";
import { createRows } from "./lib/rows.js";
import { createHvAdmin, soleRequestSince } from "./openvtc/hvAdmin.js";
import { createSigninPortal, originOf, signinConfig, triggerLink } from "./openvtc/signinPortal.js";

const UDID = process.env.UDID;
const PLATFORM = process.env.PLATFORM === "ios" ? "ios" : "android";
/** How the person verified at Approve, said in the verdict: Face ID (iOS), or on Android the fingerprint or device PIN. */
const VERIFIED_BY = PLATFORM === "ios" ? "Face ID (the leg's watcher)" : process.env.SIGNIN_UV === "pin" ? "the leg's watcher, SIGNIN_UV=pin: the device PIN where a prompt offers it, fingerprint 1 where it is biometric-only (biometric.log)" : "fingerprint 1 (the leg's watcher)";
const C_DID = process.env.SIGNIN_C_DID;
const C_REST = process.env.SIGNIN_C_REST;
const PORTAL = process.env.SIGNIN_PORTAL;
const rows = createRows({ label: "signin-member" });
const adb = (...args) => execFileSync("adb", ["-s", UDID, ...args], { encoding: "utf8", timeout: 30000 });
const admin = createHvAdmin({ vtcBase: C_REST, communityDid: C_DID, adminCredential: process.env.SIGNIN_C_ADMIN_CRED });

/**
 * The system's biometric or credential window, or "": the driver touches the sensor only there. On iOS the leg's Face ID
 * watcher answers, and with SIGNIN_UV=pin the leg's watcher answers with the device PIN (the Android emulator's
 * fingerprint HAL gives a token keystore treats as expired, run 1019-1459), so the driver leaves the prompt to it.
 */
const authWindow = () => PLATFORM === "ios" || process.env.SIGNIN_UV === "pin" ? "" : (adb("shell", "dumpsys", "window", "windows").match(/Window\{[^}]*(BiometricPrompt|AuthContainer|ConfirmDeviceCredential|CredentialView|biometric)[^}]*\}/i) || [""])[0];
/** The phone says it cannot approve here: an environment without biometrics, not a sign-in verdict. */
async function uvBroken(d) {
  const t = (await d.getPageSource().catch(() => "")) || "";
  if (/couldn't approve the sign-in|isn't set up to approve sign-ins/i.test(t)) throw new Error("driver: the phone cannot approve with biometrics here (uvUnavailable/noUvKey): check the AVD's enrolled fingerprint");
}

let d;
let memberDid;
try {
  for (const [k, v] of Object.entries({ UDID, SIGNIN_C_DID: C_DID, SIGNIN_C_REST: C_REST, SIGNIN_PORTAL: PORTAL })) if (!v) throw new Error(`driver: ${k} is required`);
  await ensureAppium();
  d = await makeDriver({ platform: PLATFORM, udid: UDID, deviceName: process.env.IOS_DEVICE_NAME, keepState: true });
  rows.setDriver(d);
  await unlockToHome(d);

  // 1. Join by the review way; the harness admin approves the request this phone made.
  const since = new Date().toISOString();
  await rows.row("signin-member-joined", async () => {
    await join.openCommunity(d, { did: C_DID, name: "" });
    await join.ask(d, { tag: "signin" });
    await join.awaitSent(d, { required: true });
    // The community is shared with legs beside this one (hv on keyring-hv-lab1 on the MacBook): approve only when this
    // phone's request is the one new request on two reads, and remember only the member it made, so the cleanup never
    // removes someone else's (as run-agent-refused.mjs, #549).
    const { req, count } = await soleRequestSince(() => admin.joinRequests("pending"), since);
    if (!req && !count) throw new Error("no pending join request from this phone reached the community");
    if (!req) return { skip: `${count} join requests since this step began (read twice, 5 s apart): another run is joining on this shared community, so none is approved and this run cannot judge the app` };
    const decided = admin.decide(req.id, "approved");
    let member;
    for (let i = 0; i < 24 && !member; i++) { member = admin.members().find((m) => m.did === req.applicantDid); if (!member) await sleep(5000); }
    memberDid = member?.did;
    // The phone learns it from its own inbox: the join screen ends on JoinDone.
    const done = await waitForTestId(d, "JoinDone", 240000).then(() => true, () => false);
    if (done) await join.done(d).catch(() => undefined);
    return { ok: Boolean(member && done), detail: `request ${req.id} approved (${decided.status}); member ${member?.did ?? "not listed"} (its applicant); the phone reached JoinDone ${done}` };
  });
  if (!memberDid) throw new Error("not a member: nothing to sign in as");

  // 2. The portal's request and the code it would show.
  const origin = originOf(PORTAL);
  const cfg = await signinConfig(origin);
  if (cfg.vtcDid !== C_DID) throw new Error(`driver: the portal names ${cfg.vtcDid}, not ${C_DID}`);
  const portal = await createSigninPortal({ trustTaskBase: C_REST, portalOrigin: origin, vtcDid: cfg.vtcDid });
  const req = await portal.request();
  console.log(`[e2e] sign-in request ${req.requestId.slice(0, 6)}… (claim by ${new Date(req.claimDeadline * 1000).toISOString()}), portal key ${portal.holderDid.slice(-10)}`);
  await pasteLinkFromHome(d, triggerLink({ vtcDid: cfg.vtcDid, requestId: req.requestId, claimDeadline: req.claimDeadline, linkHost: cfg.linkHost, flow: cfg.flow }));

  // 3. The phone claims; the portal shows two digits; the person types them.
  await waitForTestId(d, "SignInConfirm", 60000);
  await tapBelow(d, "SignInContinue", { enabledWithin: 20000 });
  let match;
  for (const until = Date.now() + 90000; Date.now() < until && !match; await sleep(2000)) {
    const r = await portal.redeem(req.requestId);
    if (r.state !== "pending") throw new Error(`the request ended before the match number: ${JSON.stringify(r).slice(0, 160)}`);
    match = r.matchNumber;
  }
  await rows.row("signin-claimed", () => ({ ok: /^\d{2}$/.test(String(match ?? "")), detail: `the portal's redeem shows match number ${match ?? "none"} once the phone claimed` }));
  if (!match) throw new Error("no match number: the phone never claimed");
  const input = await waitForTestId(d, "SignInNumberInput", 30000);
  await input.setValue(String(match));
  await tapBelow(d, "SignInNumberContinue");

  await waitForTestId(d, "SignInReview", 60000);
  const scope = await existsTestId(d, "SignInSigningScope", 3000);
  const session = await textOf(d, "SignInSessionOnly").catch(() => "");
  await screenshot(d, "signin-review").catch(() => undefined);
  await rows.row("signin-version", () => ({ ok: !scope, detail: `${scope ? "SignInSigningScope offered: 0.2 (a VTC with VTI #2190)" : "no SignInSigningScope: 0.1, the fallback every VTC answers today"}; session line "${session.slice(0, 90)}"` }));

  // 4. Approve with the fingerprint: Keyring's UV key prompts for biometrics.
  await tapBelow(d, "SignInApprove");
  let touched = 0;
  for (const until = Date.now() + 30000; Date.now() < until; await sleep(1000)) {
    await uvBroken(d);
    // Let the prompt animate in first: a touch before it has is dropped ("couldn't confirm it's you"); then lift.
    if (authWindow()) { await sleep(2500); adb("emu", "finger", "touch", "1"); await sleep(1000); adb("emu", "finger", "remove", "1"); touched++; await sleep(2000); if (!authWindow()) break; }
    else if (touched) break;
    else if (await existsTestId(d, "SignInResult", 500)) break;
  }
  console.log(`[e2e] ${PLATFORM === "ios" ? "Face ID: answered by the leg's watcher" : process.env.SIGNIN_UV === "pin" ? "device PIN: answered by the leg's watcher" : `fingerprint touches at Approve: ${touched}`}`);
  const r = await portal.awaitRedeem(req);
  await rows.row("signin-approved", () => ({
    ok: r.state === "approved" && r.subject === memberDid && (r.amr ?? []).includes("uv"),
    detail: r.state === "approved" ? `verified with ${VERIFIED_BY} · redeem approved: subject ${r.subject === memberDid ? "= the phone's member DID" : `${r.subject} (member ${memberDid})`} · amr ${JSON.stringify(r.amr)} · notAfter ${r.notAfter}` : `redeem ${r.state}: ${JSON.stringify(r).slice(0, 160)}`,
  }));
  await uvBroken(d);
  const result = await waitForTestId(d, "SignInResult", 60000).then(() => true, () => false);
  const said = result ? await textOf(d, "SignInResultMessage").catch(() => "") : "";
  await screenshot(d, "signin-result").catch(() => undefined);
  await rows.row("signin-phone-done", () => ({ ok: result && !/couldn't|failed|not signed in/i.test(said), detail: `SignInResult ${result} · "${said.slice(0, 120)}"` }));
  if (await existsTestId(d, "SignInDone", 3000)) await tapTestId(d, "SignInDone", 10000).catch(() => undefined);
} catch (e) {
  rows.fatal(e);
  if (d) await screenshot(d, "signin-failure").catch(() => undefined);
} finally {
  if (memberDid) { const rm = admin.removeMember(memberDid, "signin leg cleanup"); console.log(`[cleanup] member ${memberDid.slice(-24)} removed: ${rm.status}`); }
  rows.summary();
  process.exitCode = rows.exitCode();
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
process.exit(process.exitCode ?? 0);
