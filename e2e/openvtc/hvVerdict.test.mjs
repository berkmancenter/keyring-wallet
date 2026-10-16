// node --test e2e/openvtc/hvVerdict.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applicationVerdict } from './hvVerdict.js';

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

test('a verified reply before any ask does not count', () => {
  const v = applicationVerdict(L('[TrustTasks:VtaClient] reply verified: https://trusttasks.org/spec/vta/pcs/applications/create/0.1'));
  assert.equal(v.status, 'FAIL');
});
