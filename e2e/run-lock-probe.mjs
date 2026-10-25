#!/usr/bin/env node
/**
 * A REAL lock and unlock, no relaunch (#10; keyring-bifold #183). Every release
 * gate runs it on both platforms.
 *
 * Locking shuts the wallet's agent down, which drops every identity's
 * in-memory keys; unlocking restarts that agent or builds a new one. A build
 * that does not hand the new agent to the VTA link looks fine on screen and is
 * deaf: the persona's inbox stops being picked up until the app is killed.
 * Only a real lock shows it — a relaunch (what every other run does) builds
 * everything fresh and hides it.
 *
 *   PLATFORM=ios|android UDID=<sim udid or emulator serial> [APPIUM_PORT=…] \
 *     [BACKGROUND_S=330] [LINGER_S=90] \
 *     [MEDIATOR_LOG=~/vti-stack/logs/mediator.log PERSONA_MATCH=<DID fragment>[,<more>]] \
 *     node run-lock-probe.mjs
 *
 * The phone must already be linked, with a persona. The app is driven as it
 * is: opened and unlocked, sent to the background for BACKGROUND_S (past the
 * auto-lock time, 5 min by default), brought back, the PIN screen checked
 * (so it really locked), unlocked, and kept in the foreground for LINGER_S.
 *
 * With MEDIATOR_LOG (a lab run: the mediator's own log) the probe decides:
 * PASS when the persona picks up from the mediator within PICKUP_S (30) of
 * the unlock. PERSONA_MATCH is what identifies the persona's lines there —
 * its DID's SCID, or the key fragment the mediator logs. Without a log (the
 * Farm: its logs are not on this machine) it prints the marks and says so;
 * read the component's log for the window after UNLOCKED.
 *
 * Prints OPEN / BACKGROUND / LOCKED / UNLOCKED / DONE with UTC times, each
 * persona mediator event after the lock one per line with its own time, then
 * `LOCK_PROBE PASS|FAIL|NOT-LOCKED|UNDECIDED`.
 * Exit: 0 pass, 2 did not lock, 3 no pickup after unlock, 4 undecided (no
 * log), 1 the run failed.
 */
import "./lib/cli-guard.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { ensureAppium, existsTestId, screenshot, sleep, stopAppium } from "./lib/driver.js";
import { makeDriver, unlockToHome } from "./lib/keyringRoles.js";

const PLATFORM = process.env.PLATFORM ?? "ios";
const UDID = process.env.UDID;
const BACKGROUND_S = Number(process.env.BACKGROUND_S ?? 330);
const LINGER_S = Number(process.env.LINGER_S ?? 90);
const PICKUP_S = Number(process.env.PICKUP_S ?? 30);
const MEDIATOR_LOG = process.env.MEDIATOR_LOG?.replace(/^~/, homedir());
const PERSONA_MATCH = (process.env.PERSONA_MATCH ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const stamp = () => new Date().toISOString();
const EVENTS = ["Authentication successful", "Registered streaming", "Delivery-Request", "live_delivery", "Deregistered"];

/** The persona's mediator events from a minute before the lock, one per line with its own time. */
function personaEvents(lockedAt) {
  const from = lockedAt.getTime() - 60_000;
  const events = [];
  for (const raw of readFileSync(MEDIATOR_LOG, "utf8").split("\n")) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, "");
    if (!PERSONA_MATCH.some((m) => line.includes(m))) continue;
    const at = line.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?)/);
    if (!at) continue;
    const t = new Date(at[1].endsWith("Z") ? at[1] : `${at[1]}Z`);
    if (t.getTime() < from) continue;
    events.push({ t, kind: EVENTS.find((e) => line.includes(e)) ?? "other" });
  }
  return events;
}

let driver;
let lockedAt;
let unlockedAt;
let locked = false;
try {
  if (!UDID) throw new Error("UDID is required: the sim or emulator already linked, with a persona");
  if (MEDIATOR_LOG && PERSONA_MATCH.length === 0) throw new Error("MEDIATOR_LOG needs PERSONA_MATCH to find the persona's lines");
  await ensureAppium();
  driver = await makeDriver({ platform: PLATFORM, udid: UDID, keepState: true });
  await unlockToHome(driver);
  console.log(`OPEN ${stamp()}`);
  // Let the session and the persona's inbox come up before the lock.
  await sleep(20_000);
  console.log(`BACKGROUND ${BACKGROUND_S}s from ${stamp()}`);
  await driver.background(BACKGROUND_S);
  locked = await existsTestId(driver, "EnterPIN", 20_000);
  lockedAt = new Date();
  console.log(`${locked ? "LOCKED" : "NOT-LOCKED"} ${lockedAt.toISOString()}`);
  await screenshot(driver, `lock-probe-after-background-${PLATFORM}`);
  if (locked) {
    await unlockToHome(driver);
    unlockedAt = new Date();
    console.log(`UNLOCKED ${unlockedAt.toISOString()}`);
    await sleep(LINGER_S * 1000);
    console.log(`DONE ${stamp()}`);
  }
} catch (err) {
  process.exitCode = 1;
  console.error(err);
} finally {
  await driver?.deleteSession().catch(() => undefined);
  stopAppium();
}

if (process.exitCode !== 1) {
  if (!locked) {
    console.log(`LOCK_PROBE NOT-LOCKED — no PIN screen after ${BACKGROUND_S}s in the background (auto-lock time longer?)`);
    process.exitCode = 2;
  } else if (!MEDIATOR_LOG) {
    console.log(`LOCK_PROBE UNDECIDED — no MEDIATOR_LOG; read the mediator for persona pickups from ${unlockedAt.toISOString()}`);
    process.exitCode = 4;
  } else {
    const events = personaEvents(lockedAt);
    for (const { t, kind } of events) console.log(`  ${t.toISOString()} ${kind}${t >= unlockedAt ? "   <- after unlock" : ""}`);
    const deadline = unlockedAt.getTime() + PICKUP_S * 1000;
    // The mediator logs to the second: an event in the unlock's own second counts.
    const floor = Math.floor(unlockedAt.getTime() / 1000) * 1000;
    const picked = events.find((e) => e.kind === "Delivery-Request" && e.t.getTime() >= floor && e.t.getTime() <= deadline);
    console.log(
      picked
        ? `LOCK_PROBE PASS — persona pickup ${((picked.t - unlockedAt) / 1000).toFixed(0)} s after the unlock`
        : `LOCK_PROBE FAIL — no persona pickup within ${PICKUP_S} s of the unlock (${unlockedAt.toISOString()})`
    );
    process.exitCode = picked ? 0 : 3;
  }
}
