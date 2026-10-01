import { execFileSync } from "node:child_process";

// The harness never starts an Android emulator. An `appium:avd` capability with
// no udid makes Appium boot that AVD itself, and stopAppium() then took the
// emulator down with the rest of Appium's process tree — SIGKILL to qemu. On
// 2026-10-01 the Mac stopped booting any emulator after one of those runs
// (`HV_NO_RESOURCES`, even a 1 GB guest) until a restart. Emulators are started
// and stopped by scripts/emu.sh; a session only attaches to one already running,
// by udid.

/** `adb devices` serials of the running emulators. */
export function runningEmulators() {
  let out = "";
  try {
    out = execFileSync("adb", ["devices"], { encoding: "utf8" });
  } catch {
    return [];
  }
  return out
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter(([serial, state]) => /^emulator-\d+$/.test(serial ?? "") && state === "device")
    .map(([serial]) => serial);
}

/** The AVD name an emulator reports for itself (first line of `adb emu avd name`). */
function avdNameOf(serial) {
  try {
    return execFileSync("adb", ["-s", serial, "emu", "avd", "name"], { encoding: "utf8" }).split(/\r?\n/)[0].trim();
  } catch {
    return undefined;
  }
}

/**
 * Turn an `appium:avd` capability into `appium:udid` of that AVD's running
 * emulator, so Appium attaches instead of launching. Throws when it is not
 * running: start it with `scripts/emu.sh start <avd>` first. Caps that already
 * name a udid, or are not Android, are returned unchanged.
 */
export function pinToRunningEmulator(caps) {
  const avd = caps["appium:avd"];
  if (String(caps.platformName).toLowerCase() !== "android" || !avd) return caps;
  const { "appium:avd": _avd, ...rest } = caps;
  if (caps["appium:udid"]) return rest;
  const running = runningEmulators();
  const serial = running.find((s) => avdNameOf(s) === avd);
  if (!serial) {
    throw new Error(
      `AVD ${avd} is not running (running emulators: ${running.join(", ") || "none"}). ` +
        `The harness does not start emulators: run scripts/emu.sh start ${avd} first.`
    );
  }
  return { ...rest, "appium:udid": serial };
}

/** True for an emulator or qemu process: never ours to signal (see above). */
export function isEmulatorPid(pid) {
  try {
    const comm = execFileSync("ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return /(^|\/)(emulator|qemu-system[^/]*)$/.test(comm);
  } catch {
    return false;
  }
}
