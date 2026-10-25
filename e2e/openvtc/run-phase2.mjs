#!/usr/bin/env node
// Phase 2 of the openvtc interop harness (docs/plans/openvtc-interop-harness-plan.md):
// the mirror of Phase 1 — a Keyring build as VETTER, the real openvtc TUI as
// APPLICANT, every step asserted on both sides and at the community. The gate
// runs it from e2e/gate/legs/p2.sh.
//
//   node e2e/openvtc/run-phase2.mjs --label A \
//     --apk <keyring apk or .app> --platform ios --udid <seated vetter sim> --no-install \
//     --vetter-did <the Keyring vetter's persona DID on C> \
//     --openvtc-bin <openvtc> --openvtc-version ed13d29 \
//     --fixture-dir ~/vti-stack/openvtc-applicant --profile harness-applicant-ed13d29 \
//     --community-did <C> --vtc-base <C's REST base> --admin-credential <C's admin credential>
//
// The Keyring side is a SEATED vetter of the community: installed, linked and
// granted beforehand (the community's vetter grant to --vetter-did); the run
// only checks it is the build named, and (with --vetter-did) that the
// community lists a live grant for it.
//
// The TUI mints a fresh persona per run (--persona-name), so its application
// and request rows are this run's alone; --persona-label with --persona-did
// reuses one instead. The card is read from the face the application wears:
// each run makes one (--face-name, with name.legal = --legal-name) unless
// --face names an existing face to wear. The persona's DID is printed as
// `P2_PERSONA <did>` as soon as it is known, so the caller can remove its
// membership of the community after the run.
//
// Rows (lib/rows.js; each needs the one before it, the first two stand alone):
//   p2-tui-applicant-ready  the TUI persona exists, listens, has an application to C and wears a face
//   p2-vetter-seated        Keyring's desk opens (a seat on C), and C lists a live vetter grant for --vetter-did
//   p2-ticket-issued        Keyring cuts a ticket; the TUI pastes it and sends its request
//   p2-request-received     Keyring's desk shows the request; the TUI shows it accepted
//   p2-session-opened       Keyring opens the session; both show the same match code; Keyring says they match
//   p2-card-received        the TUI sends its card; Keyring's desk shows its claim
//   p2-statement-signed     Keyring signs and sends the statement; the TUI receives it
//   p2-keyring-vets         the TUI joins with the statement, and C's own member list holds the persona's DID
// Exit codes: 0 every row passed or was skipped as asked, 3 a row failed, 1 the
// run broke outside its rows (no session, the wrong build, no TUI).
//
// Writes runs/<run-id>/steps.jsonl (both sides' records) and report.json under
// --fixture-dir. The verdict is the community's own member list holding the TUI
// persona's DID. --expect red|green (default green) is recorded in the report
// (asExpected) for the harness's red runs; the exit code is the rows'.
//
// Written from source at ed13d29 (2026-09-25); not yet run against a device.
// --openvtc-version 177a218 drives our pin's screens instead (tuiRoles.at177).

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { androidCaps, iosCaps } from '../lib/config.js';
import { createSession } from '../lib/driver.js';
import { installedHash, unlockToHome, vetter } from '../lib/keyringRoles.js';
import { createRows } from '../lib/rows.js';
import { awaitListener, launchListening } from './tuiListeners.js';
import { allMembers } from './communityMembers.js';
import * as tuiRoles from './tuiRoles.js';

