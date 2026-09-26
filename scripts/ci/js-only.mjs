#!/usr/bin/env node
/**
 * Can a change ship as a new JS bundle inside an existing native build, or does
 * it need a full native build? Two independent guards, both from git objects
 * (nothing is checked out or built); a change is JS-only only when BOTH say so.
 *
 *   1. The change, file by file (wallet diff + the bifold pin's diff). An
 *      allowlist: a file is JS (goes into the bundle), none (not in the app:
 *      tests, docs, e2e, server-only packages), or native. Anything the list
 *      does not know is native. Any native file → full build.
 *   2. A fingerprint of every native input, taken at both commits: app/ios and
 *      app/android (Podfile.lock, Info.plist, entitlements, manifest, gradle,
 *      icons), package.json files and yarn.lock, dependency patches, the
 *      react-native config, packages with native code, and every image/font
 *      Metro bundles (Android compiles those into res/, so they are native
 *      there). Plus the .env the base build was made with: react-native-config
 *      bakes it into native code (BuildConfig, GeneratedDotEnv), so a .env
 *      change is never JS-only. With no .env evidence for either side, the
 *      verdict is full.
 *
 * Any error, missing object or doubt → full. The verdict says why.
 *
 * Usage:
 *   node scripts/ci/js-only.mjs --base <wallet-sha> --head <wallet-sha> \
 *     [--bifold-base <sha> --bifold-head <sha>]   (default: each commit's pin)
 *     [--bifold-repo <path>]                        (default: ./bifold)
 *     [--env-base <sha256> --env-head <sha256>]     (hash of the .env each build used)
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

/** bifold packages the app does not bundle (servers, reference suites, tooling). */
export const SERVER_ONLY = new Set(["mediator-server", "witness-server", "vrc-reference", "vrc-shared"]);
/** Files in a package directory that make it native, or change how it is linked. */
const NATIVE_MARKERS = /^(android|ios|.*\.podspec|react-native\.config\.js|expo-module\.config\.json|app\.plugin\.js)$/;

/**
 * One wallet path: 'js' (in the bundle), 'none' (not in the app), or 'native'.
 * Anything not recognised is native.
 */
