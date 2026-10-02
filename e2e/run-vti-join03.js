/**
 * Single-device: joining a community that serves join 0.3
 * (`vtc/join-requests/manifest/0.3`, `submit/0.3`) through the Join screen's
 * "ways in" card (keyring-bifold #251 on the model of #252).
 *
 * The phone is already linked to its agent (run-vta-link.js with E2E_KEEP_APP=1).
 *
 *   MODE=view          open "what it asks" for the community and record the card
 *   MODE=plain         the same, then Ask to join with nothing in hand → the
 *                      community refers it to an administrator → the screen says
 *                      so → this runner, as the administrator, approves it →
 *                      Check again → member, on the screen AND in the
 *                      community's own member list
 *   MODE=notaccepting  the community publishes no criteria: the card says it is
 *                      not accepting applications, and offers no way to ask
 *
 * The community's default criteria are, in its order: `invited` (automatic),
 * `member-credential` (automatic), `review` (review, requires nothing). So with
 * nothing in hand the suggested way is `review`, and meeting it means an
 * administrator decides — never that the person is admitted.
 *
 * Usage: PLATFORM=ios UDID=… KEYRING_COMMUNITY_DID=… KEYRING_COMMUNITY_REST=…
 *        KEYRING_COMMUNITY_ADMIN_CRED=… [KEYRING_COMMUNITY_NAME=…] MODE=plain node run-vti-join03.js
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { dumpSource, ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestIdByCoordinates, waitForTestId } from "./lib/driver.js";
import { handleBiometricConfirmIfPresent, pasteLinkFromHome } from "./lib/flows.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { printFailure, printSuccess } from "./lib/banner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = path.resolve(here, "../tsp-reference/ref-20-local-vetting/vtc-admin.mjs");
const PLATFORM = process.env.PLATFORM || "ios";
const UDID = PLATFORM === "android" ? process.env.ANDROID_UDID || process.env.UDID : process.env.UDID;
const MODE = process.env.MODE || "view";
const DID = process.env.KEYRING_COMMUNITY_DID;
const REST = process.env.KEYRING_COMMUNITY_REST;
const CRED = process.env.KEYRING_COMMUNITY_ADMIN_CRED;
const NAME = process.env.KEYRING_COMMUNITY_NAME || "Join 03 test";
const TAG = process.env.SHOT_TAG || MODE;
if (!DID || !REST || !CRED) throw new Error("KEYRING_COMMUNITY_DID, KEYRING_COMMUNITY_REST and KEYRING_COMMUNITY_ADMIN_CRED are required");

const utc = () => new Date().toISOString().slice(11, 23) + "Z";
const log = (s) => console.log(`[e2e] ${utc()} ${s}`);
const WAYS = (process.env.JOIN_WAYS || "invited,member-credential,review").split(",");

/** One call as the community's administrator; the JSON it answered. */
function admin(...args) {
  const out = execFileSync("node", [ADMIN, REST, DID, CRED, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 90000 });
  return JSON.parse(out.slice(out.indexOf("\n{") + 1));
}
const text = async (d, id) => ((await existsTestId(d, id, 1500)) ? (await textOf(d, id).catch(() => "")).replace(/\s+/g, " ").trim() : null);

/** What the "what it asks" step is made of, by its test ids. */
async function readCard(d) {
  const card = {
    JoinWaysTitle: await text(d, "JoinWaysTitle"),
    JoinWays: await existsTestId(d, "JoinWays", 1500),
    JoinWaysSeveral: await existsTestId(d, "JoinWaysSeveral", 1000),
    JoinWaysMissing: await existsTestId(d, "JoinWaysMissing", 1000),
    // The id is on the card, not on its sentence: its presence is the fact, the words are in the page source.
    JoinNotAccepting: await existsTestId(d, "JoinNotAccepting", 1500),
    JoinVersionUnsupported: await existsTestId(d, "JoinVersionUnsupported", 1000),
    JoinChanged: await existsTestId(d, "JoinChanged", 1000),
    JoinAsks: await existsTestId(d, "JoinAsks", 1000),
    JoinNoInvitationBypass: await existsTestId(d, "JoinNoInvitationBypass", 1000),
    ways: {},
  };
  for (const id of WAYS) {
    await scrollToTestId(d, `JoinWay_${id}`, 2).catch(() => undefined);
    card.ways[id] = { row: await existsTestId(d, `JoinWay_${id}`, 1500), follows: await text(d, `JoinWayFollows_${id}`) };
  }
  card.JoinWaySuggested = await text(d, "JoinWaySuggested");
  await scrollToTestId(d, "JoinStart", 3).catch(() => undefined);
  card.JoinStart = await text(d, "JoinStart");
  card.JoinGoInvited = await existsTestId(d, "JoinGoInvited", 1000);
  return card;
}

