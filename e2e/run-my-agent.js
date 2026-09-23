/**
 * Single-device: the My Agent tab against a local VTI stack, through the
 * screens a person actually uses — no developer screen.
 *
 *   My Agent → Connect my agent → agent host + the identity you present
 *            → a community → what it asks → Apply to join → their answer
 *
 * This is S1/S3/S4/S5 of `community_vetting_subtask.md` §7.1. The stack's DIDs
 * are baked into `app/.env` as VTI_MEDIATOR_DID / VTI_COMMUNITY_DID.
 *
 * Usage: PLATFORM=android node run-my-agent.js   (or PLATFORM=ios)
 */
import {
  createSession,
  ensureAppium,
  stopAppium,
  screenshot,
  dumpSource,
  sleep,
  waitForTestId,
  byTestId,
  tapTestId,
  existsTestId,
} from "./lib/driver.js";
import { androidCaps, iosCaps } from "./lib/config.js";
import { completeOnboarding, unlockIfLocked, dismissTourIfPresent, openMyAgentPanel } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";

const platform = process.env.PLATFORM || "android";
const keepState = process.env.E2E_KEEP_STATE === "1";

/** iOS exposes a Text's content as its label; Android as its text. */
const textOf = async (driver, key) =>
  (await byTestId(driver, key).getAttribute(driver.e2ePlatform === "ios" ? "label" : "text")) || "";

let driver;
try {
  await ensureAppium();
  const caps = platform === "android" ? androidCaps() : iosCaps();
  driver = await createSession(
    platform,
    keepState
      ? { ...caps, "appium:fullReset": false, "appium:noReset": true, "appium:enforceAppInstall": false }
      : undefined
  );

  if (keepState) {
    await waitForTestId(driver, "EnterPIN", 120000).catch(() => undefined);
    await unlockIfLocked(driver);
    await waitForTestId(driver, "Contacts", 300000);
    await sleep(5000);
  } else {
    await completeOnboarding(driver, { firstName: "Vti", lastName: "Member" });
  }
  await dismissTourIfPresent(driver);

  // Everything below reads operator-panel ids (MyAgentCard, MyAgentHost,
  // MyAgentCommunityRow); a linked phone lands on the agent home instead
  // (keyring-bifold#11), so walk the extra screen first.
  await openMyAgentPanel(driver);
  // The session outlives a screen but not the app process, so a run that
  // follows another one in the same process opens straight onto the agent card.
  if (await existsTestId(driver, "ConnectMyAgentButton", 15000)) {
    await screenshot(driver, "my-agent-s1-not-connected");
    await tapTestId(driver, "ConnectMyAgentButton");
    console.log(`[e2e] ${driver.e2ePlatform}: connecting the agent`);
  } else {
    console.log(`[e2e] ${driver.e2ePlatform}: agent already connected, reusing the session`);
  }
  // Resolve, log in, open the socket — a few round trips through a tunnel.
  await waitForTestId(driver, "MyAgentCard", 60000);
  const host = await textOf(driver, "MyAgentHost");
  const did = await textOf(driver, "MyAgentDid");
  console.log(`[e2e] ${driver.e2ePlatform}: connected to ${host} as ${did}`);
  if (!host) throw new Error("the agent card shows no host");
  if (!did.startsWith("did:")) throw new Error(`the agent card shows no member DID: ${did}`);
  await screenshot(driver, "my-agent-s4-connected");

  await tapTestId(driver, "MyAgentCommunityRow", 20000);
  await waitForTestId(driver, "CommunityCriteria", 60000);
  await screenshot(driver, "my-agent-s5-community");

  await tapTestId(driver, "ApplyToCommunityButton", 20000);
  console.log(`[e2e] ${driver.e2ePlatform}: applied`);

  // Two truthful outcomes. A first application gets a verdict — `requestMore`
  // on this stack, the community asking for a vetter's word, which is the
  // honest answer to an empty presentation. A second application from the same
  // member DID is refused instead: upstream returns a `taskFailed`
  // trust-task-error while a request is already open, and that request cannot
  // be withdrawn (ref-20 finding 8). The screen must show whichever it is.
  const settled = await Promise.race([
    waitForTestId(driver, "CommunityVerdict", 60000).then(() => "verdict"),
    waitForTestId(driver, "CommunityError", 60000).then(() => "refusal"),
  ]);
  await screenshot(driver, "my-agent-verdict");

  if (settled === "verdict") {
    const verdict = await textOf(driver, "CommunityVerdictEffect");
    console.log(`[e2e] ${driver.e2ePlatform}: verdict "${verdict}"`);
    const expected = ["requestMore", "allow", "deny", "refer"];
    if (!expected.includes(verdict)) {
      throw new Error(`the community answered with no usable verdict: "${verdict}"`);
    }
  } else {
    const refusal = await textOf(driver, "CommunityError");
    console.log(`[e2e] ${driver.e2ePlatform}: refused — ${refusal}`);
    if (!refusal) throw new Error("a refusal with no sentence to read");
  }

  printSuccess("my-agent");
  process.exitCode = 0;
} catch (err) {
  printFailure("my-agent", err);
  if (driver) {
    try {
      await screenshot(driver, "my-agent-failure");
      await dumpSource(driver, "my-agent-failure");
    } catch {
      /* ignore */
    }
  }
  process.exitCode = 1;
} finally {
  if (driver) {
    try {
      await driver.deleteSession();
    } catch {
      /* ignore */
    }
  }
  stopAppium();
}
