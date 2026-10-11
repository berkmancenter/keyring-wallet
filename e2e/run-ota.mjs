#!/usr/bin/env node
/**
 * Over-the-air updates on a store build (the OTA plan's ring-0 smoke and rollback rows), against a throwaway update
 * server. Android first. In order, each row needing the one before:
 *   ota-embedded        a fresh install runs its embedded bundle: Developer → OtaBundleId reads "embedded (…)"
 *   ota-join-ring0      "Join ring 0" moves the install to ring0 (OtaRing)
 *   ota-applies         a published JS-only bundle runs after two cold starts (the first downloads and stages it)
 *   ota-crash-rollback  a bundle that throws while its JS loads is caught and the app comes back on the previous one
 *   ota-withdraw        withdrawing the bundle (bundle disable) returns the app to its embedded bundle after two cold
 *                       starts, and the app still reaches Home
 * The server-side moves are e2e/gate/ci/ota-ctl.sh (OTA_CTL). Rows through lib/rows.js: exit 0 all pass or skipped,
 * 3 any fail, 1 the run broke.
 *   PLATFORM=android UDID=<emulator serial> E2E_RELEASE=1 OTA_CTL=e2e/gate/ci/ota-ctl.sh node run-ota.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { byTestId, ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { completeOnboarding, openDeveloperScreen, restartApp } from "./lib/flows.js";
import { makeDriver } from "./lib/keyringRoles.js";
import { createRows } from "./lib/rows.js";

const BID = process.env.E2E_APP_ID || "asml.bkc.harvard.wallet";
const PLATFORM = process.env.PLATFORM === "android" ? "android" : "ios";
const CTL = process.env.OTA_CTL || "e2e/gate/ci/ota-ctl.sh";
const rows = createRows({
  label: "ota",
  needs: { "ota-join-ring0": ["ota-embedded"], "ota-applies": ["ota-join-ring0"], "ota-crash-rollback": ["ota-applies"], "ota-withdraw": ["ota-applies"] },
});

/** The server-side move; returns the bundle id it printed ("id=…"), if any. */
function ctl(...args) {
  const out = execFileSync("bash", [CTL, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 15 * 60 * 1000 });
  process.stdout.write(out.split("\n").map((l) => `[ota-ctl] ${l}`).join("\n") + "\n");
  return (out.match(/^id=(\S+)$/m) || [])[1];
}

/** What the Developer screen says: the running bundle (OtaBundleId's label) and the ring (OtaRing's). */
async function otaState(d) {
  // Already on the Developer screen (right after Join ring 0): the tab bar is not there to navigate from.
  if (!(await existsTestId(d, "OtaRing", 2000))) await openDeveloperScreen(d);
  const label = async (key) => {
    const el = await scrollToTestId(d, key).catch(() => byTestId(d, key));
    return (await el.getAttribute(PLATFORM === "android" ? "content-desc" : "label").catch(() => "")) || "";
  };
  return { bundle: await label("OtaBundleId"), ring: await label("OtaRing") };
}

/** Two cold starts: the first checks and stages, the second runs what was staged. Returns the state after. */
async function twoColdStarts(d) {
  await restartApp(d);
  await sleep(8000); // the update check arrives about 2 s after launch, the download a few seconds after that
  await restartApp(d);
  return otaState(d);
}

let d;
let good;
try {
  await ensureAppium();
  d = await makeDriver({ platform: PLATFORM, udid: process.env.UDID, keepState: true });
  rows.setDriver(d);
  await d.activateApp(BID);
  await completeOnboarding(d, { firstName: "Ota", lastName: "Leg" });

  await rows.row("ota-embedded", async () => {
    const s = await otaState(d);
    return { ok: s.bundle.startsWith("embedded"), detail: `running "${s.bundle}", ring "${s.ring}"` };
  });

  await rows.row("ota-join-ring0", async () => {
    await scrollToTestId(d, "OtaJoinRing0");
    await tapTestId(d, "OtaJoinRing0", 15000);
    await sleep(1000);
    const s = await otaState(d);
    return { ok: s.ring.includes("ring0"), detail: `ring "${s.ring}" after Join ring 0` };
  });

  await rows.row("ota-applies", async () => {
    good = ctl("publish");
    const s = await twoColdStarts(d);
    return { ok: Boolean(good) && s.bundle.includes(good), detail: `published ${good}; running "${s.bundle}"` };
  });

  await rows.row("ota-crash-rollback", async () => {
    const bad = ctl("crash");
    const s = await twoColdStarts(d);
    const home = await existsTestId(d, "Settings", 5000);
    ctl("disable", bad); // never left enabled behind the next row
    return { ok: s.bundle.includes(good) && !s.bundle.includes(bad) && home, detail: `crash bundle ${bad}; running "${s.bundle}" (want ${good}); Home ${home ? "reached" : "NOT reached"}` };
  });

  await rows.row("ota-withdraw", async () => {
    ctl("disable", good);
    const s = await twoColdStarts(d);
    const home = await existsTestId(d, "Settings", 5000);
    return { ok: s.bundle.startsWith("embedded") && home, detail: `withdrew ${good}; running "${s.bundle}"; Home ${home ? "reached" : "NOT reached"}` };
  });
} catch (e) {
  rows.fatal(e);
  if (d) await screenshot(d, "ota-failure").catch(() => undefined);
} finally {
  rows.summary();
  process.exitCode = rows.exitCode();
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
