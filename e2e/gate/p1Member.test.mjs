// node --test e2e/gate/p1Member.test.mjs
// p1's cleanup names a member only when it can be told apart as the run's own (openvtc/p1Member.mjs, ac on #873).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { p1OwnMember } from '../openvtc/p1Member.mjs';

const T0 = '2026-11-08T07:00:00Z', T1 = '2026-11-08T07:30:00Z', IN = '2026-11-08T07:10:00Z', OLD = '2026-10-01T00:00:00Z';
const OURS = 'did:webvh:Qm1:dids.ic3.dev:frown-coral', OTHER = 'did:webvh:Qm2:dids.ic3.dev:a-person', TUI = 'did:webvh:Qm3:dids.ic3.dev:pledge-champion';
const before = new Set(['did:old:1', TUI]);
const base = { before, startedAt: T0, endedAt: T1, fixtures: [TUI], green: true };

test('the one member new in the run is named', () => {
  assert.equal(p1OwnMember({ ...base, after: [{ did: 'did:old:1', joinedAt: OLD }, { did: OURS, joinedAt: IN }] }).did, OURS);
});

test('a member joining in the window who is not p1\'s is not removed: with two new, none is named', () => {
  const r = p1OwnMember({ ...base, after: [{ did: OURS, joinedAt: IN }, { did: OTHER, joinedAt: IN }] });
  assert.equal(r.did, undefined);
  assert.match(r.why, /2 members new/);
});

test('a fixture (the TUI persona, a seated vetter) is never named, even if it rejoined in the window', () => {
  const r = p1OwnMember({ ...base, before: new Set(['did:old:1']), after: [{ did: TUI, joinedAt: IN }] });
  assert.equal(r.did, undefined);
});

test('a failed run, or no start snapshot, names none', () => {
  const after = [{ did: OURS, joinedAt: IN }];
  assert.equal(p1OwnMember({ ...base, after, green: false }).did, undefined);
  assert.equal(p1OwnMember({ ...base, after, before: undefined }).did, undefined);
});

test('a member already there at the start, or joined outside the window, is not new', () => {
  assert.equal(p1OwnMember({ ...base, before: new Set([OURS]), after: [{ did: OURS, joinedAt: IN }] }).did, undefined);
  assert.equal(p1OwnMember({ ...base, after: [{ did: OURS, joinedAt: '2026-11-08T08:00:00Z' }] }).did, undefined);
});

test('control: the old pure time window would have named the other person too', () => {
  const after = [{ did: OURS, joinedAt: IN }, { did: OTHER, joinedAt: IN }];
  const window = after.filter((m) => Date.parse(m.joinedAt) >= Date.parse(T0)).map((m) => m.did);
  assert.ok(window.includes(OTHER));
  assert.equal(p1OwnMember({ ...base, after }).did, undefined);
});
