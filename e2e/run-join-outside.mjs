#!/usr/bin/env node
/**
 * IN-149 (bifold #363), read-only: an outside community's Join (OUTSIDE_VTC_DID) lists "Meet a vetter" among the
 * usable ways, under "One vetter must confirm who you are", not behind "See them" (JoinWaysOthersToggle, which renders
 * the other ways only when opened). Opens Join from the community's link and reads; taps nothing on Join, joins nothing.
 * Row: outside-join-meet-vetter. Exit 0 pass, 3 fail, 1 broke.
 *   E2E_APP_ID=… UDID=emulator-5572 OUTSIDE_VTC_DID=… node run-join-outside.mjs
 */
import "./lib/cli-guard.js";
import { ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium } from "./lib/driver.js";
import { makeDriver, unlockToHome } from "./lib/keyringRoles.js";
import { pasteLinkFromHome } from "./lib/flows.js";

const DID = process.env.OUTSIDE_VTC_DID;
let d;
try {
  if (!DID) throw new Error("OUTSIDE_VTC_DID is required");
  await ensureAppium();
  d = await makeDriver({ platform: "android", udid: process.env.UDID, keepState: true });
  await d.activateApp(process.env.E2E_APP_ID);
  await unlockToHome(d).catch(async (e) => {
    if (!(await existsTestId(d, "MyAgent", 10000))) throw e;
  });
  await pasteLinkFromHome(d, `keyring://vti/community?d=${encodeURIComponent(DID)}`);
  const ways = Boolean(await scrollToTestId(d, "JoinWays", 6, { from: 0.5 }).catch(() => undefined)) || (await existsTestId(d, "JoinWays", 30000));
  await sleep(2000);
  let src = await d.getPageSource();
  const pos = (re) => {
    const m = src.match(new RegExp(`<[^>]*(?:text|content-desc)="[^"]*${re}[^"]*"[^>]*bounds="\\[\\d+,(\\d+)\\]`, "i"));
    return m ? Number(m[1]) : undefined;
  };
  let meet = pos("Meet a vetter");
  if (meet === undefined) {
    // Further down the card: scroll once and look again (still no tap on Join).
    await scrollToTestId(d, "JoinWaysOthersToggle", 3, { from: 0.6 }).catch(() => undefined);
    src = await d.getPageSource();
    meet = pos("Meet a vetter");
  }
  // The vetter's way in, as 239 words it (the request's "One vetter must confirm who you are" was a paraphrase).
  const heading = pos("A statement from one of its vetters");
  const toggle = (src.match(/resource-id="com\.ariesbifold:id\/JoinWaysOthersToggle"[^>]*bounds="\[\d+,(\d+)\]/) || [])[1];
  const toggleY = toggle === undefined ? undefined : Number(toggle);
  await screenshot(d, "outside-join-meet-vetter").catch(() => undefined);
  const ok = ways && meet !== undefined && heading !== undefined && heading < meet && (toggleY === undefined || meet < toggleY);
  console.log(`ROW outside-join-meet-vetter ${ok ? "PASS" : "FAIL"} — JoinWays ${ways} · "A statement from one of its vetters" ${heading !== undefined ? `at y ${heading}` : "absent"} · "Meet a vetter" ${meet !== undefined ? `at y ${meet}` : "not shown without opening See them"} · See them ${toggleY !== undefined ? `at y ${toggleY}` : "absent"} (IN-149; read-only, nothing tapped on Join)`);
  await d.back().catch(() => undefined);
  process.exitCode = ok ? 0 : 3;
} catch (e) {
  console.log(`LEG join-outside BROKEN — ${String(e.message).split("\n")[0]}`);
  if (d) await screenshot(d, "outside-join-failure").catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
