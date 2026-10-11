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
//   [--json]                         prints {tier, reasons: {file: rule}, flags: [{flag, hold, files}], held, unchecked}
// Exit: 0 ota, 1 none, 2 store (native, or a held flag), 3 an error (reported as store, never none), 4 unchecked (ota by
// its paths, but --files cannot read the added lines a held flag looks at: run it with --range). ONLY 0 permits an OTA
// publish; 1-4 all mean do not publish OTA. "tier" is the verdict; "reasons" is the per-file input (a file there can
// say ota while the tier is store or unchecked), so never recompute the tier from reasons.
// While a held flag reads added lines (deletes stored records does), --files can never say ota: a change that is ota
// by its paths always comes out unchecked there. A publish step must use --range.
// The range's base must be the LAST STORE BUILD: a JS change that calls a native method added since then reads ota
// here, and only a native fingerprint at publish time can catch it.
// Flags (FLAGS) name classes of change the owner holds back from OTA even when they could travel (decided 10-11): a
// flag with hold: true moves an "ota" change to "store" and lists itself under "held". A flag without it is shown only.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
  // Shapes the install, so store, though it sits in a tooling folder.
  ['store', 'install script (shapes node_modules)', /^scripts\/(ensure-bifold-ready|fix-portal-symlinks)\.js$/],
  // Folders the app never ships.
  ['none', 'e2e, CI and tooling', /^(e2e|\.github|scripts|tsp-reference|deploy|\.claude|\.husky|\.yarn\/releases|\.demo-local|docs)\//],
  ['none', 'server-side package (not in the app)', /^bifold\/packages\/(witness-server|mediator-server|vrc-reference|vrc-shared)\//],
  ['none', "bifold's sample app, tooling or CI", /^bifold\/(samples|scripts|\.github|\.githooks|docs)\//],
  // Store: compiled into the binary.
  ['store', 'native project (iOS/Android folder)', /^(app|bifold\/packages\/[^/]+)\/(ios|android)\//],
  ['store', 'native build file', /(^|\/)(Podfile(\.lock)?|[^/]+\.podspec|[^/]+\.gradle(\.kts)?|gradle\.properties|Info\.plist|AndroidManifest\.xml|[^/]+\.entitlements|CMakeLists\.txt)$/],
  ['store', 'Xcode project', /\.(xcodeproj|xcworkspace)\//],
  // Codegen TurboModule specs live in their src (codegenConfig jsSrcsDir "src"): the whole package is native.
  ['store', 'native module package (codegen specs included)', /^bifold\/packages\/(react-native-attestation|react-native-locality-peripheral)\/(?!__tests__\/|README)/],
  ['store', 'font (linked into the binary: react-native.config assets)', /\.(ttf|otf|woff2?)$/i],
  ['store', 'build-time config (react-native-config, app config, babel/metro)', /^app\/(\.env(?!\.sample$)(\.[^/]*)?|app\.json|app\.config\.[cm]?[jt]s|(react-native|babel|metro)\.config\.[cm]?[jt]s)$/],
  ['store', 'install config at the root', /^(\.yarnrc\.yml|\.env(\.[^/]*)?|\.npmrc)$/],
  // What the app never ships, by file type.
  ['none', 'docs', /\.(md|txt)$/],
  ['none', 'tests', /(^|\/)(__tests__|__mocks__)\/|\.(test|spec)\.[jt]sx?$/],
  ['none', 'repository dotfile', /^\.(gitignore|gitattributes|editorconfig|nvmrc|prettierrc[^/]*|prettierignore|eslintrc[^/]*|eslintignore|commitlintrc[^/]*|lintstagedrc[^/]*)$/],
  ['none', 'the .env template (builds read their own .env)', /^app\/\.env\.sample$/],
  ['none', "a package's test or type-check config", /^bifold\/packages\/[^/]+\/(jest\.config\.[jt]s|tsconfig[^/]*\.json|\.eslintrc[^/]*|\.prettierrc[^/]*)$/],
  ['none', "bifold's own lockfile (the app installs from the wallet's yarn.lock, which a new dependency changes)", /^bifold\/yarn\.lock$/],
  // Store: dependencies, policy.
  ['store', 'dependency manifest or patch (needs a native fingerprint check)', /(^|\/)(package\.json|yarn\.lock|Podfile\.lock)$|^\.yarn\/patches\/|^app\/patches\//],
  ['store', 'stored-data migration (policy: never OTA)', (f) => MIGRATION_PATHS.includes(f)],
  ['store', 'bifold pin moved but its range was not read', /^bifold@/],
  // OTA: the one JS bundle. At the app's root only the bundle's own entry files (an allowlist).
  ['ota', 'app JavaScript bundle (screens, flows, copy, theme, localisation)', /^(app\/src|bifold\/packages\/[^/]+\/src)\/|^app\/(App\.tsx|index\.js|container-imp\.ts)$/],
];

/**
 * Flags: classes of change that could travel OTA (the OTA lane's question 1 on board #29). The owner holds all three
 * back for now (10-11): hold: true routes them to a store build. Setting hold to false makes a flag advisory again,
 * shown to the approver beside an "ota" tier. A flag matches a path, or (with --range, which reads the diff) a line
 * the change adds.
 */
export const FLAGS = [
  // Storage deletes only: a Map's or Set's .delete() is not one. deleteById on any receiver (Credo's APIs), .delete or
  // .remove on a receiver named for storage, and the record-removing helpers.
  { flag: 'deletes stored records', hold: true, added: /\.deleteById\s*\(|(?:[Rr]epository|[Ss]torage|[Rr]ecords?|[Ww]allet|[Aa]skar|[Ss]tore)\w*\.(?:delete|remove)\s*\(|\b(?:deleteRecord|removeWhere|forget[A-Z]\w*|clear[A-Z]\w*Store|wipe\w*)\s*\(/ },
  { flag: 'sign-in / key handling', hold: true, path: /(oobSignIn|uvKey|SignIn\.tsx|hardware-signing\/|\/keys?\.ts$|KeyRotation|vtaKeyMigration|VtaClient\.ts$|keychain)/i },
  { flag: 'VTI protocol line', hold: true, path: /^bifold\/packages\/(core\/src\/modules\/trust-tasks\/module\/(vti|join|tsp|vtc|trigger)|trust-tasks\/src\/)/ },
];

/** Which flags a change raises: [{ flag, hold, files }], from paths and, when given, each file's added lines. */
export function flagsOf(files, added = {}, flags = FLAGS) {
  const out = [];
  for (const { flag, hold = false, path: p, added: a } of flags) {
    const hit = files.filter((f) => !/^(e2e|docs)\/|__tests__|\.test\./.test(f) && ((p && p.test(f)) || (a && (added[f] || []).some((l) => a.test(l)))));
    if (hit.length) out.push({ flag, hold, files: hit });
  }
  return out;
}

/** The tier after the held flags: an "ota" change that raises one becomes "store", naming the flags under "held". */
export function applyHolds({ tier, ...rest }, flags) {
  const held = flags.filter((f) => f.hold).map((f) => f.flag);
  return tier === 'ota' && held.length ? { ...rest, tier: 'store', held } : { ...rest, tier, held: [] };
}

/**
 * The whole verdict. Without the added lines (--files), a held flag that reads them was never checked, so an "ota"
 * change is "unchecked" instead, listing those flags: the tool never says OTA without having looked.
 */
export function verdict(files, { added, flags: set = FLAGS } = {}) {
  const flags = flagsOf(files, added || {}, set);
  const r = { ...applyHolds(classify(files), flags), flags, unchecked: [] };
  if (!added && r.tier === 'ota') {
    const unchecked = set.filter((f) => f.hold && f.added).map((f) => f.flag);
    if (unchecked.length) Object.assign(r, { tier: 'unchecked', unchecked });
  }
  return r;
}

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

/** a..b only: the base is the last store build, the tip the change; other range syntax drops the bifold pin. */
export function parseRange(range) {
  // Refs may hold dots (staging-v0.2.0-238); the form may not be "a...b" or a single rev.
  const parts = String(range).includes('...') ? [] : String(range).split('..');
  if (parts.length !== 2 || !parts[0] || !parts[1] || /\s/.test(range)) throw new Error(`range must be <base>..<tip> (the last store build..the change), not "${range}"`);
  return parts;
}

const bifoldDirOf = (repo) => process.env.BIFOLD_GIT || path.join(repo, 'bifold');
const pinAt = (repo, rev) => { try { return execFileSync('git', ['-C', repo, 'rev-parse', `${rev}:bifold`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

/** The paths a range changes (renames as delete + add), with the bifold submodule's own paths when its pin moved. */
export function changedFiles(range, { repo = repoRoot, bifold = bifoldDirOf(repo) } = {}) {
  const [a, b] = parseRange(range);
  const files = execFileSync('git', ['-C', repo, 'diff', '--no-renames', '--name-only', `${a}..${b}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  if (!files.includes('bifold')) return files;
  const pa = pinAt(repo, a), pb = pinAt(repo, b);
  const out = files.filter((f) => f !== 'bifold');
  try {
    if (!pa || !pb) throw new Error('pin unreadable');
    const inner = execFileSync('git', ['-C', bifold, 'diff', '--no-renames', '--name-only', `${pa}..${pb}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').filter(Boolean);
    out.push(...inner.map((f) => `bifold/${f}`));
  } catch {
    out.push(`bifold@${(pa || '?').slice(0, 8)}..${(pb || '?').slice(0, 8)} (range unreadable here; set BIFOLD_GIT)`);
  }
  return out;
}

/** The lines a range adds, per file (wallet and, when the pin moved, bifold), for the content flags. */
export function addedLines(range, { repo = repoRoot, bifold = bifoldDirOf(repo) } = {}) {
  const [a, b] = parseRange(range);
  const out = {};
  const read = (dir, r, prefix) => {
    let diff = '';
    try { diff = execFileSync('git', ['-C', dir, 'diff', '--no-renames', '-U0', r], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return; }
    let file = null;
    for (const l of diff.split('\n')) {
      if (l.startsWith('+++ b/')) file = prefix + l.slice(6);
      else if (file && l.startsWith('+') && !l.startsWith('+++')) (out[file] ||= []).push(l.slice(1));
    }
  };
  read(repo, `${a}..${b}`, '');
  const pa = pinAt(repo, a), pb = pinAt(repo, b);
  if (pa && pb && pa !== pb) read(bifold, `${pa}..${pb}`, 'bifold/');
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  if (!arg('--files') && !arg('--range')) { console.error('usage: tier.mjs --files a,b,… | --range <last store build>..<tip> [--json]'); process.exit(64); }
  try {
    const files = arg('--files') ? arg('--files').split(',').map((s) => s.trim()).filter(Boolean) : changedFiles(arg('--range'));
    const r = verdict(files, { added: arg('--range') ? addedLines(arg('--range')) : undefined });
    if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
    else {
      for (const [f, why] of Object.entries(r.reasons)) if (!why.startsWith('none')) console.log(`${why.split(':')[0].padEnd(5)} ${f} (${why.split(': ')[1]})`);
      for (const f of r.flags) console.log(`${f.hold ? 'hold ' : 'flag '} ${f.flag}: ${f.files.slice(0, 4).join(', ')}${f.files.length > 4 ? ', …' : ''}`);
      const why = r.held.length ? ` (held back from OTA: ${r.held.join('; ')})` : r.unchecked.length ? ` (ota by its paths; not checked without --range: ${r.unchecked.join('; ')})` : '';
      console.log(`tier=${r.tier}${why}`);
    }
    // exitCode, not exit(): a large --json written to a pipe must finish before the process ends.
    process.exitCode = { ota: 0, none: 1, store: 2, unchecked: 4 }[r.tier];
  } catch (e) {
    // Never "none" by accident: an error routes the change to a store build, with its own exit code.
    if (process.argv.includes('--json')) console.log(JSON.stringify({ tier: 'store', error: e.message, reasons: {}, flags: [], held: [], unchecked: [] }));
    else console.log(`tier=store (error: ${e.message.split('\n')[0]})`);
    process.exitCode = 3;
  }
}
