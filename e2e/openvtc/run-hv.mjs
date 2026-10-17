// The hv leg's driver: Keyring applies by HIDDEN vetting (PCS) on a community we administer (keyring-hv-lab1).
// The vetter is the openvtc TUI seated there (--vetter tui) or a second Keyring seated there as a hidden vetter
// (--vetter keyring; seat-hv-keyring-vetter.mjs, once per vetter phone). The applicant phone is linked and unlocked
// by the leg (run-vta-link.js, the gate's own admin grant, so its identity derives pcs-applicant); both phones are
// driven as installed, never reset. Android emulator or iOS simulator, each side.
//
//   node e2e/openvtc/run-hv.mjs --platform ios --udid <sim> --device-name <name> --wda-port 8131 --mjpeg-port 9131 \
//     --community-did <did> --criterion hv-vetted --vtc-base <https://…/v1> --admin-credential <json> \
//     --vetter keyring --vetter-udid <sim> --vetter-device-name <name> --vetter-wda-port 8132 --vetter-mjpeg-port 9132 \
//     --vetter-did <the vetter's member DID>
//   (--vetter tui: --openvtc-bin … --openvtc-version … --fixture-dir … --profile … --tui-persona …)
//
// Prints `ROW <name> PASS|FAIL|SKIP — <detail>` lines the leg takes (lib.sh take_rows):
//   hv-private-badge          the criterion's way in carries the "Private vetting" badge (JoinWayPrivate_<id>)
//   hv-vetting-private-shown  "Meet a vetter" → the persona step → the vetting screen, badged (VettingPrivate)
//   hv-application-created    "Start my application": the phone's own agent creates the PCS application
//                             (`asked its agent …/vta/pcs/applications/create/0.1`, then `reply verified`)
//   hv-ticket                 the vetter's ticket taken by the applicant; the vetter's desk shows the request
//   hv-card                   both show the same match code; the vetter receives the applicant's card
//   hv-attestation-received   the vetter attests (hidden); the applicant's agent verifies it (vta/pcs/verify-attestation)
//   hv-proof                  the applicant's agent proves (vta/pcs/prove): its latency, or the no-answer line verbatim
//   hv-admitted               the community lists the applicant as a member (its own record, the harness admin's read)
//   hv-member-card            the applicant's app reports the join done
//   hv-vetter-anonymous       the vetter's DID appears neither in what the applicant was shown (its screens and log
//                             since the attestation) nor in the community's record of the join (request + member)
// The hidden steps were first run by hand on build 257 (2026-10-16, the application half) and are pinned on the first
// watched run with a vetter; a step whose screen differs is a FAIL that names the step, and the run's logs are kept.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { byTestId, ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, tapTestId } from '../lib/driver.js';
import { applicant as applicantRole, unlockToHome, vetter as vetterRole } from '../lib/keyringRoles.js';
import { join } from '../lib/pages/join.js';
import { createHvAdmin, newestMemberSince, newestRequestSince } from './hvAdmin.js';
import { clearDeviceLog, deviceLog, keepAlive, openDevice } from './hvDevices.js';
import { applicationVerdict, taskRound } from './hvVerdict.js';

const { values: a } = parseArgs({
  options: {
    platform: { type: 'string', default: 'android' },
    udid: { type: 'string' },
    'device-name': { type: 'string' },
    'wda-port': { type: 'string' },
    'mjpeg-port': { type: 'string' },
    'community-did': { type: 'string' },
    criterion: { type: 'string', default: 'hv-vetted' },
    'vtc-base': { type: 'string' },
    'admin-credential': { type: 'string' },
    vetter: { type: 'string', default: 'tui' },
    'vetter-platform': { type: 'string' },
    'vetter-udid': { type: 'string' },
    'vetter-device-name': { type: 'string' },
    'vetter-wda-port': { type: 'string' },
    'vetter-mjpeg-port': { type: 'string' },
    'vetter-did': { type: 'string' },
    'openvtc-bin': { type: 'string' },
    'openvtc-version': { type: 'string' },
    'fixture-dir': { type: 'string' },
    profile: { type: 'string' },
    'tui-persona': { type: 'string' },
    'log-dir': { type: 'string' },
  },
});
for (const k of ['udid', 'community-did', 'vtc-base', 'admin-credential']) if (!a[k]) throw new Error(`--${k} is required`);
if (!['tui', 'keyring'].includes(a.vetter)) throw new Error(`--vetter is tui or keyring, not ${a.vetter}`);
if (a.vetter === 'keyring') for (const k of ['vetter-udid', 'vetter-did']) if (!a[k]) throw new Error(`--${k} is required with --vetter keyring`);

