// node --test e2e/openvtc/hvVerdict.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appLevelLines, applicationVerdict, lineSeconds, taskRound, withoutOwnRequestCard } from './hvVerdict.js';

const AGENT = 'did:webvh:QmWj8ssa:dids.ic3.dev:hidden-vet-vta';
// The 257 check's lines (2026-10-16, mini), with the logcat prefix as Android prints it.
const L = (s) => `10-15 18:15:40.635 12345 12399 I ReactNativeJS: ${s}`;
const PASS_LOG = [
  L(`[TrustTasks:VtaClient] asked ${AGENT} https://trusttasks.org/spec/trust-task-discovery/0.1 over rev3`),
  L('[TrustTasks:VtaClient] reply verified: https://trusttasks.org/spec/auth/whoami/0.1'),
  L('[TrustTasks:VtaClient] asked its agent https://trusttasks.org/spec/vta/pcs/applications/create/0.1 over rev3'),
  L('[TrustTasks:VtaClient] reply verified: https://trusttasks.org/spec/vta/pcs/applications/create/0.1'),
].join('\n');

test('created: asked of its own agent, then verified', () => {
  assert.equal(applicationVerdict(PASS_LOG).status, 'PASS');
});

test("the app's refusal is a FAIL carrying its error", () => {
  const v = applicationVerdict(L('[hidden-vetting] no agent-side application for hv-vetted: agentTooOld'));
  assert.equal(v.status, 'FAIL');
  assert.match(v.detail, /agentTooOld/);
});

test('asked but never verified is a FAIL', () => {
  const v = applicationVerdict(PASS_LOG.split('\n').slice(0, 3).join('\n'));
  assert.equal(v.status, 'FAIL');
  assert.match(v.detail, /no verified reply/);
});

test('neither line: the private way was not recognised', () => {
  const v = applicationVerdict(PASS_LOG.split('\n').slice(0, 2).join('\n'));
  assert.equal(v.status, 'FAIL');
  assert.match(v.detail, /not recognised/);
});

test('a verified reply before the ask does not count', () => {
  const v = applicationVerdict([
    L('[TrustTasks:VtaClient] reply verified: https://trusttasks.org/spec/vta/pcs/applications/create/0.1'),
    L('[TrustTasks:VtaClient] asked its agent https://trusttasks.org/spec/vta/pcs/applications/create/0.1 over rev3'),
  ].join('\n'));
  assert.equal(v.status, 'FAIL');
  assert.match(v.detail, /no verified reply/);
});

// 268's carriage (bifold #486): DIDComm to the agent, which logs no ask line. The applicant's line on 1022-2230 (mini).
const DIDCOMM_CREATED = '10-22 17:58:42.534  5062  5098 I ReactNativeJS: [TrustTasks:VtaClient] reply verified: https://trusttasks.org/spec/vta/pcs/applications/create/0.1  ';

test('created over DIDComm: a verified reply with no ask line at all', () => {
  const v = applicationVerdict(PASS_LOG.split('\n').slice(0, 2).join('\n') + '\n' + DIDCOMM_CREATED);
  assert.equal(v.status, 'PASS');
  assert.match(v.detail, /over DIDComm/);
});

test('over DIDComm too, no verified reply is still the FAIL it was', () => {
  const v = applicationVerdict(PASS_LOG.split('\n').slice(0, 2).join('\n'));
  assert.equal(v.status, 'FAIL');
  assert.match(v.detail, /not recognised/);
});

test('the app\'s refusal still FAILs when a verified reply is in the log too', () => {
  const v = applicationVerdict([DIDCOMM_CREATED, L('[hidden-vetting] no agent-side application for hv-vetted: agentTooOld')].join('\n'));
  assert.equal(v.status, 'FAIL');
  assert.match(v.detail, /agentTooOld/);
});

