import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import os from "node:os";

import { androidCaps, iosCaps } from "./config.js";
import { createSession, screenshot } from "./driver.js";

/**
 * Resource budget for concurrently running emulated/simulated devices.
 *
 * These are deliberately conservative rules of thumb, not measurements of
 * this specific machine — this repo has real prior history of emulators
 * OOM-killing each other when run too aggressively in parallel. An Android
 * emulator does full CPU emulation (or at best hardware-accelerated
 * virtualization) plus boots an entire OS image, so it is budgeted heavily.
 * An iOS Simulator runs the app binary natively on the host's own CPU (no
 * instruction emulation) and shares the host's frameworks, so it is much
 * lighter — but it only exists on macOS at all.
 *
 * `HOST_RESERVE_*` is what's left for the thing actually driving the test:
 * Metro's bundler, the Appium server, adb/xcrun, this shell, and the OS
 * itself. Getting this wrong doesn't fail loudly — it shows up as flaky,
 * hard-to-reproduce timeouts and dropped connections partway through a run,
 * which is a much worse failure mode than refusing to start.
 */
const BUDGET = {
  androidEmulatorRamGb: 4,
  androidEmulatorCpuCores: 1.5,
  iosSimulatorRamGb: 1.5,
  iosSimulatorCpuCores: 0.5,
  hostReserveRamGb: 4,
  hostReserveCpuCores: 2,
};

function availableRamGb() {
  if (process.platform === "linux") {
    try {
      const meminfo = readFileSync("/proc/meminfo", "utf8");
      const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
      if (match) return Number(match[1]) / 1024 / 1024;
    } catch {
      /* fall through to the generic estimate below */
    }
  }
  if (process.platform === "darwin") {
    try {
      // vm_stat reports pages; "free" ~= free + inactive (reclaimable without swapping).
      const pageSize = Number(
        execSync("sysctl -n hw.pagesize", { encoding: "utf8" }).trim()
      );
      const vmStat = execSync("vm_stat", { encoding: "utf8" });
      const pagesOf = (label) => {
        const m = vmStat.match(new RegExp(`Pages ${label}:\\s+(\\d+)\\.`));
        return m ? Number(m[1]) : 0;
      };
      const freePages = pagesOf("free") + pagesOf("inactive");
      return (freePages * pageSize) / 1024 / 1024 / 1024;
    } catch {
      /* fall through */
    }
  }
  // Generic fallback (also what Windows gets): Node's own freemem() undercounts
  // reclaimable-but-cached memory on Linux, which is why the platform-specific
  // paths above are preferred when available — but it's a safe (if pessimistic)
  // floor everywhere else.
  return os.freemem() / 1024 / 1024 / 1024;
}

function cpuCoreCount() {
  return os.cpus().length;
}

/**
 * How many of each device type this machine can plausibly run at once,
 * right now, per the static budget above — NOT a measurement of what's
 * already running, and not a guarantee (a rule of thumb can be wrong on an
 * unusual machine). Call this BEFORE writing an e2e test that needs N
 * concurrent devices, so a too-large player count is caught at design time
 * rather than as a mysterious timeout mid-run.
 */
export function checkDeviceBudget({ android = 0, ios = 0 } = {}) {
  const ramGb = availableRamGb();
  const cores = cpuCoreCount();
  const usableRamGb = Math.max(0, ramGb - BUDGET.hostReserveRamGb);
  const usableCores = Math.max(0, cores - BUDGET.hostReserveCpuCores);

  const maxAndroidByRam = Math.floor(usableRamGb / BUDGET.androidEmulatorRamGb);
  const maxAndroidByCpu = Math.floor(usableCores / BUDGET.androidEmulatorCpuCores);
  const maxAndroid = Math.max(0, Math.min(maxAndroidByRam, maxAndroidByCpu));

  const iosAvailable = process.platform === "darwin";
  const maxIosByRam = iosAvailable ? Math.floor(usableRamGb / BUDGET.iosSimulatorRamGb) : 0;
  const maxIosByCpu = iosAvailable ? Math.floor(usableCores / BUDGET.iosSimulatorCpuCores) : 0;
  const maxIos = iosAvailable ? Math.max(0, Math.min(maxIosByRam, maxIosByCpu)) : 0;

  const reasons = [];
  if (!iosAvailable && ios > 0) {
    reasons.push(
      `iOS Simulator only runs on macOS (this host is ${process.platform}) — ${ios} iOS device(s) requested cannot run here at all.`
    );
  }
  if (android > maxAndroid) {
    reasons.push(
      `Requested ${android} Android emulator(s), but this machine has room for at most ${maxAndroid} ` +
        `(${usableRamGb.toFixed(1)}GB usable RAM / ${BUDGET.androidEmulatorRamGb}GB each, ` +
        `${usableCores.toFixed(1)} usable cores / ${BUDGET.androidEmulatorCpuCores} each).`
    );
  }
  if (iosAvailable && ios > maxIos) {
    reasons.push(
      `Requested ${ios} iOS Simulator(s), but this machine has room for at most ${maxIos} ` +
        `(${usableRamGb.toFixed(1)}GB usable RAM / ${BUDGET.iosSimulatorRamGb}GB each, ` +
        `${usableCores.toFixed(1)} usable cores / ${BUDGET.iosSimulatorCpuCores} each).`
    );
  }

  return {
    platform: process.platform,
    totalRamGb: Number(ramGb.toFixed(1)),
    availableRamGb: Number(usableRamGb.toFixed(1)),
    cpuCores: cores,
    availableCpuCores: Number(usableCores.toFixed(1)),
    requested: { android, ios },
    maxFeasible: { android: maxAndroid, ios: maxIos },
    feasible: reasons.length === 0,
    reasons,
    budget: BUDGET,
  };
}