let d;
try {
  await ensureAppium();
  d = await makeDriver({ platform: PLATFORM, udid: UDID, deviceName: process.env.IOS_DEVICE_NAME, keepState: true });
  await unlockToHome(d);
  const t0 = Date.now();
  await pasteLinkFromHome(d, `keyring://vti/community?d=${encodeURIComponent(DID)}&n=${encodeURIComponent(NAME)}`);
  await waitForTestId(d, "JoinWaysTitle", 90000);
  log(`"what it asks" shown after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const card = await readCard(d);
  log(`card ${JSON.stringify(card)}`);
  await scrollToTestId(d, "JoinWaysTitle", 4).catch(() => undefined);
  await screenshot(d, `join03-${TAG}-card`);
  await dumpSource(d, `join03-${TAG}-card`);
  if (card.JoinAsks || card.JoinNoInvitationBypass) throw new Error("the 0.2 card (JoinAsks / JoinNoInvitationBypass) is shown for a 0.3 community");

  if (MODE === "notaccepting") {
    if (!card.JoinNotAccepting) throw new Error("no JoinNotAccepting for a community that publishes no criteria");
    if (card.JoinWays || card.JoinStart !== null) throw new Error(`a way in is offered by a community that accepts no applications: ${JSON.stringify(card)}`);
    printSuccess("JOIN 0.3 — not accepting: the card says so and offers no way to ask");
  } else {
    if (!card.JoinWays) throw new Error("no JoinWays card");
    const missing = WAYS.filter((id) => !card.ways[id].row);
    if (missing.length) throw new Error(`no row for ${missing.join(", ")}`);
    if (MODE === "view") printSuccess(`JOIN 0.3 — the card: suggested "${card.JoinWaySuggested}", button "${card.JoinStart}"`);
  }

  if (MODE === "plain") {
    if (!/review/i.test(card.ways.review?.follows ?? "")) throw new Error(`the review way does not say an administrator decides: "${card.ways.review?.follows}"`);
    const before = new Set((admin("join-list").items ?? []).map((r) => r.id));
    await (await waitForTestId(d, "JoinStart", 30000)).click();
    await waitForTestId(d, "JoinMakeIdentity", 30000);
    await tapTestIdByCoordinates(d, "JoinAsContinue");
    await handleBiometricConfirmIfPresent(d);
    const t1 = Date.now();
    await waitForTestId(d, "JoinStanding", 240000);
    const pending = await text(d, "JoinStandingText");
    log(`after Ask to join (${((Date.now() - t1) / 1000).toFixed(1)} s): "${pending}"`);
    await screenshot(d, `join03-${TAG}-pending`);
    if (/you're a member|you are a member/i.test(pending ?? "")) throw new Error(`a plain request was admitted without an administrator: "${pending}"`);

    // The community's side: one new request, pending.
    let request;
    for (const until = Date.now() + 60000; Date.now() < until && !request; await sleep(3000)) {
      request = (admin("join-list").items ?? []).find((r) => !before.has(r.id));
    }
    if (!request) throw new Error("the community lists no new join request");
    log(`community: request ${request.id} status=${request.status} applicant=${String(request.applicantDid).slice(-24)}`);
    if (request.status !== "pending") throw new Error(`the request is "${request.status}" at the community, not pending`);
    if ((admin("members").items ?? []).some((m) => m.did === request.applicantDid)) throw new Error("the applicant is already a member before any approval");

    // The administrator approves.
    const decided = admin("join-decide", request.id, "approved");
    log(`admin approved: ${JSON.stringify(decided).slice(0, 160)}`);
    const t2 = Date.now();
    let standing = pending;
    for (const until = Date.now() + 180000; Date.now() < until; await sleep(4000)) {
      if (await existsTestId(d, "JoinCheckAgain", 1000)) await (await waitForTestId(d, "JoinCheckAgain", 5000)).click().catch(() => undefined);
      await sleep(3000);
      standing = await text(d, "JoinStandingText");
      if (/member of/i.test(standing ?? "")) break;
    }
    log(`after the approval (${((Date.now() - t2) / 1000).toFixed(1)} s): "${standing}"`);
    await screenshot(d, `join03-${TAG}-member`);
    if (!/member of/i.test(standing ?? "")) throw new Error(`the screen does not show membership after the approval: "${standing}"`);
    const member = (admin("members").items ?? []).find((m) => m.did === request.applicantDid);
    if (!member) throw new Error("the community does not list the applicant as a member after the approval");
    log(`community: member ${String(member.did).slice(-24)} role=${member.role} joinedViaInvitation=${member.joinedViaInvitation}`);
    printSuccess("JOIN 0.3 — plain request: referred, approved by an administrator, member on the screen and at the community");
  }
} catch (err) {
  printFailure("vti-join03", err);
  if (d) {
    await screenshot(d, `join03-${TAG}-failure`).catch(() => undefined);
    await dumpSource(d, `join03-${TAG}-failure`).catch(() => undefined);
  }
  process.exitCode = 1;
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