const { values: a } = parseArgs({
  options: {
    label: { type: 'string' },
    expect: { type: 'string', default: 'green' },
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
    // The Keyring vetter's persona DID on the community: with it, p2-vetter-seated
    // also asks the community for a live vetter grant to it.
    'vetter-did': { type: 'string' },
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
// The signed build at its stable path (scripts/openvtc/sign-lab-tool.sh): an ad hoc
// openvtc build re-prompts the Keychain for its profile on every rebuild.
a['openvtc-bin'] ??= path.join(os.homedir(), 'vti-stack/bin/openvtc');
for (const k of ['label', 'apk', 'openvtc-bin', 'openvtc-version', 'fixture-dir', 'profile']) if (!a[k]) throw new Error(`--${k} is required`);
if (!['red', 'green'].includes(a.expect)) throw new Error('--expect red|green');
// The Keyring vetter needs a vetter grant from the community, which only its
// own tooling sets up (onboard, link, grant): a fresh install could not vet.
if (!a['no-install']) throw new Error('--no-install is required: the Keyring vetter is installed, linked and granted beforehand');
if (Boolean(a['persona-label']) !== Boolean(a['persona-did'])) throw new Error('--persona-label and --persona-did go together (reuse), or neither (a new persona)');

const ADMIN = fileURLToPath(new URL('../../tsp-reference/ref-20-local-vetting/vtc-admin.mjs', import.meta.url));
const runId = `${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}Z-${a.label}-phase2-openvtc-${a['openvtc-version']}`;
const runDir = path.join(a['fixture-dir'], 'runs', runId);
mkdirSync(runDir, { recursive: true });
const log = path.join(runDir, 'steps.jsonl');
const opts = { log };
const startedAt = new Date().toISOString();
const debugLog = path.join(a['fixture-dir'], `debug-${a.profile}.log`);
const report = { runId, phase: 2, label: a.label, expect: a.expect, startedAt, openvtcVersion: a['openvtc-version'], platform: a.platform, apk: a.apk, udid: a.udid, steps: [], rows: {}, result: undefined };
const say = (m) => console.log(`[phase2 ${a.label}] ${m}`);

// Each row needs the one before it; the TUI's setup and the vetter's seat stand alone.
const ROWS = ['p2-tui-applicant-ready', 'p2-vetter-seated', 'p2-ticket-issued', 'p2-request-received', 'p2-session-opened', 'p2-card-received', 'p2-statement-signed', 'p2-keyring-vets'];
const rows = createRows({
  label: 'p2',
  needs: {
    'p2-ticket-issued': ['p2-tui-applicant-ready', 'p2-vetter-seated'],
    'p2-request-received': ['p2-ticket-issued'],
    'p2-session-opened': ['p2-request-received'],
    'p2-card-received': ['p2-session-opened'],
    'p2-statement-signed': ['p2-card-received'],
    'p2-keyring-vets': ['p2-statement-signed'],
  },
});

let failure;
/** One row. Its actions run inside it: every later row needs it, so a row left unselected stops the flow there. */
const step = (name, fn) =>
  rows.row(name, async () => {
    try {
      return await fn();
    } catch (e) {
      if (!failure) {
        failure = e;
        report.failedAt = e.record ? `${e.record.role}.${e.record.step}` : `${name}: ${e.message.split('\n')[0]}`;
        report.error = e.message.split('\n')[0];
      }
      throw e;
    }
  });

let d;
let tui;
try {
  // The build under test, and its hash as installed. Android: the APK. iOS
  // (--apk names the .app): its JS bundle, which is what installedHash reads
  // from the simulator's copy. --no-install: the build went over the seated
  // vetter beforehand (the leg); the run only checks it is the build named.
  const apkSha = createHash('sha256')
    .update(readFileSync(a.platform === 'ios' ? path.join(a.apk, 'main.jsbundle') : a.apk))
    .digest('hex')
    .slice(0, 12);
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
  d = await createSession(a.platform, caps);
  rows.setDriver(d);

  // Never run with a deaf TUI: relaunch until its listeners are up. A reused
  // persona must be among them; a new one is minted after launch, and its
  // listener is started then (openvtc state_handler/mod.rs:4163-4200).
  report.tuiLaunches = [];
  const launchTui = () =>
    tuiRoles.launch({ bin: a['openvtc-bin'], version: a['openvtc-version'], dir: a['fixture-dir'], profile: a.profile, role: 'openvtc-applicant', log });
  tui = a['persona-did']
    ? await launchListening(launchTui, { debugLog, persona: a['persona-did'], record: (r) => report.tuiLaunches.push(r) })
    : await launchTui();

  const personaLabel = a['persona-label'] ?? a['persona-name'] ?? `Harness Applicant ${runId.slice(0, 15)}`;
  let personaDid = a['persona-did'];
  if (personaDid) console.log(`P2_PERSONA ${personaDid}`);

  // The applicant persona and its application, before any ticket exists.
  await step('p2-tui-applicant-ready', async () => {
    if (!personaDid) {
      personaDid = await tuiRoles.createPersona(tui, { name: personaLabel, debugLog });
      console.log(`P2_PERSONA ${personaDid}`);
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
    return { ok: true, detail: `persona ${report.persona.reused ? 'reused' : 'minted'}${report.personaListenerAt === 'relaunched' ? ' (TUI relaunched for its listener)' : ''}, application to ${a['community-name']}, face "${face}"` };
  });

  // The seat: Keyring's desk opens (it waits for "You vet for"), and the community itself lists the grant.
  await step('p2-vetter-seated', async () => {
    // A new session relaunches the app onto its PIN screen.
    await unlockToHome(d);
    const youVetFor = (await vetter.openDesk(d, opts))?.observed?.youVetFor ?? '';
    if (!a['vetter-did']) return { ok: true, detail: `desk open ("${youVetFor.slice(0, 60)}"); the community's grant not checked (no --vetter-did)` };
    const live = vetterGrants().filter((v) => v.memberDid === a['vetter-did'] && v.live && !v.revoked);
    return live.length
      ? { ok: true, detail: `desk open ("${youVetFor.slice(0, 60)}"); C lists a live vetter grant for the Keyring vetter` }
      : { ok: false, detail: `desk open, but C lists no live vetter grant for the Keyring vetter (…${a['vetter-did'].slice(-24)})` };
  });

  await step('p2-ticket-issued', async () => {
    const ticketLink = (await vetter.issueTicket(d, opts)).value;
    say(`ticket ${ticketLink.slice(0, 60)}…`);
    report.vetterDid = await tuiRoles.requestVetter(tui, { ticketLink, personaDid });
    return { ok: true, detail: `Keyring issued a ticket (${ticketLink.length} chars); the TUI sent its request` };
  });

  await step('p2-request-received', async () => {
    await vetter.awaitRequest(d, {}, opts);
    const accepted = await tuiRoles.awaitAccepted(tui, { personaDid, debugLog });
    return { ok: true, detail: `Keyring's desk shows the request; the TUI reads "${String(accepted ?? '').slice(0, 80)}"` };
  });

  await step('p2-session-opened', async () => {
    const keyringCode = (await vetter.openSession(d, opts)).value;
    const tuiCode = await tuiRoles.awaitSession(tui, { personaDid, debugLog });
    report.matchCode = { keyring: keyringCode, tui: tuiCode };
    // The two read their codes to each other: the vetter says whether they match.
    await vetter.confirmMatch(d, { match: tuiCode === keyringCode }, opts);
    if (tuiCode !== keyringCode) return { ok: false, detail: `match codes differ: Keyring ${keyringCode}, TUI ${tuiCode}` };
    return { ok: true, detail: 'both show the same match code; Keyring confirmed it' };
  });

  await step('p2-card-received', async () => {
    report.card = await tuiRoles.sendCard(tui, { personaDid, matchCode: report.matchCode.tui });
    const claim = (await vetter.awaitCard(d, {}, opts)).value ?? '';
    report.cardClaimOnKeyring = claim;
    const named = report.face?.legalName ? `; legal name shown: ${claim.includes(report.face.legalName) ? 'yes' : 'no'}` : '';
    return { ok: true, detail: `the TUI sent its card; Keyring's desk shows "${claim.slice(0, 80)}"${named}` };
  });

  await step('p2-statement-signed', async () => {
    const issued = (await vetter.attest(d, opts))?.observed?.statementIssued ?? '';
    await tuiRoles.awaitStatement(tui, { personaDid, debugLog });
    return { ok: true, detail: `Keyring signed and sent it ("${issued.slice(0, 60)}"); the TUI received it` };
  });

  // The verdict: the community's own member list, not either side's screen.
  await step('p2-keyring-vets', async () => {
    report.membershipStored = await tuiRoles.joinWithStatements(tui, { communityDid: a['community-did'], personaDid, personaLabel, debugLog });
    report.communityMember = communityMember(personaDid);
    const m = report.communityMember;
    if (!m) return { ok: false, detail: `the TUI stored a membership, but C lists no member …${personaDid.slice(-24)}` };
    // A reused persona may have been a member before: it must have joined during this run.
    if (report.persona.reused && !m.joinedThisRun) return { ok: false, detail: `C lists the reused persona, but joined ${m.joinedAt}, before this run (${startedAt})` };
    return { ok: true, detail: `C lists the TUI persona as a member (joined ${m.joinedAt})` };
  });
} catch (e) {
  // Outside a row: no session, the wrong build, no TUI. The leg breaks.
  failure ??= e;
  report.failedAt ??= e.record ? `${e.record.role}.${e.record.step}` : e.message.split('\n')[0];
  report.error ??= e.message.split('\n')[0];
  rows.fatal(e);
} finally {
  report.openvtcLog = tuiRoles.vettingLogLines(a['fixture-dir'], a.profile, startedAt);
  if (tui) await tui.stop().catch(() => undefined);
  if (d) await d.deleteSession().catch(() => undefined);
}

for (const name of ROWS) report.rows[name] = rows.outcome(name);
const green = !failure && ROWS.every((n) => rows.outcome(n) === 'PASS');
report.result = green ? 'green' : 'red';
report.asExpected = report.result === a.expect && (a.expect === 'green' || !a['expect-fail-at'] || String(report.failedAt ?? '').includes(a['expect-fail-at']));
writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
say(`${report.result.toUpperCase()}${failure ? ` at ${report.failedAt}` : ''} — expected ${a.expect}: ${report.asExpected ? 'AS EXPECTED' : 'NOT AS EXPECTED'}`);
say(`report: ${path.join(runDir, 'report.json')}`);
rows.summary();
process.exitCode = rows.exitCode();

/** The community's vetter grants (vtc/vetting/vetters/grants/list/0.1, every page). */
function vetterGrants() {
  const out = execFileSync('node', [ADMIN, a['vtc-base'], a['community-did'], a['admin-credential'], 'vetters-list'], { encoding: 'utf8', timeout: 90000 });
  const body = JSON.parse(out.slice(out.indexOf('{', out.indexOf('->'))));
  if (!Array.isArray(body.vetters)) throw new Error(`the community's vetter list came back without vetters: ${out.slice(0, 200)}`);
  return body.vetters;
}

/**
 * The community's own record, not the TUI's: the member whose DID is the TUI
 * persona's (vtc-service MemberResponse has `did` and `joinedAt`). Returns
 * that member, or undefined.
 */
function communityMember(did) {
  const m = allMembers(memberSource).find((x) => x.did === did);
  return m && { did: m.did, joinedAt: m.joinedAt, joinedThisRun: Date.parse(m.joinedAt ?? 0) >= Date.parse(startedAt) };
}