const row = (name, status, detail) => console.log(`ROW ${name} ${status} — ${String(detail).replace(/\s+/g, ' ').slice(0, 300)}`);
const say = (m) => console.log(`[hv] ${m}`);
const crit = a.criterion;
const logDir = a['log-dir'] || process.env.LEG_DIR || process.cwd();
const admin = createHvAdmin({ vtcBase: a['vtc-base'], communityDid: a['community-did'], adminCredential: a['admin-credential'] });
const appDev = { platform: a.platform, udid: a.udid };
const vetDev = { platform: a['vetter-platform'] || a.platform, udid: a['vetter-udid'] };
const ROWS = ['hv-private-badge', 'hv-vetting-private-shown', 'hv-application-created', 'hv-ticket', 'hv-card', 'hv-attestation-received', 'hv-proof', 'hv-admitted', 'hv-member-card', 'hv-vetter-anonymous'];
const done = new Set();
const mark = (name, status, detail) => { done.add(name); row(name, status, detail); };

const startedMs = Date.now();
const since = new Date(startedMs).toISOString();
await ensureAppium();
const app = await openDevice({ platform: a.platform, udid: a.udid, deviceName: a['device-name'], wdaPort: a['wda-port'], mjpegPort: a['mjpeg-port'] });
let vet, tui;
const stopKeep = [keepAlive(app)];
const keepLogs = () => {
  try { writeFileSync(path.join(logDir, `applicant-${a.platform}.log`), deviceLog(appDev, startedMs)); } catch {}
  if (vet) try { writeFileSync(path.join(logDir, `vetter-${vetDev.platform}.log`), deviceLog(vetDev, startedMs)); } catch {}
};
try {
  await unlockToHome(app);
  clearDeviceLog(appDev);
  await join.openCommunity(app, { did: a['community-did'], name: '' });
  const badge = await existsTestId(app, `JoinWayPrivate_${crit}`, 15000);
  await screenshot(app, 'hv-ways').catch(() => undefined);
  mark('hv-private-badge', badge ? 'PASS' : 'FAIL', badge ? `the ${crit} way is badged Private vetting` : `no JoinWayPrivate_${crit} on the ways in`);
  if (!badge) throw new Error('no private way');

  // The way's own start button is the screen's JoinStart ("Meet a vetter"); JoinWayStart_<id> is its caption.
  if (!(await scrollToTestId(app, 'JoinStart', 6, { from: 0.6 }).catch(() => undefined))) throw new Error('JoinStart (Meet a vetter) not reachable');
  await tapTestId(app, 'JoinStart', 10000);
  if (await existsTestId(app, 'JoinAsContinue', 15000)) await tapTestId(app, 'JoinAsContinue', 10000);
  const shown = await existsTestId(app, 'VettingPrivate', 90000);
  await screenshot(app, 'hv-vetting').catch(() => undefined);
  mark('hv-vetting-private-shown', shown ? 'PASS' : 'FAIL', shown ? 'Meet a vetter → persona → the vetting screen, badged Private vetting' : 'the vetting screen (VettingPrivate) did not come');
  if (!shown) throw new Error('no private vetting screen');

  if (!(await scrollToTestId(app, 'VettingStartButton', 6, { from: 0.6 }).catch(() => undefined))) throw new Error('VettingStartButton not reachable');
  // The screen connects the person's identity by itself on arrival ("Connecting your identity…" on the button), and a
  // tap then does nothing (hv-tui on 261, 02:48Z): tap once it reads "Start my application".
  const startLabel = async () => (await byTestId(app, 'VettingStartButton').getText().catch(() => '')) || '';
  let label = await startLabel();
  for (let i = 0; i < 60 && !/start my application/i.test(label); i++) { await sleep(3000); label = await startLabel(); }
  console.log(`[e2e] VettingStartButton reads "${label}" — tapping`);
  if (!/start my application/i.test(label)) throw new Error(`VettingStartButton never read "Start my application" (last: "${label}")`);
  await tapTestId(app, 'VettingStartButton', 10000);
  let verdict = applicationVerdict('');
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    verdict = applicationVerdict(deviceLog(appDev, startedMs));
    if (verdict.status === 'PASS' || /no agent-side application/.test(verdict.detail)) break;
  }
  mark('hv-application-created', verdict.status, verdict.detail);
  if (verdict.status !== 'PASS') throw new Error('no application');

  // The vetter's half. Keyring as vetter drives keyringRoles' vetter (the named flow's desk); the hidden attestation
  // is what its 261 desk sends for a hidden criterion. The TUI as vetter: tuiRoles' desk.
  let ticketUri;
  if (a.vetter === 'keyring') {
    vet = await openDevice({ platform: vetDev.platform, udid: vetDev.udid, deviceName: a['vetter-device-name'], wdaPort: a['vetter-wda-port'], mjpegPort: a['vetter-mjpeg-port'] });
    stopKeep.push(keepAlive(vet));
    await unlockToHome(vet);
    await vetterRole.openDesk(vet);
    ticketUri = (await vetterRole.issueTicket(vet)).value;
  } else {
    const tuiRoles = await import('./tuiRoles.js');
    tui = await tuiRoles.launch({ bin: a['openvtc-bin'], version: a['openvtc-version'], dir: a['fixture-dir'], profile: a.profile, log: path.join(logDir, 'tui-steps.jsonl') });
    await tuiRoles.openDesk(tui);
    ticketUri = await tuiRoles.issueTicket(tui);
    tui.roles = tuiRoles;
  }
  say(`ticket ${String(ticketUri).slice(0, 60)}…`);
  await applicantRole.request(app, { ticketUri, via: 'field' });
  await applicantRole.awaitAccepted(app, {});
  if (vet) await vetterRole.awaitRequest(vet, {}); else await tui.roles.awaitRequest(tui);
  mark('hv-ticket', 'PASS', `the applicant asked with the vetter's ticket; the vetter's desk shows the request`);

  const vetterCode = vet ? (await vetterRole.openSession(vet)).value : await tui.roles.openSession(tui);
  const applicantCode = (await applicantRole.readMatchCode(app, {})).value;
  if (vetterCode !== applicantCode) throw new Error(`match codes differ: vetter ${vetterCode}, applicant ${applicantCode}`);
  await applicantRole.confirmMatch(app, { match: true });
  if (vet) await vetterRole.confirmMatch(vet, { match: true });
  await applicantRole.sendCard(app);
  if (vet) await vetterRole.awaitCard(vet, {}); else await tui.roles.awaitCard(tui);
  mark('hv-card', 'PASS', `match code ${applicantCode} on both; the vetter received the applicant's card`);

  const attestMs = Date.now();
  if (vet) await vetterRole.attest(vet); else await tui.roles.attest(tui);
  await screenshot(vet ?? app, 'hv-attested').catch(() => undefined);
  let va, prove;
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    const log = deviceLog(appDev, startedMs);
    va = taskRound(log, '/vta/pcs/verify-attestation/0.1');
    prove = taskRound(log, '/vta/pcs/prove/0.1');
    if (prove.verified || prove.noAnswer) break;
  }
  mark('hv-attestation-received', va.verified ? 'PASS' : 'FAIL', va.verified ? `the applicant's agent verified the hidden attestation (${va.seconds ?? '?'} s)` : `no verified vta/pcs/verify-attestation (asked: ${va.asked})`);
  mark('hv-proof', prove.verified ? 'PASS' : 'FAIL', prove.verified ? `vta/pcs/prove verified in ${prove.seconds} s` : prove.noAnswer ? `unanswered: "${prove.noAnswer}"` : `no verified vta/pcs/prove (asked: ${prove.asked})`);

  const outcome = (await applicantRole.apply(app, {}).catch((e) => ({ value: `apply: ${String(e?.message || e).split('\n')[0]}` }))).value;
  let member;
  for (let i = 0; i < 24 && !member; i++) { member = newestMemberSince(admin.members(), since); if (!member) await sleep(5000); }
  mark('hv-admitted', member ? 'PASS' : 'FAIL', member ? `the community lists ${member.did} (joined ${member.joinedAt})` : 'no member listed since the run began');
  mark('hv-member-card', /member|joined|welcome|done/i.test(String(outcome)) ? 'PASS' : 'FAIL', `the app says "${String(outcome).slice(0, 120)}"`);

  // No vetter named: not in what the applicant was shown since the attestation (its log and the page it ends on), not
  // in the community's record of the join (the request it decided, the member it lists).
  const vetterDid = a.vetter === 'keyring' ? a['vetter-did'] : a['tui-persona'];
  const shownToApplicant = deviceLog(appDev, attestMs) + (await app.getPageSource().catch(() => ''));
  const req = newestRequestSince([...admin.joinRequests('approved'), ...admin.joinRequests('pending')], since);
  const record = JSON.stringify(req ?? {}) + JSON.stringify(member ?? {});
  const leaks = [shownToApplicant.includes(vetterDid) && 'the applicant side', record.includes(vetterDid) && "the community's record"].filter(Boolean);
  mark('hv-vetter-anonymous', vetterDid && !leaks.length ? 'PASS' : 'FAIL', !vetterDid ? 'no vetter DID given to check against' : leaks.length ? `the vetter's DID appears in ${leaks.join(' and ')}` : "the vetter's DID is in neither the applicant's screens and log nor the community's record");
} catch (e) {
  console.log(`❌ run-hv: ${String(e?.message || e).split('\n')[0]}`);
  await screenshot(app, 'hv-failure').catch(() => undefined);
  if (vet) await screenshot(vet, 'hv-vetter-failure').catch(() => undefined);
  for (const r of ROWS) if (!done.has(r)) row(r, 'FAIL', `not reached: ${String(e?.message || e).split('\n')[0].slice(0, 160)}`);
  process.exitCode = 1;
} finally {
  keepLogs();
  for (const s of stopKeep) s();
  if (tui) await tui.stop().catch(() => undefined);
  await app.deleteSession().catch(() => undefined);
  if (vet) await vet.deleteSession().catch(() => undefined);
}
// The Appium server this run started keeps node alive (hv-tui on 261 sat 35 min past its rows until galarm).
process.exit(process.exitCode ?? 0);
