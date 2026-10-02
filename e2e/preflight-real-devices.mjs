#!/usr/bin/env node
/**
 * Preflight for an attended real-device e2e run (yarn e2e:vrc:devices*,
 * yarn e2e:vrc:witnessed:*android-only / :devices, and DIDComm-v2 variants).
 *
 * Exists because every one of these runs is slow (minutes) and attended (a
 * human has to stand at two phones and authenticate) — so a mistake that
 * only surfaces 5-10 minutes in, as a confusing UI timeout deep in onboarding,
 * is far more expensive than the same mistake caught in the first second.
 * Every check below is something that has actually caused a confusing
 * failure on a real run (2026-09-28/29 — see e2e run notes / the handoff
 * doc), not a hypothetical.
 *
 * Usage:
 *   node preflight-real-devices.mjs                    # both android-only witnessed
 *   ANDROID_UDID=<a> ANDROID_UDID2=<b> node preflight-real-devices.mjs
 *   node preflight-real-devices.mjs --manage-device-settings   # see below
 *   E2E_MANAGE_DEVICE_SETTINGS=1 node preflight-real-devices.mjs
 *
 * Exits 0 if every check passes, non-zero with a clear, actionable message
 * naming the FIRST failing check otherwise (fail fast, don't waste time
 * proving check #2 also would have failed once #1 already did).
 *
 * This intentionally does NOT try to fix anything itself (start a mediator,
 * rebuild the APK, install packages) — it only tells you clearly and
 * quickly what's wrong, since automatically doing any of these is either
 * slow itself (a rebuild) or a real decision (which mediator invitation to
 * use). Fixing is one command away in every message below.
 *
 * The one exception is app-install state (below): a full uninstall of the
 * disposable test app itself is always safe and always done automatically,
 * on any device, because it's the app THIS harness owns.
 *
 * Device-wide SETTINGS (screensaver/dream, screen-off timeout) are a
 * different matter — these are real phones, possibly someone's daily
 * driver, and changing them is a real, persistent, user-visible action
 * outside anything this harness owns. That check is OFF by default; opt in
 * per-run with `--manage-device-settings` or `E2E_MANAGE_DEVICE_SETTINGS=1`
 * when you know the devices are dedicated test hardware (or don't mind the
 * change) — see the check itself for exactly what it touches.
 */

const MANAGE_DEVICE_SETTINGS =
  process.argv.includes("--manage-device-settings") || process.env.E2E_MANAGE_DEVICE_SETTINGS === "1";
