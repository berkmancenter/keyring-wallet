// node --test scripts/ci/js-only.test.mjs
// The history cases need a wallet clone with the bifold submodule's objects (pre-fold history):
//   JS_ONLY_WALLET=~/Documents/keyring-ui-ux node --test scripts/ci/js-only.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { classifyBifoldPath, classifyWalletPath, judge, VERDICT } from "./js-only.mjs";

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

test("wallet: a bifold/… path (the folded tree) is judged by the bifold rules", () => {
  const natives = new Set(["react-native-attestation"]);
  assert.equal(classifyWalletPath("bifold/packages/core/src/screens/X.tsx", natives).cls, "js");
  assert.equal(classifyWalletPath("bifold/packages/react-native-attestation/src/index.ts", natives).cls, "js");
  assert.equal(classifyWalletPath("bifold/packages/react-native-attestation/ios/Foo.m", natives).cls, "native");
  assert.equal(classifyWalletPath("bifold/packages/witness-server/src/index.ts", natives).cls, "none");
  assert.equal(classifyWalletPath("bifold/packages/core/README.md", natives).cls, "none");
  for (const p of ["bifold/package.json", "bifold/yarn.lock"]) assert.deepEqual(classifyWalletPath(p, natives), { cls: "native", why: "bifold dependencies" }, p);
  // The gitlink itself (before the fold) is still judged through its pin's diff.
  assert.equal(w("bifold"), "none");
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
    "package.json",
    "yarn.lock",
    "packages/core/some-new-file.cfg",
    "packages/new-native-thing/ios/X.m",
  ]) {
    assert.equal(b(p), "native", p);
  }
});

test("bifold: server-only packages, tests and docs are not in the app", () => {
  for (const p of ["packages/witness-server/src/index.ts", "packages/mediator-server/package.json", "packages/vrc-reference/tests/ref-07.test.ts", "packages/core/src/modules/trust-tasks/__tests__/x.test.tsx", "packages/core/README.md", ".github/workflows/ci.yml"]) {
    assert.equal(b(p), "none", p);
  }
});

// ---- the fold, in throwaway repositories

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const sh = (dir, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-C", dir, ...args], { encoding: "utf8" }).trim();
const write = (dir, file, text) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
};
const CORE = "packages/core/src/screens/X.tsx";
const ATTESTATION = "packages/react-native-attestation/ios/x.m";

/**
 * A bifold clone (two packages, one native) and a wallet that pins it (commit `pinned`), drops the gitlink for the same
 * files as a tree (`folded`), then changes a core screen (`screen`) and a native file (`native`) inside that tree.
 */
function foldRepos() {
  const top = mkdtempSync(path.join(tmpdir(), "js-only-fold-"));
  dirs.push(top);
  const bifold = path.join(top, "bifold-repo");
  const wallet = path.join(top, "wallet");
  for (const d of [bifold, wallet]) {
    mkdirSync(d);
    sh(d, "init", "-q");
  }
  const bifoldFiles = { "package.json": "{}\n", [CORE]: "export const X = 1\n", "packages/core/package.json": "{}\n", [ATTESTATION]: "// m\n", "packages/react-native-attestation/package.json": "{}\n" };
  for (const [f, t] of Object.entries(bifoldFiles)) write(bifold, f, t);
  sh(bifold, "add", "-A");
  sh(bifold, "commit", "-qm", "bifold");
  const pin = sh(bifold, "rev-parse", "HEAD");

  write(wallet, "app/src/App.tsx", "app\n");
  sh(wallet, "add", "-A");
  sh(wallet, "update-index", "--add", "--cacheinfo", `160000,${pin},bifold`);
  sh(wallet, "commit", "-qm", "pinned");
  const pinned = sh(wallet, "rev-parse", "HEAD");
  sh(wallet, "rm", "-q", "--cached", "bifold");
  for (const [f, t] of Object.entries(bifoldFiles)) write(wallet, `bifold/${f}`, t);
  sh(wallet, "add", "-A");
  sh(wallet, "commit", "-qm", "folded");
  const folded = sh(wallet, "rev-parse", "HEAD");
  write(wallet, `bifold/${CORE}`, "export const X = 2\n");
  sh(wallet, "commit", "-qam", "screen");
  const screen = sh(wallet, "rev-parse", "HEAD");
  write(wallet, `bifold/${ATTESTATION}`, "// m2\n");
  sh(wallet, "commit", "-qam", "native");
  const native = sh(wallet, "rev-parse", "HEAD");
  return { repos: { walletRepo: wallet, bifoldRepo: bifold }, pinned, folded, screen, native };
}

test("fold: a core screen change in the folded tree is JS-only, with no pin to follow", () => {
  const { repos, folded, screen } = foldRepos();
  const r = judge({ ...repos, base: folded, head: screen, env });
  assert.equal(r.verdict, VERDICT.JS_ONLY, r.reasons.join("; "));
  assert.deepEqual(r.files, [{ repo: "wallet", path: `bifold/${CORE}`, cls: "js", why: "core source" }]);
  // The bifold identifier is the tree's id at each commit, as the manifest means it.
  assert.equal(r.base.bifold, sh(repos.walletRepo, "rev-parse", `${folded}:bifold`));
  assert.notEqual(r.base.bifold, r.head.bifold);
  // A gitlink-only flag is refused rather than ignored.
  assert.throws(() => judge({ ...repos, base: folded, head: screen, bifoldBase: "0".repeat(40), env }), /bifold is a tree of this repository/);
});

