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
import { idsOwnedBy, ownersFrom, pathExists, select } from './changed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eDir = path.resolve(here, '..');

export const slugOf = (id, saw = '') =>
  `${id.toLowerCase()}${saw ? '-' + saw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 5).join('-') : ''}`;

/** Where a unit test for a source file goes, by the repo's own layout (bifold core's __tests__/<area>, a feature
 * module's __tests__, react-hooks' tests/, the app's __tests__/<area>). */
export function unitTestPath(file, slug) {
  const ext = /\.tsx$/.test(file) ? 'tsx' : 'ts';
  const name = `${slug}.test.${ext}`;
  let m;
  if ((m = file.match(/^(bifold\/packages\/core\/src\/modules\/[^/]+)\//))) return `${m[1]}/__tests__/${name}`;
  if ((m = file.match(/^bifold\/packages\/core\/src\/([^/]+)\//))) return `bifold/packages/core/__tests__/${m[1]}/${name}`;
  if (/^bifold\/packages\/core\//.test(file)) return `bifold/packages/core/__tests__/${name}`;
  if (/^bifold\/packages\/react-hooks\//.test(file)) return `bifold/packages/react-hooks/tests/${name}`;
  // The trust-tasks package has no tests of its own: core's trust-tasks module covers it.
  if (/^bifold\/packages\/trust-tasks\//.test(file)) return `bifold/packages/core/src/modules/trust-tasks/__tests__/${name}`;
  if ((m = file.match(/^(bifold\/packages\/[^/]+)\//))) return `${m[1]}/__tests__/${name}`;
  if ((m = file.match(/^app\/src\/([^/]+)\//))) return `app/__tests__/${m[1]}/${name}`;
  return `app/__tests__/${name}`;
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
  return `// In the leg's driver, with the page objects (lib/pages/*). A plain row: it must FAIL on the tester's build.
// (Only a row that lands BEFORE its fix gets { tracked: "${id}: fix pending" }, and the fix's PR removes it again:
// a tracked row is a SKIP while it fails, so left in place it would hide this bug coming back.)
await rows.row("${slug}", async () => {
  // Reach the screen and do what the tester did: ${saw || '<what the tester saw>'}.
  return { ok: false, detail: "replace: the check that fails on the tester's build, quoting what the screen shows" };
});
`;
}

/** The newest queue line for exactly this id (IN-25 never matches IN-257). Private: shown, never committed. */
export function queueLine(id, text) {
  const re = new RegExp(`\\|\\s*${id.replace(/[-]/g, '\\-')}(?!\\d)`);
  return text.split('\n').filter((l) => re.test(l)).pop() || '';
}

const QUEUE = () => { try { return fs.readFileSync(process.env.QUEUE_FILE || path.join(os.homedir(), '.keyring-fleet/queue.md'), 'utf8'); } catch { return ''; } };
const usesRows = (driver, read) => { try { return /createRows\s*\(/.test(read(driver)); } catch { return false; } };

/**
 * The plan for one report: is the gate looking, and where does the failing test go. Pure but for `read`/`exists`.
 * { legs, ids, unmapped, missing, kind: 'unit'|'row', unitPath?, driver?: {leg, driver, unit} }
 */
export function plan({ files }, { manifests, legsDir, read = (f) => fs.readFileSync(f, 'utf8'), exists = pathExists, repoRoot = path.resolve(e2eDir, '..') }) {
  const missing = files.filter((f) => /^(bifold|app)\//.test(f) && exists(f) === false);
  const present = files.filter((f) => !missing.includes(f));
  const owned = idsOwnedBy(present, ownersFrom(manifests));
  const r = select(present, { manifests, legsDir, read, root: path.join(repoRoot, 'e2e'), top: repoRoot });
  const legs = [...r.legs.keys()].sort();
  const ids = [...new Set([...r.legs.values()].flat().map((w) => w.id))];
  const out = { legs, ids, unmapped: owned.unmapped, missing };
  if (missing.length && !present.length) return { ...out, kind: 'none' };
  if (owned.unmapped.length || !legs.length) return { ...out, kind: 'unit', unitPath: unitTestPath(owned.unmapped[0] || present[0], '<slug>') };
  // A leg's own driver that builds rows, preferring a hit in the driver itself or a page object, then a cheap smoke leg.
  const cands = legs.flatMap((l) => (r.legs.get(l) || []).map((w) => ({ leg: l, ...w })))
    .filter((w) => !/run-vta-link\.js$/.test(w.driver) && usesRows(path.resolve(repoRoot, w.driver), read));
  const score = (w) => (w.unit.startsWith(`${w.driver}#`) || /lib\/pages\//.test(w.unit) ? 2 : 0) + (/^smoke-/.test(w.leg) ? 1 : 0);
  cands.sort((a, b) => score(b) - score(a) || a.leg.localeCompare(b.leg));
  return cands.length ? { ...out, kind: 'row', driver: { leg: cands[0].leg, driver: cands[0].driver, unit: cands[0].unit } } : { ...out, kind: 'unit', unitPath: unitTestPath(present[0], '<slug>') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const id = arg('--report');
  const files = (arg('--files') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!/^IN-\d+$/.test(id || '') || !files.length) { console.error('usage: repro.mjs --report IN-<n> --files a,b,… [--saw "…"] [--want "…"]'); process.exit(64); }
  const saw = arg('--saw') || '', want = arg('--want') || '';
  const slug = slugOf(id, saw);
  const q = queueLine(id, QUEUE());
  if (q) console.log(`report (the local queue; private: never paste it into a PR or an issue):\n  ${q.slice(0, 300)}\n`);
  const manifests = [
    { file: 'lib/testids.json', root: 'bifold/packages/core/' },
    { file: 'lib/testids.app.json', root: 'app/' },
  ].filter((m) => fs.existsSync(path.join(e2eDir, m.file))).map((m) => ({ root: m.root, json: JSON.parse(fs.readFileSync(path.join(e2eDir, m.file), 'utf8')) }));
  const p = plan({ files }, { manifests, legsDir: path.join(here, 'legs') });
  if (p.missing.length) console.log(`no such file in the wallet or bifold tree: ${p.missing.join(', ')}`);
  if (p.kind === 'none') { process.exitCode = 2; } else {
    console.log('1. Is the gate looking?');
    console.log(p.legs.length ? `   yes: ${p.legs.join(', ')} reach ${p.ids.slice(0, 6).join(', ')}` : '   no leg reaches these files');
    if (p.unmapped.length) console.log(`   own no testID (logic): ${p.unmapped.join(', ')}`);
    if (p.kind === 'unit') {
      console.log('\n2. The failing test first: a unit test (fast, no device; the gate cannot see this change)');
      console.log(`   file: ${p.unitPath.replace('<slug>', slug)}\n`);
      console.log(unitSkeleton({ id, saw, want }).replace(/^/gm, '   '));
    } else {
      console.log('\n2. The failing test first: a row in a leg that reaches the screen (or a unit test if the bug is in logic)');
      console.log(`   leg ${p.driver.leg}, driver: ${p.driver.driver}  (reaches ${p.driver.unit})\n`);
      console.log(rowSkeleton({ id, saw, slug }).replace(/^/gm, '   '));
    }
    console.log(`3. Red: run it on the build the tester has; it must fail for the reason in the report.
4. Fix, then the same test green${p.kind === 'row' ? ' (a plain row: no tracked option left behind)' : ''}.
5. Prove it where the gate looks: gate.sh changed --pin <fix sha> --range <base>..<fix>${p.kind === 'unit' ? '   (for logic-only fixes the unit test is the proof; changed says "full gate")' : ''}
6. Route it: node scripts/release/tier.mjs --range <last store build>..<fix>   (ota -> the OTA ring 0; store -> a store build and the full gate)
7. Before an external release: the full gate, always.`);
  }
}