import { execSync, execFileSync, spawn } from "node:child_process";
import { existsSync, statSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { checkMetroIsThisWorktree } from "./lib/driver.js";
import { ANDROID_APK } from "./lib/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const appEnvPath = join(repoRoot, "app", ".env");
const witnessServerDir = join(repoRoot, "bifold", "packages", "witness-server");

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

/** Resolved once, reused by every check below that needs device UDIDs. */
function resolveTwoAndroidUdids() {
  const udidA = process.env.ANDROID_UDID;
  const udidB = process.env.ANDROID_UDID2;
  if (udidA && udidB) return [udidA, udidB];
  const out = execSync("adb devices").toString();
  const physical = out
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter(([id, state]) => id && state === "device" && !id.startsWith("emulator-"))
    .map(([id]) => id);
  if (physical.length !== 2) {
    throw new Error(
      `expected exactly two physical Android devices, found ${physical.length} (${physical.join(", ") || "none"}). ` +
        `Run \`adb devices\` and connect/disconnect until exactly two show state "device", or set ` +
        `ANDROID_UDID and ANDROID_UDID2 explicitly.`
    );
  }
  return physical;
}

// ---------- 1. exactly two physical Android devices ----------
let resolvedUdids;
check("two physical Android devices connected", () => {
  resolvedUdids = resolveTwoAndroidUdids();
  return resolvedUdids.join(", ");
});

// ---------- 2. (opt-in) disable each device's screensaver/dream ----------
// A real, costly mistake (2026-09-29): these are real phones (one a daily
// driver), plugged in over USB for the whole run. One had
// `screensaver_activate_on_dock` on — Android starts the dream (a full-screen
// charging animation) the instant it's plugged in, completely independent of
// the screen-off timeout. Once it's up, Appium can't interact with the app at
// all, and everything downstream times out with a misleading error (onboarding/
// discovery/exchange — whatever the harness happened to be waiting on) that has
// nothing to do with the actual cause.
//
// OFF by default: unlike the app-install wipe below, this changes real,
// persistent, user-visible device settings (not just this harness's own
// disposable test app) — the harness has no business touching that without
// being asked. Opt in with --manage-device-settings or
// E2E_MANAGE_DEVICE_SETTINGS=1 when you know that's fine for the devices in
// use. Nothing here is reverted automatically when you're done — if you
// enable it, remember you're leaving the screensaver off afterward.
check("screensaver/dream disabled on both devices (opt-in — a charging dock dream blocks all interaction)", () => {
  if (!MANAGE_DEVICE_SETTINGS) {
    return "skipped — pass --manage-device-settings or set E2E_MANAGE_DEVICE_SETTINGS=1 to enable";
  }
  const results = resolvedUdids.map((udid) => {
    execSync(`adb -s ${udid} shell settings put secure screensaver_enabled 0`);
    execSync(`adb -s ${udid} shell settings put secure screensaver_activate_on_dock 0`);
    execSync(`adb -s ${udid} shell settings put secure screensaver_activate_on_sleep 0`);
    execSync(`adb -s ${udid} shell input keyevent KEYCODE_WAKEUP`);
    return `${udid}: disabled + woken`;
  });
  return results.join("; ");
});

// ---------- 3. wipe any existing app install on both devices ----------
// A real, costly mistake (2026-09-29): `adb install -r` (reinstall,
// preserves data) between manual retries left a device's app already
// onboarded with a real identity from a PRIOR attempt. The test flow then
// polled for the RCard identity-entry screen for 30s against a device that
// had already passed it and moved on to Contacts — a confusing failure with
// no obvious link back to "the app already had data on it". `am force-stop`
// (also used between retries) only kills the process; it does not clear
// data, so this is easy to reach for without noticing the difference.
// Unlike every other check here, this one FIXES rather than just reports —
// a full uninstall is cheap (seconds) and always safe on a disposable e2e
// test device, so there's no reason to only warn about it.
check("both devices start from a clean app install (no leftover state)", () => {
  const results = resolvedUdids.map((udid) => {
    // `adb uninstall`'s own stdout is ambiguous: DELETE_FAILED_INTERNAL_ERROR
    // is what it prints BOTH for "the package isn't installed" (logcat's
    // real PackageManager line says "Not removing non-existent package",
    // but that never reaches adb's own output) AND for an actual failure.
    // Check installed-ness directly first so "already clean" and "a real
    // uninstall problem" can't be confused with each other.
    const installed = execSync(`adb -s ${udid} shell pm list packages com.ariesbifold`).toString().includes("com.ariesbifold");
    if (!installed) return `${udid}: already clean (not installed)`;
    execSync(`adb -s ${udid} shell am force-stop com.ariesbifold`, { stdio: "ignore" });
    try {
      execSync(`adb -s ${udid} uninstall com.ariesbifold`, { stdio: "pipe" });
      return `${udid}: uninstalled`;
    } catch (err) {
      const msg = (err.stdout?.toString() ?? err.message).trim().split("\n").pop();
      throw new Error(
        `${udid} has com.ariesbifold installed and refused to uninstall it ("${msg}"). This device WILL start ` +
          `the next run with leftover state from a previous one — the exact bug this check exists to prevent ` +
          `(2026-09-29). Try manually: \`adb -s ${udid} shell pm clear com.ariesbifold\`, or a device reboot if ` +
          `that also fails.`
      );
    }
  });
  return results.join("; ");
});

// ---------- 4. Metro is up and serving THIS worktree ----------
check("Metro is running and serving this worktree", async () => {
  await checkMetroIsThisWorktree();
  return "ok (or not yet started — that's a separate, self-evident failure, not this check's job)";
});

// ---------- 5. the mediator invitation in app/.env is actually reachable ----------
check("app/.env's MEDIATOR_URL is a live, reachable mediator", async () => {
  if (!existsSync(appEnvPath)) {
    throw new Error(`${appEnvPath} does not exist — copy app/.env.sample and run \`yarn mediator\` first.`);
  }
  const env = readEnvFile(appEnvPath);
  const raw = env.MEDIATOR_URL;
  if (!raw) {
    throw new Error(
      `app/.env has no active MEDIATOR_URL line (commented-out lines don't count). Run \`yarn mediator\` at the ` +
        `repo root — it writes a live invitation into app/.env for you.`
    );
  }
  // The invitation is `<tunnel-base>?c_i=<base64 OOB>` or `?oob=<base64 OOB>`
  // — either way, the tunnel base URL itself is what actually has to be
  // reachable; a dead cloudflared tunnel from a past session fails DNS
  // resolution entirely (this exact thing happened 2026-09-29 — the mediator
  // wasn't running at all, and .env still held the previous run's now-dead
  // trycloudflare.com hostname).
  const base = raw.split("?")[0];
  let res;
  try {
    res = await fetch(base, { method: "GET", signal: AbortSignal.timeout(8000) });
  } catch (err) {
    throw new Error(
      `MEDIATOR_URL's host (${base}) is not reachable (${err.cause?.code ?? err.message}). This is almost always ` +
        `a stale invitation from a mediator that's no longer running — cloudflared tunnel hostnames die with the ` +
        `process, they don't persist across sessions. Run \`yarn mediator\` at the repo root (in its own terminal, ` +
        `leave it running), then rebuild the app (see next check).`
    );
  }
  // Any HTTP response at all (even a 404) proves the tunnel + mediator are
  // both actually up; only a network-level failure above means they're not.
  return `${base} responded (HTTP ${res.status})`;
});

// ---------- 6. the built APK is not older than app/.env ----------
check("the built debug APK was built AFTER app/.env's current MEDIATOR_URL", () => {
  if (!existsSync(ANDROID_APK)) {
    throw new Error(`Android APK not found: ${ANDROID_APK}\n  Build it: cd app/android && ./gradlew assembleDebug`);
  }
  if (!existsSync(appEnvPath)) return "app/.env missing — a different check already caught this";
  const envMtime = statSync(appEnvPath).mtimeMs;
  const apkMtime = statSync(ANDROID_APK).mtimeMs;
  if (envMtime > apkMtime) {
    const envAge = new Date(envMtime).toISOString();
    const apkAge = new Date(apkMtime).toISOString();
    throw new Error(
      `app/.env (modified ${envAge}) is newer than the built APK (built ${apkAge}). react-native-config bakes ` +
        `.env values into the native build at COMPILE time — they are NOT read at JS runtime. The app is about to ` +
        `install with a stale, possibly-dead mediator invitation baked in, and this failure mode is silent: the ` +
        `app boots and onboards fine, then hangs or errors deep in the exchange flow with no obvious connection ` +
        `to the real cause (this exact thing cost a full attended run 2026-09-29). Rebuild: ` +
        `\`cd app/android && ./gradlew assembleDebug\`, then re-run this preflight.`
    );
  }
  return `APK built ${new Date(apkMtime).toISOString()}, after .env's last change`;
});

// ---------- 7. witness-server's own ports are free ----------
check("witness-server's ports are free", async () => {
  const port = Number(process.env.WITNESS_PORT || 9102);
  const webPort = Number(process.env.WITNESS_WEB_PORT || 9103);
  for (const p of [port, webPort]) {
    const inUse = await new Promise((resolve) => {
      const srv = createServer();
      srv.once("error", () => resolve(true));
      srv.once("listening", () => srv.close(() => resolve(false)));
      srv.listen(p, "0.0.0.0");
    });
    if (inUse) {
      throw new Error(
        `port ${p} is already in use (by something this preflight can't identify — could be a stray process from ` +
          `an unrelated checkout on a shared machine, as happened 2026-09-29). Set WITNESS_PORT/WITNESS_WEB_PORT ` +
          `to different ports, or find and stop whatever's on ${p} (\`ss -ltnp | grep :${p}\`, then \`docker ps\` ` +
          `if that shows nothing — it may be a container).`
      );
    }
  }
  return `${port}, ${webPort} both free`;
});

// ---------- 8. witness-server actually boots without crashing ----------
// This is the single highest-value check here: it would have caught BOTH
// real, previously-unknown bugs found 2026-09-29 (a pure-ESM dependency
// breaking CJS `require()`, and a Node-only `fs`/`path` import reachable
// from code Metro also has to bundle) — neither was caught by the unit test
// suites, which run under Jest and never actually launch the real process.
// A cheap, generic "does it start" smoke check catches this whole CLASS of
// bug without needing to know what any specific one is.
check("witness-server's compiled build actually starts (no crash in the first few seconds)", async () => {
  const distIndex = join(witnessServerDir, "dist", "index.js");
  if (!existsSync(distIndex)) {
    throw new Error(`${distIndex} doesn't exist. Build it: cd bifold/packages/witness-server && yarn build`);
  }
  const real = spawn("node", ["dist/index.js"], {
    cwd: witnessServerDir,
    env: { ...process.env, WITNESS_PORT: "0", WITNESS_WEB_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  real.stderr.on("data", (b) => (stderr += b.toString()));
  const crashed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 6000); // still running after 6s = healthy (it's a server; it shouldn't exit on its own)
    real.once("exit", () => {
      clearTimeout(timer);
      resolve(true); // exited on its own before the timeout at all = crash, regardless of code
    });
  });
  if (!real.killed) real.kill("SIGKILL");
  if (crashed && stderr) {
    throw new Error(
      `witness-server's compiled build crashed on startup within 6s:\n${stderr.slice(0, 2000)}\n` +
        `This is exactly the class of bug Jest's own test suites don't catch (they never launch the real ` +
        `process) — rebuild after any dependency change: cd bifold && yarn install && yarn workspace ` +
        `@bifold/witness-server build, then re-run this preflight.`
    );
  }
  return "started cleanly (or exited 0 for an unrelated config reason — a genuine crash prints its stack above)";
});

// ---------- 9. cloudflared is installed (witness-server's tunnel needs it) ----------
check("cloudflared is installed", () => {
  try {
    execFileSync("which", ["cloudflared"], { stdio: "ignore" });
  } catch {
    throw new Error(`cloudflared not found on PATH — the witness needs it for its HTTPS tunnel. Install: https://github.com/cloudflare/cloudflared`);
  }
  return "found";
});

function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

// ---------- run ----------
let failed = false;
for (const { name, fn } of checks) {
  process.stdout.write(`[preflight] ${name} ... `);
  try {
    const detail = await fn();
    console.log(`OK${detail ? ` (${detail})` : ""}`);
  } catch (err) {
    console.log("FAILED");
    console.error(`\n[preflight] ✗ ${name}\n\n${err.message}\n`);
    failed = true;
    break; // fail fast — don't waste time on later checks once one's already wrong
  }
}

if (failed) {
  console.error("[preflight] Fix the above and re-run before starting an attended real-device e2e suite.");
  process.exit(1);
}
console.log("\n[preflight] All checks passed — safe to start an attended real-device e2e run.");
