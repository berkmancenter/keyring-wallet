#!/usr/bin/env node
// Phase 1 of the openvtc interop harness (docs/plans/openvtc-interop-harness-plan.md):
// the real openvtc TUI as vetter, a Keyring build as applicant, every step
// asserted on both sides and at the community.
//
//   node e2e/openvtc/run-phase1.mjs --label A|B --expect red|green \
//     --apk <keyring apk> --udid emulator-5560 \
//     --openvtc-bin <openvtc> --openvtc-version ed13d29 \
//     --fixture-dir ~/vti-stack/openvtc-harness --profile harness-vetter-ed13d29
//
// Writes runs/<run-id>/steps.jsonl (both sides' records) and report.json.
// Expect "red" for a Keyring build without keyring-bifold#116: the statement
// is signed and sent by openvtc, and Keyring does not accept it. "green" runs
// through to a member in the community's own list.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { androidCaps, iosCaps } from '../lib/config.js';
import { createSession } from '../lib/driver.js';
import { applicant, installedHash, unlockToHome } from '../lib/keyringRoles.js';
import { launchListening } from './tuiListeners.js';
import { allMembers } from './communityMembers.js';
import * as tuiRoles from './tuiRoles.js';

const { values: a } = parseArgs({
  options: {
    label: { type: 'string' },
    expect: { type: 'string' },
    apk: { type: 'string' },
    platform: { type: 'string', default: 'android' },
    udid: { type: 'string', default: 'emulator-5560' },
    // iOS: the simulator's own WDA and MJPEG ports and WDA build folder, so a
    // run never collides with another session's simulator.
    'wda-port': { type: 'string', default: '8105' },
    'mjpeg-port': { type: 'string', default: '9105' },
    'wda-derived-data': { type: 'string' },
    'openvtc-bin': { type: 'string' },
    'openvtc-version': { type: 'string' },
    'fixture-dir': { type: 'string' },
    profile: { type: 'string' },
    // The TUI persona that must be listening (the vetter); without it, every listener must be up.
    'tui-persona': { type: 'string' },
    'community-did': { type: 'string', default: 'did:webvh:QmdervYcngPtJnKGuZSzH2tvDe8q274cty8324G4finFnV:dids-keyring-stack.ic3.dev:keyring-test-vtc' },
    'community-name': { type: 'string', default: 'keyring-test' },
    via: { type: 'string', default: 'deeplink' },
    'vtc-base': { type: 'string', default: 'https://vtc-keyring-test.ic3.dev/v1' },
    'admin-credential': { type: 'string', default: path.join(process.env.HOME, 'vti-stack/keyring-test-admin-credential.json') },
    'no-install': { type: 'boolean', default: false },
    // Resume an application an earlier attempt left at the ticket step.
    'allow-in-progress': { type: 'boolean', default: false },
    // A red build must fail at this step, not anywhere: the maintainers' report is a
    // statement signed and sent by openvtc that Keyring does not accept.
    'expect-fail-at': { type: 'string', default: 'awaitStatement' },
  },
});
const memberSource = { vtcBase: a['vtc-base'], communityDid: a['community-did'], adminCredential: a['admin-credential'] };
if (!['android', 'ios'].includes(a.platform)) throw new Error('--platform android|ios');
for (const k of ['label', 'expect', 'apk', 'openvtc-bin', 'openvtc-version', 'fixture-dir', 'profile']) if (!a[k]) throw new Error(`--${k} is required`);
if (!['red', 'green'].includes(a.expect)) throw new Error('--expect red|green');

const runId = `${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}Z-${a.label}-openvtc-${a['openvtc-version']}`;
const runDir = path.join(a['fixture-dir'], 'runs', runId);
mkdirSync(runDir, { recursive: true });
const log = path.join(runDir, 'steps.jsonl');
const opts = { log };
const startedAt = new Date().toISOString();
const report = { runId, label: a.label, expect: a.expect, startedAt, openvtcVersion: a['openvtc-version'], platform: a.platform, apk: a.apk, udid: a.udid, via: a.via, steps: [], result: undefined };
const say = (m) => console.log(`[phase1 ${a.label}] ${m}`);

// The build under test, and its hash as installed. Android: the APK. iOS
// (--apk names the .app): its JS bundle, which is what installedHash reads
// from the simulator's copy.
const apkSha = createHash('sha256')
  .update(readFileSync(a.platform === 'ios' ? path.join(a.apk, 'main.jsbundle') : a.apk))
  .digest('hex')
  .slice(0, 12);