test('taskRound: a DIDComm round is verified with no ask line, untimed; no reply is not verified', () => {
  const ok = taskRound(L('[TrustTasks:VtaClient] reply verified: https://trusttasks.org/spec/vta/pcs/prove/0.1'), '/vta/pcs/prove/0.1');
  assert.deepEqual(ok, { asked: false, verified: true, seconds: undefined, noAnswer: undefined });
  const none = taskRound(L('[TrustTasks:VtaClient] reply verified: https://trusttasks.org/spec/vta/pcs/applications/create/0.1'), '/vta/pcs/prove/0.1');
  assert.equal(none.verified, false);
  const dropped = taskRound(L('[TrustTasks:VtaClient] no answer to https://trusttasks.org/spec/vta/pcs/prove/0.1 after 90 s'), '/vta/pcs/prove/0.1');
  assert.equal(dropped.verified, false);
  assert.match(dropped.noAnswer, /no answer/);
});

test('lineSeconds reads the clock on Android and iOS lines', () => {
  assert.equal(lineSeconds('10-15 18:15:40.635 1 2 I ReactNativeJS: x'), 18 * 3600 + 15 * 60 + 40.635);
  assert.equal(lineSeconds('2026-10-16 23:01:18.514 Df KeyRing[123:456] x'), 23 * 3600 + 60 + 18.514);
});

test('taskRound times a prove from its ask to its verified reply', () => {
  const log = [
    L('[TrustTasks:VtaClient] asked its agent https://trusttasks.org/spec/vta/pcs/prove/0.1 over rev3').replace('18:15:40.635', '18:20:01.000'),
    L('[TrustTasks:VtaClient] reply verified: https://trusttasks.org/spec/vta/pcs/prove/0.1').replace('18:15:40.635', '18:20:37.500'),
  ].join('\n');
  assert.deepEqual(taskRound(log, '/vta/pcs/prove/0.1'), { asked: true, verified: true, seconds: 36.5, noAnswer: undefined });
});

test('taskRound reports the no-answer line verbatim', () => {
  const log = [
    L('[TrustTasks:VtaClient] asked its agent https://trusttasks.org/spec/vta/pcs/prove/0.1 over rev3'),
    L('[TrustTasks:VtaClient] no answer to https://trusttasks.org/spec/vta/pcs/prove/0.1 after 90 s'),
  ].join('\n');
  const r = taskRound(log, '/vta/pcs/prove/0.1');
  assert.equal(r.verified, false);
  assert.match(r.noAnswer, /no answer to \S+\/vta\/pcs\/prove\/0\.1 after 90 s/);
});

test('appLevelLines keeps the app\'s own lines and drops transport resolution', () => {
  const v = 'did:webvh:Qmv:dids.example:vetter';
  const log = [
    `2026-10-16 23:59:14.217 I  KeyRing[1:2] [com.facebook.react.log:javascript] resolving didUrl ${v}`,
    `2026-10-16 23:59:14.501 I  KeyRing[1:2] [com.facebook.react.log:javascript] [TrustTasks:TspCapability] ${v} does not advertise TSPTransport — using DIDComm`,
    `2026-10-16 23:59:41.686 I  KeyRing[1:2] [com.facebook.react.log:javascript] [hidden-vetting] attestation taken by the agent; it reports 1 held`,
    `2026-10-16 23:59:42.000 I  KeyRing[1:2] [com.facebook.react.log:javascript] [VTI] statement from ${v}`,
    `2026-10-16 23:59:43.000 Df KeyRing[1:2] [com.apple.network] ${v}`,
  ].join('\n');
  const kept = appLevelLines(log);
  assert.equal(kept.split('\n').length, 2);
  assert.ok(kept.includes(`statement from ${v}`), 'an app-level mention is still caught');
  assert.ok(!kept.includes('resolving didUrl'));
});

