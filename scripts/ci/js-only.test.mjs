// node --test scripts/ci/js-only.test.mjs
// (The known-history cases from the submodule era, judged through the pin walk, went with it in Phase 2 of the
// single-codebase plan: this tool reads the framework at packages/ and calls any range reaching back past the move a
// full build. They are in this file's history.)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { classifyBifoldPath, classifyWalletPath, judge, layoutAt, MOVE, VERDICT } from "./js-only.mjs";

const w = (p) => classifyWalletPath(p).cls;
const b = (p, natives = new Set(["react-native-attestation", "react-native-locality-peripheral"])) => classifyBifoldPath(p, natives).cls;

test("wallet: app source and bundle config are JS", () => {
  assert.equal(w("app/src/screens/Home.tsx"), "js");
  assert.equal(w("app/src/localization/en/index.ts"), "js");
  assert.equal(w("app/metro.config.js"), "js");
  assert.equal(w("app/index.js"), "js");
});

test("wallet: native projects, dependencies, patches, config and assets are native", () => {
  for (const p of [
    "app/ios/AriesBifold/Info.plist",
    "app/ios/Podfile.lock",
    "app/ios/AriesBifold/AriesBifold.entitlements",
    "app/android/app/src/main/AndroidManifest.xml",
    "app/android/gradle.properties",
    "app/package.json",
    "package.json",
    "yarn.lock",
    ".yarn/patches/@credo-ts-core-npm-0.6.0.patch",
    "app/patches/react-native-config+1.5.5.patch",
    "app/react-native.config.js",
    "app/app.json",
    "app/.env",
    ".env",
    "app/.env.production",
    "app/src/assets/img/logo.png",
    "app/src/assets/fonts/Inter.ttf",
    "scripts/ensure-bifold-ready.js",
    "scripts/fix-portal-symlinks.js",
    "scripts/bump_ios_build.sh",
    "scripts/testflight/upload.sh",
    "scripts/some-new-script.sh",
  ]) {
    assert.equal(w(p), "native", p);
  }
});

test("wallet: developer and lab tooling under scripts/ is not a build input", () => {
  for (const p of ["scripts/openvtc/own-agent-twin/lib.sh", "scripts/openvtc/setup-external.mjs", "scripts/ci/js-only.mjs", "scripts/ci/js-swap.sh", "scripts/demo.js", "scripts/local-mediator.js", "scripts/quickstart.sh", "scripts/check-commit-signing.sh"]) {
    assert.equal(w(p), "none", p);
  }
});

test("wallet: the e2e harness is not in the app, its own package files included", () => {
  for (const p of ["e2e/package.json", "e2e/package-lock.json", "e2e/run-lock-probe.mjs", "e2e/lib/driver.js", "e2e/README.md"]) {
    assert.equal(w(p), "none", p);
  }
  // Only e2e/ at the root: the app's own package.json stays native.
  assert.equal(w("app/package.json"), "native");
});

test("wallet: anything unrecognised is native (doubt → full build)", () => {
  assert.equal(w("app/some-new-config.yaml"), "native");
  assert.equal(w("Gemfile"), "native");
  assert.equal(w("app/src/data/model.bin"), "native");
});

test("wallet: tests, docs, e2e and CI are not in the app", () => {
  for (const p of ["e2e/run-own-agent.js", "docs/plans/x.md", ".github/workflows/staging.yaml", "app/src/utils/problemReport.test.ts", "app/__mocks__/expo-sharing.ts", "README.md"]) {
    assert.equal(w(p), "none", p);
  }
});

test("wallet: a packages/… path (the framework, since the move) is judged by the framework rules", () => {
  const natives = new Set(["react-native-attestation"]);
  assert.equal(classifyWalletPath("packages/core/src/screens/X.tsx", natives).cls, "js");
  assert.equal(classifyWalletPath("packages/react-native-attestation/src/index.ts", natives).cls, "js");
  assert.equal(classifyWalletPath("packages/react-native-attestation/ios/Foo.m", natives).cls, "native");
  assert.equal(classifyWalletPath("packages/witness-server/src/index.ts", natives).cls, "none");
  assert.equal(classifyWalletPath("packages/core/README.md", natives).cls, "none");
  assert.equal(classifyWalletPath("packages/core/package.json", natives).cls, "native");
  // The framework's tooling at the root and at packages/ since the move: none, like the wallet's own.
  for (const p of ["eslint.config.mjs", "eslint-rules/no-foo.js", "packages/.prettierrc", "packages/.prettierignore", "packages/.gitignore", "packages/tsconfig-base.json", "packages/__mocks__/x.js"]) {
    assert.equal(w(p), "none", p);
  }
});

