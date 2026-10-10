// node --test e2e/lib/buildHas.test.mjs
// Two small fixture bundles, made here: an iOS-style .app with a main.jsbundle, and an Android-style APK (a zip)
// with assets/index.android.bundle stored, plus a deflated twin. No zip tool needed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { test } from "node:test";

import { buildCaps, buildFile, buildHas, buildLacks, bundleOf, forget, platformOf } from "./buildHas.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- a minimal zip writer (one or more entries, stored or deflated), enough for an APK-shaped fixture

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function zip(entries, { deflate = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.from(content);
    const packed = deflate ? deflateRawSync(data) : data;
    const n = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(deflate ? 8 : 0, 8);
    head.writeUInt32LE(crc32(data), 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26);
    const local = Buffer.concat([head, n, packed]);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(deflate ? 8 : 0, 10);
    cd.writeUInt32LE(crc32(data), 16);
    cd.writeUInt32LE(packed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([cd, n]));
    locals.push(local);
    offset += local.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

// ---- fixtures: a Hermes-like string table, keys run together with no separator between them

const IOS_TABLE = Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03]), Buffer.from("ack};}VtaLinkResumedAgentHomeNameMyAgent\u0000rest")]);
const ANDROID_TABLE = Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03]), Buffer.from("AgentSectionRuleAgentChipsSettings\u0000rest")]);

const tmp = mkdtempSync(path.join(os.tmpdir(), "buildhas-"));
const cache = path.join(tmp, "cache");
const app = path.join(tmp, "KeyRing.app");
mkdirSync(app);
writeFileSync(path.join(app, "main.jsbundle"), IOS_TABLE);
const apk = path.join(tmp, "keyring-release-test.apk");
writeFileSync(apk, zip([["AndroidManifest.xml", "<manifest/>"], ["assets/index.android.bundle", ANDROID_TABLE]]));
const apkDeflated = path.join(tmp, "deflated.apk");
writeFileSync(apkDeflated, zip([["assets/index.android.bundle", ANDROID_TABLE]], { deflate: true }));
const env = { BUILDHAS_CACHE_DIR: cache };
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

test("platformOf: an .apk is Android, a .app is iOS, anything else is neither", () => {
  assert.equal(platformOf("/b/off/keyring-android-x/keyring-release-test.apk"), "android");
  assert.equal(platformOf("/b/off/keyring-ios-sim-x/KeyRing.app"), "ios");
  assert.equal(platformOf("/b/off/keyring-ios-sim-x/KeyRing.app/"), "ios");
  assert.equal(platformOf("/b/main.jsbundle"), undefined);
});

test("bundleOf: the .app's main.jsbundle; the APK's bundle, stored or deflated", () => {
  assert.ok(bundleOf(app).equals(IOS_TABLE));
  assert.ok(bundleOf(apk).equals(ANDROID_TABLE));
  assert.ok(bundleOf(apkDeflated).equals(ANDROID_TABLE));
  assert.throws(() => bundleOf(path.join(tmp, "x.jsbundle")), /not an \.apk or a \.app/);
});

test("buildFile: explicit file, then the leg's exports per platform; a missing file is unknown", () => {
  assert.equal(buildFile({ apk, env: {} }), apk);
  assert.equal(buildFile({ app, env: {} }), app);
  assert.equal(buildFile({ platform: "ios", env: { CAND_APP: app, APK_OFF: apk } }), app);
  assert.equal(buildFile({ platform: "android", env: { CAND_APP: app, APK_OFF: apk } }), apk);
  assert.equal(buildFile({ platform: "android", env: { ANDROID_APK: apkDeflated, APK_OFF: apk } }), apkDeflated);
  assert.equal(buildFile({ platform: "android", env: {} }), undefined);
  assert.equal(buildFile({ platform: "android", env: { APK_OFF: path.join(tmp, "gone.apk") } }), undefined);
});

test("buildHas on the iOS fixture: a key the table holds, one it does not, and the Hermes run-together case", () => {
  forget();
  assert.equal(buildHas("VtaLinkResumed", { app, env }), true);
  assert.equal(buildHas("AgentHomeName", { app, env }), true);
  assert.equal(buildHas("MyAgent", { app, env }), true);
  assert.equal(buildHas("AgentSectionRule", { app, env }), false);
  assert.equal(buildLacks("AgentSectionRule", { app, env }), "build lacks AgentSectionRule");
  assert.equal(buildLacks("MyAgent", { app, env }), undefined);
});

