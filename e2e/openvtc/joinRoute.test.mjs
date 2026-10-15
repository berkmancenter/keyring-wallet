// node --test e2e/openvtc/joinRoute.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isOwnStatementsRow, vettingRouteRows } from './tuiRoles.js';

const ME = 'did:webvh:QmXyz:dids.ic3.dev:hand-idea';

// "Choose how to join" at openvtc 0.5.0 (2a4fa2b3), the shape of the 1015-1852 gate's p2 screen: one route row per
// persona (state_handler/join_flow.rs:570-600), the persona shortened from the middle, and below them the detail
// lines that quote a row inside "Your application, as … — next: join — Enter on "…"".
const SCREEN = [
  '│  Vetting                                                                    │',
  '│  ▸ Present your vetting statements as did:we…id:webv…j:dids.ic   1 statement ready to present │',
  '│    Present your vetting statements as did:we…id:webv…:dids.ic3   1 statement ready to present │',
  '│    Present your vetting statements as Person…c3.dev:hand-idea)   1 statement ready to present │',
  '│    Apply for vetting as a new persona   a new DID — vetting starts from scratch               │',
  '│  Other ways in                                                              │',
  '│    Send an open request                                                     │',
  '│  Your application, as Persona (did:webv…:dids.ic3.dev:hand-idea) — next: join — Enter on "Present your vetting statements as Person…c3.dev:hand-idea)" │',
].join('\n');

test('reads the route rows, not the detail lines that quote them', () => {
  const rows = vettingRouteRows(SCREEN);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.focused), [true, false, false, false]);
  assert.ok(rows.every((r) => !r.text.startsWith('Your application')));
});

test("finds this run's persona among other runs' applications by its DID's last segment", () => {
  const rows = vettingRouteRows(SCREEN);
  assert.deepEqual(rows.map((r) => isOwnStatementsRow(r.text, ME)), [false, false, true, false]);
});

test('a persona whose application is still under way, or proves by PCS, is not a statements row', () => {
  assert.equal(isOwnStatementsRow('Carry on with your application as Person…c3.dev:hand-idea)', ME), false);
  assert.equal(isOwnStatementsRow('Present your PCS ZKP proof as Person…c3.dev:hand-idea)', ME), false);
  assert.equal(isOwnStatementsRow('Present your vetting statements as Person…c3.dev:other-one)', ME), false);
});

test('the 0.4.0 page (a nested "Apply as" chooser) has no per-persona rows, so the old path still runs', () => {
  const old = ['│  ▸ Present your vetting statements                                          │', '│    Apply as  Harness Applicant  (did:webv…:hand-idea)  — ready to present │'].join('\n');
  assert.equal(vettingRouteRows(old).length, 0);
});