test("wallet: the framework's old place, bifold/ (a tree or the gitlink), is native for the move's one reason", () => {
  // Such a path is only in a diff that reaches back before the move, where nothing of the framework's can be read.
  for (const p of ["bifold", "bifold/packages/core/src/screens/X.tsx", "bifold/packages/core/README.md", "bifold/yarn.lock"]) {
    assert.deepEqual(classifyWalletPath(p), { cls: "native", why: MOVE }, p);
  }
});

test("bifold: package source is JS, even in a package with native code", () => {
  assert.equal(b("packages/core/src/modules/trust-tasks/screens/VtiVetting.tsx"), "js");
  assert.equal(b("packages/core/src/localization/en/en.json"), "js");
  assert.equal(b("packages/react-native-attestation/src/index.ts"), "js");
});

test("bifold: native code, linking, dependencies and assets are native", () => {
  for (const p of [
    "packages/react-native-attestation/ios/Attestation.swift",
    "packages/react-native-attestation/android/build.gradle",
    "packages/react-native-attestation/react-native-attestation.podspec",
    "packages/core/react-native.config.js",
    "packages/core/package.json",
    "packages/core/src/assets/img/logo-large.png",
    "packages/some-new-root-file.cfg",
    "packages/core/some-new-file.cfg",
    "packages/new-native-thing/ios/X.m",
  ]) {
    assert.equal(b(p), "native", p);
  }
});

test("bifold: server-only packages, tests and docs are not in the app", () => {
  for (const p of ["packages/witness-server/src/index.ts", "packages/mediator-server/package.json", "packages/vrc-reference/tests/ref-07.test.ts", "packages/core/src/modules/trust-tasks/__tests__/x.test.tsx", "packages/core/README.md", "packages/__mocks__/react-native-fs.js"]) {
    assert.equal(b(p), "none", p);
  }
});

// ---- the move, in throwaway repositories

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const sh = (dir, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-C", dir, ...args], { encoding: "utf8" }).trim();
const write = (dir, file, text) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
};
const CORE = "packages/core/src/screens/X.tsx";
const ATTESTATION = "packages/react-native-attestation/ios/x.m";
const env = { base: "e".repeat(64), head: "e".repeat(64) };

/**
 * A wallet across the fold and the move: it pins a stand-in bifold clone (`pinned`), drops the gitlink (`dropped`),
 * carries the same files as a tree under bifold/ (`folded`), renames that tree to packages/ (`moved`, Phase 2), then
 * changes a core screen (`screen`) and a native file (`native`) under packages/.
 */
function movedRepos() {
  const top = mkdtempSync(path.join(tmpdir(), "js-only-move-"));
  dirs.push(top);
  const clone = path.join(top, "bifold-repo");
  const wallet = path.join(top, "wallet");
  for (const d of [clone, wallet]) {
    mkdirSync(d);
    sh(d, "init", "-q");
  }
  const frameworkFiles = { [CORE]: "export const X = 1\n", "packages/core/package.json": "{}\n", [ATTESTATION]: "// m\n", "packages/react-native-attestation/package.json": "{}\n" };
  for (const [f, t] of Object.entries({ "package.json": "{}\n", ...frameworkFiles })) write(clone, f, t);
  sh(clone, "add", "-A");
  sh(clone, "commit", "-qm", "bifold");
  const pin = sh(clone, "rev-parse", "HEAD");

  write(wallet, "app/src/App.tsx", "app\n");
  sh(wallet, "add", "-A");
  sh(wallet, "update-index", "--add", "--cacheinfo", `160000,${pin},bifold`);
  sh(wallet, "commit", "-qm", "pinned");
  const pinned = sh(wallet, "rev-parse", "HEAD");
  sh(wallet, "rm", "-q", "--cached", "bifold");
  sh(wallet, "commit", "-qm", "dropped");
  const dropped = sh(wallet, "rev-parse", "HEAD");
  for (const [f, t] of Object.entries({ "package.json": "{}\n", ...frameworkFiles })) write(wallet, `bifold/${f}`, t);
  sh(wallet, "add", "-A");
  sh(wallet, "commit", "-qm", "folded");
  const folded = sh(wallet, "rev-parse", "HEAD");
  // The move: renames only, the framework's own manifest gone (one install at the root).
  sh(wallet, "mv", "bifold/packages", "packages");
  sh(wallet, "rm", "-q", "bifold/package.json");
  sh(wallet, "commit", "-qm", "moved");
  const moved = sh(wallet, "rev-parse", "HEAD");
  write(wallet, CORE, "export const X = 2\n");
  sh(wallet, "commit", "-qam", "screen");
  const screen = sh(wallet, "rev-parse", "HEAD");
  write(wallet, ATTESTATION, "// m2\n");
  sh(wallet, "commit", "-qam", "native");
  const native = sh(wallet, "rev-parse", "HEAD");
  return { walletRepo: wallet, pinned, dropped, folded, moved, screen, native };
}

