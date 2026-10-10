/**
 * The page-object step, the model of lib/keyringRoles.js for any page: one
 * function per step, which asserts the screen it ends on, returns a record,
 * fails by name with a screenshot and the page source, and never waits
 * without a deadline. A page object (agents.js, join.js) is a set of these
 * over one screen's testIDs; the caller owns the session and the order.
 *
 * Record, one JSON line in the run's shared log (opts.log or E2E_STEP_LOG),
 * the same shape as a vetting step's so the two line up by time:
 *
 *   { role, step, platform, device, ok, startedAt, endedAt,
 *     observed: { screen, ... }, value?, error?, screenshot?, source? }
 *
 * `role` is the page's name ("agents", "join"). `observed.screen` is the
 * page's marker the screen ended on (see `whichShowing`).
 *
 * Every wait takes a clock, `opts.clock = { now, wait }`, so a unit test can
 * run the deadlines without the time (the model of lib/steady.js).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { deviceTag, dumpSource, existsTestId, screenshot, sleep } from "../driver.js";
import { StepError, textOf } from "../keyringRoles.js";
import { TEST_ID_PREFIX } from "../config.js";

export { StepError, textOf };

/** The drivers' own log line: `[e2e] HH:MM:SS.mmmZ <message>`; the legs grep `^\[e2e\] [0-9]`. */
export const utc = () => new Date().toISOString().slice(11, 23) + "Z";
export const elog = (s) => console.log(`[e2e] ${utc()} ${s}`);

/** The clock a step waits by: the caller's (a test's), else the real one. */
export const clockOf = (opts) => ({ now: opts?.clock?.now ?? Date.now, wait: opts?.clock?.wait ?? sleep });

/** An error that carries what the screen said, for the record. */
export function failWith(message, observed) {
  return Object.assign(new Error(message), { observed });
}

function logPath(opts) {
  return opts?.log || process.env.E2E_STEP_LOG || "";
}

function writeRecord(opts, record) {
  const file = logPath(opts);
  if (!file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + "\n");
}

/** A screenshot that never throws: a miss is logged, as the drivers did. */
export const shot = (d, name) => screenshot(d, name).catch((e) => elog(`screenshot ${name} not taken: ${String(e.message).slice(0, 60)}`));

/**
 * Which of `ids` the page shows now, the first in order, from one read of the
 * page source; null for none. Android's source leaves out what is below the
 * fold, so a marker should be a screen's root or header, not its last line.
 */
export async function whichShowing(d, ids) {
  let src = "";
  try {
    src = await d.getPageSource();
  } catch {
    return null;
  }
  // A marker ending in "_" is a stem (VettingApplicantStep_): any id built on it counts.
  return ids.find((id) => (id.endsWith("_") ? src.includes(`${TEST_ID_PREFIX}${id}`) : src.includes(`${TEST_ID_PREFIX}${id}"`))) ?? null;
}

/**
 * Run one step: time it, run `fn`, say which of the page's markers the screen
 * ended on, write the record. `fn` returns { value?, observed? }; a throw
 * becomes a StepError with a screenshot, the page source, and the marker the
 * screen was on at the time. `markers` is the page's list, for `observed.screen`.
 */
export async function runStep(d, page, step, opts, markers, fn) {
  const startedAt = new Date().toISOString();
  const base = { role: page, step, platform: d.e2ePlatform, device: deviceTag(d) };
  try {
    const out = (await fn()) || {};
    const record = {
      ...base,
      ok: true,
      startedAt,
      endedAt: new Date().toISOString(),
      observed: { screen: await whichShowing(d, markers), ...(out.observed || {}) },
      ...(out.value !== undefined ? { value: out.value } : {}),
    };
    writeRecord(opts, record);
    console.log(`[step] ${page}.${step} ok${out.value !== undefined ? ` — ${JSON.stringify(out.value).slice(0, 120)}` : ""}`);
    return record;
  } catch (err) {
    const tag = `step-${page}-${step}`;
    const shotFile = await screenshot(d, tag).catch(() => undefined);
    const source = await dumpSource(d, tag).catch(() => undefined);
    const record = {
      ...base,
      ok: false,
      startedAt,
      endedAt: new Date().toISOString(),
      observed: { screen: await whichShowing(d, markers), ...(err?.observed || {}) },
      error: err?.message || String(err),
      ...(typeof shotFile === "string" ? { screenshot: shotFile } : {}),
      ...(typeof source === "string" ? { source } : {}),
    };
    writeRecord(opts, record);
    console.log(`[step] ${page}.${step} FAILED — ${record.error}`);
    throw new StepError(`${page}.${step}: ${record.error}`, record);
  }
}

