/**
 * The app's clocks a gate case waits on, as the build under test has them (gate efficiency item 3/4). A test build
 * carries E2E_CLOCKS=short (bifold #411): the grant windows are 60 s and the auto-lock default shorter, so linkwait's
 * cases wait about a minute, not ten. The store build has the real clocks. The Developer screen shows the clocks in
 * force under four testIDs (E2EClocksMode, E2EGrantWindowSeconds, E2EPhoneGrantWindowSeconds, E2EAutoLockMinutes);
 * flows.js readClocks reads them, and this file turns them into each case's waits, so one driver runs on either
 * build. Pure: no device, no Appium (clocks.test.mjs).
 */

/** The real clocks: the store build, and any build from before bifold #411 (no clock rows on its Developer screen). */
export const REAL_CLOCKS = Object.freeze({
  mode: "real",
  grantWindowS: 600,
  phoneGrantWindowS: 600,
  autoLockS: 300,
  source: "real clocks",
});

/** Seconds kept clear of a clock's edge, as the real-clock cases always did (read before 590 s of a 600 s window). */
export const EDGE_S = 10;
/** Seconds left between the end of create-wait-no-lock's idle and its read limit, for the reads themselves. */
export const READ_MARGIN_S = 15;

const number = (raw, what) => {
  const n = Number(String(raw ?? "").trim());
  if (String(raw ?? "").trim() === "" || !Number.isFinite(n) || n < 0) {
    throw new Error(`driver: the Developer screen's ${what} reads ${JSON.stringify(raw)}, not a number`);
  }
  return n;
};

/**
 * The four rows' texts → the clocks. Anything unreadable is the driver's failure ("driver: …", which the legs report
 * as a broken leg), never a guess: a case timed against the wrong clock says nothing about the app.
 */
export function parseClocks({ mode, grantWindowS, phoneGrantWindowS, autoLockMin }) {
  const m = String(mode ?? "").trim();
  if (m !== "short" && m !== "real") throw new Error(`driver: the Developer screen's E2EClocksMode reads ${JSON.stringify(mode)}, not short or real`);
  const clocks = {
    mode: m,
    grantWindowS: number(grantWindowS, "E2EGrantWindowSeconds"),
    phoneGrantWindowS: number(phoneGrantWindowS, "E2EPhoneGrantWindowSeconds"),
    // Minutes on screen (0.5 is 30 s); 0 is "Never", which no lock case can run against.
    autoLockS: Math.round(number(autoLockMin, "E2EAutoLockMinutes") * 60),
    source: `Developer screen: clocks ${m}`,
  };
  // "real" must be the real clocks: anything else is a build this harness does not know how to read.
  if (m === "real" && (clocks.grantWindowS !== REAL_CLOCKS.grantWindowS || clocks.phoneGrantWindowS !== REAL_CLOCKS.phoneGrantWindowS)) {
    throw new Error(`driver: clocks "real" but the grant windows read ${clocks.grantWindowS}/${clocks.phoneGrantWindowS} s, not 600`);
  }
  return clocks;
}

/** One line for a row's detail and the log: which clocks the case was timed against, and where they came from. */
export const clocksSaid = (c) => `clocks ${c.mode}: window ${c.grantWindowS} s, lock ${c.autoLockS ? `${c.autoLockS} s` : "never"} (${c.source})`;

/**
 * Each linkwait case's waits, from the clocks. The real-clock numbers are the ones the cases used before (400 s idle,
 * 720 s look, 180 s and 900 s away); the short ones scale from the same rules. Throws ("driver: …") when the clocks
 * leave a case nothing to prove, rather than timing it against a window it cannot see.
 */
export function linkWaitTiming(c) {
  const windowS = c.grantWindowS;
  const lockS = c.autoLockS;
  if (!lockS) throw new Error(`driver: the auto-lock reads Never, so no lock case can run (${clocksSaid(c)})`);
  // create-wait-no-lock: idle past the lock, and read before the window ends, so "still waiting, no PIN" shows the
  // hold (bifold #396) and not merely a window still open. Real: 300 + 100 = 400 s, read before 590 s.
  if (lockS + EDGE_S > windowS - EDGE_S) {
    throw new Error(`driver: a ${lockS} s lock leaves no time inside a ${windowS} s window to show the hold keeps it off (${clocksSaid(c)})`);
  }
  // Capped 15 s short of the read limit: the reads after the idle take seconds, and a short window leaves little
  // room (60/30: idle 35 s, read before 50). The real clocks are untouched by the cap (400 s, limit 575).
  const readBeforeS = windowS - EDGE_S;
  const noLockIdleS = Math.min(lockS + Math.round((windowS - lockS) / 3), readBeforeS - READ_MARGIN_S);
  if (noLockIdleS <= lockS) {
    throw new Error(`driver: a ${lockS} s lock leaves no idle past it before ${readBeforeS - READ_MARGIN_S} s of a ${windowS} s window (${clocksSaid(c)})`);
  }
  // link-no-answer: "didn't answer" is due once the window has ended (checks every 6 s); look 120 s past it. A touch
  // now and then, well inside the lock (110 s of 300 s), as a person waiting would; the loop polls at half that.
  const touchEveryS = Math.max(5, Math.round(lockS * 0.37));
  return {
    noLock: { idleMs: noLockIdleS * 1000, readBeforeS },
    noAnswer: {
      windowS,
      lookUntilMs: (windowS + 120) * 1000,
      tooSoonS: windowS - EDGE_S,
      touchEveryMs: touchEveryS * 1000,
      stepMs: Math.min(20, Math.max(2, Math.floor(touchEveryS / 2))) * 1000,
    },
    // create-window-paused: away under the lock (real 180 s of 300), then away past both the window and the lock
    // (real 900 s), so the lock signs out and Create's window is gone.
    paused: {
      shortAwayMs: Math.round(lockS * 0.6) * 1000,
      longAwayMs: Math.max(Math.round(windowS * 1.5), lockS + 60) * 1000,
    },
  };
}