// --no-install: the build was installed, onboarded and linked beforehand (the
// Keyring side's own tooling); the run only checks it is the build named.
if (!a['no-install']) {
  if (a.platform === 'ios') throw new Error('iOS runs need --no-install: the simulator is prepared beforehand');
  execFileSync('adb', ['-s', a.udid, 'uninstall', 'asml.bkc.harvard.wallet'], { stdio: 'ignore' });
  execFileSync('adb', ['-s', a.udid, 'install', '-r', a.apk], { stdio: 'inherit' });
}
report.apkSha = apkSha;
report.installedSha = installedHash({ platform: a.platform, udid: a.udid });
if (!String(report.installedSha).startsWith(apkSha)) throw new Error(`installed build ${report.installedSha} is not ${apkSha}`);

// The phone first: a driver that cannot start leaves no TUI holding the profile lock.
// This device by udid, and the app as installed: never install, never reset.
const keep = { 'appium:fullReset': false, 'appium:noReset': true, 'appium:enforceAppInstall': false };
let caps;
if (a.platform === 'android') {
  const { 'appium:avd': _avd, 'appium:app': _app, ...base } = androidCaps();
  caps = { ...base, 'appium:udid': a.udid, ...keep };
} else {
  const { 'appium:app': _app, 'appium:platformVersion': _v, ...base } = iosCaps();
  caps = {
    ...base,
    'appium:udid': a.udid,
    'appium:wdaLocalPort': Number(a['wda-port']),
    'appium:mjpegServerPort': Number(a['mjpeg-port']),
    ...(a['wda-derived-data'] ? { 'appium:derivedDataPath': a['wda-derived-data'], 'appium:usePrebuiltWDA': false } : {}),
    ...keep,
  };
}
const d = await createSession(a.platform, caps);
// Never run with a deaf TUI: relaunch until the vetter persona's listener is up.
report.tuiLaunches = [];
const tui = await launchListening(
  () => tuiRoles.launch({ bin: a['openvtc-bin'], version: a['openvtc-version'], dir: a['fixture-dir'], profile: a.profile, log }),
  {
    debugLog: path.join(a['fixture-dir'], `debug-${a.profile}.log`),
    persona: a['tui-persona'],
    record: (r) => report.tuiLaunches.push(r),
  }
);
let failure;
try {
  await tuiRoles.openDesk(tui);
  report.staleDeclined = await tuiRoles.declineStale(tui);
  // A new session relaunches the app onto its PIN screen.
  await unlockToHome(d);
  await applicant.reset(d, { allowInProgress: a['allow-in-progress'] }, opts);
  await applicant.start(d, { communityDid: a['community-did'], communityName: a['community-name'] }, opts);
  const ticketUri = await tuiRoles.issueTicket(tui);
  say(`ticket ${ticketUri.slice(0, 60)}…`);
  await applicant.request(d, { ticketUri, via: a.via }, opts);
  await tuiRoles.awaitRequest(tui);
  await applicant.awaitAccepted(d, {}, opts);
  const tuiCode = await tuiRoles.openSession(tui);
  const keyringCode = (await applicant.readMatchCode(d, {}, opts)).value;
  report.matchCode = { tui: tuiCode, keyring: keyringCode };
  if (tuiCode !== keyringCode) throw new Error(`match codes differ: TUI ${tuiCode}, Keyring ${keyringCode}`);
  await applicant.confirmMatch(d, { match: true }, opts);
  const { cardSentMs } = (await applicant.sendCard(d, opts)).value ?? {};
  await tuiRoles.awaitCard(tui);
  await tuiRoles.attest(tui);
  await applicant.awaitStatement(d, { cardSentMs }, opts);
  const outcome = (await applicant.apply(d, {}, opts)).value;
  report.keyringOutcome = outcome;
  report.communityHasMember = communityListsMember();
  if (!report.communityHasMember) throw new Error(`Keyring says "${outcome}", but the community lists no new member`);
} catch (e) {
  failure = e;
  report.failedAt = e.record ? `${e.record.role}.${e.record.step}` : e.message.split('\n')[0];
  report.error = e.message.split('\n')[0];
} finally {
  report.openvtcLog = tuiRoles.vettingLogLines(a['fixture-dir'], a.profile, startedAt);
  await tui.stop();
  await d.deleteSession().catch(() => undefined);
}

const green = !failure;
report.result = green ? 'green' : 'red';
report.asExpected =
  report.result === a.expect && (a.expect === 'green' || String(report.failedAt ?? '').includes(a['expect-fail-at']));
writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
say(`${report.result.toUpperCase()}${failure ? ` at ${report.failedAt}` : ''} — expected ${a.expect}: ${report.asExpected ? 'AS EXPECTED' : 'NOT AS EXPECTED'}`);
say(`report: ${path.join(runDir, 'report.json')}`);
process.exitCode = report.asExpected ? 0 : 1;

/** The community's own record, not the phone's screen: is there a member the run added? */
function communityListsMember() {
  return allMembers(memberSource).some((m) => Date.parse(m.joinedAt ?? 0) >= Date.parse(startedAt));
}