export function classifyWalletPath(p) {
  if (p === "bifold") return { cls: "none", why: "submodule pin (its diff is judged file by file)" };
  if (p.startsWith("app/ios/") || p.startsWith("app/android/")) return { cls: "native", why: "native project" };
  if (/(^|\/)\.env(\..*)?$/.test(p) && !p.endsWith(".sample")) return { cls: "native", why: "react-native-config bakes .env into native code" };
  if (/(^|\/)package\.json$|^yarn\.lock$|^\.yarnrc\.yml$|^\.yarn\//.test(p)) return { cls: "native", why: "dependencies (may add or change native code)" };
  if (p.startsWith("app/patches/")) return { cls: "native", why: "dependency patch" };
  if (/^app\/(react-native\.config\.js|app\.json)$/.test(p)) return { cls: "native", why: "native linking / app registration" };
  if (p.startsWith("scripts/")) return { cls: "native", why: "install/build scripts" };
  if (ASSET_EXT.test(p) && p.startsWith("app/")) return { cls: "native", why: "bundled asset: compiled into Android res/" };
  if (p.startsWith("e2e/") || p.startsWith("docs/") || p.startsWith(".github/") || p.startsWith(".husky/") || p.startsWith("tsp-reference/")) return { cls: "none", why: "not in the app" };
  if (TEST.test(p) || (DOC.test(p) && !p.startsWith("app/src/"))) return { cls: "none", why: "test or document" };
  if (/^app\/(metro|babel)\.config\.js$|^app\/index\.js$/.test(p)) return { cls: "js", why: "bundle configuration / entry" };
  if (p.startsWith("app/src/") && CODE_EXT.test(p)) return { cls: "js", why: "app source" };
  if (/^(\.eslintrc.*|\.prettier.*|app\/\.eslintrc.*|app\/tsconfig.*\.json|app\/jest\.config\.js|commitlint\.config\.js|\.gitignore|\.gitattributes|\.nvmrc|README.*|LICENSE.*)$/.test(p)) return { cls: "none", why: "tooling, not in the bundle" };
  return { cls: "native", why: "not recognised as JS-only" };
}

/**
 * One bifold path (relative to the bifold repo). `nativePackages` are the
 * package names with native markers at either commit.
 */
export function classifyBifoldPath(p, nativePackages) {
  const m = p.match(/^packages\/([^/]+)\/(.*)$/);
  if (!m) {
    if (p.startsWith(".github/") || p.startsWith("docs/") || DOC.test(p) || TEST.test(p) || p.startsWith(".githooks/")) return { cls: "none", why: "not in the app" };
    if (/^(package\.json|yarn\.lock|\.yarnrc\.yml)$|^\.yarn\//.test(p)) return { cls: "native", why: "bifold dependencies" };
    return { cls: "native", why: "bifold root file not recognised as JS-only" };
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
const objectAt = (repo, commit, path) => {
  try {
    return git(repo, "rev-parse", `${commit}:${path}`);
  } catch {
    return "absent";
  }
};

/** Changed paths between two commits, both sides of a rename. */
export function changedPaths(repo, a, b) {
  const out = git(repo, "diff", "--name-status", "--no-renames", a, b);
  return out ? out.split("\n").map((l) => l.split("\t").slice(1)).flat() : [];
}

export function bifoldPin(repo, commit) {
  const pin = objectAt(repo, commit, "bifold");
  if (pin === "absent") throw new Error(`no bifold pin at ${commit}`);
  return pin;
}

/** Package directories of bifold at a commit, with whether each carries native markers. */
export function bifoldPackages(bifoldRepo, commit) {
  const dirs = git(bifoldRepo, "ls-tree", "-d", "--name-only", commit, "packages/").split("\n").filter(Boolean);
  return dirs.map((dir) => {
    const names = git(bifoldRepo, "ls-tree", "--name-only", commit, `${dir}/`).split("\n").map((n) => n.split("/").pop());
    return { name: dir.slice("packages/".length), markers: names.filter((n) => NATIVE_MARKERS.test(n)) };
  });
}

/** Every native input at one wallet commit (and its bifold pin), as object hashes. */
export function nativeInputs(walletRepo, bifoldRepo, commit, pin) {
  const inputs = {};
  for (const p of ["app/ios", "app/android", "package.json", "app/package.json", "yarn.lock", ".yarnrc.yml", ".yarn/patches", "app/patches", "app/react-native.config.js", "app/app.json", "scripts"]) {
    inputs[`wallet:${p}`] = objectAt(walletRepo, commit, p);
  }
  for (const line of git(walletRepo, "ls-tree", "-r", commit, "app/").split("\n")) {
    const [meta, path] = line.split("\t");
    if (path && ASSET_EXT.test(path) && !path.startsWith("app/ios/") && !path.startsWith("app/android/")) inputs[`wallet:${path}`] = meta.split(" ")[2];
  }
  for (const p of ["package.json", "yarn.lock", ".yarnrc.yml", ".yarn/patches"]) inputs[`bifold:${p}`] = objectAt(bifoldRepo, pin, p);
  for (const { name, markers } of bifoldPackages(bifoldRepo, pin)) {
    if (SERVER_ONLY.has(name)) continue;
    inputs[`bifold:packages/${name}/package.json`] = objectAt(bifoldRepo, pin, `packages/${name}/package.json`);
    for (const m of markers) inputs[`bifold:packages/${name}/${m}`] = objectAt(bifoldRepo, pin, `packages/${name}/${m}`);
  }
  for (const line of git(bifoldRepo, "ls-tree", "-r", pin, "packages/").split("\n")) {
    const [meta, path] = line.split("\t");
    const pkg = path?.split("/")[1];
    if (path && ASSET_EXT.test(path) && !SERVER_ONLY.has(pkg) && !TEST.test(path)) inputs[`bifold:${path}`] = meta.split(" ")[2];
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
export function judge({ walletRepo, bifoldRepo, base, head, bifoldBase, bifoldHead, env = {} }) {
  const reasons = [];
  const files = [];
  const pinA = bifoldBase ?? bifoldPin(walletRepo, base);
  const pinB = bifoldHead ?? bifoldPin(walletRepo, head);

  const natives = new Set();
  for (const c of [pinA, pinB]) for (const p of bifoldPackages(bifoldRepo, c)) if (p.markers.length) natives.add(p.name);

  for (const p of changedPaths(walletRepo, base, head)) files.push({ repo: "wallet", path: p, ...classifyWalletPath(p) });
  if (pinA !== pinB) for (const p of changedPaths(bifoldRepo, pinA, pinB)) files.push({ repo: "bifold", path: p, ...classifyBifoldPath(p, natives) });

  for (const f of files) if (f.cls === "native") reasons.push(`${f.repo}:${f.path} — ${f.why}`);

  const a = nativeInputs(walletRepo, bifoldRepo, base, pinA);
  const b = nativeInputs(walletRepo, bifoldRepo, head, pinB);
  const fingerprintChanges = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
  for (const k of fingerprintChanges) reasons.push(`fingerprint: ${k} changed`);

  if (!env.base || !env.head) reasons.push("no .env evidence for the base build or this one: cannot rule out baked config");
  else if (env.base !== env.head) reasons.push(".env differs from the base build's (react-native-config bakes it into native code)");

  const verdict = reasons.length ? VERDICT.FULL : files.some((f) => f.cls === "js") ? VERDICT.JS_ONLY : VERDICT.NO_APP_CHANGE;
  return {
    verdict,
    reasons,
    base: { wallet: base, bifold: pinA, fingerprint: digestOf(a) },
    head: { wallet: head, bifold: pinB, fingerprint: digestOf(b) },
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
      bifoldRepo: args["bifold-repo"] ?? "bifold",
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
