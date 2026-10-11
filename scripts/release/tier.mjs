#!/usr/bin/env node
// Can a change reach testers as an over-the-air bundle, or does it need a store build? The rules are the OTA
// report's (10-08, "What OTA can carry"), applied to the paths a change touches:
//   ota    screens, flows, copy, theme, JS localisation, in app/src and the bifold packages' src (one JS bundle)
//   store  the native projects (ios/, android/, Xcode and Gradle files, Info.plist, manifests, entitlements), native
//          modules, build-time config (react-native-config, app.json), dependency manifests and patches (until a
//          native fingerprint check can clear them), and, by policy, stored-data migrations: a bundle that migrates
//          records and is then withdrawn would land older code on a migrated store
//   none   nothing the app ships (docs, tests, e2e, CI, tooling)
// The tier of a change is its highest: one store file makes the whole change "store".
//
//   tier.mjs --files a,b,…           paths from the wallet root (bifold/packages/…, app/…)
//   tier.mjs --range <a>..<b>        the wallet range, plus the bifold submodule's range when its pin moved
//   [--json]                         prints {tier, reasons: {file: rule}}; exit 0 ota, 1 none, 2 store
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Stored-data migration code (the OTA report's "no, by policy" row). Extend when a migration moves or is added. */
export const MIGRATION_PATHS = [
  'app/src/hooks/useBCAgentSetup.ts',
  'bifold/packages/core/src/hooks/useBifoldAgentSetup.ts',
  'bifold/packages/core/src/utils/migration.ts',
  'bifold/packages/core/src/modules/trust-tasks/module/vtaKeyMigration.ts',
  'bifold/packages/core/src/modules/vrc/services/rCardCredential.ts',
  'bifold/packages/core/src/contexts/reducers/store.ts',
];

// First match wins: what the app never ships, then store, then the rest of none, then ota.
export const RULES = [
  // What the app never ships, first: a manifest or a config there decides nothing about the app's binary.
  ['none', 'e2e, CI and tooling', /^(e2e|\.github|scripts|tsp-reference|deploy|\.claude|\.husky|\.yarn\/releases|\.demo-local)\//],
  ['none', 'docs', /\.(md|txt)$|^docs\//],
  ['none', 'tests', /(^|\/)(__tests__|__mocks__)\/|\.(test|spec)\.[jt]sx?$/],
  ['none', 'repository dotfile', /^\.[^/]+$/],
  ['none', 'the .env template (builds read their own .env)', /^app\/\.env\.sample$/],
  ['none', 'server-side package (not in the app)', /^bifold\/packages\/(witness-server|mediator-server|vrc-reference|vrc-shared)\//],
  ['none', "bifold's sample app, tooling or CI", /^bifold\/(samples|scripts|\.github|\.githooks|docs)\//],
  ['none', "a package's test or type-check config", /^bifold\/packages\/[^/]+\/(jest\.config\.[jt]s|tsconfig[^/]*\.json|\.eslintrc[^/]*|\.prettierrc[^/]*)$/],
  ['none', "bifold's own lockfile (the app installs from the wallet's yarn.lock, which a new dependency changes)", /^bifold\/yarn\.lock$/],
  // Store: compiled into the binary, or never OTA by policy.
  ['store', 'native project (iOS/Android folder)', /^(app|bifold\/packages\/[^/]+)\/(ios|android)\//],
  ['store', 'native build file', /(^|\/)(Podfile(\.lock)?|[^/]+\.podspec|[^/]+\.gradle(\.kts)?|gradle\.properties|Info\.plist|AndroidManifest\.xml|[^/]+\.entitlements)$/],
  ['store', 'Xcode project', /\.(xcodeproj|xcworkspace)\//],
  ['store', 'native module package', /^bifold\/packages\/(react-native-attestation|react-native-locality-peripheral)\/(?!src\/|__tests__\/|README)/],
  ['store', 'build-time config (react-native-config, app config)', /^app\/(\.env(\.[^/]*)?|app\.json|app\.config\.[jt]s|react-native\.config\.js|babel\.config\.js|metro\.config\.js)$/],
  ['store', 'dependency manifest or patch (needs a native fingerprint check)', /(^|\/)(package\.json|yarn\.lock|Podfile\.lock)$|^\.yarn\/patches\/|^app\/patches\//],
  ['store', 'stored-data migration (policy: never OTA)', (f) => MIGRATION_PATHS.includes(f)],
  ['store', 'bifold pin moved but its range was not read', /^bifold@/],
  // OTA: the one JS bundle.
  ['ota', 'app JavaScript bundle (screens, flows, copy, theme, localisation)', /^(app\/src|bifold\/packages\/[^/]+\/src)\/|^app\/[^/]+\.[jt]sx?$/],
];

const RANK = { none: 0, ota: 1, store: 2 };

/** The tier of each file, and of the whole change. An unknown path counts as store: never OTA by default. */
export function classify(files) {
  const reasons = {};
  let tier = 'none';
  for (const f of files) {
    const hit = RULES.find(([, , m]) => (typeof m === 'function' ? m(f) : m.test(f)));
    const [t, why] = hit ? [hit[0], hit[1]] : ['store', 'unknown path (not OTA by default)'];
    reasons[f] = `${t}: ${why}`;
    if (RANK[t] > RANK[tier]) tier = t;
  }
  return { tier, reasons };
}

function changedFiles(range) {
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  const files = git('diff', '--name-only', range).split('\n').filter(Boolean);
  const [a, b] = range.split('..');
  const pin = (rev) => { try { return git('rev-parse', `${rev}:bifold`); } catch { return ''; } };
  const pa = pin(a), pb = pin(b);
  if (pa && pb && pa !== pb) {
    // The submodule's own clone (BIFOLD_GIT, else ./bifold). Unreadable -> a marker the rules count as store.
    const dir = process.env.BIFOLD_GIT || path.join(repo, 'bifold');
    try {
      const inner = execFileSync('git', ['-C', dir, 'diff', '--name-only', `${pa}..${pb}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').filter(Boolean);
      files.push(...inner.map((f) => `bifold/${f}`));
    } catch {
      files.push(`bifold@${pa.slice(0, 8)}..${pb.slice(0, 8)} (range unreadable here; set BIFOLD_GIT)`);
    }
  }
  return files.filter((f) => f !== 'bifold');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const files = arg('--files') ? arg('--files').split(',').map((s) => s.trim()).filter(Boolean) : arg('--range') ? changedFiles(arg('--range')) : null;
  if (!files) { console.error('usage: tier.mjs --files a,b,… | --range <a>..<b> [--json]'); process.exit(64); }
  const r = classify(files);
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    for (const [f, why] of Object.entries(r.reasons)) if (!why.startsWith('none')) console.log(`${why.split(':')[0].padEnd(5)} ${f} (${why.split(': ')[1]})`);
    console.log(`tier=${r.tier}`);
  }
  // exitCode, not exit(): a large --json written to a pipe must finish before the process ends.
  process.exitCode = { ota: 0, none: 1, store: 2 }[r.tier];
}
