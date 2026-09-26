/**
 * "Your agent" in its three segments (IN-20c), on a phone already set up as
 * one of the gate's four people — it never installs, resets or wipes.
 *
 *   For the header and each of Communities, Manage and Status: a screenshot,
 *   and what the screen must show there:
 *     - the header says "Your agent", with the agent's name under it;
 *     - Your devices is in reach on every segment;
 *     - Communities holds the doors and the community cards, and each card
 *       has at most one filled button — judged scrolled to, not unscrolled;
 *       an applicant's and a vetter's card show theirs, a member's none;
 *     - Manage holds Unlink; Status holds the activity and Details, and the
 *       agent's DID shows only once Details is opened;
 *     - a waiting approval shows its banner on every segment, and it opens Manage.
 *   Then a tab switch away and back keeps the segment.
 *
 * Usage (the gate, next-release §3):
 *   PLATFORM=android ANDROID_UDID=emulator-5574 PERSON=member APPIUM_PORT=4763 node run-agent-segments.js
 *   PLATFORM=ios IOS_UDID=<sim udid> PERSON=vetter WDA_LOCAL_PORT=8133 APPIUM_PORT=4763 node run-agent-segments.js
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
    await screenshot(driver, `segments-${person}-missing-${id}`);
    throw new Error(`${where}: ${id} is not on the screen`);
  }
};
const mustNot = async (driver, id, where) => {
  if (await existsTestId(driver, id, 1500)) throw new Error(`${where}: ${id} should not be on the screen`);
};

/** The My Agent tab lands on "Your agent" once linked (as run-vta-link opens it). */
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
      console.log(`[e2e] segments ${person}/card ${key}: no next step`);
      continue;
    }
    let judged = [];
    for (let i = 0; i < 4 && !judged.some((b) => b.id === primary); i++) {
      if (i > 0) await nudge(driver);
      judged = await buttonsOnScreen(driver);
    }
    await screenshot(driver, `segments-${person}-card-${key}`);
    const mine = judged.find((b) => b.id === primary);
    if (!mine) throw new Error(`card ${key}: its next step never came whole above the tab bar`);
    const others = judged.filter((b) => b.filled && !b.id.startsWith("AgentCommunityPrimary_") && !b.id.startsWith("AgentSegment_")).map((b) => b.id);
    console.log(`[e2e] segments ${person}/card ${key}: next step ${mine.filled ? "filled" : "OUTLINED"} (${mine.share}); other filled ${JSON.stringify(others)}`);
    if (!mine.filled) throw new Error(`card ${key}: its next step is not drawn filled (share ${mine.share})`);
    if (others.length) throw new Error(`card ${key}: filled beside its next step: ${JSON.stringify(others)}`);
    filled.push(primary);
  }
  return { keys: [...keys], filled };
}

async function segment(driver, key) {
  await tapTestId(driver, `AgentSegment_${key}`, 10000);
  await must(driver, "AgentDevices", key);
  // The selected segment is drawn filled: it says which segment is open, it
  // is not a step's action (the first Android walk counted it).
  const buttons = (await buttonsOnScreen(driver)).filter((b) => !b.id.startsWith("AgentSegment_"));
  const filled = buttons.filter((b) => b.filled).map((b) => b.id);
  console.log(`[e2e] segments ${person}/${key}: filled ${JSON.stringify(filled)}`);
  await screenshot(driver, `segments-${person}-${key}`);
  return filled;
}

await ensureAppium();
const driver = await makeDriver({ platform, udid, keepState: true });
try {
  await driver.activateApp("asml.bkc.harvard.wallet");
  // A relaunched app opens on its PIN screen, but only once its JS has booted:
  // unlockIfLocked's check is instant, and on a cold start it ran before the
  // PIN screen mounted (225 gate, iOS sim) — so wait for either the PIN screen
  // or the tab bar before deciding.
  for (let waited = 0; waited < 120000; waited += 2000) {
    if ((await existsTestId(driver, "EnterPIN", 1000)) || (await existsTestId(driver, "MyAgent", 1000))) break;
  }
  await unlockIfLocked(driver);
  await openAgentHome(driver);
  await must(driver, "AgentHomeTitle", "header");
  await must(driver, "AgentHomeName", "header");
  await screenshot(driver, `segments-${person}-header`);
  const banner = await existsTestId(driver, "AgentApprovalBanner", 2000);

  const communities = await segment(driver, "communities");
  await must(driver, "AgentDoors", "communities");
  await mustNot(driver, "AgentUnlink", "communities");
  // A card may offer one next step; the page may show one per card.
  const cardPrimaries = communities.filter((id) => id.startsWith("AgentCommunityPrimary_"));
  if (communities.length !== cardPrimaries.length) {
    throw new Error(`communities: filled buttons besides the cards' next steps: ${JSON.stringify(communities)}`);
  }
  // What each of the gate's people must find on their cards (§3): a new person
  // has none; an applicant's card says continue the vetting and a vetter's
  // opens the desk; a member's card has nothing left to do.
  const held = await cards(driver);
  const expectCards = {
    new: () => held.keys.length === 0,
    applicant: () => held.filled.length >= 1,
    vetter: () => held.filled.length >= 1,
    member: () => held.keys.length >= 1 && held.filled.length === 0,
  }[person];
  if (expectCards && !expectCards()) {
    throw new Error(`communities: a ${person} holds cards ${JSON.stringify(held.keys)} with next steps ${JSON.stringify(held.filled)}`);
  }
  console.log(`[e2e] segments ${person}/cards: ${JSON.stringify(held.keys)}, next steps filled ${JSON.stringify(held.filled)}`);
  await scrollToTestId(driver, "AgentSegment_manage", 8, { direction: "up" }).catch(() => undefined);

  await segment(driver, "manage");
  await must(driver, "AgentUnlink", "manage");
  await mustNot(driver, "AgentHolds", "manage");

  await segment(driver, "status");
  await must(driver, "AgentActivity", "status");
  await must(driver, "AgentDetailsToggle", "status");
  await mustNot(driver, "AgentDetails", "status (before opening Details)");

  if (banner) {
    await must(driver, "AgentApprovalBanner", "status");
    await tapTestId(driver, "AgentApprovalBanner", 5000);
    await must(driver, "AgentApprovals", "the banner's Manage");
  }

  // Away and back: the segment stays (Manage's Unlink, or Status's activity).
  await tapTestId(driver, "Contacts", 10000);
  await openAgentHome(driver);
  await must(driver, banner ? "AgentUnlink" : "AgentActivity", "after a tab switch");
  await screenshot(driver, `segments-${person}-after-tab-switch`);
  console.log(`✅  segments walked for ${person} on ${platform}`);
} finally {
  await driver.deleteSession().catch(() => undefined);
  stopAppium();
}