/**
 * Wait until the screen shows one of `want`, reading which of the page's
 * `markers` shows meanwhile. On the deadline, say where it is instead and for
 * how long it has been there: "stuck at JoinMakeIdentity for 120 s" is the
 * finding, "timeout" is not. Returns the marker reached.
 */
export async function awaitScreen(d, want, { page = "page", markers = [], timeoutMs, pollMs = 1000, clock = clockOf(), extra = async () => ({}) } = {}) {
  if (!(timeoutMs > 0)) throw new Error(`awaitScreen(${page}): no deadline`);
  const wanted = [want].flat();
  const all = [...new Set([...wanted, ...markers])];
  const until = clock.now() + timeoutMs;
  let current = null;
  let since = clock.now();
  let lastSeen = null;
  for (;;) {
    const now = await whichShowing(d, all);
    if (now) lastSeen = now;
    if (now !== current) {
      current = now;
      since = clock.now();
    }
    if (current && wanted.includes(current)) return current;
    if (clock.now() >= until) {
      const secondsOnScreen = Math.round((clock.now() - since) / 1000);
      const observed = { screen: current, secondsOnScreen, lastSeen, ...(await extra()) };
      throw failWith(
        current
          ? `stuck at "${current}" for ${secondsOnScreen} s, waiting for ${wanted.join(" | ")}`
          : `no ${page} screen is showing (last seen: ${lastSeen ?? "none"}; waiting for ${wanted.join(" | ")})`,
        observed
      );
    }
    await clock.wait(pollMs);
  }
}

/** The testIDs on the page that begin with `prefix`, in page order, on either platform. */
export async function idsWithPrefix(d, prefix) {
  const idAttr = d.e2ePlatform === "ios" ? "@name" : "@resource-id";
  const els = await d.$$(`//*[starts-with(${idAttr},"${TEST_ID_PREFIX}${prefix}")]`);
  const ids = [];
  for (const el of els) ids.push(String(await el.getAttribute(d.e2ePlatform === "ios" ? "name" : "resource-id")).replace(TEST_ID_PREFIX, ""));
  return ids;
}

/** A testID's words squashed to one line, or null when it is not on the page (the drivers' `txt`). */
export const said = async (d, id, timeout = 800) => ((await existsTestId(d, id, timeout)) ? (await textOf(d, id).catch(() => "")).replace(/\s+/g, " ").trim() : null);

/**
 * A row's text as shown: its own, else its descendants' (an Android container
 * carries none), else its next sibling's (an empty view whose words follow it).
 * Null when the row is not on the page. Android only; iOS carries a label.
 */
export async function rowText(d, id) {
  if (d.e2ePlatform === "ios") return said(d, id);
  const el = await d.$(`android=new UiSelector().resourceId("${TEST_ID_PREFIX}${id}")`);
  if (!(await el.isExisting().catch(() => false))) return null;
  const own = await el.getAttribute("text").catch(() => "");
  if (own) return own;
  let out = "";
  for (const c of await el.$$(".//*")) {
    const t = await c.getAttribute("text").catch(() => "");
    if (t) out += `${t} `;
  }
  if (!out.trim()) {
    for (const c of await d.$$(`//*[@resource-id="${TEST_ID_PREFIX}${id}"]/following-sibling::*[1][@text!=""]`)) out += `${await c.getAttribute("text").catch(() => "")} `;
  }
  return out.trim();
}
