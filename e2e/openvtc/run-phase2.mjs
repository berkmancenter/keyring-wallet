#!/usr/bin/env node
// Phase 2 of the openvtc interop harness (docs/plans/openvtc-interop-harness-plan.md):
// the mirror of Phase 1 — a Keyring build as VETTER, the real openvtc TUI as
// APPLICANT, every step asserted on both sides and at the community.
//
//   node e2e/openvtc/run-phase2.mjs --label A --expect green \
//     --apk <keyring apk or .app> --udid emulator-5560 --no-install \
//     --openvtc-bin <openvtc> --openvtc-version ed13d29 \
//     --fixture-dir ~/vti-stack/openvtc-harness --profile harness-applicant-ed13d29
//
// The TUI mints a fresh persona per run (--persona-name), so its application
// and request rows are this run's alone; --persona-label with --persona-did
// reuses one instead. The card is read from the face the application wears:
// each run makes one (--face-name, with name.legal = --legal-name) unless
// --face names an existing face to wear.
//
// Writes runs/<run-id>/steps.jsonl (both sides' records) and report.json. The
// verdict is the community's own member list holding the TUI persona's DID.
//
// Written from source at ed13d29 (2026-09-25); not yet run. --openvtc-version
// 177a218 drives our pin's screens instead (tuiRoles.at177), also not yet run.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { androidCaps, iosCaps } from '../lib/config.js';
import { createSession } from '../lib/driver.js';
import { installedHash, unlockToHome, vetter } from '../lib/keyringRoles.js';
import { awaitListener, launchListening } from './tuiListeners.js';
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
    'community-did': { type: 'string', default: 'did:webvh:QmdervYcngPtJnKGuZSzH2tvDe8q274cty8324G4finFnV:dids-keyring-stack.ic3.dev:keyring-test-vtc' },
    'community-name': { type: 'string', default: 'keyring-test' },
    'vtc-base': { type: 'string', default: 'https://vtc-keyring-test.ic3.dev/v1' },
    'admin-credential': { type: 'string', default: path.join(process.env.HOME, 'vti-stack/keyring-test-admin-credential.json') },
    'no-install': { type: 'boolean', default: false },
    // The TUI applicant: a new persona by name, or an existing one by label + DID.
    'persona-name': { type: 'string' },
    'persona-label': { type: 'string' },
    'persona-did': { type: 'string' },
    face: { type: 'string' },
    // Without --face, a face is made per run with name.legal = --legal-name.
    'face-name': { type: 'string', default: 'Harness Applicant' },
    'legal-name': { type: 'string', default: 'Ada Applicant' },
    // A red run must fail at this step, when given; otherwise any failure is red.
    'expect-fail-at': { type: 'string' },
  },
});
const memberSource = { vtcBase: a['vtc-base'], communityDid: a['community-did'], adminCredential: a['admin-credential'] };
if (!['android', 'ios'].includes(a.platform)) throw new Error('--platform android|ios');
for (const k of ['label', 'expect', 'apk', 'openvtc-bin', 'openvtc-version', 'fixture-dir', 'profile']) if (!a[k]) throw new Error(`--${k} is required`);
if (!['red', 'green'].includes(a.expect)) throw new Error('--expect red|green');
// The Keyring vetter needs a vetter grant from the community, which only its
// own tooling sets up (onboard, link, grant): a fresh install could not vet.
if (!a['no-install']) throw new Error('--no-install is required: the Keyring vetter is installed, linked and granted beforehand');
if (Boolean(a['persona-label']) !== Boolean(a['persona-did'])) throw new Error('--persona-label and --persona-did go together (reuse), or neither (a new persona)');

const runId = `${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}Z-${a.label}-phase2-openvtc-${a['openvtc-version']}`;
const runDir = path.join(a['fixture-dir'], 'runs', runId);
mkdirSync(runDir, { recursive: true });
const log = path.join(runDir, 'steps.jsonl');
const opts = { log };
const startedAt = new Date().toISOString();
const debugLog = path.join(a['fixture-dir'], `debug-${a.profile}.log`);
const report = { runId, phase: 2, label: a.label, expect: a.expect, startedAt, openvtcVersion: a['openvtc-version'], platform: a.platform, apk: a.apk, udid: a.udid, steps: [], result: undefined };
const say = (m) => console.log(`[phase2 ${a.label}] ${m}`);

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
// Never run with a deaf TUI: relaunch until its listeners are up. A reused
// persona must be among them; a new one is minted after launch, and its
// listener is started then (openvtc state_handler/mod.rs:4163-4200).
report.tuiLaunches = [];
const launchTui = () =>
  tuiRoles.launch({ bin: a['openvtc-bin'], version: a['openvtc-version'], dir: a['fixture-dir'], profile: a.profile, role: 'openvtc-applicant', log });