test("fold: a native file change in the folded tree is a full build, by the file and by the fingerprint", () => {
  const { repos, screen, native } = foldRepos();
  const r = judge({ ...repos, base: screen, head: native, env });
  assert.equal(r.verdict, VERDICT.FULL);
  assert.ok(r.reasons.includes(`wallet:bifold/${ATTESTATION} — react-native-attestation native code or linking`), r.reasons.join("; "));
  assert.ok(r.reasons.includes("fingerprint: bifold:packages/react-native-attestation/ios changed"), r.reasons.join("; "));
});

test("fold: a range crossing the fold is a full build, every bifold path native, the fingerprints apart", () => {
  const { repos, pinned, folded } = foldRepos();
  const r = judge({ ...repos, base: pinned, head: folded, env });
  assert.equal(r.verdict, VERDICT.FULL);
  const bifold = r.files.filter((f) => f.path === "bifold" || f.path.startsWith("bifold/"));
  assert.ok(bifold.length >= 2 && bifold.every((f) => f.cls === "native" && f.why === "the fold: the submodule became a tree"));
  assert.equal(r.reasons.filter((x) => x.startsWith("the fold:")).length, 1, "one reason for the fold, not one per file");
  assert.ok(r.reasons.includes("fingerprint: bifold:(layout) changed"), r.reasons.join("; "));
  assert.notEqual(r.base.fingerprint, r.head.fingerprint);
});

// ---- known history (the cases the rule was asked to prove)

const WALLET = process.env.JS_ONLY_WALLET;
const history = WALLET && existsSync(`${WALLET}/bifold`) ? test : test.skip;
const repos = { walletRepo: WALLET, bifoldRepo: `${WALLET}/bifold` };
const env = { base: "e".repeat(64), head: "e".repeat(64) };
// The wallet commit the bifold-only ranges are judged against (#212's merge).
const WALLET_AT = "92593c4";

history("bifold #151–#155 (2026-09-26, screens and strings): JS-only", () => {
  const r = judge({ ...repos, base: WALLET_AT, head: WALLET_AT, bifoldBase: "7e4a110f^1", bifoldHead: "280e7e0b", env });
  assert.equal(r.verdict, VERDICT.JS_ONLY, r.reasons.join("; "));
});

history("wallet #196 (expo-sharing: a native dependency): full", () => {
  const r = judge({ ...repos, base: "8b2b7d0b^1", head: "8b2b7d0b", env });
  assert.equal(r.verdict, VERDICT.FULL);
  assert.ok(r.reasons.some((x) => x.includes("Podfile.lock")));
  assert.ok(r.reasons.some((x) => x.startsWith("fingerprint: wallet:yarn.lock")));
});

history("wallet #200 (an Info.plist URL scheme + manifest intent filter): full", () => {
  const r = judge({ ...repos, base: "13c5466c^1", head: "13c5466c", env });
  assert.equal(r.verdict, VERDICT.FULL);
  assert.ok(r.reasons.some((x) => x.includes("Info.plist")));
  assert.ok(r.reasons.includes("fingerprint: wallet:app/ios changed"));
  assert.ok(r.reasons.includes("fingerprint: wallet:app/android changed"));
});

history("a .env-only change: full; no .env evidence: full", () => {
  const same = { ...repos, base: WALLET_AT, head: WALLET_AT, bifoldBase: "280e7e0b", bifoldHead: "280e7e0b" };
  assert.equal(judge({ ...same, env: { base: env.base, head: "f".repeat(64) } }).verdict, VERDICT.FULL);
  assert.equal(judge({ ...same, env: {} }).verdict, VERDICT.FULL);
  assert.equal(judge({ ...same, env }).verdict, VERDICT.NO_APP_CHANGE);
});

history("226: the #171 stack on the 225 wallet is JS-only; wallet main is full only for #219's native change", () => {
  const same = { ...repos, bifoldBase: "280e7e0b", bifoldHead: "2de341e9", env };
  assert.equal(judge({ ...same, base: "335fbc9", head: "335fbc9" }).verdict, VERDICT.JS_ONLY);
  const toMain = judge({ ...same, base: "335fbc9", head: "f98317a6" });
  assert.equal(toMain.verdict, VERDICT.FULL);
  // Only #219's Xcode project, not the lab tooling that changed alongside it.
  assert.deepEqual(toMain.files.filter((f) => f.cls === "native").map((f) => f.path), ["app/ios/AriesBifold.xcodeproj/project.pbxproj"]);
});

history("wallet #212 (e2e only): no app change", () => {
  assert.equal(judge({ ...repos, base: "92593c4^1", head: "92593c4", env }).verdict, VERDICT.NO_APP_CHANGE);
});
