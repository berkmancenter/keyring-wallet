/**
 * Join (VtiJoin.ids.ts, the ways-in card JoinWaysCard.tsx) and the
 * community's own screen (VtiCommunity.ids.ts), one step per function: the
 * community's link opened, its ways in read, "Ask to join" or "Meet a vetter"
 * started, the waiting screen, the lost-request screen and "Send again", a
 * member's Done. The model of lib/keyringRoles.js: each step asserts the
 * screen it ends on, returns a record, throws a StepError with a screenshot
 * and the page source, and never waits without a deadline (pages/step.js).
 *
 * What the drivers did, moved here as it was (run-several-agents.mjs,
 * run-join-waiting.mjs, run-join-lost.mjs; 239 gate): the flows and the
 * `[e2e] …` lines they print are unchanged. The caller owns the session and
 * the order, and talks to the community itself (its admin script).
 *
 * Every step takes (d, args, opts): `opts.clock` { now, wait }, `opts.log`
 * the shared step log, `opts.say` the driver's logger. `args.owner` answers
 * Android's device-credential prompt, `async (tag) => boolean`
 * (agents.js `answerOwnerCheck`); with none it is not answered.
 */
import { execFileSync } from "node:child_process";
import { existsTestId, scrollToTestId, tapTestId, waitForTestId } from "../driver.js";
import { handleBiometricConfirmIfPresent, pasteLinkFromHome } from "../flows.js";
import { APP_ID } from "../config.js";
import { awaitSwitched } from "./agents.js";
import { awaitScreen, clockOf, elog, failWith, rowText, runStep, said, shot, textOf } from "./step.js";

const PAGE = "join";
const COMMUNITY = "community";

/** The Join screens a step can end on, in the order they are told apart (a page can show two at once). */
export const JOIN_MARKERS = [
  "EnterPIN",
  "JoinRequestLost",
  "JoinMemberCheck",
  "JoinStanding",
  "JoinRequestSent",
  "JoinMakeIdentity",
  "JoinError",
  "JoinNeedsAgent",
  "JoinNotAccepting",
  "JoinVersionUnsupported",
  "JoinWays",
  "JoinAsks",
  "JoinAsk",
  "JoinStart",
  "JoinAgain",
  "JoinAsContinue",
  "JoinSuggested",
  "JoinThisCommunity",
  "JoinLinkAgent",
  "JoinErrorCard",
  "JoinActions",
  "PreparingSlow",
  "JoinScroll",
  "VettingApplicantStep_",
  "PasteUrlButton",
  "AgentHome",
];

/** The community screen's markers. */
export const COMMUNITY_MARKERS = ["CommunityHeldElsewhere", "CommunityError", "ApplyToCommunityButton", "LeaveCommunityButton", "CommunityName", "CommunityScroll", "AgentHome"];

/** A Join screen that offers a way in, as the drivers took it: the ask, else the older Start. */
export const ASK_BUTTONS = ["JoinAsk", "JoinStart"];

const step = (d, name, opts, fn) => runStep(d, PAGE, name, opts, JOIN_MARKERS, fn);
const cstep = (d, name, opts, fn) => runStep(d, COMMUNITY, name, opts, COMMUNITY_MARKERS, fn);
const sayOf = (opts) => opts?.say ?? elog;
const noOwner = async () => false;

/** The community's link, as the app's QR carries it: `n` (its name) only when given. */
export const communityLink = (did, name) => `keyring://vti/community?d=${encodeURIComponent(did || "")}${name ? `&n=${encodeURIComponent(name)}` : ""}`;

// ---------------------------------------------------------------- readers (no step: they act on nothing)

/**
 * The waiting screen's lines: the identity it asked with (#319), the 238
 * "request sent" title and what will show when accepted (#344), the standing's
 * own words. Each null when not on the page.
 */
export async function readStanding(d) {
  const identityName = (await existsTestId(d, "JoinStandingIdentityName", 3000)) ? (await textOf(d, "JoinStandingIdentityName")).trim() : "";
  const requestSent = await existsTestId(d, "JoinRequestSent", 2000);
  return {
    identityName,
    requestSent,
    requestSentText: requestSent ? (await textOf(d, "JoinRequestSent").catch(() => "")).trim() : "",
    willShow: requestSent ? await existsTestId(d, "JoinWillShow", 2000) : false,
    standingText: await said(d, "JoinStandingText"),
    error: await said(d, "JoinError"),
  };
}

