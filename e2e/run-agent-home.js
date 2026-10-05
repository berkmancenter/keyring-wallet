/**
 * "Your agent" in its K6/K8 layout (bifold #297), on a phone already set up as
 * one of the gate's four people — it never installs, resets or wipes. The
 * counterpart of run-agent-segments.js, for the layout without segments.
 *
 *   A screenshot of each part, and what the screen must show there:
 *     - the header says "Your agent", with the agent's name under it;
 *     - before joining (new, applicant): the two doors lead, and there is no
 *       corner Join button;
 *     - after joining (member, vetter): the community cards come first, the
 *       doors sit behind the corner Join button, and opening it shows them;
 *     - each card has at most one filled button, judged scrolled to;
 *     - Your devices is in reach;
 *     - "Agent settings" is closed at first; opened, it holds Requests,
 *       "Ask me before…", Restore cards (with an identity), Unlink, the
 *       activity and Details — the agent's DID only once Details is opened;
 *     - a waiting approval shows its banner, and it opens Requests.
 *
 * Usage (the gate):
 *   PLATFORM=android ANDROID_UDID=emulator-5574 PERSON=member APPIUM_PORT=4763 node run-agent-home.js
 * PERSON names the screenshots: new | applicant | member | vetter.
 */
import { ensureAppium, stopAppium, tapTestId, existsTestId, scrollToTestId, screenshot, sleep, waitForTestId } from "./lib/driver.js";
import { buttonsOnScreen } from "./lib/filledButtons.js";
import { makeDriver } from "./lib/keyringRoles.js";
import { unlockIfLocked } from "./lib/flows.js";

const platform = process.env.PLATFORM ?? "android";
const person = process.env.PERSON ?? "person";
const udid = platform === "android" ? process.env.ANDROID_UDID : process.env.IOS_UDID;

const must = async (driver, id, where) => {
  if (!(await existsTestId(driver, id, 8000)) && !(await scrollToTestId(driver, id, 6).catch(() => undefined))) {
    await screenshot(driver, `home-${person}-missing-${id}`);
    throw new Error(`${where}: ${id} is not on the screen`);
  }
};
const mustNot = async (driver, id, where) => {
  if (await existsTestId(driver, id, 1500)) throw new Error(`${where}: ${id} should not be on the screen`);
};

/** The My Agent tab lands on "Your agent" once linked (as run-vta-link opens it). */
/**
 * From the Requests screen back to Your agent. Its own button shows only when nothing
 * waits, last in the list (scroll to it); else the header back, which is a plain stack
 * back to Your agent (RequestsHeaderBack when the screen was opened from a link).
 */
async function backFromRequests(driver) {
  const own = await scrollToTestId(driver, "RequestsBackToAgent", 4).catch(() => undefined);
  if (own) return own.click();
  // Opened from a notification link the screen has its own header back.
  if (await existsTestId(driver, "RequestsHeaderBack", 1000)) return tapTestId(driver, "RequestsHeaderBack", 5000);
  if (driver.e2ePlatform === "ios") {
    const back = driver.$('-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Back" OR label == "Back")');
    if (await back.isExisting().catch(() => false)) return back.click();
  }
  return driver.back();
}

async function openAgentHome(driver) {
  await (await waitForTestId(driver, "MyAgent", 30000)).click();
  await sleep(1500);
  if (await existsTestId(driver, "AgentHome", 2000)) return;
  const open = await scrollToTestId(driver, "OpenYourAgentButton", 4).catch(() => undefined);
  if (!open) throw new Error('My Agent offers no way to "Open your agent"');
  await open.click();
  await waitForTestId(driver, "AgentHome", 30000);
}

/** Drag the page up a fifth of the window: brings a button half under the tab bar above it. */
async function nudge(driver) {
  const { width, height } = await driver.getWindowSize();
  const x = Math.round(width / 2);
  await driver.performActions([
    {
      type: "pointer",
      id: "finger",
      parameters: { pointerType: "touch" },
      actions: [
        { type: "pointerMove", duration: 0, x, y: Math.round(height * 0.6) },
        { type: "pointerDown", button: 0 },
        { type: "pause", duration: 100 },
        { type: "pointerMove", duration: 400, x, y: Math.round(height * 0.4) },
        { type: "pointerUp", button: 0 },
      ],
    },
  ]);
  await driver.releaseActions().catch(() => undefined);
  await sleep(700);
}

/**
 * Each community card, judged where it is drawn: the cards sit under the
 * doors, below the fold on a phone, so what the segment shows unscrolled
 * says nothing about them (the first applicant walk "passed" with its card
 * never on screen). A card with a next step must show it filled, whole above
 * the tab bar, with nothing else filled beside it.
 */
