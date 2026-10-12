#!/usr/bin/env node
/**
 * Over-the-air updates on a store build (the OTA plan's ring-0 smoke and rollback rows), against a throwaway update
 * server. Android first. In order, each row needing the one before:
 *   ota-embedded        a fresh install runs its embedded bundle: Developer → OtaBundleId reads "embedded (…)"
 *   ota-join-ring0      "Join ring 0" moves the install to ring0 (OtaRing)
 *   ota-applies         a published JS-only bundle runs after two cold starts (the first downloads and stages it)
 *   ota-crash-rollback  a bundle that throws while its JS loads is caught and the app comes back on the previous one:
 *                       only with evidence the path ran (the server served that bundle, and the app lists it under
 *                       OtaRolledBack), never just because the app is still on the previous bundle
 *   ota-withdraw        withdrawing the bundle (bundle disable) returns the app to its embedded bundle after two cold
 *                       starts, and the app still reaches Home
 * The server-side moves are e2e/gate/ci/ota-ctl.sh (OTA_CTL). Between cold starts the leg waits on the server's check
 * log (OTA_SERVER_LOG, OTA_LOG_CHECKS=1) for the download or check it expects, not on a fixed sleep. Before each move
 * it checks the update server answers through the tunnel (OTA_PUBLIC_URL): when it does not, it prints
 * "ENV update server unreachable through the tunnel" and exits 2, a verdict on the environment, not the app.
 * Rows through lib/rows.js: exit 0 all pass or skipped, 3 any fail, 1 the run broke, 2 the environment.
 *   PLATFORM=android UDID=<emulator serial> E2E_RELEASE=1 OTA_CTL=e2e/gate/ci/ota-ctl.sh node run-ota.mjs
 */
import "./lib/cli-guard.js";
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { byTestId, ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { completeOnboarding, openDeveloperScreen, restartApp } from "./lib/flows.js";
import { makeDriver } from "./lib/keyringRoles.js";
import { createRows } from "./lib/rows.js";
import { crashRolledBack, servedPattern } from "./lib/otaEvidence.js";

const BID = process.env.E2E_APP_ID || "asml.bkc.harvard.wallet";
const PLATFORM = process.env.PLATFORM === "android" ? "android" : "ios";
const CTL = process.env.OTA_CTL || "e2e/gate/ci/ota-ctl.sh";
const run = promisify(execFile);
const SERVER_LOG = process.env.OTA_SERVER_LOG;
const PUBLIC_URL = process.env.OTA_PUBLIC_URL;

/** The server's log so far, and its lines since a byte offset (where a wait began). */
const logSize = () => { try { return statSync(SERVER_LOG).size; } catch { return 0; } };
const logSince = (from) => { try { return readFileSync(SERVER_LOG).subarray(from).toString("utf8"); } catch { return ""; } };

/** Waits up to `ms` for a server-log line matching `re` after byte `from`; true when it came. */
async function waitForServer(re, from, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(2000)) if (re.test(logSince(from))) return true;
  return re.test(logSince(from));
}

/** The update server through the tunnel the APK was built against; a dead tunnel is the environment's, not the app's. */
async function serverUp() {
  for (let i = 0; i < 3; i++) {
    const ok = await fetch(`${PUBLIC_URL}/hot-updater/version`, { signal: AbortSignal.timeout(15000) }).then((r) => r.ok, () => false);
    if (ok) return;
    await sleep(5000);
  }
  console.log("ENV update server unreachable through the tunnel");
  rows.summary();
  process.exit(2);
}
const rows = createRows({
  label: "ota",
  needs: { "ota-join-ring0": ["ota-embedded"], "ota-applies": ["ota-join-ring0"], "ota-crash-rollback": ["ota-applies"], "ota-withdraw": ["ota-applies"] },
});

/**
 * The server-side move; returns the bundle id it printed ("id=…"), if any. A publish takes minutes on a runner, longer
 * than Appium's idle timeout (300 s on Android), so the session is kept alive with a light command every minute.
 */
