/**
 * The link page: VtaLink and the screens around it — the way in from My Agent,
 * the host's code, a scanned or pasted address, the address path through
 * VtaCreateAgent, a resumed link, "Linked", the agent's introduction, the
 * "added" card's Keep (238) and the chips' Add — one function per step, for
 * run-vta-link.js and the legs that link a phone before their own rows.
 *
 * The model is lib/keyringRoles.js (KEYRING_ROLES.md): each step does ONE
 * thing on the phone it is given, asserts the screen it ends on by the id that
 * screen carries (VtaLinkIds and its neighbours in bifold's manifest,
 * lib/testids.json), and returns a record. A step that fails throws a
 * StepError carrying the same record with a screenshot and the page source,
 * and says where the screen was stuck and for how long ("stuck at
 * "VtaLinkWaitingForPhone" for 240 s"); nothing waits without a named deadline.
 * A step whose outcome the caller decides (a refusal the run expects, a key a
 * case records as missing) returns the outcome in `value` rather than throwing.
 *
 *   const link = createLinkPage(driver);
 *   await link.open();                                 // My Agent → "Scan your agent's code" (or "Link again")
 *   await link.pasteCode(offer.link);                  // the host's code → VtaLinkConfirm
 *   await link.pressLink();                            // VtaLinkButton
 *   const { value: code } = await link.awaitCode();    // VtaLinkCode
 *   … the host grants …
 *   const { value: end } = await link.awaitLinked();   // VtaLinkDone, or VtaLinkError with its words
 *   await link.continueToAgent();                      // VtaLinkContinue, past the other-phones offer
 *   await link.introduction({ onCentre });             // AgentIntro → AgentHome
 *
 * Record: { role: "link", step, platform, device, ok, startedAt, endedAt,
 *           observed: { stepId, ... }, value?, error?, screenshot?, source? }
 *
 * Every driver call goes through `io`, so a unit test hands in a fake
 * (link.test.mjs); `opts.log` (or E2E_STEP_LOG) appends each record as one
 * JSON line, as keyringRoles does.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { TEST_ID_PREFIX } from "../config.js";
import {
  acceptSystemAlertIfPresent,
  byTestId,
  clearLocalityPreflightIfUp,
  clearSiblingNoticeIfUp,
  deviceTag,
  dumpSource,
  existsTestId,
  scrollToTestId,
  screenshot,
  sleep,
  tapTestId,
  waitForTestId,
} from "../driver.js";
import { dismissTourIfPresent, passNewPhoneOfferIfShown, pasteLinkOnScanScreen } from "../flows.js";

export class StepError extends Error {
  constructor(message, record) {
    super(message);
    this.name = "StepError";
    this.record = record;
  }
}

/** The driver calls a step makes; a test replaces them (link.test.mjs). */
export const defaultIo = {
  byTestId,
  existsTestId,
  tapTestId,
  waitForTestId,
  scrollToTestId,
  screenshot,
  dumpSource,
  sleep,
  deviceTag,
  dismissTourIfPresent,
  passNewPhoneOfferIfShown,
  pasteLinkOnScanScreen,
  /**
   * What covers a screen mid-link and hides it from the tree: a system alert
   * (a camera permission), the "also open as you" notice of a shared runner
   * agent, the Bluetooth pre-flight — what pasteLinkOnScanScreen and
   * waitForTestId clear on a miss.
   */
  clearNotices: async (d) => (await acceptSystemAlertIfPresent(d)) || (await clearSiblingNoticeIfUp(d)) || (await clearLocalityPreflightIfUp(d)),
  pageSource: (d) => d.getPageSource(),
  clipboard: (d) => d.getClipboard("plaintext"),
  windowRect: (d) => d.getWindowRect(),
  swipe: (d, from, to) => d.action("pointer").move(from).down().pause(100).move({ ...to, duration: 400 }).up().perform(),
  now: () => Date.now(),
  log: (s) => console.log(s),
};

/**
 * Where a link can be, by the id each screen (or state card) carries: the
 * first of these in the page source is the step the record names. The end
 * states come first, since "Linked" and a refusal share the screen with the
 * card that led there; the agent's introduction sits over its home.
 */