async function cards(driver) {
  await scrollToTestId(driver, "AgentHolds", 8).catch(() => undefined);
  const keys = new Set();
  // Android's page source holds only what is on screen: read it twice, a
  // nudge apart, so a card below the first view is found too.
  for (let pass = 0; pass < 2; pass++) {
    for (const m of (await driver.getPageSource()).matchAll(/AgentCommunityCard_([^"]+)"/g)) keys.add(m[1]);
    if (pass === 0) await nudge(driver);
  }
  const filled = [];
  for (const key of keys) {
    const primary = `AgentCommunityPrimary_${key}`;
    if (!(await scrollToTestId(driver, primary, 6).catch(() => undefined))) {
      console.log(`[e2e] home ${person}/card ${key}: no next step`);
      continue;
    }
    let judged = [];
    for (let i = 0; i < 4 && !judged.some((b) => b.id === primary); i++) {
      if (i > 0) await nudge(driver);
      judged = await buttonsOnScreen(driver);
    }
    await screenshot(driver, `home-${person}-card-${key}`);
    const mine = judged.find((b) => b.id === primary);
    if (!mine) throw new Error(`card ${key}: its next step never came whole above the tab bar`);
    const others = judged.filter((b) => b.filled && !b.id.startsWith("AgentCommunityPrimary_") && true).map((b) => b.id);
    console.log(`[e2e] home ${person}/card ${key}: next step ${mine.filled ? "filled" : "OUTLINED"} (${mine.share}); other filled ${JSON.stringify(others)}`);
    if (!mine.filled) throw new Error(`card ${key}: its next step is not drawn filled (share ${mine.share})`);
    if (others.length) throw new Error(`card ${key}: filled beside its next step: ${JSON.stringify(others)}`);
    filled.push(primary);
  }
  return { keys: [...keys], filled };
}


await ensureAppium();
const driver = await makeDriver({ platform, udid, keepState: true });
try {
  await driver.activateApp("asml.bkc.harvard.wallet");
  // Wait for the PIN screen or the tab bar before deciding (a cold start mounts the PIN screen late).
  for (let waited = 0; waited < 120000; waited += 2000) {
    if ((await existsTestId(driver, "EnterPIN", 1000)) || (await existsTestId(driver, "MyAgent", 1000))) break;
  }
  await unlockIfLocked(driver);
  await openAgentHome(driver);
  await must(driver, "AgentHomeTitle", "header");
  await must(driver, "AgentHomeName", "header");
  await mustNot(driver, "AgentSegments", "header (#297 has no segments)");
  await screenshot(driver, `home-${person}-header`);
  const banner = await existsTestId(driver, "AgentApprovalBanner", 2000);

  const joined = person === "member" || person === "vetter";
  if (joined) {
    // The communities lead; the doors are behind the corner button.
    await must(driver, "AgentHolds", "after joining");
    await must(driver, "AgentJoinCorner", "after joining");
    await mustNot(driver, "AgentDoors", "after joining, before the corner button");
    await tapTestId(driver, "AgentJoinCorner", 10000);
    await must(driver, "AgentInvited", "the corner Join");
    await must(driver, "AgentJoinCommunity", "the corner Join");
    await screenshot(driver, `home-${person}-join-corner`);
    await tapTestId(driver, "AgentJoinCorner", 10000);
  } else {
    await must(driver, "AgentDoors", "before joining");
    await mustNot(driver, "AgentJoinCorner", "before joining");
  }

  const held = await cards(driver);
  const expectCards = {
    new: () => held.keys.length === 0,
    applicant: () => held.filled.length >= 1,
    vetter: () => held.filled.length >= 1,
    member: () => held.keys.length >= 1 && held.filled.length === 0,
  }[person];
  if (expectCards && !expectCards()) {
    throw new Error(`cards: a ${person} holds ${JSON.stringify(held.keys)} with next steps ${JSON.stringify(held.filled)}`);
  }
  console.log(`[e2e] home ${person}/cards: ${JSON.stringify(held.keys)}, next steps filled ${JSON.stringify(held.filled)}`);

  await must(driver, "AgentDevices", "below the cards");
  await must(driver, "AgentSettings", "the foot of the page");
  await mustNot(driver, "AgentUnlink", "Agent settings, closed");
  await tapTestId(driver, "AgentSettings", 10000);
  await must(driver, "AgentRequestsRow", "Agent settings");
  await must(driver, "AgentAskMeRow", "Agent settings");
  if (person !== "new") await must(driver, "AgentGetCards", "Agent settings (Restore cards)");
  await must(driver, "AgentUnlink", "Agent settings");
  await must(driver, "AgentActivity", "Agent settings");
  await must(driver, "AgentDetailsToggle", "Agent settings");
  await mustNot(driver, "AgentDetails", "Agent settings (before opening Details)");
  await screenshot(driver, `home-${person}-settings`);

  if (banner) {
    await scrollToTestId(driver, "AgentApprovalBanner", 8, { direction: "up" }).catch(() => undefined);
    await tapTestId(driver, "AgentApprovalBanner", 5000);
    if (!(await existsTestId(driver, "Requests", 8000))) throw new Error("the approval banner did not open Requests");
    await backFromRequests(driver);
    await must(driver, "AgentApprovalBanner", "Your agent, back from Requests");
  }
  console.log(`✅  agent home walked for ${person} on ${platform}`);
} finally {
  await driver.deleteSession().catch(() => undefined);
  stopAppium();
}
