/**
 * Waits and finds that do not trust the first thing they see. Each one is a
 * driver miss from the 236 gate, written down once so the next driver does
 * not make it again:
 *
 * - `waitStable`: the Wallet showed its empty state (whose "Add your first
 *   credential" sits where the card row goes) for a moment after each tab tap,
 *   and the tap landed on that instead of the card (R7).
 * - `findScrolling`: a new device row rendered above the fold, and a search
 *   that only scrolled down never found it (My devices, run-release-235).
 * - `expectChanged`: a still-valid ticket from eight hours before was taken as
 *   the new cut, so no new ticket was ever made (the vetter's desk).
 * - `dismissTourIfUp`: a first-visit tour (bifold's TourBox) sat over the
 *   Wallet and took the tap meant for the card, on both 236 runs.
 * - `tapLifted`: iOS kept the ticket's Details toggle "not displayed" through
 *   four swipes, so a tap waiting for isDisplayed was never made; lift it by
 *   its measured position and tap where it is (#331).
 *
 * A target is a testID (string) or a function returning a WebdriverIO element,
 * for things only a UiSelector or predicate can name.
 */
import { byTestId, liftAboveTabBar, scrollToTestId, sleep, tapTestId, tapTestIdByCoordinates } from "./driver.js";

const elementOf = (driver, target) => (typeof target === "function" ? target() : byTestId(driver, target));
const nameOf = (target) => (typeof target === "function" ? target.name || "element" : `testID=${target}`);

/** Whether a target is on the page now (no wait). */
export async function present(driver, target) {
  try {
    return Boolean(await (await elementOf(driver, target)).isExisting());
  } catch {
    return false;
  }
}

/**
 * Wait until `target` is present and none of `absent` are, and stays that way
 * for `holdMs` without a break. Returns `{ el, absentSeen }`: the element, and
 * which of `absent` showed at some point meanwhile (evidence of a flash, worth
 * logging). Throws after `timeout`, saying what was there.
 *
 *   const { absentSeen } = await waitStable(d, cardName, { absent: ["NoCredentials", "AddFirstCredential"] });
 */
export async function waitStable(
  driver,
  target,
  { holdMs = 1000, absent = [], timeout = 20000, pollMs = 200, now = Date.now, wait = sleep } = {}
) {
  const seen = new Set();
  const until = now() + timeout;
  let steadySince = 0;
  let last = { here: false, blocking: [] };
  for (;;) {
    const here = await present(driver, target);
    const blocking = [];
    for (const a of absent) if (await present(driver, a)) blocking.push(nameOf(a));
    blocking.forEach((b) => seen.add(b));
    last = { here, blocking };
    if (here && !blocking.length) {
      steadySince ||= now();
      if (now() - steadySince >= holdMs) return { el: await elementOf(driver, target), absentSeen: [...seen] };
    } else steadySince = 0;
    if (now() >= until) break;
    await wait(pollMs);
  }
  throw new Error(
    `${nameOf(target)} did not hold for ${holdMs} ms within ${timeout} ms (last: ${last.here ? "present" : "absent"}${
      last.blocking.length ? `, with ${last.blocking.join(", ")} showing` : ""
    })`
  );
}

/**
 * Find a testID by scrolling up first, then down — a row can render above the
 * fold as easily as below it. Returns the displayed element; throws naming both
 * directions. `scroll` is for tests.
 */
export async function findScrolling(driver, key, { swipes = 4, from, scroll = scrollToTestId } = {}) {
  const opts = (direction) => ({ direction, both: false, ...(from ? { from } : {}) });
  try {
    return await scroll(driver, key, swipes, opts("up"));
  } catch {
    try {
      return await scroll(driver, key, swipes, opts("down"));
    } catch {
      throw new Error(`testID=${key} not found scrolling up ${swipes} and down ${swipes}`);
    }
  }
}

/**
 * Read a value, act, and wait for the value to differ from what it was before
 * the action — never take what was already on screen as the action's result.
 * Returns `{ before, after }`; throws "unchanged" after `timeout`. Values are
 * compared as JSON, so objects and arrays work.
 *
 *   const { after: code } = await expectChanged(() => textOf(d, "VettingTicketCode").catch(() => ""), () => tap(...));
 */
export async function expectChanged(
  read,
  action,
  { timeout = 15000, pollMs = 500, settleMs = 0, now = Date.now, wait = sleep } = {}
) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const before = await read();
  await action();
  if (settleMs) await wait(settleMs);
  const until = now() + timeout;
  for (;;) {
    const after = await read();
    if (!same(after, before)) return { before, after };
    if (now() >= until) break;
    await wait(pollMs);
  }
  throw new Error(`unchanged after the action (still ${JSON.stringify(before)?.slice(0, 120)})`);
}

/**
 * Tap a control that iOS may call "not displayed" although it is on the page:
 * lift it above the tab bar by its measured position, then tap where it is by
 * coordinates, up to `attempts` times until `verify()` says it took. Logs where
 * it ended, so a page that would not move shows as such. Returns whether
 * `verify` passed (true when there is no verify).
 */
export async function tapLifted(
  driver,
  key,
  { tries = 6, attempts = 2, settleMs = 1200, verify, log = console.log } = {}
) {
  if (!(await present(driver, key))) throw new Error(`testID=${key} is not on the page to lift`);
  const clear = await liftAboveTabBar(driver, key, tries);
  if (!clear) log(`[e2e] testID=${key} did not rise above the tab bar in ${tries} swipes; tapping it where it is`);
  for (let i = 0; i < attempts; i++) {
    await tapTestIdByCoordinates(driver, key);
    await sleep(settleMs);
    if (!verify || (await verify())) return true;
  }
  return false;
}

/**
 * Close bifold's first-visit tour (TourBox) if one is over the screen: tap its
 * ✕ (`Close`), else its "Next"/"Done" (`Next`), until neither shows — a tour
 * can have several steps. At most `max` taps. Returns how many it closed.
 * Call it after navigating to a tab, before tapping anything on it. A tour can
 * take a moment to appear, so the first look waits up to `appearMs`.
 *
 * Generic, unlike flows.js `dismissTourIfPresent` (one ✕, after onboarding).
 * `present`, `tap` and `wait` are for tests.
 */
export async function dismissTourIfUp(
  driver,
  { max = 5, appearMs = 1500, settleMs = 600, present: isHere = present, tap = tapTestId, wait = sleep, log = console.log } = {}
) {
  const step = async () => ((await isHere(driver, "Close")) ? "Close" : (await isHere(driver, "Next")) ? "Next" : undefined);
  let control = await step();
  for (let waited = 0; !control && waited < appearMs; waited += 300) {
    await wait(300);
    control = await step();
  }
  let closed = 0;
  while (control && closed < max) {
    await tap(driver, control, 5000);
    closed++;
    await wait(settleMs);
    control = await step();
  }
  if (closed) log(`[e2e] ${driver.e2ePlatform ?? "device"}: closed a tour (${closed} tap${closed === 1 ? "" : "s"})${control ? `, still showing ${control}` : ""}`);
  return closed;
}