async function ctl(d, ...args) {
  await serverUp();
  const keepAlive = setInterval(() => d.getWindowSize().catch(() => undefined), 60000);
  try {
    const { stdout } = await run("bash", [CTL, ...args], { encoding: "utf8", timeout: 20 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }).catch((e) => {
      // What ota-ctl.sh printed is the reason (ota-deploy's refusal, say): show it before failing the row.
      process.stdout.write(`${String(e.stdout || "")}${String(e.stderr || "")}`.split("\n").map((l) => `[ota-ctl] ${l}`).join("\n") + "\n");
      throw new Error(`ota-ctl ${args.join(" ")} failed (exit ${e.code}): ${String(e.stdout || "").trim().split("\n").slice(-2).join(" | ")}`);
    });
    process.stdout.write(stdout.split("\n").map((l) => `[ota-ctl] ${l}`).join("\n") + "\n");
    return (stdout.match(/^id=(\S+)$/m) || [])[1];
  } finally {
    clearInterval(keepAlive);
  }
}

/** What the Developer screen says: the running bundle (OtaBundleId's label) and the ring (OtaRing's). */
async function otaState(d) {
  // Already on the Developer screen (right after Join ring 0): the tab bar is not there to navigate from.
  if (!(await existsTestId(d, "OtaRing", 2000))) await openDeveloperScreen(d);
  const label = async (key) => {
    const el = await scrollToTestId(d, key).catch(() => byTestId(d, key));
    return (await el.getAttribute(PLATFORM === "android" ? "content-desc" : "label").catch(() => "")) || "";
  };
  return { bundle: await label("OtaBundleId"), ring: await label("OtaRing"), rolledBack: await label("OtaRolledBack") };
}

/**
 * Two cold starts: the first checks and downloads, the second runs what was staged. Between them it waits for the
 * server to see what the first start should do: the download of bundle `id` (its manifest or archive), or, with no id
 * (a withdrawal), the first start's update check. Returns what the waits saw and the state after.
 */
async function twoColdStarts(d, id) {
  await serverUp();
  const from = logSize();
  await restartApp(d);
  const served = await waitForServer(servedPattern(id), from, 120000);
  await sleep(id ? 15000 : 3000); // the download finishes and is staged after its first request
  await restartApp(d);
  return { served, ...(await otaState(d)) };
}

let d;
let good;
try {
  await serverUp();
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
    good = await ctl(d, "publish");
    const s = await twoColdStarts(d, good);
    return { ok: Boolean(good) && s.bundle.includes(good), detail: `published ${good}; served ${s.served ? "yes" : "NO"}; running "${s.bundle}"` };
  });

  await rows.row("ota-crash-rollback", async () => {
    const bad = await ctl(d, "crash");
    try {
      // Start 1 downloads and stages the crash bundle; start 2 runs it, and it throws while its JS loads.
      await serverUp();
      const from = logSize();
      await restartApp(d);
      const served = await waitForServer(servedPattern(bad), from, 120000);
      await sleep(15000);
      await d.terminateApp(BID).catch(() => undefined);
      await d.activateApp(BID).catch(() => undefined);
      await sleep(20000);
      // The loader may relaunch the app on the previous bundle at once (seen on a device); the plan's criterion is
      // "rolled back on the next cold start", so the leg reopens it like a user would and records which happened.
      const front = await d.getCurrentPackage().catch(() => "?");
      const relaunched = front === BID;
      console.log(`[ota] after the crash start the foreground is ${front}: ${relaunched ? "the app (relaunched by itself)" : "not the app (it closed)"}`);
      await restartApp(d);
      const s = await otaState(d);
      const home = await existsTestId(d, "Settings", 5000);
      const v = crashRolledBack({ served, rolledBackLabel: s.rolledBack, running: s.bundle, good, bad, home });
      return {
        ok: v.ok,
        detail: `crash bundle ${bad}: served ${served ? "yes" : "NO"}, rolled back ${v.rolledBack ? "yes" : `NO ("${s.rolledBack}")`}, ${relaunched ? "relaunched by itself" : "closed, reopened"}; running "${s.bundle}" (want ${good}); Home ${home ? "reached" : "NOT reached"}`,
      };
    } finally {
      await ctl(d, "disable", bad).catch((e) => console.log(`[ota] could not disable the crash bundle: ${e.message}`)); // never left enabled behind the next row
    }
  });

  await rows.row("ota-withdraw", async () => {
    await ctl(d, "disable", good);
    const s = await twoColdStarts(d, null);
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
