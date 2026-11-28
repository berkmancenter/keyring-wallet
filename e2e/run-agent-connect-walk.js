/**
 * Step 7.11's walk of agent connect on one emulator or simulator (docs/plans/agent-connect-plan.md §7.11; backlog 2,
 * Part R5): every catalogue state a running app can reach without a connected agent, each screenshotted beside its
 * canvas frame, and every other state listed as not reached with its reason. lib/agentConnectWalk.mjs is the plan.
 *
 * Needs:
 * - a test build with KEYRING_AGENT_CONNECT_BUILD=1 (test-builds.yml sets it; store builds refuse it), carrying the
 *   developer switch rows of #1126 (ToggleEnableAgentConnect);
 * - the lab stack up, with the phone linked to a lab VTA it administers (scripts/openvtc/local-vti-stack/up.sh):
 *   without it, the connect form ends at "not an administrator" and the walk says so at the first connect state.
 *
 * Output: the screenshots, and agent-connect-walk-<platform>.md, the pairs file the dated 7.11 companion is written
 * from, in the run directory (lib/runDir.js). A state that fails to reach its marker is recorded with the reason and the
 * walk goes on, so one broken route never hides the rest.
 *
 * WRITTEN, NOT YET RUN (2026-11-28): no device has walked these routes yet.
 *
 * Usage: PLATFORM=android node run-agent-connect-walk.js   (or PLATFORM=ios; E2E_KEEP_STATE=1 to reuse an install)
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { pairsFile, planWalk, readManifests } from "./lib/agentConnectWalk.mjs";
import { printFailure, printSuccess } from "./lib/banner.js";
import { TEST_ID_PREFIX, androidCaps, iosCaps } from "./lib/config.js";
import {
  byTestId,
  createSession,
  ensureAppium,
  existsTestId,
  screenshot,
  sleep,
  stopAppium,
  tapTestId,
  waitForTestId,
} from "./lib/driver.js";
import {
  completeOnboarding,
  ensureDeveloperToggle,
  restartApp,
  unlockIfLocked,
} from "./lib/flows.js";
import { runPath } from "./lib/runDir.js";

const platform = process.env.PLATFORM || "android";
const keepState = process.env.E2E_KEEP_STATE === "1";
const here = dirname(fileURLToPath(import.meta.url));
const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: here, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

/** The element with testID `within` whose accessibility label is `label` (a row of a list, picked by its words). */
function byLabelWithin(driver, label, within) {
  const full = `${TEST_ID_PREFIX}${within}`;
  if (driver.e2ePlatform === "android") {
    return driver.$(
      `android=new UiSelector().resourceId("${full}").description("${label}")`,
    );
  }
  return driver.$(
    `-ios predicate string:name == "${full}" AND label == "${label}"`,
  );
}

/** One step of a route or of a manifest. Each waits for its element; a step that cannot is the state's failure. */
async function step(driver, s) {
  if ("wait" in s) return waitForTestId(driver, s.wait, 60000);
  if ("tap" in s) return tapTestId(driver, s.tap, 30000);
  if ("press" in s) return tapTestId(driver, s.press, 30000);
  if ("type" in s) {
    const el = byTestId(driver, s.type);
    await el.waitForExist({ timeout: 30000 });
    await el.setValue(s.text);
    return;
  }
  if ("pressLabel" in s) {
    const el = byLabelWithin(driver, s.pressLabel, s.within);
    await el.waitForExist({ timeout: 30000 });
    await el.click();
    return;
  }
  throw new Error(`unknown step ${JSON.stringify(s)}`);
}

/** Back to the app's home between states: a fresh start, so no state's route depends on where the last one ended. */
async function home(driver) {
  await restartApp(driver);
  await waitForTestId(driver, "Contacts", 120000);
}

let driver;
const results = [];
const plan = planWalk(readManifests(`${here}/lib`));
try {
  await ensureAppium();
  const caps = platform === "android" ? androidCaps() : iosCaps();
  driver = await createSession(
    platform,
    keepState
      ? {
          ...caps,
          "appium:fullReset": false,
          "appium:noReset": true,
          "appium:enforceAppInstall": false,
        }
      : undefined,
  );
  if (keepState || (await existsTestId(driver, "Contacts", 5000))) {
    await waitForTestId(driver, "EnterPIN", 120000).catch(() => undefined);
    await unlockIfLocked(driver);
    await waitForTestId(driver, "Contacts", 300000);
  } else {
    await completeOnboarding(driver, { firstName: "Walk", lastName: "Agent" });
  }

  // The switch exists only in a build carrying agent connect; its row missing is the first thing the walk reports.
  if (!(await existsTestId(driver, "Settings", 15000)))
    throw new Error("no Settings in the tab bar");
  await ensureDeveloperToggle(
    driver,
    "ToggleEnableAgentConnect",
    "AI agents: connect an agent",
    { wantOn: true },
  );

  for (const p of plan.filter((x) => x.status === "walk")) {
    try {
      await home(driver);
      for (const s of p.steps) await step(driver, s);
      await waitForTestId(driver, p.marker, 30000);
      await sleep(800); // let the screen settle before the picture
      const file = await screenshot(driver, `walk-${p.id}`);
      results.push({ id: p.id, outcome: "reached", screenshot: file });
      console.log(`[walk] ${p.id}: reached`);
    } catch (err) {
      const why = String(err?.message ?? err).split("\n")[0];
      const file = await screenshot(driver, `walk-${p.id}-failed`).catch(
        () => "",
      );
      results.push({ id: p.id, outcome: `failed: ${why}`, screenshot: file });
      console.log(`[walk] ${p.id}: FAILED ${why}`);
    }
  }
} catch (err) {
  console.error(err);
  printFailure("agent-connect-walk");
  process.exitCode = 1;
} finally {
  const out = runPath(`agent-connect-walk-${platform}.md`);
  writeFileSync(
    out,
    pairsFile(plan, results, {
      platform,
      appCommit: git("rev-parse", "--short", "HEAD"),
      planCommit: git(
        "log",
        "-1",
        "--format=%h",
        "--",
        "../docs/plans/agent-connect-plan.md",
      ),
      date: new Date().toISOString().slice(0, 10),
    }),
  );
  console.log(`[walk] pairs file: ${out}`);
  const failed = results.filter((r) => r.outcome !== "reached").length;
  if (!process.exitCode && failed === 0) printSuccess("agent-connect-walk");
  else if (!process.exitCode) {
    printFailure(
      `agent-connect-walk (${failed} state(s) not reached by their route)`,
    );
    process.exitCode = 1;
  }
  if (driver) await driver.deleteSession().catch(() => undefined);
  stopAppium();
}