test("buildHas on the Android fixture, through the APK; a platform with no build known is undefined", () => {
  forget();
  assert.equal(buildHas("AgentSectionRule", { apk, env }), true);
  assert.equal(buildHas("AgentChips", { platform: "android", env: { ...env, APK_OFF: apk } }), true);
  assert.equal(buildHas("VtaLinkResumed", { apk, env }), false);
  assert.equal(buildHas("Settings", { apk: apkDeflated, env }), true);
  assert.equal(buildHas("AgentChips", { platform: "android", env: { ...env } }), undefined);
  assert.equal(buildLacks("AgentChips", { platform: "android", env: { ...env } }), undefined);
});

test("a key with whitespace, or no key, is a mistake said at once", () => {
  assert.throws(() => buildHas("Try Again", { app, env }), /not a testID key/);
  assert.throws(() => buildHas("", { app, env }), /not a testID key/);
});

test("the answer is cached per build: a second process reads it without the bundle", () => {
  forget();
  rmSync(cache, { recursive: true, force: true });
  assert.equal(buildHas("AgentChips", { apk, env }), true);
  assert.equal(buildHas("Nowhere", { apk, env }), false);
  const files = readdirSync(cache);
  assert.equal(files.length, 1);
  const entry = JSON.parse(execFileSync("node", ["-e", `process.stdout.write(require("fs").readFileSync(process.argv[1], "utf8"))`, path.join(cache, files[0])], { encoding: "utf8" }));
  assert.deepEqual(entry.keys, { AgentChips: true, Nowhere: false });
  assert.equal(entry.file, apk);
  // A new process answers a cached key from the cache file (the entry written above is what it reads).
  const script = `import("${pathToFileUrlSafe(path.join(here, "buildHas.js"))}").then((m) => { console.log(m.buildHas("AgentChips", { apk: process.argv[1], env: { BUILDHAS_CACHE_DIR: process.argv[2] } })); });`;
  const out = execFileSync("node", ["--input-type=module", "-e", script, apk, cache], { encoding: "utf8" }).trim();
  assert.equal(out, "true");
  assert.ok(existsSync(path.join(cache, files[0])));
});

test("a changed build (new size) is not the old cache entry", () => {
  forget();
  const grown = path.join(tmp, "grown.apk");
  writeFileSync(grown, zip([["assets/index.android.bundle", ANDROID_TABLE]]));
  assert.equal(buildHas("AgentChips", { apk: grown, env }), true);
  assert.equal(buildHas("Later", { apk: grown, env }), false);
  forget();
  writeFileSync(grown, zip([["assets/index.android.bundle", Buffer.concat([ANDROID_TABLE, Buffer.from("Later")])]]));
  assert.equal(buildHas("Later", { apk: grown, env }), true);
  unlinkSync(grown);
});

test("buildCaps counts the manifests' keys the build holds, and is cached with the manifest version", () => {
  forget();
  const manifest = { keys: ["AgentSectionRule", "AgentChips", "Settings", "VtaLinkResumed", "AgentHomeName"], from: "test@1" };
  assert.deepEqual(buildCaps({ apk, env, manifest }), { present: 3, total: 5 });
  assert.deepEqual(buildCaps({ app, env, manifest }), { present: 2, total: 5 });
  assert.equal(buildCaps({ platform: "ios", env: { ...env }, manifest }), undefined);
  // The real manifests: a number, never a throw, on a fixture that holds a few of their keys.
  const real = buildCaps({ app, env });
  assert.ok(real.total > 100 && real.present >= 1 && real.present <= real.total, JSON.stringify(real));
});

test("the CLI: has exits 0/1/2 and says which; caps prints present/total", () => {
  const cli = path.join(here, "buildHas.js");
  const run = (...args) => {
    try {
      return { out: execFileSync("node", [cli, ...args], { encoding: "utf8", env: { ...process.env, ...env } }).trim(), code: 0 };
    } catch (e) {
      return { out: String(e.stdout).trim(), code: e.status };
    }
  };
  assert.deepEqual(run("has", "AgentChips", "--build", apk), { out: "has", code: 0 });
  assert.deepEqual(run("has", "VtaLinkResumed", "--build", apk), { out: "lacks", code: 1 });
  assert.deepEqual(run("has", "VtaLinkResumed", "--build", app), { out: "has", code: 0 });
  assert.deepEqual(run("has", "VtaLinkResumed", "--platform", "ios"), { out: "unknown", code: 2 });
  assert.equal(run("caps", "--build", apk).code, 0);
  assert.match(run("caps", "--build", apk).out, /^\d+\/\d+$/);
  assert.deepEqual(run("caps", "--platform", "android"), { out: "-", code: 2 });
  assert.equal(run("has").code, 2);
});

function pathToFileUrlSafe(p) {
  return `file://${p}`;
}
