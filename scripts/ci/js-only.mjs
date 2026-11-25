#!/usr/bin/env node
/**
 * Can a change ship as a new JS bundle inside an existing native build, or does
 * it need a full native build? Two independent guards, both from git objects
 * (nothing is checked out or built); a change is JS-only only when BOTH say so.
 *
 *   1. The change, file by file: the wallet diff, whose packages/… paths (the
 *      framework, at packages/ since its move in Phase 2 of
 *      docs/plans/single-codebase-plan.md) are judged by the framework rules.
 *      An allowlist: a file is JS (goes into the bundle), none (not in the
 *      app: tests, docs, e2e, server-only packages), or native. Anything the
 *      list does not know is native. Any native file → full build. A range
 *      with an end from before the move (bifold/ a tree, or the submodule's
 *      gitlink) names every framework file twice and says nothing about what
 *      changed: it is a full build, for one reason, before anything of the
 *      framework's is read.
 *   2. A fingerprint of every native input, taken at both commits: app/ios and
 *      app/android (Podfile.lock, Info.plist, entitlements, manifest, gradle,
 *      icons), package.json files and yarn.lock, dependency patches, the
 *      react-native config, the framework packages with native code, and
 *      every image/font Metro bundles (Android compiles those into res/, so
 *      they are native there). Plus the .env the base build was made with: react-native-config
 *      bakes it into native code (BuildConfig, GeneratedDotEnv), so a .env
 *      change is never JS-only. With no .env evidence for either side, the
 *      verdict is full.
 *
 * Any error, missing object or doubt → full. The verdict says why.
 *
 * Usage:
 *   node scripts/ci/js-only.mjs --base <wallet-sha> --head <wallet-sha> \
 *     [--env-base <sha256> --env-head <sha256>]     (hash of the .env each build used)
 *   (--bifold-base/--bifold-head named the submodule's pins before the fold; given now, they are refused, since there
 *   is no pin to name.)
 *     [--json]
 * Exit: 0 js-only, 10 no app change, 20 full build.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const VERDICT = { JS_ONLY: "js-only", NO_APP_CHANGE: "no-app-change", FULL: "full" };
const EXIT = { "js-only": 0, "no-app-change": 10, full: 20 };

/** Extensions Metro treats as assets: bundled as files, compiled into res/ on Android. */
const ASSET_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ttf|otf|woff2?|mp3|mp4|wav|lottie|pdf)$/i;
/** Source that ends up in the JS bundle. */
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/i;
const TEST = /(^|\/)(__tests__|__mocks__|__fixtures__|test|tests|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|\.snap$/;
const DOC = /\.(md|mdx|txt|html|pdf)$|(^|\/)docs?\//i;

/**
 * Scripts that never touch a build: developer and lab tooling, and the CI
 * checks themselves (scripts/ci). Every other
 * script under scripts/ counts as native, and so does any new one: the
 * build-number bump, TestFlight and the signing helpers all change what gets
 * built (the install hooks ensure-bifold-ready and fix-portal-symlinks did too,
 * until the move made one root install enough; a range removing them changes
 * the fingerprint, which is right).
 */
const DEV_SCRIPTS = /^scripts\/(openvtc\/|ci\/|demo\.js$|local-mediator\.js$|mediator-lifecycle\.js$|quickstart\.sh$|check-commit-signing\.sh$)/
/** The scripts that are build inputs, for the fingerprint. */
const BUILD_SCRIPTS = [
  "scripts/ensure-bifold-ready.js",
  "scripts/fix-portal-symlinks.js",
  "scripts/verify-bifold-linking.js",
  "scripts/bump_ios_build.sh",
  "scripts/testflight",
  "scripts/makekc.sh",
  "scripts/makepp.sh",
  "scripts/gpublish",
];

/** Framework packages the app does not bundle (servers, reference suites, tooling). */
export const SERVER_ONLY = new Set(["mediator-server", "witness-server", "vrc-reference", "vrc-shared"]);
/** Files in a package directory that make it native, or change how it is linked. */
const NATIVE_MARKERS = /^(android|ios|.*\.podspec|react-native\.config\.js|expo-module\.config\.json|app\.plugin\.js)$/;

/** The one reason a range with an end from before the move gets: nothing of the framework's can be read across it. */
export const MOVE = "the move: the framework left bifold/ for packages/";

/**
 * One wallet path: 'js' (in the bundle), 'none' (not in the app), or 'native'.
 * Anything not recognised is native. A packages/… path (the framework) is the
 * framework rules' to judge; `natives` is theirs (classifyBifoldPath). The
 * framework's old place, bifold/ (a tree or the submodule's gitlink), is only
 * in a diff that reaches back before the move: native, for that reason.
 */
export function classifyWalletPath(p, natives = new Set()) {
  if (p === "bifold" || p.startsWith("bifold/")) return { cls: "native", why: MOVE };
  if (p.startsWith("packages/")) return classifyBifoldPath(p, natives);
  if (p.startsWith("app/ios/") || p.startsWith("app/android/")) return { cls: "native", why: "native project" };
  // Before the dependency and .env rules: e2e is a standalone package outside
  // the workspaces, so its package.json and lockfile never reach a build.
  if (p.startsWith("e2e/") || p.startsWith("docs/") || p.startsWith(".github/") || p.startsWith(".husky/") || p.startsWith("tsp-reference/")) return { cls: "none", why: "not in the app" };
  if (/(^|\/)\.env(\..*)?$/.test(p) && !p.endsWith(".sample")) return { cls: "native", why: "react-native-config bakes .env into native code" };
  if (/(^|\/)package\.json$|^yarn\.lock$|^\.yarnrc\.yml$|^\.yarn\//.test(p)) return { cls: "native", why: "dependencies (may add or change native code)" };
  if (p.startsWith("app/patches/")) return { cls: "native", why: "dependency patch" };
  if (/^app\/(react-native\.config\.js|app\.json)$/.test(p)) return { cls: "native", why: "native linking / app registration" };
  if (DEV_SCRIPTS.test(p)) return { cls: "none", why: "developer tooling, not a build input" };
  if (p.startsWith("scripts/")) return { cls: "native", why: "install/build scripts" };
  if (ASSET_EXT.test(p) && p.startsWith("app/")) return { cls: "native", why: "bundled asset: compiled into Android res/" };
  if (TEST.test(p) || (DOC.test(p) && !p.startsWith("app/src/"))) return { cls: "none", why: "test or document" };
  if (/^app\/(metro|babel)\.config\.js$|^app\/index\.js$/.test(p)) return { cls: "js", why: "bundle configuration / entry" };
  if (p.startsWith("app/src/") && CODE_EXT.test(p)) return { cls: "js", why: "app source" };
  // The framework's lint config and rules sit at the root since the move; lint never reaches a build.
  if (/^(\.eslintrc.*|\.prettier.*|eslint\.config\.[cm]?js|eslint-rules\/.*|app\/\.eslintrc.*|app\/tsconfig.*\.json|app\/jest\.config\.js|commitlint\.config\.js|\.gitignore|\.gitattributes|\.nvmrc|README.*|LICENSE.*)$/.test(p)) return { cls: "none", why: "tooling, not in the bundle" };
  return { cls: "native", why: "not recognised as JS-only" };
}

/**
 * One framework path, packages/… from the wallet root (the same path it had
 * relative to the bifold repository, before the fold and the move).
 * `nativePackages` are the package names with native markers at either commit.
 */
export function classifyBifoldPath(p, nativePackages) {
  // The framework's shared mocks (jest only) and the dotfiles and tsconfig base that apply to the packages/ subtree.
  if (p.startsWith("packages/__mocks__/")) return { cls: "none", why: "test or document" };
  if (/^packages\/(\.prettierrc[^/]*|\.prettierignore|\.gitignore|tsconfig[^/]*\.json)$/.test(p)) return { cls: "none", why: "package tooling" };
  const m = p.match(/^packages\/([^/]+)\/(.*)$/);
  if (!m) {
    if (DOC.test(p) || TEST.test(p)) return { cls: "none", why: "not in the app" };
    return { cls: "native", why: "framework file not recognised as JS-only" };
  }
  const [, pkg, rest] = m;
  if (SERVER_ONLY.has(pkg)) return { cls: "none", why: `${pkg} is not bundled into the app` };
  if (rest === "package.json") return { cls: "native", why: `${pkg} dependencies / entry points` };
  if (NATIVE_MARKERS.test(rest.split("/")[0])) return { cls: "native", why: `${pkg} native code or linking` };
  if (TEST.test(rest) || DOC.test(rest)) return { cls: "none", why: "test or document" };
  if (ASSET_EXT.test(rest)) return { cls: "native", why: "bundled asset: compiled into Android res/" };
  if (/^(src|lib)\//.test(rest) && CODE_EXT.test(rest)) {
    return { cls: "js", why: nativePackages.has(pkg) ? `${pkg} JS side (native side unchanged)` : `${pkg} source` };
  }
  if (/^(tsconfig.*\.json|\.eslintrc.*|jest\.config\.[cm]?js|babel\.config\.js|\.npmignore)$/.test(rest)) return { cls: "none", why: "package tooling" };
  return { cls: "native", why: `${pkg} file not recognised as JS-only` };
}

// ---------------------------------------------------------------- git

const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();
// --verify --quiet: a path absent at the commit is the expected answer here, not a thing to report on stderr.
const objectAt = (repo, commit, path) => {
  try {
    return git(repo, "rev-parse", "--verify", "--quiet", `${commit}:${path}`) || "absent";
  } catch {
    return "absent";
  }
};

/** Changed paths between two commits, both sides of a rename. */
export function changedPaths(repo, a, b) {
  const out = git(repo, "diff", "--name-status", "--no-renames", a, b);
  return out ? out.split("\n").map((l) => l.split("\t").slice(1)).flat() : [];
}

/**
 * Where the framework is at a wallet commit: 'packages' (a tree at packages/, since the move), 'bifold tree' (folded
 * in at bifold/, between the fold and the move), 'bifold submodule' (the gitlink, before the fold) or 'absent'. From
 * the tree entry's type (ls-tree), not `cat-file -t`: a gitlink's commit lives in the submodule's repository, so that
 * read fails whenever it was not fetched here, which is the usual case.
 */
export function layoutAt(repo, commit) {
  const kind = (name) => {
    try {
      return git(repo, "ls-tree", commit, "--", name).split(/\s+/)[1] || "absent";
    } catch {
      return "absent";
    }
  };
  const bifold = kind("bifold");
  if (bifold === "commit") return "bifold submodule";
  if (bifold === "tree") return "bifold tree";
  return kind("packages") === "tree" ? "packages" : "absent";
}

/** The framework's identity at a commit, as the build manifest's `bifold` field means it: the tree id of packages/. */
export function frameworkTree(repo, commit) {
  const id = objectAt(repo, commit, "packages");
  return id === "absent" ? null : id;
}

/** Package directories of the framework at a commit, with whether each carries native markers. */
export function frameworkPackages(repo, commit) {
  const dirs = git(repo, "ls-tree", "-d", "--name-only", commit, "packages/").split("\n").filter(Boolean);
  return dirs.map((dir) => {
    const names = git(repo, "ls-tree", "--name-only", commit, `${dir}/`).split("\n").map((n) => n.split("/").pop());
    return { name: dir.slice("packages/".length), markers: names.filter((n) => NATIVE_MARKERS.test(n)) };
  });
}

/** Every native input at one wallet commit, the framework's included, as object hashes. */
export function nativeInputs(repo, commit) {
  const inputs = {};
  for (const p of ["app/ios", "app/android", "package.json", "app/package.json", "yarn.lock", ".yarnrc.yml", ".yarn/patches", "app/patches", "app/react-native.config.js", "app/app.json", ...BUILD_SCRIPTS]) {
    inputs[`wallet:${p}`] = objectAt(repo, commit, p);
  }
  for (const line of git(repo, "ls-tree", "-r", commit, "app/").split("\n")) {
    const [meta, path] = line.split("\t");
    if (path && ASSET_EXT.test(path) && !path.startsWith("app/ios/") && !path.startsWith("app/android/")) inputs[`wallet:${path}`] = meta.split(" ")[2];
  }
  // Named, so a fingerprint from before the move (the framework at bifold/, its own lockfile beside it) never equals
  // one taken since, even when every object is byte for byte the same.
  inputs["framework:(layout)"] = "packages/";
  for (const { name, markers } of frameworkPackages(repo, commit)) {
    if (SERVER_ONLY.has(name)) continue;
    inputs[`wallet:packages/${name}/package.json`] = objectAt(repo, commit, `packages/${name}/package.json`);
    for (const m of markers) inputs[`wallet:packages/${name}/${m}`] = objectAt(repo, commit, `packages/${name}/${m}`);
  }
  for (const line of git(repo, "ls-tree", "-r", commit, "packages/").split("\n")) {
    const [meta, path] = line.split("\t");
    const pkg = path?.split("/")[1];
    if (path && ASSET_EXT.test(path) && !SERVER_ONLY.has(pkg) && !TEST.test(path)) inputs[`wallet:${path}`] = meta.split(" ")[2];
  }
  return inputs;
}

export const digestOf = (inputs) =>
  createHash("sha256")
    .update(Object.keys(inputs).sort().map((k) => `${k}=${inputs[k]}`).join("\n"))
    .digest("hex");

/**
 * The verdict for base → head. `env` is { base, head }: the sha256 of the
 * .env each build used (the base's from its build manifest).
 */
export function judge({ walletRepo, base, head, bifoldBase, bifoldHead, env = {} }) {
  const reasons = [];
  const files = [];
  const envReasons = () => {
    if (!env.base || !env.head) reasons.push("no .env evidence for the base build or this one: cannot rule out baked config");
    else if (env.base !== env.head) reasons.push(".env differs from the base build's (react-native-config bakes it into native code)");
  };
  if (bifoldBase || bifoldHead) throw new Error("--bifold-base/--bifold-head name a submodule pin, and the framework is a tree of this repository (packages/) with no pin");
  // The framework at packages/ at both ends (since the move): the wallet diff carries its paths itself, there is no
  // pin and no second repository. An end from before the move (bifold/ a tree, or the gitlink; or no framework at
  // all): the move is in the range, every framework file is named twice in the diff and nothing of what changed can be
  // read, so the verdict is a full build, for that one reason, before anything of the framework's is read. (A
  // repository with no framework at either end has nothing that moved: its wallet files decide, as before.)
  const layoutA = layoutAt(walletRepo, base);
  const layoutB = layoutAt(walletRepo, head);
  const moved = !(layoutA === layoutB && (layoutA === "packages" || layoutA === "absent"));
  if (moved) {
    for (const p of changedPaths(walletRepo, base, head)) {
      const framework = p === "bifold" || p.startsWith("bifold/") || p.startsWith("packages/");
      files.push({ repo: "wallet", path: p, ...(framework ? { cls: "native", why: MOVE } : classifyWalletPath(p)) });
    }
    // The move is one reason, not one per framework file (the whole tree arrives twice in that diff).
    reasons.push(`${MOVE} between ${base} and ${head} (the framework is ${layoutA} at the base, ${layoutB} at the head): nothing of it can be read across the move`);
    reasons.push("fingerprint: framework:(layout) changed");
    for (const f of files) if (f.cls === "native" && f.why !== MOVE) reasons.push(`${f.repo}:${f.path} — ${f.why}`);
    envReasons();
    return {
      verdict: VERDICT.FULL,
      reasons,
      base: { wallet: base, bifold: frameworkTree(walletRepo, base), fingerprint: null },
      head: { wallet: head, bifold: frameworkTree(walletRepo, head), fingerprint: null },
      files,
    };
  }

  const natives = new Set();
  if (layoutA === "packages") for (const c of [base, head]) for (const p of frameworkPackages(walletRepo, c)) if (p.markers.length) natives.add(p.name);

  for (const p of changedPaths(walletRepo, base, head)) files.push({ repo: "wallet", path: p, ...classifyWalletPath(p, natives) });

  for (const f of files) if (f.cls === "native") reasons.push(`${f.repo}:${f.path} — ${f.why}`);

  const a = nativeInputs(walletRepo, base);
  const b = nativeInputs(walletRepo, head);
  const fingerprintChanges = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
  for (const k of fingerprintChanges) reasons.push(`fingerprint: ${k} changed`);

  envReasons();

  const verdict = reasons.length ? VERDICT.FULL : files.some((f) => f.cls === "js") ? VERDICT.JS_ONLY : VERDICT.NO_APP_CHANGE;
  return {
    verdict,
    reasons,
    // `bifold` keeps its name: the build manifest's field, the tree id of packages/ since the move (heads.sh and
    // ota-deploy.mjs report the same id).
    base: { wallet: base, bifold: frameworkTree(walletRepo, base), fingerprint: digestOf(a) },
    head: { wallet: head, bifold: frameworkTree(walletRepo, head), fingerprint: digestOf(b) },
    files,
  };
}

// ---------------------------------------------------------------- CLI

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]]] : acc), [])
  );
  let result;
  try {
    if (!args.base || !args.head) throw new Error("--base and --head are required");
    result = judge({
      walletRepo: args["wallet-repo"] ?? ".",
      base: args.base,
      head: args.head,
      bifoldBase: args["bifold-base"],
      bifoldHead: args["bifold-head"],
      env: { base: args["env-base"], head: args["env-head"] },
    });
  } catch (e) {
    result = { verdict: VERDICT.FULL, reasons: [`could not judge: ${e.message}`], files: [] };
  }
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`verdict: ${result.verdict}`);
    for (const r of result.reasons) console.log(`  full because ${r}`);
    const counts = result.files.reduce((c, f) => ({ ...c, [f.cls]: (c[f.cls] ?? 0) + 1 }), {});
    console.log(`  files: ${JSON.stringify(counts)}`);
  }
  process.exit(EXIT[result.verdict]);
}