// A reused persona must be listening at launch; a new one is minted after
// launch and its listener checked then (awaitListener below). A profile with
// no personas logs no listener lines at launch at all.
let tui = a['persona-did']
  ? await launchListening(launchTui, { debugLog, persona: a['persona-did'], record: (r) => report.tuiLaunches.push(r) })
  : await launchTui();
let failure;
try {
  // The applicant persona and its application, before any ticket exists.
  const personaLabel = a['persona-label'] ?? a['persona-name'] ?? `Harness Applicant ${runId.slice(0, 15)}`;
  const personaDid = a['persona-did'] ?? (await tuiRoles.createPersona(tui, { name: personaLabel, debugLog }));
  if (!a['persona-did']) {
    // The new persona's listener starts now; through a flaky tunnel its login
    // can miss openvtc's budget, which openvtc never retries. Relaunch then:
    // the persona exists at launch, and launchListening checks and retries it.
    report.personaListenerAt = await awaitListener(debugLog, personaDid, startedAt, { timeoutMs: 30000 }).catch(async () => {
      await tui.stop();
      tui = await launchListening(launchTui, { debugLog, persona: personaDid, record: (r) => report.tuiLaunches.push(r) });
      return 'relaunched';
    });
  }
  report.persona = { label: personaLabel, did: personaDid, reused: Boolean(a['persona-did']) };
  say(`persona ${personaDid}`);
  report.requirements = (await tuiRoles.startApplication(tui, { communityDid: a['community-did'], personaDid, personaLabel })).requires;
  // The card is read from the face the application wears, and the Keyring
  // vetter's session asks for name.legal. Faces are the holder's (any context);
  // wearing one binds it in the application's own context, so chooseFace comes
  // after startApplication. --face wears an existing face instead of making one.
  const face = a.face ?? (await tuiRoles.createFace(tui, { name: a['face-name'], claims: { 'name.legal': a['legal-name'] }, personaDid }));
  report.face = { name: face, made: !a.face, legalName: a.face ? undefined : a['legal-name'] };
  await tuiRoles.chooseFace(tui, { personaDid, face });

  // A new session relaunches the app onto its PIN screen.
  await unlockToHome(d);
  await vetter.openDesk(d, opts);
  const ticketLink = (await vetter.issueTicket(d, opts)).value;
  say(`ticket ${ticketLink.slice(0, 60)}…`);
  report.vetterDid = await tuiRoles.requestVetter(tui, { ticketLink, personaDid });
  await vetter.awaitRequest(d, {}, opts);
  await tuiRoles.awaitAccepted(tui, { personaDid, debugLog });

  const keyringCode = (await vetter.openSession(d, opts)).value;
  const tuiCode = await tuiRoles.awaitSession(tui, { personaDid, debugLog });
  report.matchCode = { keyring: keyringCode, tui: tuiCode };
  // The two read their codes to each other: the vetter says whether they match.
  await vetter.confirmMatch(d, { match: tuiCode === keyringCode }, opts);
  if (tuiCode !== keyringCode) throw new Error(`match codes differ: Keyring ${keyringCode}, TUI ${tuiCode}`);

  report.card = await tuiRoles.sendCard(tui, { personaDid, matchCode: tuiCode });
  report.cardClaimOnKeyring = (await vetter.awaitCard(d, {}, opts)).value;
  await vetter.attest(d, opts);
  await tuiRoles.awaitStatement(tui, { personaDid, debugLog });

  report.membershipStored = await tuiRoles.joinWithStatements(tui, { communityDid: a['community-did'], personaDid, personaLabel, debugLog });
  report.communityMember = communityMember(personaDid);
  if (!report.communityMember) throw new Error(`the TUI stored a membership, but the community lists no member ${personaDid}`);
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
report.asExpected = report.result === a.expect && (a.expect === 'green' || !a['expect-fail-at'] || String(report.failedAt ?? '').includes(a['expect-fail-at']));
writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
say(`${report.result.toUpperCase()}${failure ? ` at ${report.failedAt}` : ''} — expected ${a.expect}: ${report.asExpected ? 'AS EXPECTED' : 'NOT AS EXPECTED'}`);
say(`report: ${path.join(runDir, 'report.json')}`);
process.exitCode = report.asExpected ? 0 : 1;

/**
 * The community's own record, not the TUI's: the member whose DID is the TUI
 * persona's (vtc-service MemberResponse has `did` and `joinedAt`). Returns
 * that member, or undefined.
 */
function communityMember(did) {
  const m = allMembers(memberSource).find((x) => x.did === did);
  return m && { did: m.did, joinedAt: m.joinedAt, joinedThisRun: Date.parse(m.joinedAt ?? 0) >= Date.parse(startedAt) };
}