export const LINK_SCREENS = [
  "VtaLinkDone",
  "VtaLinkError",
  "VtaLinkConfirm",
  "VtaLinkCode",
  "VtaLinkResumed",
  "VtaLinkForOtherPhone",
  "VtaLinkWaitingForPhone",
  "VtaLinkNotYet",
  "VtaLinkNoAnswer",
  "VtaLinkShowingKey",
  "VtaLinkManualDid",
  "VtaLinkShowTheCode",
  "VtaLinkAgentAddress",
  "VtaLinkWithoutQr",
  "VtaLinkScanAgain",
  "AgentCreateReady",
  "AgentCreateError",
  "AgentCreateWaiting",
  "AgentCreateOwnerCode",
  "AgentCreateAddressInput",
  "NewPhoneOffer",
  "AgentAddedCard",
  "AgentIntro",
  "AgentHome",
  "MyAgentContinueLink",
  "LinkYourAgentButton",
  "LinkByAddressButton",
  "AgentSwitcherAdd",
  "PasteUrlButton",
  "Continue",
  "EnterPIN",
];

/** What the address path says when a phone has no screen lock (237, before bifold #339). */
export const NEEDS_LOCK = /To protect your agent, turn on .*(passcode|screen lock)/i;

/** What a screen of the link is on, for a record. */
export const screenIn = (source) => LINK_SCREENS.find((id) => source.includes(`${TEST_ID_PREFIX}${id}"`)) ?? null;

const failWith = (message, observed) => Object.assign(new Error(message), { observed });

function logPath(opts) {
  return opts?.log || process.env.E2E_STEP_LOG || "";
}

function writeRecord(opts, record) {
  const file = logPath(opts);
  if (!file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + "\n");
}

/**
 * The link page for one phone. `io` is the driver's helper family (a fake in
 * tests); `log` a file for the records.
 */
