#!/usr/bin/env node
// Can a change reach testers as an over-the-air bundle, or does it need a store build? The rules are the OTA
// report's (10-08, "What OTA can carry"), applied to the paths a change touches:
//   ota    screens, flows, copy, theme, JS localisation, in app/src and the framework packages' src (one JS bundle)
//   store  the native projects (ios/, android/, Xcode and Gradle files, Info.plist, manifests, entitlements), native
//          modules, build-time config (react-native-config, app.json), dependency manifests and patches (until a
//          native fingerprint check can clear them), and, by policy, stored-data migrations: a bundle that migrates
//          records and is then withdrawn would land older code on a migrated store
//   none   nothing the app ships (docs, tests, e2e, CI, tooling)
// The tier of a change is its highest: one store file makes the whole change "store".
//
//   tier.mjs --files a,b,…           paths from the wallet root (packages/…, app/…)
//   tier.mjs --range <a>..<b>        the wallet range; the framework's paths are packages/… in it since the move
//                                    (Phase 2 of docs/plans/single-codebase-plan.md). A range with an end from before
//                                    the move (bifold/ a tree, or the submodule's gitlink) grades store: see changedFiles
//   [--json]                         prints {tier, reasons: {file: rule}, flags: [{flag, policy, files}], held,
//                                    strict, unchecked}
// Exit: 0 ota, 1 none, 2 store (native, or a held flag), 3 an error (reported as store, never none), 4 unchecked (ota by
// its paths, but --files cannot read the added lines a held flag looks at: run it with --range), 5 ota-strict (OTA,
// labelled: the change touches sign-in or keys, or the VTI protocol line, listed under "strict"; since 10-29 it publishes
// like 0, and the label is for reviewers and the release's summary). 0 and 5 permit an OTA publish; 1-4 mean do not
// publish OTA. "tier" is the verdict; "reasons" is the per-file input (a
// file there can say ota while the tier is store, unchecked or ota-strict), so never recompute the tier from reasons.
// "held" and "strict" name the flags that moved an ota change; when the tier is store for its own reasons (native files)
// they are empty even if flags were raised: read "flags" for every flag a change raises.
// While a held flag reads added lines (deletes stored records does), --files can never say ota: a change that is ota
// by its paths always comes out unchecked there. A publish step must use --range.
// The range's base must be the LAST STORE BUILD: a JS change that calls a native method added since then reads ota
// here, and only a native fingerprint at publish time can catch it.
// Flags (FLAGS) name classes of change that need more than a plain OTA publish (the owner's policy, revised 10-11):
// A flag reads only files the app ships: a file whose path rule says "none" (deploy/, e2e/, scripts/, docs, tests,
// server-side packages) raises nothing, whatever its lines say.
// policy "store" moves an "ota" change to "store" (listed under "held"); policy "strict" moves it to "ota-strict"
// (listed under "strict"); policy "advisory" (or none) is shown only. Store wins over strict.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Stored-data migration code (the OTA report's "no, by policy" row). Extend when a migration moves or is added. */
export const MIGRATION_PATHS = [
  'app/src/hooks/useBCAgentSetup.ts',
  'packages/core/src/hooks/useBifoldAgentSetup.ts',
  'packages/core/src/utils/migration.ts',
  'packages/core/src/modules/trust-tasks/module/vtaKeyMigration.ts',
  'packages/core/src/modules/vrc/services/rCardCredential.ts',
  'packages/core/src/contexts/reducers/store.ts',
];

