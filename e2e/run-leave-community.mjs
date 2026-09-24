#!/usr/bin/env node
/**
 * Leave a community from the phone (220, keyring-bifold#105): the community is
 * told (members/self-remove), not only the phone. On a phone that is already a
 * member (E2E_KEEP_STATE=1, after an invite or a vetting run):
 *
 *   My Agent → the community's row → Leave community → the confirmation says
 *   what happens and asks what to keep (Erase is the default) → Leave → a toast
 *   says what the community applied → the phone no longer lists the community.
 *
 * With MEMBER_DID (the phone's persona for the community) and the community's
 * admin env, the community's own member list is read before and after: the
 * person must be on it before and gone after a purge.
 *
 *   E2E_KEEP_STATE=1 PLATFORM=ios IOS_DEVICE_NAME="…" IOS_APP=… \
 *   KEYRING_COMMUNITY_DID=… KEYRING_COMMUNITY_REST=… KEYRING_COMMUNITY_ADMIN_CRED=… \
 *   MEMBER_DID=… LEAVE_KEEP=purge|tombstone node run-leave-community.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSession, ensureAppium, stopAppium, screenshot, sleep, existsTestId, waitForTestId, tapTestId, scrollToTestId } from "./lib/driver.js";
import { unlockIfLocked } from "./lib/flows.js";
import { androidCaps, iosCaps } from "./lib/config.js";
import { printFailure, printSuccess } from "./lib/banner.js";
import { assertNoDidShown } from "./lib/gateChecks.js";

const platform = process.env.PLATFORM || "ios";
const KEEP = process.env.LEAVE_KEEP || "purge";
const MEMBER_DID = process.env.MEMBER_DID || "";
const here = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = path.resolve(here, "../tsp-reference/ref-20-local-vetting/vtc-admin.mjs");

/** Whether the community lists this DID as a member (read-only, as its admin). */
function communityLists(did) {
  const { KEYRING_COMMUNITY_REST: rest, KEYRING_COMMUNITY_DID: vtc, KEYRING_COMMUNITY_ADMIN_CRED: cred } = process.env;
  if (!did || !rest || !vtc || !cred) return undefined;
  const out = execFileSync("node", [ADMIN, rest, vtc, cred, "members"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.includes(did);
}

let driver;
try {
  if (process.env.E2E_KEEP_STATE !== "1") throw new Error("leaving needs a phone that is already a member: set E2E_KEEP_STATE=1");
  if (!["purge", "tombstone"].includes(KEEP)) throw new Error(`LEAVE_KEEP must be purge or tombstone, not ${KEEP}`);
  const listedBefore = communityLists(MEMBER_DID);
  if (listedBefore === false) throw new Error(`the community does not list ${MEMBER_DID.slice(0, 40)}… before leaving`);
  if (listedBefore) console.log("[e2e] the community lists the member before leaving");

  await ensureAppium();
  const caps = platform === "android" ? androidCaps() : iosCaps();
  driver = await createSession(platform, { ...caps, "appium:fullReset": false, "appium:noReset": true, "appium:enforceAppInstall": false });
  await waitForTestId(driver, "EnterPIN", 120000).catch(() => undefined);
  await unlockIfLocked(driver);
  await waitForTestId(driver, "Contacts", 300000);

  // The community, from the agent screen.
  await (await waitForTestId(driver, "MyAgent", 30000)).click();
  await sleep(1500);
  if (!(await existsTestId(driver, "AgentHome", 3000))) {
    const open = await scrollToTestId(driver, "OpenYourAgentButton", 4).catch(() => undefined);
    if (open) await open.click();
  }
  const row = await scrollToTestId(driver, "AgentMembershipRow", 6).catch(() => undefined);
  if (!row) throw new Error("the agent screen lists no community membership");
  await row.click();

  // Leave: asked first, in words, with what to keep.
  const leave = await scrollToTestId(driver, "LeaveCommunityButton", 6).catch(() => undefined);
  if (!leave) throw new Error("the community screen offers no Leave");
  await leave.click();
  await waitForTestId(driver, "LeaveCommunityConfirmCard", 10000);
  await assertNoDidShown(driver, "the leave confirmation");
  const choice = KEEP === "purge" ? "LeaveCommunityPurge" : "LeaveCommunityTombstone";
  if (KEEP === "tombstone") await tapTestId(driver, choice, 5000);
  await screenshot(driver, "leave-confirm");
  await (await scrollToTestId(driver, "LeaveCommunityConfirm", 4)).click();

  // What the community applied, said; then the community is gone from the phone.
  // The toast's title (BaseToast: ToastTitle).
  let words = "";
  for (const until = Date.now() + 60000; Date.now() < until && !words; ) {
    if (await existsTestId(driver, "ToastTitle", 2000)) {
      words = ((await driver.$(`~${"com.ariesbifold:id/"}ToastTitle`).getAttribute("label").catch(() => "")) || "").trim();
      if (driver.e2ePlatform === "android") {
        words = ((await driver
          .$('android=new UiSelector().resourceId("com.ariesbifold:id/ToastTitle")')
          .getText()
          .catch(() => "")) || "").trim();
      }
    } else if (await existsTestId(driver, "CommunityError", 500)) {
      await screenshot(driver, "leave-refused");
      throw new Error("leaving was refused (CommunityError)");
    }
  }
  if (!words) {
    await screenshot(driver, "leave-no-word");
    throw new Error("nothing said what happened after Leave");
  }
  console.log(`[e2e] after Leave: "${words}"`);
  if (KEEP === "purge" && !/erased your record|no longer had you/.test(words)) throw new Error(`asked to erase, but: "${words}"`);
  await sleep(3000);
  if (await existsTestId(driver, "AgentMembershipRow", 3000)) {
    await screenshot(driver, "leave-still-listed");
    throw new Error("the phone still lists the community after Leave");
  }
  console.log("[e2e] the phone no longer lists the community");

  const listedAfter = communityLists(MEMBER_DID);
  if (listedAfter === true && KEEP === "purge") throw new Error("the community still lists the member after a purge");
  if (listedAfter === false) console.log("[e2e] the community no longer lists the member");

  printSuccess(`LEAVE COMMUNITY — ${KEEP}`);
} catch (err) {
  printFailure("LEAVE COMMUNITY", err);
  process.exitCode = 1;
} finally {
  await driver?.deleteSession().catch(() => undefined);
  stopAppium();
}
