// Seat a Keyring as a hidden vetter of the hv community (keyring-hv-lab1), once per vetter phone. The phone is linked
// first to a FRESH runner agent that has never been on the hv community (run-vta-link.js, the gate's own grant), and
// unlocked. Then, through the app and the harness admin credential (community-admin there; no passkey):
//   hvk-vetter-asked     the phone asks to join by the review way (JoinAsk) and the request is sent
//   hvk-vetter-member    the harness admin approves that request; the community lists the phone's member DID
//   hvk-vetter-granted   the harness admin grants that member a vetter credential
//   hvk-vetter-enrolled  the phone's vetter desk opens, and the community's own count of hidden vetters enrolled
//                        under the live label grows by one (vtc/vetting/hidden/show); the app enrols by itself once it
//                        holds the grant and reads the published parameters (Keyring 261: tokens on the community's ticks)
//
//   node e2e/openvtc/seat-hv-keyring-vetter.mjs --platform ios --udid <sim> --device-name "iPhone 17 HV Vetter" \
//     --wda-port 8132 --mjpeg-port 9132 --community-did <did> --vtc-base <https://…/v1> --admin-credential <json> \
//     [--criterion hv-vetted] [--out <file for the member DID>]
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ensureAppium, screenshot, sleep } from '../lib/driver.js';
import { unlockToHome, vetter as vetterRole } from '../lib/keyringRoles.js';
import { join } from '../lib/pages/join.js';
import { createHvAdmin, newestMemberSince, newestRequestSince } from './hvAdmin.js';
import { keepAlive, openDevice } from './hvDevices.js';

const { values: a } = parseArgs({
  options: {
    platform: { type: 'string', default: 'ios' },
    udid: { type: 'string' },
    'device-name': { type: 'string' },
    'wda-port': { type: 'string' },
    'mjpeg-port': { type: 'string' },
    'community-did': { type: 'string' },
    'vtc-base': { type: 'string' },
    'admin-credential': { type: 'string' },
    criterion: { type: 'string', default: 'hv-vetted' },
    out: { type: 'string' },
    // A phone already seated (asked, approved, granted) on an earlier build: run only the enrol step again.
    'resume-member': { type: 'string' },
  },
});
for (const k of ['udid', 'community-did', 'vtc-base', 'admin-credential']) if (!a[k]) throw new Error(`--${k} is required`);
const row = (name, status, detail) => {
  console.log(`ROW ${name} ${status} — ${String(detail).replace(/\s+/g, ' ').slice(0, 300)}`);
  if (status === 'FAIL') process.exitCode = 1;
};
const admin = createHvAdmin({ vtcBase: a['vtc-base'], communityDid: a['community-did'], adminCredential: a['admin-credential'] });
const enrolled = async () => Object.values((await admin.hiddenShow(a.criterion)).enrolledVetters ?? {}).reduce((s, n) => s + Number(n), 0);

const since = new Date().toISOString();
const before = await enrolled();
await ensureAppium();
const d = await openDevice({ platform: a.platform, udid: a.udid, deviceName: a['device-name'], wdaPort: a['wda-port'], mjpegPort: a['mjpeg-port'] });
const stop = keepAlive(d);
/** The phone's desk opens; the community's count of hidden vetters under the live label grows by one. */
async function awaitEnrolled() {
  await vetterRole.openDesk(d);
  await screenshot(d, 'hvk-vetter-desk').catch(() => undefined);
  let now = before;
  for (let i = 0; i < 24 && now <= before; i++) { await sleep(10000); now = await enrolled(); }
  row('hvk-vetter-enrolled', now > before ? 'PASS' : 'FAIL', `hidden vetters enrolled on ${a.criterion}: ${before} → ${now} (vtc/vetting/hidden/show)`);
}

try {
  await unlockToHome(d);
  if (a['resume-member']) {
    const m = admin.members().find((x) => x.did === a['resume-member']);
    row('hvk-vetter-member', m ? 'PASS' : 'FAIL', m ? `already a member: ${m.did} (resumed)` : `${a['resume-member']} is not a member`);
    if (!m) throw new Error('the resumed vetter is not a member');
    await awaitEnrolled();
  } else {
  await join.openCommunity(d, { did: a['community-did'], name: '' });
  await join.ask(d, { tag: 'hvk-vetter' });
  const sent = (await join.awaitSent(d, { required: false })).value;
  row('hvk-vetter-asked', sent?.shown ? 'PASS' : 'FAIL', sent?.shown ? 'asked by the review way; the standing shows' : 'no standing after the ask');

  let req;
  for (let i = 0; i < 24 && !req; i++) { req = newestRequestSince(admin.joinRequests('pending'), since); if (!req) await sleep(5000); }
  if (!req) throw new Error('no pending join request from this phone reached the community');
  const decided = admin.decide(req.id, 'approved');
  let member;
  for (let i = 0; i < 24 && !member; i++) { member = newestMemberSince(admin.members(), since); if (!member) await sleep(5000); }
  row('hvk-vetter-member', member && member.did === req.applicantDid ? 'PASS' : 'FAIL', `request ${req.id} approved (${decided.status}); member ${member?.did ?? 'none listed'}`);
  if (!member) throw new Error('approved, but no member listed');
  if (a.out) writeFileSync(a.out, member.did + '\n');

  const grant = admin.grantVetter(member.did);
  row('hvk-vetter-granted', grant.status === 200 ? 'PASS' : 'FAIL', `vetter-grant ${grant.status} ${grant.body?.credentialId ?? ''} until ${grant.body?.validUntil ?? '?'}`);

  await awaitEnrolled();
  }
} catch (e) {
  console.log(`❌ seat-hv-keyring-vetter: ${String(e?.message || e).split('\n')[0]}`);
  await screenshot(d, 'hvk-vetter-failure').catch(() => undefined);
  process.exitCode = 1;
} finally {
  stop();
  await d.deleteSession().catch(() => undefined);
}
// The Appium server this run started keeps node alive past the rows (run-hv on 261).
process.exit(process.exitCode ?? 0);