/** How Join lets this phone in: an agent chooser (older builds, #334 took it away), a way in, a standing already. */
export async function readEntry(d) {
  const chooser = (await existsTestId(d, "JoinWithAgent", 6000)) || (await existsTestId(d, "JoinUseSuggestedAgent", 1500)) || (await existsTestId(d, "JoinAgentSuggested", 1500));
  await scrollToTestId(d, "JoinAsk", 6, { from: 0.45 }).catch(() => undefined);
  const wayIn = (await existsTestId(d, "JoinAsk", 4000)) || (await existsTestId(d, "JoinStart", 1500)) || (await existsTestId(d, "JoinWays", 1500));
  return { chooser, wayIn, standing: await said(d, "JoinStandingText") };
}

/** The ways-in card (join 0.3): whether it shows, and each named way's row, "follows" line and Start. */
export async function readWays(d, ways = []) {
  const out = { ways: await existsTestId(d, "JoinWays", 1500), title: await said(d, "JoinWaysTitle"), others: await existsTestId(d, "JoinWaysOthers", 500), byWay: {} };
  for (const way of ways) {
    await scrollToTestId(d, `JoinWay_${way}`, 3, { from: 0.6 }).catch(() => undefined);
    out.byWay[way] = { row: await existsTestId(d, `JoinWay_${way}`, 1500), follows: await said(d, `JoinWayFollows_${way}`), start: await said(d, `JoinWayStart_${way}`) };
  }
  return out;
}

/** A member's Join (238, #344): the member check, Done, and the door to the community. */
export async function readMemberState(d) {
  return {
    check: await existsTestId(d, "JoinMemberCheck", 30000),
    done: Boolean(await scrollToTestId(d, "JoinDone", 4, { from: 0.5 }).catch(() => undefined)),
    open: await existsTestId(d, "JoinOpenCommunity", 1500),
  };
}

// ---------------------------------------------------------------- Join

