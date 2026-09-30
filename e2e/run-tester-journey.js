/**
 * The tester's journey, in the tester's configuration — the pre-PR gate.
 *
 * TestFlight 206 shipped two bugs its testers found in minutes and no run of
 * ours could have: every run baked VTI_VTA_DID (TestFlight does not) and none
 * came back to My Agent after linking. This runner does what a tester does, on
 * a Release build with the TestFlight environment, from a fresh install:
 *
 *   A  link the agent by QR, then walk it as the LINKED agent
 *      (run-vta-link.js JOURNEY=1: back, tab switch, Get vetted, Join, Vet
 *      someone, I was invited, relaunch — "Linked" never comes back)
 *   B  "I was invited" end to end through the door
 *      (run-vti-invite.js INVITE_VIA=door: identity → invited → Join → member)
 *
 * The vetter-grant lifecycle is run-vetter-grant-lifecycle.js, on the suite's
 * vetter phone.
 *
 * It runs on its own simulator so the debug suite's state is left alone:
 *
 *   node run-tester-journey.js                           # builds, then runs
 *   IOS_APP=<prebuilt .app> node run-tester-journey.js   (scripts/build-testflight-sim.sh)
 *   PHASES=A …                                           # only the link and walk
 *
 * Needs the lab stack up; starts its own enrolment page on ENROL_PORT (8192;
 * 8190 is alice's for the TestFlight phone, 8191 the UI/UX session's).
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEVICE = process.env.IOS_DEVICE_NAME || "iPhone 17 Release repro";
const WDA = process.env.WDA_LOCAL_PORT || "8102";
const ENROL_PORT = process.env.ENROL_PORT || "8192";
const APP_ID = "asml.bkc.harvard.wallet";
const PHASES = (process.env.PHASES || "A,B").split(",");
// The runner VTA. alice is Alberto's TestFlight agent since 2026-09-22 and no
// runner links to, mints on or grants on it.
const RUNNER_VTA = process.env.RUNNER_VTA || "bob";
if (RUNNER_VTA === "alice") throw new Error("alice is reserved for the TestFlight phone — use a runner VTA");
const log = (m) => console.log(`[journey] ${m}`);

const app =
  process.env.IOS_APP ||
  execFileSync("bash", [path.join(here, "scripts/build-testflight-sim.sh")], { encoding: "utf8" }).trim().split("\n").pop();
log(`app ${app}`);
const env = {
  ...process.env,
  PLATFORM: "ios",
  IOS_APP: app,
  IOS_DEVICE_NAME: DEVICE,
  WDA_LOCAL_PORT: WDA,
  ENROL_PORT,
  RUNNER_VTA,
  E2E_KEEP_APP: "1",
};
const run = (script, extra) => execFileSync("node", [path.join(here, script)], { stdio: "inherit", env: { ...env, ...extra } });

const done = [];
try {
  if (PHASES.includes("A")) {
    // A fresh install, as a tester's first launch.
    const sims = JSON.parse(execFileSync("xcrun", ["simctl", "list", "devices", "-j"], { encoding: "utf8" })).devices;
    const sim = Object.values(sims).flat().find((s) => s.name === DEVICE && s.isAvailable);
    if (!sim) throw new Error(`no simulator named "${DEVICE}"`);
    if (sim.state !== "Booted") execFileSync("xcrun", ["simctl", "boot", sim.udid]);
    try {
      execFileSync("xcrun", ["simctl", "uninstall", sim.udid, APP_ID]);
    } catch {
      /* not installed */
    }
    log(`A: fresh install on ${DEVICE} (${sim.udid})`);
    run("run-vta-link.js", { JOURNEY: "1" });
    done.push("A link by QR + the linked agent's walk");
  }
  if (PHASES.includes("B")) {
    run("run-vti-invite.js", { INVITE_VIA: "door", E2E_KEEP_STATE: "1" });
    done.push("B I was invited → member");
  }
  for (const d of done) log(`✓ ${d}`);
  log(`PASSED on a Release build with the TestFlight environment (${path.basename(app)}, ${DEVICE})`);
} catch (err) {
  for (const d of done) log(`✓ ${d}`);
  log(`FAILED: ${err.message.split("\n")[0]}`);
  process.exitCode = 1;
}
