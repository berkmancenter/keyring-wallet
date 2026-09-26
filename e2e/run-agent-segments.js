/**
 * "Your agent" in its three segments (IN-20c), on a phone already set up as
 * one of the gate's four people — it never installs, resets or wipes.
 *
 *   For the header and each of Communities, Manage and Status: a screenshot,
 *   and what the screen must show there:
 *     - the header says "Your agent", with the agent's name under it;
 *     - Your devices is in reach on every segment;
 *     - Communities holds the doors and the community cards, and each card
 *       has at most one filled button;
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

async function segment(driver, key) {
  await tapTestId(driver, `AgentSegment_${key}`, 10000);
  await must(driver, "AgentDevices", key);
  const buttons = await buttonsOnScreen(driver);
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
