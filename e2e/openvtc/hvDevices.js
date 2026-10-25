// Devices for the hv leg's drivers, Android emulator or iOS simulator: a session on the app as installed (never a
// reset: an ended fullReset session uninstalls it, and a run waiting on a grant loses the app; see the 257 check), and
// the app's own log lines since a moment, the same way on both.
import { execFileSync } from 'node:child_process';
import { androidCaps, iosCaps } from '../lib/config.js';
import { createSession } from '../lib/driver.js';

const KEEP = { 'appium:fullReset': false, 'appium:noReset': true, 'appium:enforceAppInstall': false };

/** A session on the installed app. Android by emulator udid; iOS by simulator udid and name, each with its own WDA port. */
export async function openDevice({ platform, udid, deviceName, wdaPort, mjpegPort }) {
  let caps;
  if (platform === 'android') {
    const { 'appium:avd': _avd, 'appium:app': _app, ...base } = androidCaps();
    caps = { ...base, 'appium:udid': udid, ...KEEP };
  } else {
    const { 'appium:app': _app, ...base } = iosCaps();
    caps = {
      ...base,
      'appium:udid': udid,
      ...(deviceName ? { 'appium:deviceName': deviceName } : {}),
      ...(wdaPort ? { 'appium:wdaLocalPort': Number(wdaPort) } : {}),
      ...(mjpegPort ? { 'appium:mjpegServerPort': Number(mjpegPort) } : {}),
      ...KEEP,
    };
  }
  const d = await createSession(platform, caps);
  d.e2eUdid = d.e2eUdid || udid;
  return d;
}

/**
 * The app's log since `sinceMs` (epoch ms): Android's logcat (the caller clears it at the start, `clearDeviceLog`),
 * iOS's unified log read back with `log show` (smoke-ios's way: a `log stream` attached through simctl caught
 * nothing but its header on every run checked).
 */
export function deviceLog({ platform, udid }, sinceMs) {
  if (platform === 'android') return execFileSync('adb', ['-s', udid, 'logcat', '-d'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const start = new Date(sinceMs - 2000);
  const p = (n) => String(n).padStart(2, '0');
  const at = `${start.getFullYear()}-${p(start.getMonth() + 1)}-${p(start.getDate())} ${p(start.getHours())}:${p(start.getMinutes())}:${p(start.getSeconds())}`;
  return execFileSync(
    'xcrun',
    ['simctl', 'spawn', udid, 'log', 'show', '--start', at, '--style', 'compact', '--info', '--debug', '--predicate', 'process == "KeyRing" OR subsystem == "com.facebook.react.log"'],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }
  );
}

export function clearDeviceLog({ platform, udid }) {
  if (platform === 'android') execFileSync('adb', ['-s', udid, 'logcat', '-c']);
}

/** Keep a session alive while a run waits on the other side (Appium's newCommandTimeout is 300 s). */
export function keepAlive(...drivers) {
  const t = setInterval(() => { for (const d of drivers) d?.getWindowSize().catch(() => undefined); }, 20000);
  return () => clearInterval(t);
}
