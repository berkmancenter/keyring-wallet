#!/usr/bin/env node
// Join the fixture's persona to a community with its invitation, through the
// TUI, and wait until the TUI has stored the membership (tuiRoles.joinByInvitation).
// Run inside an announced criteria window when the community's criteria would
// not admit an invitation alone (farm-test-resources.md).
//
//   node e2e/openvtc/join-fixture.mjs --bin <openvtc> --version <sha> --dir <config dir> \
//     --profile <name> --vic <vic.json> --community <did> --persona-label "<persona name>"

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import * as tuiRoles from './tuiRoles.js';

const { values: a } = parseArgs({
  options: {
    bin: { type: 'string' },
    version: { type: 'string' },
    dir: { type: 'string' },
    profile: { type: 'string' },
    vic: { type: 'string' },
    community: { type: 'string' },
    'persona-label': { type: 'string' },
  },
});
for (const k of ['bin', 'version', 'dir', 'profile', 'vic', 'community', 'persona-label']) if (!a[k]) throw new Error(`--${k} is required`);

const log = path.join(a.dir, 'fixture-steps.jsonl');
const tui = await tuiRoles.launch({ bin: a.bin, version: a.version, dir: a.dir, profile: a.profile, role: 'openvtc-fixture', log });
let code = 0;
try {
  const hit = await tuiRoles.joinByInvitation(tui, {
    vic: readFileSync(a.vic, 'utf8'),
    community: a.community,
    personaLabel: a['persona-label'],
    debugLog: path.join(a.dir, `debug-${a.profile}.log`),
  });
  console.log(`[join] membership stored: ${hit.slice(0, 27)}`);
} catch (e) {
  console.error(`[join] ${String(e.message).split('\n')[0]}`);
  code = 1;
} finally {
  // Only after the membership is stored, or after a failure that says so.
  await new Promise((r) => setTimeout(r, 3000));
  await tui.stop();
}
process.exit(code);