test('withoutOwnRequestCard drops only the applicant\'s own request and session card', () => {
  const src = [
    '<XCUIElementTypeStaticText name="com.ariesbifold:id/VettingRequestVetterDid" value="did:x"/>',
    '<XCUIElementTypeStaticText name="com.ariesbifold:id/VettingSessionVetter" value="did:x"/>',
    '<XCUIElementTypeStaticText name="com.ariesbifold:id/VettingAttestationHeld" value="did:x"/>',
  ].join('\n');
  const kept = withoutOwnRequestCard(src);
  assert.ok(!kept.includes('VettingRequestVetterDid') && !kept.includes('VettingSessionVetter'));
  assert.ok(kept.includes('VettingAttestationHeld'));
});

test('appLevelLines reads Android\'s ReactNativeJS lines too (an empty read would pass hollow)', () => {
  const v = 'did:webvh:Qmv:dids.example:vetter';
  const log = [
    `10-18 09:00:00.000  1234  1300 I ReactNativeJS: resolving didUrl ${v}`,
    `10-18 09:00:01.000  1234  1300 I ReactNativeJS: [VTI] statement from ${v}`,
    `10-18 09:00:02.000  1234  1301 D OkHttp  : ${v}`,
  ].join('\n');
  const kept = appLevelLines(log);
  assert.equal(kept.split('\n').length, 1);
  assert.ok(kept.includes(`statement from ${v}`));
});

test('anonymityVerdict: an empty source fails as such, never passes as "absent"', async () => {
  const { anonymityVerdict } = await import('./hvVerdict.js');
  const vetterDid = 'did:webvh:QmVetterVetterVetter:dids.example:vetter';
  const memberDid = 'did:webvh:QmZWDgXDWUxxkR3SHZWLzF:dids.example:quiz-pyramid';
  const record = JSON.stringify({ did: memberDid });
  const shown = '… vtiAgent: inbound …/submit/0.3#response (session did:webvh:QmZWDgXD…)';
  assert.equal(anonymityVerdict({ vetterDid, memberDid, shown: '', record }).ok, false);
  assert.match(anonymityVerdict({ vetterDid, memberDid, shown: '', record }).detail, /source empty: the applicant side/);
  assert.match(anonymityVerdict({ vetterDid, memberDid, shown, record: '{}' }).detail, /source empty: the community's record/);
  assert.equal(anonymityVerdict({ vetterDid, memberDid: undefined, shown, record }).ok, false);
});

test('anonymityVerdict: both sources read, the vetter absent passes; present fails', async () => {
  const { anonymityVerdict } = await import('./hvVerdict.js');
  const vetterDid = 'did:webvh:QmVetterVetterVetter:dids.example:vetter';
  const memberDid = 'did:webvh:QmZWDgXDWUxxkR3SHZWLzF:dids.example:quiz-pyramid';
  const record = JSON.stringify({ did: memberDid });
  const shown = 'session did:webvh:QmZWDgXD… card filed';
  assert.equal(anonymityVerdict({ vetterDid, memberDid, shown, record }).ok, true);
  const leak = anonymityVerdict({ vetterDid, memberDid, shown: shown + ` [VTI] statement from ${vetterDid}`, record });
  assert.equal(leak.ok, false);
  assert.match(leak.detail, /appears in the applicant side/);
});

test('taskRound: a reply before its ask is not verified (the ordering is vi\'s own `i > ai`)', () => {
  // Since #594 `verified` is `vi >= 0`; the ask-then-reply order rests only on vi's search starting after the ask.
  // A tidy-up to a plain findIndex there would read as harmless and break this.
  const r = taskRound([
    L('[TrustTasks:VtaClient] reply verified: https://trusttasks.org/spec/vta/pcs/prove/0.1'),
    L('[TrustTasks:VtaClient] asked its agent https://trusttasks.org/spec/vta/pcs/prove/0.1 over rev3'),
  ].join('\n'), '/vta/pcs/prove/0.1');
  assert.equal(r.asked, true);
  assert.equal(r.verified, false);
});