test("the layout at a commit: the gitlink, the folded tree, the packages/ tree, or none", () => {
  const r = movedRepos();
  assert.deepEqual([r.pinned, r.dropped, r.folded, r.moved, r.screen].map((c) => layoutAt(r.walletRepo, c)), ["bifold submodule", "absent", "bifold tree", "packages", "packages"]);
});

test("after the move: a core screen change under packages/ is JS-only, with no pin to follow", () => {
  const { walletRepo, moved, screen } = movedRepos();
  const r = judge({ walletRepo, base: moved, head: screen, env });
  assert.equal(r.verdict, VERDICT.JS_ONLY, r.reasons.join("; "));
  assert.deepEqual(r.files, [{ repo: "wallet", path: CORE, cls: "js", why: "core source" }]);
  // The framework's identifier is the packages/ tree's id at each commit, as the manifest's `bifold` field means it.
  assert.equal(r.base.bifold, sh(walletRepo, "rev-parse", `${moved}:packages`));
  assert.notEqual(r.base.bifold, r.head.bifold);
  // A pin-naming flag is refused rather than ignored.
  assert.throws(() => judge({ walletRepo, base: moved, head: screen, bifoldBase: "0".repeat(40), env }), /no pin/);
});

test("after the move: a native file change under packages/ is a full build, by the file and by the fingerprint", () => {
  const { walletRepo, screen, native } = movedRepos();
  const r = judge({ walletRepo, base: screen, head: native, env });
  assert.equal(r.verdict, VERDICT.FULL);
  assert.ok(r.reasons.includes(`wallet:${ATTESTATION} — react-native-attestation native code or linking`), r.reasons.join("; "));
  assert.ok(r.reasons.includes("fingerprint: wallet:packages/react-native-attestation/ios changed"), r.reasons.join("; "));
});

test("a range crossing the move is a full build for one reason, every framework path native, no fingerprint on either side", () => {
  const { walletRepo, pinned, dropped, folded, moved, screen } = movedRepos();
  for (const [base, head, layouts] of [
    [folded, moved, "bifold tree at the base, packages at the head"],
    [folded, screen, "bifold tree at the base, packages at the head"],
    [pinned, screen, "bifold submodule at the base, packages at the head"],
    [dropped, moved, "absent at the base, packages at the head"],
    [pinned, folded, "bifold submodule at the base, bifold tree at the head"],
  ]) {
    const r = judge({ walletRepo, base, head, env });
    assert.equal(r.verdict, VERDICT.FULL, layouts);
    const framework = r.files.filter((f) => f.path === "bifold" || f.path.startsWith("bifold/") || f.path.startsWith("packages/"));
    assert.ok(framework.length >= 1 && framework.every((f) => f.cls === "native" && f.why === MOVE), layouts);
    const move = r.reasons.filter((x) => x.startsWith(MOVE));
    assert.equal(move.length, 1, `one reason for the move, not one per file (${layouts})`);
    assert.ok(move[0].includes(layouts), move[0]);
    assert.ok(r.reasons.includes("fingerprint: framework:(layout) changed"), r.reasons.join("; "));
    // Nothing of the framework's is read across the move, so no fingerprint is computed for either end; the layout
    // reason above is what says they differ.
    assert.deepEqual([r.base.fingerprint, r.head.fingerprint], [null, null], layouts);
  }
  // The folded tree's screen, judged from the folded base, is the move's business too: the same screen change that
  // reads JS-only after the move (the control above) is never JS-only across it.
  assert.equal(judge({ walletRepo, base: folded, head: screen, env }).files.find((f) => f.path === CORE)?.why, MOVE);
});

test("no framework at either end: nothing moved, the wallet files decide", () => {
  const { walletRepo, dropped } = movedRepos();
  const r = judge({ walletRepo, base: dropped, head: dropped, env });
  assert.equal(r.verdict, VERDICT.NO_APP_CHANGE, r.reasons.join("; "));
  assert.deepEqual([r.base.bifold, r.head.bifold], [null, null]);
});
