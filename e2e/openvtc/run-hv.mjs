// The hv leg's driver: Keyring applies by HIDDEN vetting (PCS) on a community we administer (keyring-hv-lab1), with
// the openvtc TUI as the vetter (VETTER=tui) or, later, a second Keyring (VETTER=keyring). The phone is linked and
// unlocked by the leg before this runs (run-vta-link.js, the gate's own admin grant, so its identity derives
// pcs-applicant); this drives the app as installed and never resets it.
//
//   node e2e/openvtc/run-hv.mjs --udid emulator-5570 --community-did <did> --criterion hv-vetted \
//     --vtc-base <https://…/v1> --admin-credential <json> [--vetter tui|keyring] \
//     [--openvtc-bin … --openvtc-version … --fixture-dir … --profile … --tui-persona …]
//
// Prints `ROW <name> PASS|FAIL|SKIP — <detail>` lines the leg takes (lib.sh take_rows):
//   hv-private-badge          the way in for the criterion carries the "Private vetting" badge (JoinWayPrivate_<id>)
//   hv-vetting-private-shown  "Meet a vetter" → the persona step → the vetting screen, badged (VettingPrivate)
//   hv-application-created    "Start my application" makes the phone's own agent create the PCS application:
//                             `asked its agent …/vta/pcs/applications/create/0.1` then `reply verified` in logcat
//                             (the 257 check, 2026-10-16). `[hidden-vetting] no agent-side application for <id>:
//                             <error>` is a FAIL with that error; neither line means the private way was not
//                             recognised (the community's requirements digest does not match the app's).
//   hv-ticket … hv-member-card, hv-vetter-anonymous   the vetter's half (ticket, card, hidden attestation, the
//                             agent's proof, admission, the member card, and no vetter named, neither on the
//                             applicant's attestation nor in the community's record). They are written after the first
//                             watched device run (the app's private-vetting screens and openvtc's attest_hidden keys
//                             are not all knowable from source); until then they report SKIP saying so.
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { androidCaps } from '../lib/config.js';
import { createSession, existsTestId, screenshot, scrollToTestId, sleep, tapTestId } from '../lib/driver.js';
import { unlockToHome } from '../lib/keyringRoles.js';
import { join } from '../lib/pages/join.js';
import { applicationVerdict } from './hvVerdict.js';

const { values: a } = parseArgs({
  options: {
    udid: { type: 'string' },
    'community-did': { type: 'string' },
    criterion: { type: 'string', default: 'hv-vetted' },
    'vtc-base': { type: 'string' },
    'admin-credential': { type: 'string' },
    vetter: { type: 'string', default: 'tui' },
    'openvtc-bin': { type: 'string' },
    'openvtc-version': { type: 'string' },
    'fixture-dir': { type: 'string' },
    profile: { type: 'string' },
    'tui-persona': { type: 'string' },
  },
});
for (const k of ['udid', 'community-did', 'vtc-base', 'admin-credential']) if (!a[k]) throw new Error(`--${k} is required`);
if (!['tui', 'keyring'].includes(a.vetter)) throw new Error(`--vetter is tui or keyring, not ${a.vetter}`);

const row = (name, status, detail) => console.log(`ROW ${name} ${status} — ${String(detail).replace(/\s+/g, ' ').slice(0, 300)}`);
const adb = (...args) => execFileSync('adb', ['-s', a.udid, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const crit = a.criterion;

const LATER = 'written after the first watched device run (the private-vetting screens and openvtc attest_hidden)';
const VETTER_ROWS = ['hv-ticket', 'hv-card', 'hv-attestation-received', 'hv-proof', 'hv-admitted', 'hv-member-card', 'hv-vetter-anonymous'];

const { 'appium:avd': _avd, 'appium:app': _app, ...base } = androidCaps();
const d = await createSession('android', { ...base, 'appium:udid': a.udid, 'appium:fullReset': false, 'appium:noReset': true, 'appium:enforceAppInstall': false });
try {
  await unlockToHome(d);
  adb('logcat', '-c');
  await join.openCommunity(d, { did: a['community-did'], name: '' });
  const badge = await existsTestId(d, `JoinWayPrivate_${crit}`, 15000);
  await screenshot(d, 'hv-ways').catch(() => undefined);
  row('hv-private-badge', badge ? 'PASS' : 'FAIL', badge ? `the ${crit} way is badged Private vetting` : `no JoinWayPrivate_${crit} on the ways in`);
  if (!badge) throw new Error('no private way');

  // The way's own start button is the screen's JoinStart ("Meet a vetter"); JoinWayStart_<id> is its caption.
  if (!(await scrollToTestId(d, 'JoinStart', 6, { from: 0.6 }).catch(() => undefined))) throw new Error('JoinStart (Meet a vetter) not reachable');
  await tapTestId(d, 'JoinStart', 10000);
  if (await existsTestId(d, 'JoinAsContinue', 15000)) await tapTestId(d, 'JoinAsContinue', 10000);
  const shown = await existsTestId(d, 'VettingPrivate', 90000);
  await screenshot(d, 'hv-vetting').catch(() => undefined);
  row('hv-vetting-private-shown', shown ? 'PASS' : 'FAIL', shown ? 'Meet a vetter → persona → the vetting screen, badged Private vetting' : 'the vetting screen (VettingPrivate) did not come');
  if (!shown) throw new Error('no private vetting screen');

  if (!(await scrollToTestId(d, 'VettingStartButton', 6, { from: 0.6 }).catch(() => undefined))) throw new Error('VettingStartButton not reachable');
  await tapTestId(d, 'VettingStartButton', 10000);
  let verdict = applicationVerdict('');
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    verdict = applicationVerdict(adb('logcat', '-d'));
    if (verdict.status === 'PASS' || /no agent-side application/.test(verdict.detail)) break;
  }
  row('hv-application-created', verdict.status, verdict.detail);
  for (const r of VETTER_ROWS) row(r, 'SKIP', `vetter=${a.vetter}: ${LATER}`);
} catch (e) {
  console.log(`❌ run-hv: ${String(e?.message || e).split('\n')[0]}`);
  await screenshot(d, 'hv-failure').catch(() => undefined);
  process.exitCode = 1;
} finally {
  await d.deleteSession().catch(() => undefined);
}
