// node --test scripts/ci/js-only.test.mjs
// The history cases need a wallet clone with the bifold submodule's objects:
//   JS_ONLY_WALLET=~/Documents/keyring-ui-ux node --test scripts/ci/js-only.test.mjs
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

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
  for (const p of ["scripts/openvtc/own-agent-twin/lib.sh", "scripts/openvtc/setup-external.mjs", "scripts/demo.js", "scripts/local-mediator.js", "scripts/quickstart.sh", "scripts/check-commit-signing.sh"]) {
    assert.equal(w(p), "none", p);
  }
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