/**
 * Boot `count` Android emulator sessions, one per role in `roles`
 * (e.g. ['host', 'player1', 'player2']). Generalizes the existing
 * ANDROID_AVD / ANDROID_AVD2 pair to ANDROID_AVD, ANDROID_AVD2, ANDROID_AVD3…
 * so existing two-device runners and their env vars keep working unchanged.
 * Each AVD must already exist (create once with Android Studio / avdmanager);
 * this does not create AVDs, only boots sessions against ones already there.
 */
async function createAndroidDevices(roles) {
  const devices = {};
  for (let i = 0; i < roles.length; i++) {
    const envVar = i === 0 ? "ANDROID_AVD" : `ANDROID_AVD${i + 1}`;
    const avd = process.env[envVar];
    if (!avd) {
      throw new Error(
        `createAndroidDevices: role "${roles[i]}" (device ${i + 1} of ${roles.length}) needs ` +
          `${envVar} set to an existing AVD's name. Create one for each role first ` +
          `(Android Studio's Device Manager, or 'avdmanager create avd').`
      );
    }
    devices[roles[i]] = await createSession("android", androidCaps(avd));
  }
  return devices;
}

/**
 * Boot `count` iOS Simulator sessions, one per role. Each needs its own
 * WDA port and MJPEG port — concurrent WDA instances on the same port
 * collide — mirroring the real-device `ports` pattern `iosDeviceCaps`
 * already uses. Simulator identity comes from IOS_UDID / IOS_UDID2 / …
 * (a specific simulator's UDID, from `xcrun simctl list devices`), NOT a
 * device name + OS version pair, so each role can be pinned to its own
 * already-created simulator rather than fighting over the same one.
 */
async function createIosDevices(roles) {
  const devices = {};
  for (let i = 0; i < roles.length; i++) {
    const envVar = i === 0 ? "IOS_UDID" : `IOS_UDID${i + 1}`;
    const udid = process.env[envVar];
    if (!udid) {
      throw new Error(
        `createIosDevices: role "${roles[i]}" (device ${i + 1} of ${roles.length}) needs ` +
          `${envVar} set to an existing Simulator's UDID ('xcrun simctl list devices' — ` +
          `create one per role with 'xcrun simctl create').`
      );
    }
    const caps = {
      ...iosCaps(),
      "appium:udid": udid,
      "appium:wdaLocalPort": 8100 + i,
      "appium:mjpegServerPort": 9100 + i,
    };
    devices[roles[i]] = await createSession("ios", caps);
  }
  return devices;
}

/**
 * Boot every device a game's e2e test needs in one call. `android` and
 * `ios` are each an array of role labels for that platform — pass only the
 * platform(s) this particular test uses. Always run `checkDeviceBudget`
 * first; this function boots unconditionally and will genuinely exhaust
 * the host if asked for more than it can hold.
 *
 * Returns a flat `{ roleLabel: driver }` map across both platforms, so
 * test code addresses a device by its role ("host", "player1", …) without
 * caring which platform it happened to run on.
 */
export async function createDevices({ android = [], ios = [] } = {}) {
  const [androidDevices, iosDevices] = await Promise.all([
    android.length ? createAndroidDevices(android) : {},
    ios.length ? createIosDevices(ios) : {},
  ]);
  return { ...androidDevices, ...iosDevices };
}

/** Screenshot every device in a `{role: driver}` map, labeled by role. */
export async function screenshotAll(devicesByRole, label) {
  for (const [role, driver] of Object.entries(devicesByRole)) {
    await screenshot(driver, `${label}-${role}`);
  }
}

/** Best-effort teardown of every device in a `{role: driver}` map. */
export async function teardownAll(devicesByRole) {
  for (const driver of Object.values(devicesByRole)) {
    try {
      await driver.deleteSession();
    } catch {
      /* best-effort — a device that's already gone (crashed, manually closed) isn't a test failure */
    }
  }
}