export const join = {
  /**
   * Open the community's link: `via` "paste" hands it to the scanner's paste
   * screen from Home (as a scanned QR would), "intent" to the OS as a tap on
   * the link does (Android: `am start … VIEW`). Ends on a Join screen (any
   * JOIN_MARKERS entry but the lock and the scanner). `open(d, link)`, when
   * given, stands in for both ways (a test's). Value: { screen }.
   */
  openCommunity(d, { did, name, via = "paste", open, appId = APP_ID, udid = d.e2eUdid || process.env.UDID, timeoutMs = 30000 } = {}, opts = {}) {
    return step(d, "openCommunity", opts, async () => {
      if (!did) throw new Error("openCommunity needs did");
      const clock = clockOf(opts);
      const link = communityLink(did, name);
      if (open) {
        await open(d, link);
      } else if (via === "intent") {
        execFileSync("adb", ["-s", udid, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'${link}'`, appId], { encoding: "utf8" });
        await clock.wait(4000);
      } else {
        await pasteLinkFromHome(d, link);
      }
      const screens = JOIN_MARKERS.filter((m) => !["EnterPIN", "PasteUrlButton", "AgentHome"].includes(m));
      const screen = await awaitScreen(d, screens, { page: PAGE, markers: JOIN_MARKERS, timeoutMs, clock });
      return { value: { screen } };
    });
  },

  /**
   * Ask to join by the review way: "Join again" first when a refused or
   * withdrawn standing offers it (R10 after R5's decline; it sits below the
   * fold), then the ask (JoinAsk, else the older JoinStart), the identity step
   * continued, the biometric and owner prompts answered. `beforeTap` runs once
   * the ask is in view, before it is tapped (run-join-lost cuts the network
   * there). Ends on a Join screen. Value: { askId, again }.
   */
  ask(d, { owner = noOwner, tag = "join", beforeTap } = {}, opts = {}) {
    return step(d, "ask", opts, async () => {
      const clock = clockOf(opts);
      let again = await existsTestId(d, "JoinAgain", 3000);
      if (!again && (await existsTestId(d, "JoinStandingAgain", 2000))) again = Boolean(await scrollToTestId(d, "JoinAgain", 6, { from: 0.6, both: false }).catch(() => undefined));
      if (again) await tapTestId(d, "JoinAgain", 10000);
      await scrollToTestId(d, "JoinAsk", 6, { from: 0.45 }).catch(() => undefined);
      const askId = (await existsTestId(d, "JoinAsk", 3000)) ? "JoinAsk" : "JoinStart";
      if (beforeTap) await beforeTap();
      await tapTestId(d, askId, 15000);
      await waitForTestId(d, "JoinMakeIdentity", 30000).catch(() => undefined);
      if (await existsTestId(d, "JoinAsContinue", 3000)) await tapTestId(d, "JoinAsContinue", 10000);
      await handleBiometricConfirmIfPresent(d).catch(() => undefined);
      await owner(`${tag} identity`);
      await awaitScreen(d, JOIN_MARKERS.filter((m) => m !== "EnterPIN"), { page: PAGE, markers: JOIN_MARKERS, timeoutMs: 10000, clock });
      return { value: { askId, again } };
    });
  },

  /**
   * Start a named way in from the ways-in card (JoinWayStart_<way>): the
   * review way leads to the identity step, the vetting way ("Meet a vetter")
   * to Get vetted. Ends on the identity step, a standing, or Get vetted.
   * Value: { landed }.
   */
  startWay(d, { way, owner = noOwner } = {}, opts = {}) {
    return step(d, "startWay", opts, async () => {
      if (!way) throw new Error("startWay needs the way's id");
      const clock = clockOf(opts);
      const start = await scrollToTestId(d, `JoinWayStart_${way}`, 6, { from: 0.6 }).catch(() => undefined);
      if (!start) throw failWith(`no Start for the way "${way}" (JoinWayStart_${way})`, { way });
      await start.click();
      await handleBiometricConfirmIfPresent(d).catch(() => undefined);
      await owner(`way ${way}`);
      const landed = await awaitScreen(d, ["JoinMakeIdentity", "JoinStanding", "JoinRequestSent", "VettingApplicantStep_", "JoinError"], { page: PAGE, markers: JOIN_MARKERS, timeoutMs: 60000, clock });
      return { value: { landed } };
    });
  },

  /**
   * The request on its way: the waiting screen (JoinStanding) within
   * `timeoutMs`. With `required` false a late answer is reported, not failed
   * (run-join-waiting carries on to read what shows). Value: { shown }.
   */
  awaitSent(d, { timeoutMs = 240000, required = true } = {}, opts = {}) {
    return step(d, "awaitSent", opts, async () => {
      const clock = clockOf(opts);
      try {
        await awaitScreen(d, "JoinStanding", { page: PAGE, markers: JOIN_MARKERS, timeoutMs, clock, extra: async () => ({ error: await said(d, "JoinError") }) });
        return { value: { shown: "standing" } };
      } catch (err) {
        if (required) throw err;
        return { value: { shown: `no standing in ${Math.round(timeoutMs / 1000)} s` }, observed: err.observed };
      }
    });
  },

  /**
   * The lost-request screen (bifold #347): JoinRequestLost within `timeoutMs`
   * after Join was reopened, "Check again" pressed once after
   * `checkAgainAfterMs` when it is offered. Not lost within the deadline is
   * reported, not failed: the row judges. Ends on a Join screen.
   * Value: { lost, words, checked, standingText }.
   */
  awaitLost(d, { timeoutMs = 120000, checkAgainAfterMs = 30000 } = {}, opts = {}) {
    return step(d, "awaitLost", opts, async () => {
      const say = sayOf(opts);
      const clock = clockOf(opts);
      let lost = false;
      let checked = false;
      for (const until = clock.now() + timeoutMs; clock.now() < until && !lost; ) {
        lost = Boolean(await scrollToTestId(d, "JoinRequestLost", 2, { from: 0.5 }).catch(() => undefined));
        if (!lost && !checked && clock.now() > until - (timeoutMs - checkAgainAfterMs) && (await existsTestId(d, "JoinCheckAgain", 1000))) {
          await tapTestId(d, "JoinCheckAgain", 5000).catch(() => undefined);
          checked = true;
          say(`Join still waiting after ${Math.round(checkAgainAfterMs / 1000)} s: Check again`);
        }
        if (!lost) await clock.wait(2000);
      }
      const words = lost ? await said(d, "JoinRequestLost") : "";
      await awaitScreen(d, JOIN_MARKERS.filter((m) => m !== "EnterPIN"), { page: PAGE, markers: JOIN_MARKERS, timeoutMs: 5000, clock });
      return { value: { lost, words, checked, standingText: await said(d, "JoinStandingText") } };
    });
  },

  /**
   * Send a lost request again (JoinSendAgain → the identity step continued,
   * the prompts answered). The caller then awaits the standing (`awaitSent`).
   * Value: { continued }.
   */
  sendAgain(d, { owner = noOwner } = {}, opts = {}) {
    return step(d, "sendAgain", opts, async () => {
      if (!(await existsTestId(d, "JoinSendAgain", 3000))) throw failWith("no JoinSendAgain", {});
      await tapTestId(d, "JoinSendAgain", 10000);
      await waitForTestId(d, "JoinAsContinue", 30000).catch(() => undefined);
      const continued = await existsTestId(d, "JoinAsContinue", 3000);
      if (continued) await tapTestId(d, "JoinAsContinue", 10000);
      await handleBiometricConfirmIfPresent(d).catch(() => undefined);
      await owner("send again identity");
      await awaitScreen(d, JOIN_MARKERS.filter((m) => m !== "EnterPIN"), { page: PAGE, markers: JOIN_MARKERS, timeoutMs: 10000, clock: clockOf(opts) });
      return { value: { continued } };
    });
  },

  /**
   * A member's Done (238, #344): it goes to Your agent with the community's
   * card set apart. Ends on Your agent. Value: { lit }: AgentCommunityHighlighted
   * within 10 s.
   */
  done(d, _args = {}, opts = {}) {
    return step(d, "done", opts, async () => {
      await scrollToTestId(d, "JoinDone", 4, { from: 0.5 }).catch(() => undefined);
      if (!(await existsTestId(d, "JoinDone", 1500))) throw failWith("no JoinDone to tap", {});
      await tapTestId(d, "JoinDone", 10000);
      await awaitScreen(d, "AgentHome", { page: PAGE, markers: JOIN_MARKERS, timeoutMs: 15000, clock: clockOf(opts) });
      return { value: { lit: await existsTestId(d, "AgentCommunityHighlighted", 10000) } };
    });
  },

  /**
   * A member's "A different community" (IN-142, 239 re-pin): it must open the
   * scanner, not dead-end. Back to Join afterwards. Ends on Join.
   * Value: { offered, scanner }.
   */
  scanOtherCommunity(d, _args = {}, opts = {}) {
    return step(d, "scanOtherCommunity", opts, async () => {
      const other = await scrollToTestId(d, "JoinScanCommunity", 4, { from: 0.5 }).catch(() => undefined);
      let scanner = false;
      if (other) {
        await other.click();
        for (let i = 0; i < 3 && !scanner; i++) {
          scanner = await existsTestId(d, "PasteUrlButton", 5000);
          if (!scanner && (await existsTestId(d, "Continue", 1500))) await tapTestId(d, "Continue", 5000).catch(() => undefined);
        }
        await shot(d, "member-join-different-community");
        await d.back().catch(() => undefined);
        await existsTestId(d, "JoinMemberCheck", 10000);
      }
      await awaitScreen(d, JOIN_MARKERS.filter((m) => !["EnterPIN", "PasteUrlButton"].includes(m)), { page: PAGE, markers: JOIN_MARKERS, timeoutMs: 10000, clock: clockOf(opts) });
      return { value: { offered: Boolean(other), scanner } };
    });
  },
};

// ---------------------------------------------------------------- the community's own screen

export const community = {
  /**
   * #326 (IN-127): the community's screen never sends a request; its button is
   * "Choose how to join" and leads to Join's ways in. From the screen, opened
   * (agents.openCommunityCard). Ends on Join. Value: { words, landed }.
   */
  chooseHowToJoin(d, _args = {}, opts = {}) {
    return cstep(d, "chooseHowToJoin", opts, async () => {
      const btn = await scrollToTestId(d, "ApplyToCommunityButton", 6).catch(() => undefined);
      if (!btn) throw failWith("C's screen shows no ApplyToCommunityButton", {});
      const words = String((await btn.getAttribute("text").catch(() => "")) || (await textOf(d, "ApplyToCommunityButton").catch(() => ""))).trim();
      await btn.click();
      let landed = "";
      for (const id of ["JoinWays", "JoinAsks", "JoinStanding", "JoinAsk"]) if (!landed && (await existsTestId(d, id, id === "JoinWays" ? 15000 : 2000))) landed = id;
      if (!landed) throw failWith(`"${words || "?"}" led to no Join screen`, { words });
      return { value: { words, landed } };
    });
  },

  /**
   * What the community's screen says of who holds it (#320): on another
   * agent's phone it says so (CommunityHeldElsewhere, within `timeoutMs`),
   * offers that agent and no Leave. Value: { held, heldText, useHolder, leave }.
   */
  readHolding(d, { timeoutMs = 20000 } = {}, opts = {}) {
    return cstep(d, "readHolding", opts, async () => {
      const held = await existsTestId(d, "CommunityHeldElsewhere", timeoutMs);
      const heldText = held ? await rowText(d, "CommunityHeldElsewhereText") : null;
      const useHolder = await existsTestId(d, "CommunityUseHolderAgent", 3000);
      const leave = await existsTestId(d, "LeaveCommunityButton", 1500);
      return { value: { held, heldText, useHolder, leave } };
    });
  },

  /**
   * "Use <holder>": switch to the agent that holds the community, the owner
   * check answered, the switch waited out. Value: { heldGone }: the held card
   * gone 3 s after.
   */
  useHolderAgent(d, { name, owner = noOwner, tag = "use holder" } = {}, opts = {}) {
    return cstep(d, "useHolderAgent", opts, async () => {
      if (!name) throw new Error("useHolderAgent needs the holder's name");
      const clock = clockOf(opts);
      await tapTestId(d, "CommunityUseHolderAgent", 10000);
      await owner(tag);
      await awaitSwitched(d, name, sayOf(opts), clock).catch(() => undefined);
      await clock.wait(3000);
      return { value: { heldGone: !(await existsTestId(d, "CommunityHeldElsewhere", 3000)) } };
    });
  },
};