export function createLinkPage(d, { io = defaultIo, log } = {}) {
  const opts = { log };
  const isIos = d.e2ePlatform === "ios";
  const textOfId = async (key) => (await io.byTestId(d, key).getAttribute(isIos ? "label" : "text")) || "";
  const wordsOfId = async (key) => (await textOfId(key).catch(() => "")).replace(/\s+/g, " ").trim();
  const onScreen = async (key) => {
    try {
      return Boolean(await io.byTestId(d, key).isExisting());
    } catch {
      return false;
    }
  };
  const source = () => io.pageSource(d).catch(() => "");
  const stepIdOf = async () => screenIn(await source());

  /**
   * Wait until the screen is on one of `want` (ids, looked up in one page
   * source per poll). `each` runs between polls (a "Check again" to tap). On
   * the deadline, say where the screen is instead and for how long: "stuck at
   * checking for 300 s" is the finding, "timeout" is not.
   */
  async function awaitStep(want, timeoutMs, { each, extra = async () => ({}) } = {}) {
    const wanted = Array.isArray(want) ? want : [want];
    const until = io.now() + timeoutMs;
    let current = null;
    let since = io.now();
    let lastSeen = null;
    let lastSeenAt = null;
    for (;;) {
      const src = await source();
      const hit = wanted.find((id) => src.includes(`${TEST_ID_PREFIX}${id}"`));
      if (hit) return hit;
      const now = screenIn(src);
      if (now) {
        lastSeen = now;
        lastSeenAt = new Date().toISOString();
      }
      if (now !== current) {
        current = now;
        since = io.now();
      }
      // A notice over the screen (the "also open as you" one, the Bluetooth
      // pre-flight) hides what is under it from the tree: clear it, as
      // waitForTestId does on a miss.
      await io.clearNotices(d).catch(() => false);
      if (each) await each();
      if (io.now() > until) {
        const observed = {
          stepId: current,
          secondsOnStep: Math.round((io.now() - since) / 1000),
          lastStepSeen: lastSeen,
          lastStepAt: lastSeenAt,
          ...(await extra()),
        };
        throw failWith(
          current
            ? `stuck at "${current}" for ${observed.secondsOnStep} s, waiting for ${wanted.join(" | ")}`
            : `none of the link's screens is showing (last seen: ${lastSeen ?? "none"}${lastSeenAt ? ` at ${lastSeenAt}` : ""}; waiting for ${wanted.join(" | ")})`,
          observed
        );
      }
      await io.sleep(2000);
    }
  }

  /**
   * Run one step: time it, read the screen it ended on, write the record. `fn`
   * returns { value?, observed? }; a throw becomes a StepError with a
   * screenshot, the page source and the screen the link was on at the time.
   */
  async function step(name, fn) {
    const startedAt = new Date().toISOString();
    const base = { role: "link", step: name, platform: d.e2ePlatform, device: io.deviceTag(d) };
    try {
      const out = (await fn()) || {};
      const record = {
        ...base,
        ok: true,
        startedAt,
        endedAt: new Date().toISOString(),
        observed: { stepId: await stepIdOf(), ...(out.observed || {}) },
        ...(out.value !== undefined ? { value: out.value } : {}),
      };
      writeRecord(opts, record);
      io.log(`[step] link.${name} ok${out.value !== undefined ? ` — ${JSON.stringify(out.value).slice(0, 120)}` : ""}`);
      return record;
    } catch (err) {
      const tag = `step-link-${name}-${d.e2ePlatform}`;
      const shot = await io.screenshot(d, tag).catch(() => undefined);
      const dump = await io.dumpSource(d, tag).catch(() => undefined);
      const record = {
        ...base,
        ok: false,
        startedAt,
        endedAt: new Date().toISOString(),
        observed: { stepId: await stepIdOf(), ...(err?.observed || {}) },
        error: err?.message || String(err),
        ...(typeof shot === "string" ? { screenshot: shot } : {}),
        ...(typeof dump === "string" ? { source: dump } : {}),
      };
      writeRecord(opts, record);
      io.log(`[step] link.${name} FAILED — ${record.error}`);
      throw new StepError(`link.${name}: ${record.error}`, record);
    }
  }

  /** A "Check again" between polls, when the screen offers one. */
  const tapIfUp = (key) => async () => {
    if (await io.existsTestId(d, key, 500)) await io.tapTestId(d, key, 5000).catch(() => undefined);
  };

  /** VtaLinkError's words, and the raw text behind its Details (SaidFailure: toggle → VtaLinkErrorDetail). */
  async function linkErrorSaid() {
    const said = await wordsOfId("VtaLinkError");
    const toggle = await io.scrollToTestId(d, "VtaLinkErrorDetailsToggle", 3).catch(() => undefined);
    if (toggle) await toggle.click().catch(() => undefined);
    const detail = toggle ? await io.scrollToTestId(d, "VtaLinkErrorDetail", 3).then(() => wordsOfId("VtaLinkErrorDetail"), () => "") : "";
    return { said, detail };
  }

  /** AgentCreateError's words, and the original text under its Details. */
  async function createErrorSaid() {
    const said = await wordsOfId("AgentCreateError");
    let detail = "";
    if (await io.existsTestId(d, "AgentCreateErrorDetailsToggle", 1000)) {
      await io.tapTestId(d, "AgentCreateErrorDetailsToggle", 5000).catch(() => undefined);
      detail = await wordsOfId("AgentCreateErrorDetail");
    }
    return { said, detail };
  }

  /** Swipe the content up from mid-screen: the fixed footer at 70% scrolls nothing (220 gate). */
  async function swipeUpMidScreen() {
    const { width, height } = await io.windowRect(d);
    await io.swipe(d, { x: Math.floor(width / 2), y: Math.floor(height * 0.5) }, { x: Math.floor(width / 2), y: Math.floor(height * 0.25) }).catch(() => undefined);
    await io.sleep(600);
  }

  /**
   * 238 (bifold #340): the introduction's words and buttons are centred
   * together in AgentIntro. Returns { ok, above, below } (the space above the
   * first line and below the buttons; within 24 px is ok), { unmeasured } when
   * the measure failed, or undefined on a build without AgentIntroButtons.
   */
  async function measureIntroCentre() {
    try {
      if (!(await io.existsTestId(d, "AgentIntroButtons", 2000))) return undefined;
      const box = async (el) => ({ ...(await el.getLocation()), ...(await el.getSize()) });
      const intro = await box(io.byTestId(d, "AgentIntro"));
      const buttons = await box(io.byTestId(d, "AgentIntroButtons"));
      // The topmost element inside AgentIntro's rectangle, from the page source (an element's own child query found
      // nothing on iOS, 238 gate): iOS gives x/y/width/height in points, Android bounds in pixels, as getLocation does.
      let top = Infinity;
      for (const [tag] of (await io.pageSource(d)).matchAll(/<[A-Za-z.]+ [^>]*>/g)) {
        if (/AgentIntro"/.test(tag)) continue;
        let r;
        const b = tag.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
        if (b) r = { x: +b[1], y: +b[2], width: b[3] - b[1], height: b[4] - b[2] };
        else {
          const n = (k) => Number((tag.match(new RegExp(` ${k}="(-?\\d+)"`)) || [])[1]);
          r = { x: n("x"), y: n("y"), width: n("width"), height: n("height") };
        }
        if (!(r.height > 0) || Number.isNaN(r.y)) continue;
        const inside = r.x >= intro.x - 1 && r.y >= intro.y - 1 && r.x + r.width <= intro.x + intro.width + 1 && r.y + r.height <= intro.y + intro.height + 1;
        if (inside && !(r.y <= intro.y + 1 && r.height >= intro.height - 2)) top = Math.min(top, r.y);
      }
      const above = Math.round(top - intro.y);
      const below = Math.round(intro.y + intro.height - (buttons.y + buttons.height));
      return { ok: Math.abs(above - below) <= 24, above, below };
    } catch (e) {
      return { unmeasured: String(e.message).split("\n")[0].slice(0, 80) };
    }
  }

  return {
    stepIdOf,
    measureIntroCentre,

    // ------------------------------------------------------------ the way in

    /** My Agent → the scanner: "Link again" (VtaLinkScanAgain) when the agent no longer accepts this phone, else "Scan your agent's code". */
    open: () =>
      step("open", async () => {
        // A first-run tour overlays the tabs and swallows the first tap.
        await io.dismissTourIfPresent(d);
        await (await io.waitForTestId(d, "MyAgent", 30000)).click();
        await io.sleep(1500);
        const entry = (await io.existsTestId(d, "VtaLinkScanAgain", 2000)) ? "VtaLinkScanAgain" : "LinkYourAgentButton";
        await io.tapTestId(d, entry, 30000);
        // The scanner, or its camera-permission step first (pasteLinkOnScanScreen walks it).
        await awaitStep(["PasteUrlButton", "Continue"], 15000);
        return { value: { entry } };
      }),

    /** The host's code, pasted on the scanner (the QR's text twin) → "Link this phone?" (VtaLinkConfirm). */
    pasteCode: (link) =>
      step("pasteCode", async () => {
        await io.pasteLinkOnScanScreen(d, link);
        await awaitStep("VtaLinkConfirm", 30000);
      }),

    /** "Link" on the confirm screen (VtaLinkButton). */
    pressLink: () =>
      step("pressLink", async () => {
        await io.tapTestId(d, "VtaLinkButton", 15000);
      }),

    /** The enrolment code the phone shows (VtaLinkCode), spaces removed: iOS reads the label, which spells it out for VoiceOver. */
    awaitCode: ({ timeoutMs = 60000 } = {}) =>
      step("awaitCode", async () => {
        await awaitStep("VtaLinkCode", timeoutMs);
        return { value: (await textOfId("VtaLinkCode")).replace(/\s+/g, "") };
      }),

    /**
     * The agent's bare address, pasted on the scanner (237, bifold #338): the
     * "add this phone" link, whose card VtaLinkForOtherPhone shows the phone's
     * key as a QR. Needs no screen lock.
     */
    pasteAddress: (did) =>
      step("pasteAddress", async () => {
        await io.pasteLinkOnScanScreen(d, did);
        await awaitStep("VtaLinkForOtherPhone", 45000);
      }),

    /**
     * The phone's key as VtaLink shows it: as text in VtaLinkManualDid, behind
     * "Show as text" on the scan card or "Show the code" on a resumed or typed
     * link; else by Copy (VtaLinkCopyKey) and the clipboard — 237's card showed
     * only Copy, Share and Stop linking (10-07), and 239's resumed link no text.
     * `required: false` returns an empty key for a case to record, not a throw.
     */
    readKey: ({ required = true } = {}) =>
      step("readKey", async () => {
        if (!(await io.existsTestId(d, "VtaLinkManualDid", 1500))) {
          for (const toggle of ["VtaLinkShowAsText", "VtaLinkShowTheCode"]) {
            const el = (await io.existsTestId(d, toggle, 500)) ? io.byTestId(d, toggle) : await io.scrollToTestId(d, toggle, 3).catch(() => undefined);
            if (!el) continue;
            await el.click().catch(() => undefined);
            break;
          }
        }
        let did = "";
        let by = "text";
        if (await io.scrollToTestId(d, "VtaLinkManualDid", 3).catch(() => undefined)) did = (await textOfId("VtaLinkManualDid").catch(() => "")).replace(/\s+/g, "").trim();
        if (!did) {
          by = "copy";
          const copy = await io.scrollToTestId(d, "VtaLinkCopyKey", 4).catch(() => undefined);
          if (copy) await copy.click();
          else if (required) await io.tapTestId(d, "VtaLinkCopyKey", 15000);
          if (copy || required) {
            await io.sleep(1000);
            const raw = await io.clipboard(d).catch(() => "");
            const text = Buffer.from(String(raw), "base64").toString("utf8");
            did = (text.match(/did:[a-z0-9]+:[A-Za-z0-9._:%-]+/) || [""])[0];
          }
        }
        if (!/^did:/.test(did) && required) throw failWith(`no key in VtaLinkManualDid: "${did.slice(0, 60)}"`, { key: did, by });
        return { value: { did, by } };
      }),

    /** "I've been added" (VtaLinkCheckGrant): the phone signs in to check its grant. */
    pressCheckGrant: () =>
      step("pressCheckGrant", async () => {
        await io.tapTestId(d, "VtaLinkCheckGrant", 15000);
      }),

    /**
     * The check before the grant must say "not yet" (VtaLinkNotYet). It renders
     * at the bottom of the key card, below a ~350-character did:peer, so a
     * plain wait never sees it on Android (off-screen children are not
     * reported) while iOS reports it but not as displayed: existence first,
     * then a scroll — both were measured, one after the other.
     * `retryNoAnswer`: the second tap a person makes after "didn't answer"
     * (VtaLinkNoAnswer) — on a slow link the agent's answer can land after the
     * phone gave up, and the next "I've been added" settles on it rather than
     * start over (keyring-bifold#113). Once.
     */
    awaitNotYet: ({ timeoutMs = 60000, retryNoAnswer = false } = {}) =>
      step("awaitNotYet", async () => {
        let retried = false;
        let notYetBy = io.now() + timeoutMs;
        let notYet = false;
        while (!notYet && io.now() < notYetBy) {
          notYet = (await io.existsTestId(d, "VtaLinkNotYet", 2000)) || Boolean(await io.scrollToTestId(d, "VtaLinkNotYet", 4).catch(() => undefined));
          if (!notYet && retryNoAnswer && !retried && (await io.existsTestId(d, "VtaLinkNoAnswer", 1000))) {
            retried = true;
            io.log(`[e2e] first check: the agent didn't answer — tapping "Try again" (${new Date().toISOString()})`);
            await io.screenshot(d, "link-no-answer-first");
            await io.tapTestId(d, "VtaLinkCheckGrant", 15000);
            notYetBy = io.now() + timeoutMs;
            continue;
          }
          if (!notYet) await io.sleep(2000);
        }
        if (retried && notYet) io.log(`[e2e] second check settled: not yet (${new Date().toISOString()})`);
        if (!notYet) throw failWith(`${d.e2ePlatform}: the phone never said the key was not added yet`, { noAnswer: await onScreen("VtaLinkNoAnswer"), retried });
        return { value: { retried } };
      }),

    /**
     * The end of a link: "Linked" (VtaLinkDone), or a refusal (VtaLinkError)
     * with its words and the text behind Details. The scan card polls by
     * itself and offers "Check again" once its window ends (VtaLinkCheckAgain):
     * tapped whenever it shows, unless `checkAgain: false`; `details: false`
     * leaves the refusal's Details closed. Neither within `timeoutMs` is the
     * failure, named by the state the screen sat on.
     */
    awaitLinked: ({ timeoutMs = 240000, checkAgain = true, details = true } = {}) =>
      step("awaitLinked", async () => {
        const on = await awaitStep(["VtaLinkDone", "VtaLinkError"], timeoutMs, { each: checkAgain ? tapIfUp("VtaLinkCheckAgain") : undefined });
        if (on === "VtaLinkDone") return { value: { state: "done", said: "", detail: "" } };
        const { said, detail } = details ? await linkErrorSaid() : { said: await wordsOfId("VtaLinkError"), detail: "" };
        return { value: { state: "error", said, detail } };
      }),

    /** "Continue" on the Linked screen, past the other-phones offer, to the agent's introduction or home. */
    continueToAgent: () =>
      step("continueToAgent", async () => {
        await io.tapTestId(d, "VtaLinkContinue", 15000);
        const offerKept = await io.passNewPhoneOfferIfShown(d);
        await awaitStep(["AgentAddedCard", "AgentIntro", "AgentHome"], 30000);
        return { value: { offerKept } };
      }),

    /**
     * The agent screen after linking: the introduction (AgentIntro) once,
     * through its three pages to the home (AgentHome). An agent with other
     * phones on it first offers "Your other phones": kept, all of them.
     * `onCentre` gets the 238 centring measure before the pages are turned, so
     * a run that stops on them has still recorded it.
     */
    introduction: ({ onCentre, offer = true } = {}) =>
      step("introduction", async () => {
        let offerKept = false;
        if (offer && (await io.passNewPhoneOfferIfShown(d, 8000))) {
          offerKept = true;
          io.log("[e2e] other-phones offer: kept them all (Done)");
        }
        await awaitStep("AgentIntro", 30000);
        await io.screenshot(d, "link-06-intro");
        const centre = await measureIntroCentre();
        if (onCentre) await onCentre(centre);
        for (let i = 0; i < 3; i++) await io.tapTestId(d, "AgentIntroNext", 15000);
        await awaitStep("AgentHome", 30000);
        return { value: { offerKept, centre } };
      }),

    /**
     * The "added" card of a second agent (238): on the new agent's home, behind
     * its introduction, with Keep (AgentAddedKeep: the first agent stays
     * current) and Use. The introduction is skipped as it shows; the card can
     * come a moment after the home, or below the fold. Returns whether the card
     * showed and Keep was tapped; `required` makes its absence the failure.
     * The owner check that may follow Keep is the caller's (adb on Android).
     */
    keepCard: ({ timeoutMs = 30000, required = false } = {}) =>
      step("keepCard", async () => {
        for (const until = io.now() + timeoutMs; io.now() < until; ) {
          if (await io.existsTestId(d, "AgentIntroSkip", 500)) {
            io.log("[e2e] the new agent's introduction is up: Skip");
            await io.tapTestId(d, "AgentIntroSkip", 5000).catch(() => undefined);
            await io.sleep(1500);
            continue;
          }
          const keep = (await io.existsTestId(d, "AgentAddedKeep", 1500)) ? io.byTestId(d, "AgentAddedKeep") : await io.scrollToTestId(d, "AgentAddedKeep", 2, { from: 0.6 }).catch(() => undefined);
          if (keep) {
            await keep.click();
            return { value: { shown: true } };
          }
          await io.sleep(1000);
        }
        if (required) throw failWith("no Keep card (AgentAddedKeep) showed after the link");
        return { value: { shown: false } };
      }),

    /**
     * The chips' Add (AgentSwitcherAdd), brought back into view first: after a
     * switch the home can sit scrolled past the chip strip, Android leaves
     * off-screen views out of the tree (239: R9 found no AgentSwitcherAdd), and
     * Add is the last chip, off to the right with two agents. Ends on a way
     * in: the scanner, the address entry, or the link screen's own form.
     */
    addAgent: () =>
      step("addAgent", async () => {
        // Up only: scrollToTestId's default also tries the other way, which carried the strip off the top (239 final pin, R9).
        let el = (await io.existsTestId(d, "AgentSwitcherAdd", 2000)) ? io.byTestId(d, "AgentSwitcherAdd") : await io.scrollToTestId(d, "AgentSwitcherAdd", 3, { direction: "up", both: false }).catch(() => undefined);
        if (!el) await io.scrollToTestId(d, "AgentChips", 3, { direction: "up", both: false }).catch(() => undefined);
        for (let i = 0; i < 4 && !el; i++) {
          const strip = io.byTestId(d, "AgentChips");
          if (!(await strip.isExisting().catch(() => false))) break;
          const { x, y } = await strip.getLocation();
          const { width, height } = await strip.getSize();
          const cy = Math.floor(y + height / 2);
          await io.swipe(d, { x: Math.floor(x + width * 0.85), y: cy }, { x: Math.floor(x + width * 0.15), y: cy });
          await io.sleep(800);
          if (await io.existsTestId(d, "AgentSwitcherAdd", 1500)) el = io.byTestId(d, "AgentSwitcherAdd");
        }
        if (el) await el.click();
        else await io.tapTestId(d, "AgentSwitcherAdd", 15000);
        const on = await awaitStep(["PasteUrlButton", "Continue", "LinkByAddressButton", "AgentCreateAddressInput", "VtaLinkAgentAddress", "VtaLinkWithoutQr", "LinkYourAgentButton"], 15000);
        return { value: { on } };
      }),

    /**
     * A held link, resumed: My Agent offers "Continue linking"
     * (MyAgentContinueLink), which opens VtaLink with the kept key —
     * VtaLinkResumed after a relaunch found a young key (bifold #353/#355), or
     * the plain key card when nothing was restarted (the window paused in the
     * background). Returns which showed; `required: false` records their
     * absence for a case rather than throwing.
     */
    resume: ({ waitMs = 30000, required = true } = {}) =>
      step("resume", async () => {
        const continueLink = await io.existsTestId(d, "MyAgentContinueLink", waitMs);
        if (continueLink) await io.tapTestId(d, "MyAgentContinueLink", 10000);
        let on = null;
        try {
          on = await awaitStep(["VtaLinkResumed", "VtaLinkShowTheCode", "VtaLinkManualDid", "VtaLinkShowingKey", "VtaLinkCopyKey"], 20000, { extra: async () => ({ continueLink }) });
        } catch (e) {
          if (required) throw e;
        }
        const resumed = on === "VtaLinkResumed" || (on !== null && (await onScreen("VtaLinkResumed")));
        return { value: { continueLink, resumed, on } };
      }),

    // ------------------------------------------- the address path (VtaCreateAgent)

    /**
     * Into the address path (237 and later, bifold #338/#339): My Agent's "No
     * code? Use your agent's address" (LinkByAddressButton) or the link
     * screen's own VtaLinkByAddress — `entry` names one, else whichever is
     * there — opens VtaCreateAgent at its address step.
     */
    openAddress: ({ entry } = {}) =>
      step("openAddress", async () => {
        if (entry) await io.tapTestId(d, entry, 30000);
        else await io.tapTestId(d, "LinkByAddressButton", 30000).catch(() => io.tapTestId(d, "VtaLinkByAddress", 15000));
        await awaitStep("AgentCreateAddressInput", 30000);
      }),

    /**
     * The agent's address, then Continue: the code step (AgentCreateOwnerCode),
     * or a refusal back on the address (AgentCreateError) — before bifold #339 a
     * phone with no screen lock is refused here (`needsLock`); #339 goes on as a
     * device. The refusal is returned, not thrown: the caller says what it means.
     */
    enterAddress: (did) =>
      step("enterAddress", async () => {
        const address = await io.waitForTestId(d, "AgentCreateAddressInput", 30000);
        await address.setValue(did);
        await (await io.scrollToTestId(d, "AgentCreateAddressContinue", 4).catch(() => io.byTestId(d, "AgentCreateAddressContinue"))).click();
        const on = await awaitStep(["AgentCreateOwnerCode", "AgentCreateError"], 60000);
        if (on === "AgentCreateError") {
          const { said, detail } = await createErrorSaid();
          return { value: { state: "error", said, detail, needsLock: NEEDS_LOCK.test(said) } };
        }
        return { value: { state: "code", said: "", detail: "", needsLock: false } };
      }),

    /**
     * The phone's code on the code card: "Show the code" (AgentCreateShowCode)
     * reveals the did:key in AgentCreateOwnerDid. `asDevice`: the phone has no
     * screen lock and takes the device path (#339), with no owner check.
     */
    showCode: () =>
      step("showCode", async () => {
        await awaitStep("AgentCreateOwnerCode", 5000);
        if (!(await io.existsTestId(d, "AgentCreateOwnerDid", 2000))) {
          const show = await io.scrollToTestId(d, "AgentCreateShowCode", 6).catch(() => undefined);
          if (show) await show.click();
          else await io.tapTestId(d, "AgentCreateShowCode", 15000);
        }
        await io.scrollToTestId(d, "AgentCreateOwnerDid", 4).catch(() => undefined);
        const did = (await textOfId("AgentCreateOwnerDid")).replace(/\s+/g, "").trim();
        if (!/^did:/.test(did)) throw failWith(`no code in AgentCreateOwnerDid: "${did.slice(0, 60)}"`, { ownerDid: did });
        const asDevice = await io.existsTestId(d, "AgentCreateAsDevice", 500);
        return { value: { did, asDevice } };
      }),

    /** Connect (AgentCreateConnect), once the host has granted the code. */
    connect: () =>
      step("connect", async () => {
        const connect = await io.scrollToTestId(d, "AgentCreateConnect", 6).catch(() => undefined);
        if (connect) await connect.click();
        else await io.tapTestId(d, "AgentCreateConnect", 15000);
      }),

    /**
     * The end of the address path: AgentCreateReady, or a refusal back on the
     * address step (AgentCreateError) with its words. "Check again"
     * (AgentCreateCheckAgain) is tapped as it shows unless `checkAgain: false`;
     * `also` names other ids that count as the end (VtaLinkDone); `required:
     * false` returns state "none" on the deadline instead of throwing.
     */
    awaitReady: ({ timeoutMs = 240000, checkAgain = true, also = [], required = true } = {}) =>
      step("awaitReady", async () => {
        let on;
        try {
          on = await awaitStep(["AgentCreateReady", ...also, "AgentCreateError"], timeoutMs, { each: checkAgain ? tapIfUp("AgentCreateCheckAgain") : undefined });
        } catch (e) {
          if (required) throw e;
          return { value: { state: "none", on: null, said: "", detail: "" }, observed: e.observed };
        }
        if (on === "AgentCreateError") {
          const { said, detail } = await createErrorSaid();
          return { value: { state: "error", on, said, detail } };
        }
        return { value: { state: "ready", on, said: "", detail: "" } };
      }),

    /** Done (AgentCreateDone), past the other-phones offer, to the agent's introduction or home. */
    done: () =>
      step("done", async () => {
        await io.tapTestId(d, "AgentCreateDone", 15000);
        const offerKept = await io.passNewPhoneOfferIfShown(d);
        await awaitStep(["AgentAddedCard", "AgentIntro", "AgentHome"], 30000);
        return { value: { offerKept } };
      }),

    // ------------------------------- the link screen's own address form (240 and before)

    /**
     * Older-build fallback: VtaLink's own address form, the way in without a
     * code on 240 and before (LinkWithoutQrButton on My Agent, VtaLinkWithoutQr
     * on the link screen; bifold ed9aabf8 / 9b6cc085). The gate's `dry
     * --golden` runs these drivers on the shipped build, which is one of
     * those; drop this and the two allowlist entries together once the golden
     * pin carries 9b6cc085. After a pasted address the screen already knows
     * the agent: no address to type. 236's address screen shows "Show my code"
     * beside an empty address field: that one still needs the address.
     */
    typeAddressOnLink: (did) =>
      step("typeAddressOnLink", async () => {
        const knowsAgent =
          (await io.existsTestId(d, "VtaLinkManualDid", 3000)) ||
          (await io.existsTestId(d, "VtaLinkShowTheCode", 1500)) ||
          ((await io.existsTestId(d, "VtaLinkShowMyCode", 1500)) && !(await io.existsTestId(d, "VtaLinkAgentAddress", 1500)));
        if (!knowsAgent) {
          // "Link without QR" can land straight on the address screen, and then the intermediate control is never
          // there to tap: ask for the goal first, and treat the waypoint as optional (candidate tree 2026-09-23).
          if (!(await io.existsTestId(d, "VtaLinkAgentAddress", 2000))) await io.tapTestId(d, "VtaLinkWithoutQr", 15000).catch(() => undefined);
          const address = await io.waitForTestId(d, "VtaLinkAgentAddress", 15000);
          // Return on the keyboard submits the address, as a person would — on iOS.
          await address.setValue(`${did}\n`);
        }
        await awaitStep(["VtaLinkManualDid", "VtaLinkShowTheCode", "VtaLinkShowMyCode", "VtaLinkAgentAddress"], 15000);
        return { value: { knewAgent: knowsAgent } };
      }),

    /**
     * Older-build fallback, with typeAddressOnLink: the key is revealed by "Show
     * my code" (VtaLinkShowMyCode, 236) or "Show the code" (VtaLinkShowTheCode),
     * which the screen enables once the address looks like a DID — it does not
     * appear on submit. They are not alternatives: "Show my code" submits the
     * address, and the panel it opens keeps the key behind "Show the code"
     * (TestFlight #25), so keep going until the key shows, tapping each step as
     * it appears, within 60 s. Submitting the address can reveal the key
     * directly, with the toggle gone before it can be tapped: ask for the goal
     * first. Below the fold the toggle is not in the tree at all on Android
     * (React Native clips off-screen views: a Pixel 6 profile, RC gate
     * 2026-09-25), so with neither toggle in the tree the content is swiped up
     * mid-screen before the next look. Where the admin adds the code must be in
     * view before the code is asked for (keyring-bifold#107: VtaLinkGiveKeyHow).
     */
    showTheCode: () =>
      step("showTheCode", async () => {
        const keyBy = io.now() + 60000;
        const tapped = new Set();
        while (!(await io.existsTestId(d, "VtaLinkManualDid", 1500))) {
          if (io.now() > keyBy) break;
          const anyToggle = (await onScreen("VtaLinkShowTheCode")) || (await onScreen("VtaLinkShowMyCode"));
          if (!anyToggle) {
            await swipeUpMidScreen();
            continue;
          }
          for (const key of ["VtaLinkShowTheCode", "VtaLinkShowMyCode"]) {
            if (tapped.has(key) || !(await onScreen(key))) continue;
            if (key === "VtaLinkShowTheCode") {
              if (!(await io.existsTestId(d, "VtaLinkGiveKeyHow", 3000))) {
                await io.screenshot(d, "link-give-key-how-hidden");
                throw failWith("the give-key screen hides how the admin adds the code", { giveKeyHow: false });
              }
              io.log("[e2e] give-key: how the admin adds it is in view before the code");
            }
            // Below the fold since the admin's steps are shown (keyring-bifold#107): a tap on an off-screen toggle
            // does nothing, and a sliver of it counts as "displayed" on Android (7 px at the scroll view's edge,
            // 220 gate), so first scroll the content to its end with one short swipe mid-screen, then find it.
            await swipeUpMidScreen();
            const toggle = await io.scrollToTestId(d, key, 4, { from: 0.5 }).catch(() => undefined);
            if (toggle) await toggle.click().catch(() => undefined);
            else await io.tapTestId(d, key, 15000).catch(() => undefined);
            tapped.add(key);
            break;
          }
        }
        await awaitStep("VtaLinkManualDid", 5000);
        const did = (await textOfId("VtaLinkManualDid")).trim();
        return { value: { did, tapped: [...tapped] } };
      }),
  };
}
