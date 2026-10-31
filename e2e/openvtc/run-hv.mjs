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
//   hv-refused-bad-ticket     (Keyring vetter) the applicant first presents the vetter's ticket with one character of
//                             its secret changed: the vetter's app refuses it (vetting/request:invalidTicket, the real
//                             ticket left unspent) and the request reads "Refused" (fr Refusée, pt-BR Recusado), never
//                             stuck at "Request sent". Coverage of the refusal path, not of one trust-task-error version.
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
import { byTestId, ensureAppium, stopAppium, existsTestId, screenshot, scrollToTestId, sleep, tapTestId } from '../lib/driver.js';
import { applicant as applicantRole, textOf, unlockToHome, vetter as vetterRole } from '../lib/keyringRoles.js';
import { join } from '../lib/pages/join.js';
import { createHvAdmin, soleMemberSince } from './hvAdmin.js';
import { clearDeviceLog, deviceLog, keepAlive, openDevice } from './hvDevices.js';
import { anonymityVerdict, appLevelLines, applicationVerdict, taskRound, withoutOwnRequestCard, withWrongSecret, refusalCodes } from './hvVerdict.js';

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
const ROWS = ['hv-private-badge', 'hv-vetting-private-shown', 'hv-application-created', ...(a.vetter === 'keyring' ? ['hv-refused-bad-ticket'] : []), 'hv-ticket', 'hv-card', 'hv-attestation-received', 'hv-proof', 'hv-admitted', 'hv-member-card', 'hv-vetter-anonymous'];
const done = new Set();
// A FAIL row fails the run (try 4 on 261 printed five FAIL rows and exited 0).
const mark = (name, status, detail) => { done.add(name); row(name, status, detail); if (status === 'FAIL') process.exitCode = 1; };

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
  // iOS reads the button's label; Android carries the words in text or content-desc (textOf), or only in the child
  // TextView a Pressable renders (the hv leg on Android read "" every time while the screen said Start my application).
  const startLabel = async () => {
    const own = await textOf(app, 'VettingStartButton').catch(() => '');
    if (own || app.e2ePlatform === 'ios') return own || '';
    const kids = await byTestId(app, 'VettingStartButton').$$('.//android.widget.TextView').catch(() => []);
    const words = [];
    for (const k of kids) words.push(await k.getText().catch(() => ''));
    return words.join(' ').trim();
  };
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
    await vetterRole.openDesk(vet, { community: { did: a['community-did'] } });
    ticketUri = (await vetterRole.issueTicket(vet)).value;
  } else {
    const tuiRoles = await import('./tuiRoles.js');
    tui = await tuiRoles.launch({ bin: a['openvtc-bin'], version: a['openvtc-version'], dir: a['fixture-dir'], profile: a.profile, log: path.join(logDir, 'tui-steps.jsonl') });
    await tuiRoles.openDesk(tui);
    ticketUri = await tuiRoles.issueTicket(tui);
    tui.roles = tuiRoles;
  }
  say(`ticket ${String(ticketUri).slice(0, 60)}…`);
  // The refusal first: the same ticket with a wrong secret. The vetter's app answers it with a refusal and leaves the real
  // ticket unspent, so the request below still goes through. "Accepted" here would mean the vetter took a ticket it never
  // cut; "Request sent" after the wait, that the refusal never reached the applicant or was not read.
  // HV_BAD_TICKET_CONTROL=1 proves the row can fail: the REAL ticket goes in instead, the vetter accepts it, the row must
  // read FAIL ("Accepted"), and the run stops there (its ticket is spent). Never set in a gate run. The stop lands in
  // the catch below, so every later row also prints FAIL "not reached": in a control run only this row's FAIL counts.
  const control = process.env.HV_BAD_TICKET_CONTROL === '1';
  if (a.vetter === 'keyring') {
    const asked = Date.now();
    if (control) say('CONTROL: presenting the real ticket in the refusal row');
    await applicantRole.request(app, { ticketUri: control ? ticketUri : withWrongSecret(ticketUri), via: 'field' });
    let status = '';
    // A refused request leaves the active step: the screen goes back to "Ask a vetter" and the refused card is drawn
    // under the ticket field, below the fold, where Android's page source does not reach (1029-2326: the refusal landed
    // at 23:39:17Z and the card read "Refused", but only once a later step scrolled to it). So scroll to it each time.
    for (const until = Date.now() + 150000; Date.now() < until; await sleep(3000)) {
      status = await textOf(app, 'VettingRequestStatus').catch(() => '');
      if (!status) {
        await scrollToTestId(app, 'VettingRequestStatus', 4).catch(() => undefined);
        status = await textOf(app, 'VettingRequestStatus').catch(() => '');
      }
      if (/Refused|Refusée|Recusado|Accepted|Aceit|Declined|Recus/i.test(status)) break;
    }
    await screenshot(app, 'hv-refused').catch(() => undefined);
    // The screen says a refusal happened; the code the applicant's agent logged says it was the wrong secret's (a vetter
    // that refused for any other reason, or crashed on the link, would read "Refused" too). Both are required.
    const shown = /Refused|Refusée|Recusado/i.test(status);
    const codes = refusalCodes(deviceLog(appDev, asked));
    const why = codes.includes('vetting/request:invalidTicket');
    const secs = Math.round((Date.now() - asked) / 1000);
    mark('hv-refused-bad-ticket', shown && why ? 'PASS' : 'FAIL', shown && why
      ? `a wrong-secret ticket was refused: the request reads "${status}" ${secs} s after asking, and the applicant's agent logged vetting/request:invalidTicket`
      : `the request reads "${status || 'nothing'}" ${secs} s after asking with a wrong-secret ticket (expected "Refused"); refusal codes logged: ${codes.length ? codes.join(', ') : 'none'} (expected vetting/request:invalidTicket)`);
    if (control) throw new Error('HV_BAD_TICKET_CONTROL: stopping after the refusal row');
  } else row('hv-refused-bad-ticket', 'SKIP', 'the openvtc TUI vetter: the refusal row is a Keyring vetter\'s');
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
  // The attestation first; the proof is made only when the person applies (pcs-challenge, then vta/pcs/prove, then
  // submit), so it is looked for after Apply (hv-keyring on 262 waited 3 min for a prove nothing had asked for yet).
  let va;
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    va = taskRound(deviceLog(appDev, startedMs), '/vta/pcs/verify-attestation/0.1');
    if (va.verified || va.noAnswer) break;
  }
  mark('hv-attestation-received', va.verified ? 'PASS' : 'FAIL', va.verified ? `the applicant's agent verified the hidden attestation (${va.seconds ?? '?'} s)` : `no verified vta/pcs/verify-attestation (asked: ${va.asked})`);

  const outcome = (await applicantRole.apply(app, {}).catch((e) => ({ value: `apply: ${String(e?.message || e).split('\n')[0]}` }))).value;
  let prove = taskRound(deviceLog(appDev, startedMs), '/vta/pcs/prove/0.1');
  for (let i = 0; i < 24 && !(prove.verified || prove.noAnswer); i++) {
    await sleep(5000);
    prove = taskRound(deviceLog(appDev, startedMs), '/vta/pcs/prove/0.1');
  }
  mark('hv-proof', prove.verified ? 'PASS' : 'FAIL', prove.verified ? `vta/pcs/prove verified${prove.seconds !== undefined ? ` in ${prove.seconds} s` : ' (over DIDComm: no ask line to time it from)'}` : prove.noAnswer ? `unanswered: "${prove.noAnswer}"` : `no verified vta/pcs/prove (asked: ${prove.asked})`);
  // The one member since the run began, on two reads: the community is shared with legs beside this one (signin's
  // member joins keyring-hv-lab1 too), and "the newest member" could be theirs, a pass for an admission that is not ours.
  const { member, count: members } = await soleMemberSince(() => admin.members(), since);
  mark('hv-admitted', member ? 'PASS' : members ? 'SKIP' : 'FAIL', member ? `the community lists ${member.did} (joined ${member.joinedAt}), the one member since the run began` : members ? `${members} members joined since the run began (read twice) on this shared community: whose is not known, so this run cannot judge the admission` : 'no member listed since the run began');
  mark('hv-member-card', /member|joined|welcome|done/i.test(String(outcome)) ? 'PASS' : 'FAIL', `the app says "${String(outcome).slice(0, 120)}"`);

  // No vetter named where it would be a leak: in the app's own lines since the attestation and the page it ends on (the
  // attestation as the applicant holds and is shown it), and in the community's record of the join (the request it
  // decided, the member it lists). Not counted: Credo's transport lines resolving the vetter's DID to reach it, and the
  // applicant's own request and session card. The applicant meets its vetter by design; what must not name the vetter
  // is the attestation and what the community keeps (hv-keyring on 262: all ten mentions were transport lines).
  const vetterDid = a.vetter === 'keyring' ? a['vetter-did'] : a['tui-persona'];
  const shownToApplicant = appLevelLines(deviceLog(appDev, attestMs)) + withoutOwnRequestCard(await app.getPageSource().catch(() => ''));
  // The record of this applicant's join: the request whose applicant is the member above, not the newest on a shared
  // community (no member, no record: the verdict below says the source was not read).
  const req = member ? [...admin.joinRequests('approved'), ...admin.joinRequests('pending')].find((r) => r.applicantDid === member.did) : undefined;
  const record = JSON.stringify(req ?? {}) + JSON.stringify(member ?? {});
  // Each source must show it was read (the applicant side names the applicant, the record names the member) before an
  // absent vetter DID counts: an empty page source or log read fails as "source empty" (review on #500).
  const anon = anonymityVerdict({ vetterDid, memberDid: member?.did, shown: shownToApplicant, record });
  mark('hv-vetter-anonymous', anon.ok ? 'PASS' : 'FAIL', anon.detail);
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
// The Appium server this run started keeps node alive (hv-tui on 261 sat 35 min past its rows until galarm), and an
// exit alone left it orphaned on its port (seat on 262): stop it, then exit.
stopAppium();
process.exit(process.exitCode ?? 0);
