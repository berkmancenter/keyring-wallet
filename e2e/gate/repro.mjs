#!/usr/bin/env node
// From a tester's report to a test that fails first. Before a fix: is the gate already looking at this, and if not,
// where does the failing test go? Prints a starting test (a bifold unit test, or a gate row), and the rest of the
// loop as commands: red on the tester's build, the fix, green, the changed legs, the tier.
//
//   repro.mjs --report IN-257 --files bifold/packages/core/src/screens/PINEnter.tsx[,…] [--saw "…"] [--want "…"]
//
// The report's line is read from the local queue (QUEUE_FILE, default ~/.keyring-fleet/queue.md) when it is there;
// it is printed for you only and never written into the repo. Prints; writes nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { select, ownersFrom, idsOwnedBy } from './changed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eDir = path.resolve(here, '..');

export const slugOf = (id, saw = '') =>
  `${id.toLowerCase()}${saw ? '-' + saw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 5).join('-') : ''}`;

/** Where a bifold unit test for a source file goes: its module's __tests__ (the folder the screen tests live in). */
export function unitTestPath(file, slug) {
  const m = file.match(/^(bifold\/packages\/[^/]+\/src\/(?:modules\/[^/]+\/)?)/);
  const base = m ? m[1] : 'bifold/packages/core/src/';
  const ext = /\.tsx$/.test(file) ? 'tsx' : 'ts';
  return `${base}__tests__/${slug}.test.${ext}`;
}

export function unitSkeleton({ id, saw, want, base }) {
  return `/**
 * ${id}: ${saw || '<what the tester saw>'}. ${want ? `It should ${want}.` : '<what should happen instead>.'}
 * Red before the fix (on ${base || '<the commit the tester has>'}), green after. Fake only the edges (the agent, the
 * network, the stores): joinLostRequest.test.tsx shows the pattern with in-memory records.
 */
describe('${id}: ${(saw || 'what the tester saw').replace(/'/g, "\\'")}', () => {
  it('${(want || 'does what the tester expected').replace(/'/g, "\\'")}', async () => {
    // Arrange: the state the tester was in.
    // Act: what they did.
    // Assert: what they should have seen.
    expect('replace this').toBe('a check that fails on the build the tester has')
  })
})
`;
}

export function rowSkeleton({ id, saw, slug }) {
  return `// In the leg's driver (see below for which), with the page objects (lib/pages/*):
await rows.row("${slug}", async () => {
  // Reach the screen and do what the tester did: ${saw || '<what the tester saw>'}.
  return { ok: false, detail: "replace: the check that fails on the tester's build, quoting what the screen shows" };
}, { tracked: "${id}: until the fix ships" }); // tracked (rows.js): a SKIP until it passes, so it can't turn the gate red
`;
}

function queueLine(id) {
  const file = process.env.QUEUE_FILE || path.join(os.homedir(), '.keyring-fleet/queue.md');
  try {
    return fs.readFileSync(file, 'utf8').split('\n').find((l) => l.includes(`| ${id}`) || l.includes(`| ${id}-`)) || '';
  } catch {
    return '';
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const id = arg('--report');
  const files = (arg('--files') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!id || !files.length) { console.error('usage: repro.mjs --report IN-<n> --files a,b,… [--saw "…"] [--want "…"]'); process.exit(64); }
  const saw = arg('--saw') || '', want = arg('--want') || '';
  const slug = slugOf(id, saw);
  const q = queueLine(id);
  if (q) console.log(`report (local queue, not committed):\n  ${q.slice(0, 300)}\n`);

  const manifests = [
    { file: 'lib/testids.json', root: 'bifold/packages/core/' },
    { file: 'lib/testids.app.json', root: 'app/' },
  ].filter((m) => fs.existsSync(path.join(e2eDir, m.file))).map((m) => ({ root: m.root, json: JSON.parse(fs.readFileSync(path.join(e2eDir, m.file), 'utf8')) }));
  const owned = idsOwnedBy(files, ownersFrom(manifests));
  const r = select(files, { manifests, legsDir: path.join(here, 'legs') });
  const legs = [...r.legs.keys()].sort();

  console.log('1. Is the gate looking?');
  if (legs.length) console.log(`   yes: ${legs.join(', ')} reach ${[...new Set([...r.legs.values()].flat().map((w) => w.id))].slice(0, 6).join(', ')}`);
  else console.log('   no leg reaches these files');
  if (owned.unmapped.length) console.log(`   own no testID (logic): ${owned.unmapped.join(', ')}`);

  const unit = owned.unmapped.length > 0 || !legs.length;
  console.log(`\n2. The failing test first: ${unit ? 'a bifold unit test (fast, no device; the gate cannot see this change)' : 'a row in a leg that reaches the screen, or a unit test if the bug is in logic'}`);
  if (unit) {
    const target = owned.unmapped[0] || files[0];
    console.log(`   file: ${unitTestPath(target, slug)}\n`);
    console.log(unitSkeleton({ id, saw, want }).replace(/^/gm, '   '));
  } else {
    // A leg's own driver, not the shared link step every leg runs first (run-vta-link.js): the row belongs there.
    const all = legs.flatMap((l) => (r.legs.get(l) || []).map((w) => ({ leg: l, ...w })));
    const own = all.find((w) => !/run-vta-link\.js$/.test(w.driver)) || all[0] || {};
    console.log(`   leg ${own.leg || '?'}, driver: ${own.driver || '?'}  (reaches ${own.unit || '?'})\n`);
    console.log(rowSkeleton({ id, saw, slug }).replace(/^/gm, '   '));
  }
  console.log(`3. Red: run it on the build the tester has; it must fail for the reason in the report.
4. Fix, then the same test green.
5. Prove it where the gate looks: gate.sh changed --pin <fix sha> --range <base>..<fix>${unit ? '   (for logic-only fixes the unit test is the proof; changed says "full gate")' : ''}
6. Route it: node scripts/release/tier.mjs --range <base>..<fix>   (ota -> the OTA ring 0; store -> a store build and the full gate)
7. Before an external release: the full gate, always.`);
}