// First match wins: what the app never ships, then store, then the rest of none, then ota.
export const RULES = [
  // Shaped the install, so store, though they sat in a tooling folder. Gone with the move (one yarn install at the root
  // needs neither); the rule stays so a range that removes them still reads store, which that range is.
  ['store', 'install script (shapes node_modules)', /^scripts\/(ensure-bifold-ready|fix-portal-symlinks)\.js$/],
  // Folders the app never ships. eslint-rules/ holds the framework's own lint rules (at the root since the move).
  ['none', 'e2e, CI and tooling', /^(e2e|\.github|scripts|tsp-reference|deploy|\.claude|\.husky|\.yarn\/releases|\.demo-local|docs|eslint-rules)\//],
  // The app's own tooling: the OTA publisher, the ledger refresh. Nothing the bundle imports. A hot fix branch carries
  // the publisher it is published with, so a change here must never make the fix itself read store. Its script files
  // only: a manifest there (package.json) still reads store, by the rule below.
  ['none', "the app's tooling (app/scripts: the OTA publisher, the ledger refresh)", /^app\/scripts\/[^/]+\.(mjs|cjs|js)$/],
  ['none', 'server-side package (not in the app)', /^packages\/(witness-server|mediator-server|vrc-reference|vrc-shared)\//],
  // The framework's old place. Since the move (Phase 2 of the single-codebase plan) nothing lives under bifold/, so a
  // path there is from before it, and a range reaching back that far cannot be graded file by file (the whole tree
  // moved): store, named, never ota. The marker changedFiles adds for such a range is graded by its own rule below.
  ['store', 'a bifold/… path (the framework lives at packages/ since the move; a range from before it cannot be graded)', /^bifold(\/|$)/],
  // Store: compiled into the binary.
  ['store', 'native project (iOS/Android folder)', /^(app|packages\/[^/]+)\/(ios|android)\//],
  ['store', 'native build file', /(^|\/)(Podfile(\.lock)?|[^/]+\.podspec|[^/]+\.gradle(\.kts)?|gradle\.properties|Info\.plist|AndroidManifest\.xml|[^/]+\.entitlements|CMakeLists\.txt)$/],
  ['store', 'Xcode project', /\.(xcodeproj|xcworkspace)\//],
  // Codegen TurboModule specs live in their src (codegenConfig jsSrcsDir "src"): the whole package is native. The
  // shape here is test-builds.yml's `packages/react-native-*/**` trigger, on purpose: a named allowlist let a
  // third react-native-* package's specs fall through to the JS-bundle rule below and grade ota (review of the fold,
  // 2026-11-21). WARNING: a native package named otherwise still needs both places, and only the workflow fails safe;
  // tier.test.mjs reads the workflow's glob and fails when the two diverge.
  ['store', 'native module package (codegen specs included)', /^packages\/react-native-[^/]+\/(?!__tests__\/|README)/],
  ['store', 'font (linked into the binary: react-native.config assets)', /\.(ttf|otf|woff2?)$/i],
  ['store', 'build-time config (react-native-config, app config, babel/metro)', /^app\/(\.env(?!\.sample$)(\.[^/]*)?|app\.json|app\.config\.[cm]?[jt]s|(react-native|babel|metro)\.config\.[cm]?[jt]s)$/],
  ['store', 'install config at the root', /^(\.yarnrc\.yml|\.env(\.[^/]*)?|\.npmrc)$/],
  // What the app never ships, by file type.
  ['none', 'docs', /\.(md|txt)$/],
  ['none', 'tests', /(^|\/)(__tests__|__mocks__)\/|\.(test|spec)\.[jt]sx?$/],
  // At the wallet root and at packages/ (the framework's own .prettierignore, which keeps vendored bundles byte-identical,
  // and its .gitignore and .prettierrc apply to that subtree since the move). The root eslint.config.mjs is the
  // framework's lint config, moved to where ESLint reads it: lint never ships.
  ['none', 'repository dotfile', /^(packages\/)?\.(gitignore|gitattributes|editorconfig|nvmrc|prettierrc[^/]*|prettierignore|eslintrc[^/]*|eslintignore|commitlintrc[^/]*|lintstagedrc[^/]*)$|^eslint\.config\.[cm]?js$/],
  ['none', 'the .env template (builds read their own .env)', /^app\/\.env\.sample$/],
  // jestSetup*.js: jest's setupFiles / setupFilesAfterEnv (named by jest.config); only tests and that config reference
  // them, nothing in src imports them, so they never reach the bundle.
  // packages/tsconfig-base.json is the framework's shared type-check base, at the root of its subtree since the move.
  ['none', "a package's test or type-check config", /^packages\/([^/]+\/)?(jest\.config\.[jt]s|jestSetup[^/]*\.[jt]s|tsconfig[^/]*\.json|\.eslintrc[^/]*|\.prettierrc[^/]*)$/],
  // A package's dev-time generators (core: gen-testids, the emoji data). Their OUTPUT lands in src and grades there;
  // nothing the app ships imports scripts/. The two native packages match the native rule above first.
  ['none', "a package's dev-time scripts (generators and their tests; nothing shipped imports them)", /^packages\/[^/]+\/scripts\//],
  // The e2e test-id manifest, the same artefact the wallet's own e2e/lib/testids.json is, generated from core's
  // src. Nothing the app ships reads it: testIdWithKey is `testIdPrefix + key`, no src imports the file, and its only
  // consumers are gen-testids.mjs, e2e/ and CI. check-testids.mjs still holds the two copies together, both ways,
  // whatever the tier says.
  ['none', "core's e2e test-id manifest (generated from src; nothing the app ships reads it)", /^packages\/core\/testids\.json$/],
  // Store: dependencies, policy.
  ['store', 'dependency manifest or patch (needs a native fingerprint check)', /(^|\/)(package\.json|yarn\.lock|Podfile\.lock)$|^\.yarn\/patches\/|^app\/patches\//],
  ['store', 'stored-data migration (policy: never OTA)', (f) => MIGRATION_PATHS.includes(f)],
  // changedFiles' marker for a range with an end from before the move (or, older still, before the fold): what moved
  // cannot be told file by file, so the change is store, never silently ota or none.
  ['store', 'the range reaches back before the move of the framework into packages/ (what moved cannot be told)', /^bifold@/],
  // OTA: the one JS bundle. At the app's root only the bundle's own entry files (an allowlist).
  ['ota', 'app JavaScript bundle (screens, flows, copy, theme, localisation)', /^(app\/src|packages\/[^/]+\/src)\/|^app\/(App\.tsx|index\.js|container-imp\.ts|container-compose\.ts)$/],
];

/**
 * Flags: classes of change that could travel OTA (the OTA lane's question 1 on board #29). The owner's policy (10-11,
 * revised the same day to let features travel OTA): deleting stored records stays store only, since a rollback cannot
 * undo data already changed; sign-in / key handling and the VTI protocol line travel OTA, labelled as strict (since 10-29 a label, not a gate).
 * shown to the approver beside an "ota" tier. A flag matches a path, or (with --range, which reads the diff) a line
 * the change adds.
 */
export const FLAGS = [
  // Storage deletes only: a Map's or Set's .delete() is not one. deleteById on any receiver (Credo's APIs), .delete or
  // .remove on a receiver named for storage, the record-removing helpers, and the four device-store deletes whose method
  // names the receiver rule can't see (AsyncStorage.removeItem / .multiRemove / .clear, SecureStore.deleteItemAsync;
  // a stopgap, 10-30: names, not behaviour).
  // `deleteKeyed` is in the helper list because the receiver rule cannot see it (11-27): it is a bare call, and the
  // only file it matched was keyedRecords.ts, which DEFINES it and happens to contain `agent.genericRecords.delete(` —
  // so every call site added through the framework's own keyed-record delete read publishable. A helper that removes
  // stored records belongs here by name, beside deleteRecord.
  { flag: 'deletes stored records', policy: 'store', added: /\bAsyncStorage\.(?:removeItem|multiRemove|clear)\s*\(|\bSecureStore\.deleteItemAsync\s*\(|\.deleteById\s*\(|(?:[Rr]epository|[Ss]torage|[Rr]ecords?|[Ww]allet|[Aa]skar|[Ss]tore)\w*\.(?:delete|remove)\s*\(|\b(?:deleteRecord|deleteKeyed|removeWhere|forget[A-Z]\w*|clear[A-Z]\w*Store|wipe\w*)\s*\(/ },
  { flag: 'sign-in / key handling', policy: 'strict', path: /(oobSignIn|uvKey|SignIn\.tsx|hardware-signing\/|\/keys?\.ts$|KeyRotation|vtaKeyMigration|VtaClient\.ts$|keychain)/i },
  // Case-insensitive: the protocol line's files are named both ways (vtiAgent.ts, VtiMediatorTransport.ts, TspCarriage.ts),
  // and without /i the capitalised ones read plain ota (found 10-29).
  { flag: 'VTI protocol line', policy: 'strict', path: /^packages\/(core\/src\/modules\/trust-tasks\/module\/(vti|join|tsp|vtc|trigger)|trust-tasks\/src\/)/i },
];

const POLICIES = ['store', 'strict', 'advisory'];

/**
 * A content flag reads names, not behaviour, so it can fire on a line that is not what it means: an in-memory Map whose
 * name starts with "record" (`this.recordMembers.delete(k)`, bifold #933) reads as a stored-record delete. Such a line
 * may carry `// tier-exempt(<flag>): <reason>`, naming the exact flag and at least ten characters of reason, written in
 * the PR where a reviewer reads it. It exempts only that line, only from that flag, and only from content flags: a path
 * flag cannot be exempted. Every exemption is printed with the verdict ("exempt"), and ota-publish.yml's tier job
 * raises each one as a warning in the run summary BEFORE the approval gate, so the approver sees it.
 * Keep the flag match EXACT (=== on the trimmed name): a prefix, case-insensitive or punctuation-tolerant match would
 * make an exemption guessable. An exemption travels with its line's text, so a later edit to that line keeps it: the
 * pre-approval warning is what makes that visible at publish time.
 */
const EXEMPT = /\/\/\s*tier-exempt\(([^)]+)\):\s*(\S.{9,})$/;
export const exemptionOf = (line, flag) => {
  const m = EXEMPT.exec(line);
  return m && m[1].trim() === flag ? m[2].trim() : null;
};

/** Which flags a change raises: [{ flag, policy, files }], from paths and, when given, each file's added lines. An
 * unknown policy throws (the error path: store, exit 3), so a typo can never let a change through as plain ota. */
export function flagsOf(files, added = {}, flags = FLAGS) {
  const out = [];
  for (const { flag, policy = 'advisory', path: p, added: a } of flags) {
    if (!POLICIES.includes(policy)) throw new Error(`flag "${flag}": policy must be ${POLICIES.join(', ')}, not "${policy}"`);
    const hit = files.filter((f) => ships(f) && ((p && p.test(f)) || (a && (added[f] || []).some((l) => a.test(l) && !exemptionOf(l, flag)))));
    if (hit.length) out.push({ flag, policy, files: hit });
  }
  return out;
}

/** The lines a content flag would have read but an exemption kept out: [{ flag, file, line, reason }]. */
export function exemptionsOf(files, added = {}, flags = FLAGS) {
  const out = [];
  for (const { flag, added: a } of flags) {
    if (!a) continue;
    for (const f of files.filter(ships)) for (const l of added[f] || []) {
      const reason = a.test(l) ? exemptionOf(l, flag) : null;
      if (reason) out.push({ flag, file: f, line: l.trim(), reason });
    }
  }
  return out;
}

/**
 * The tier after the flags: an "ota" change that raises a store-policy flag becomes "store" (named under "held"); one
 * that raises only strict-policy flags becomes "ota-strict" (named under "strict").
 */
export function applyHolds({ tier, ...rest }, flags) {
  const held = flags.filter((f) => f.policy === 'store').map((f) => f.flag);
  const strict = flags.filter((f) => f.policy === 'strict').map((f) => f.flag);
  if (tier !== 'ota') return { ...rest, tier, held: [], strict: [] };
  if (held.length) return { ...rest, tier: 'store', held, strict };
  return { ...rest, tier: strict.length ? 'ota-strict' : 'ota', held: [], strict };
}

/**
 * The whole verdict. Without the added lines (--files), a held flag that reads them was never checked, so an "ota"
 * change is "unchecked" instead, listing those flags: the tool never says OTA without having looked.
 */
export function verdict(files, { added, flags: set = FLAGS } = {}) {
  const flags = flagsOf(files, added || {}, set);
  const r = { ...applyHolds(classify(files), flags), flags, exempted: exemptionsOf(files, added || {}, set), unchecked: [] };
  if (!added && (r.tier === 'ota' || r.tier === 'ota-strict')) {
    const unchecked = set.filter((f) => f.policy === 'store' && f.added).map((f) => f.flag);
    if (unchecked.length) Object.assign(r, { tier: 'unchecked', unchecked });
  }
  return r;
}

const RANK = { none: 0, ota: 1, store: 2 };

/** The first rule a path matches, as [tier, why]. An unknown path counts as store: never OTA by default. */
export function ruleOf(f) {
  const hit = RULES.find(([, , m]) => (typeof m === 'function' ? m(f) : m.test(f)));
  return hit ? [hit[0], hit[1]] : ['store', 'unknown path (not OTA by default)'];
}

/** Whether a path is in what the app ships: anything its rule does not call "none" (an unknown path counts). The
 * older test-file exclusion stays, so a test the rules miss (a .test.mjs under src) still raises no flag. */
export const ships = (f) => ruleOf(f)[0] !== 'none' && !/^(e2e|docs)\/|__tests__|\.test\./.test(f);

/** The tier of each file, and of the whole change. An unknown path counts as store: never OTA by default. */
export function classify(files) {
  const reasons = {};
  let tier = 'none';
  for (const f of files) {
    const [t, why] = ruleOf(f);
    reasons[f] = `${t}: ${why}`;
    if (RANK[t] > RANK[tier]) tier = t;
  }
  return { tier, reasons };
}

/** a..b only: the base is the last store build, the tip the change; other range syntax has no readable base. */
export function parseRange(range) {
  // Refs may hold dots (staging-v0.2.0-238); the form may not be "a...b" or a single rev.
  const parts = String(range).includes('...') ? [] : String(range).split('..');
  if (parts.length !== 2 || !parts[0] || !parts[1] || /\s/.test(range)) throw new Error(`range must be <base>..<tip> (the last store build..the change), not "${range}"`);
  return parts;
}

/** The kind of the tree entry `<rev>:<name>` ('tree', 'commit' for a submodule's gitlink, 'blob'), or '' when absent.
 * ls-tree, not cat-file: a gitlink's commit is an object of the submodule's repository, not of this one. */
const kindAt = (repo, rev, name) => {
  try { return execFileSync('git', ['-C', repo, 'ls-tree', rev, '--', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\s+/)[1] || ''; } catch { return ''; }
};

/** Where the framework is at a revision: 'packages' (a tree at packages/, since the move), 'bifold tree' (folded in at
 * bifold/, between the fold and the move), 'bifold submodule' (the gitlink, before the fold), or 'absent'. */
export const layoutAt = (repo, rev) => {
  const bifold = kindAt(repo, rev, 'bifold');
  if (bifold === 'commit') return 'bifold submodule';
  if (bifold === 'tree') return 'bifold tree';
  return kindAt(repo, rev, 'packages') === 'tree' ? 'packages' : 'absent';
};

/** The paths a range changes (renames as delete + add). Since the move the framework's paths are packages/… in the wallet
 * diff, like any other. A range with an end from before the move (bifold/ a tree, or the submodule's gitlink) cannot be
 * graded file by file: the whole framework moved inside it, so the diff names every file twice and says nothing about
 * what changed. Such a range carries a marker instead of its bifold paths, which grades store (never silently ota or
 * none): the move is a store-build boundary by design, as the fold was. */
export function changedFiles(range, { repo = repoRoot } = {}) {
  const [a, b] = parseRange(range);
  const files = execFileSync('git', ['-C', repo, 'diff', '--no-renames', '--name-only', `${a}..${b}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const la = layoutAt(repo, a), lb = layoutAt(repo, b);
  // Both ends at packages/, or a repository with no framework at either end (nothing there to have moved).
  if (la === lb && (la === 'packages' || la === 'absent')) return files;
  // The framework's paths are dropped from the list (every one is in it twice, as a delete and an add, saying nothing);
  // the marker stands for all of them.
  return [...files.filter((f) => !/^(bifold|packages)(\/|$)/.test(f)), `bifold@${a.slice(0, 8)}..${b.slice(0, 8)} (the range reaches back before the move of the framework into packages/: bifold is ${la === 'absent' ? 'absent' : la.replace('bifold ', 'a ')} at the base, ${lb === 'absent' ? 'absent' : lb.replace('bifold ', 'a ')} at the tip; what moved cannot be told)`];
}

/** The lines a range adds, per file, for the content flags. One diff: since the move the framework's lines are in the
 * wallet diff like any other (a range from before it grades store on its paths alone, whatever its lines say). */
export function addedLines(range, { repo = repoRoot } = {}) {
  const [a, b] = parseRange(range);
  const out = {};
  let diff = '';
  try { diff = execFileSync('git', ['-C', repo, 'diff', '--no-renames', '-U0', `${a}..${b}`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return out; }
  let file = null;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ b/')) file = l.slice(6);
    else if (file && l.startsWith('+') && !l.startsWith('+++')) (out[file] ||= []).push(l.slice(1));
  }
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
      for (const e of r.exempted) console.log(`exempt ${e.flag}: ${e.file} (${e.reason})`);
      for (const f of r.flags) console.log(`${{ store: 'hold  ', strict: 'strict' }[f.policy] || 'flag  '} ${f.flag}: ${f.files.slice(0, 4).join(', ')}${f.files.length > 4 ? ', …' : ''}`);
      const why = r.held.length ? ` (held back from OTA: ${r.held.join('; ')})`
        : r.unchecked.length ? ` (ota by its paths; not checked without --range: ${r.unchecked.join('; ')})`
        : r.strict.length ? ` (OTA, labelled: touches ${r.strict.join('; ')})` : '';
      console.log(`tier=${r.tier}${why}`);
    }
    // exitCode, not exit(): a large --json written to a pipe must finish before the process ends.
    process.exitCode = { ota: 0, none: 1, store: 2, unchecked: 4, 'ota-strict': 5 }[r.tier];
  } catch (e) {
    // Never "none" by accident: an error routes the change to a store build, with its own exit code.
    if (process.argv.includes('--json')) console.log(JSON.stringify({ tier: 'store', error: e.message, reasons: {}, flags: [], exempted: [], held: [], strict: [], unchecked: [] }));
    else console.log(`tier=store (error: ${e.message.split('\n')[0]})`);
    process.exitCode = 3;
  }
}
