/**
 * Does the build under test have a screen element? `buildHas(id)` says whether the installed build's JS bundle
 * holds that testID key as a literal, so a row written for a newer feature can SKIP with "build lacks <id>"
 * instead of failing on the build testers already have (`gate.sh dry --golden`).
 *
 * Where the key is looked for:
 *   iOS      <app>/main.jsbundle, the .app the leg exports as CAND_APP (or IOS_APP)
 *   Android  assets/index.android.bundle inside the APK the leg exports as ANDROID_APK (or APK_OFF)
 * Both bundles are Hermes bytecode; its string table keeps every literal as plain bytes, so a key is found by
 * a byte search (verified on a cached gate build: VtaLinkResumed and AgentHome present, a made-up key absent).
 * Only a literal key can be found: an id the app derives from a label at runtime (testids.allow.json, "derived")
 * is not in the bundle and must not be asked for. A key that is the beginning of another key the build holds
 * reads as present too; ask for the whole key.
 *
 * The answer is cached per build (path, size, mtime) in BUILDHAS_CACHE_DIR (the gate sets it under its home;
 * otherwise the system temp dir), so a leg's many calls unzip the bundle once.
 *
 *   buildHas("AgentSectionRule", { platform: "android" })   true | false | undefined (no build file known)
 *   buildLacks("AgentSectionRule", { platform })           "build lacks AgentSectionRule" | undefined
 *   buildCaps({ platform })                                 { present, total }: the manifests' keys the build holds
 *
 * From a shell (gate/lib.sh wraps these as build_has and build_caps):
 *   node e2e/lib/buildHas.js has <key> [--build <apk | .app>] [--platform ios|android]   exit 0 has, 1 lacks, 2 unknown
 *   node e2e/lib/buildHas.js caps [--build <apk | .app>] [--platform ios|android]        prints <present>/<total>
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const ANDROID_BUNDLE = "assets/index.android.bundle";
const IOS_BUNDLE = "main.jsbundle";

/** Where the cached answers live: the gate names a folder under its home; elsewhere the system temp dir. */
export const cacheDir = (env = process.env) => env.BUILDHAS_CACHE_DIR || path.join(os.tmpdir(), "keyring-buildhas");

/** The platform a build file is for, from its name: an .apk, or a .app folder. */
export const platformOf = (file) => (/\.apk$/i.test(file) ? "android" : /\.app\/?$/i.test(file) ? "ios" : undefined);

/**
 * The build file to read: `apk` or `app` when given, else what the leg exported. Returns undefined when no
 * file is known or it is not there, which `buildHas` reports as "unknown", never as "lacks".
 */
export function buildFile({ platform, app, apk, env = process.env } = {}) {
  const ios = app ?? env.IOS_APP ?? env.CAND_APP;
  const android = apk ?? env.ANDROID_APK ?? env.APK_OFF;
  const want = platform ?? (app ? "ios" : apk ? "android" : undefined);
  const file = want === "ios" ? ios : want === "android" ? android : undefined;
  if (!file || !existsSync(file)) return undefined;
  return path.resolve(file);
}

// ----------------------------------------------------------------- the bundle

/** One entry of a zip (an APK is one), by the central directory: stored or deflated, no zip64. */
function zipEntry(buf, name) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
  const entries = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error(`zip: bad central directory entry at ${at}`);
    const method = buf.readUInt16LE(at + 10);
    const csize = buf.readUInt32LE(at + 20);
    const usize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const entryName = buf.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;
    if (csize === 0xffffffff || usize === 0xffffffff) throw new Error(`zip: ${name} needs zip64, which this reader does not do`);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`zip: bad local header for ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    if (method === 0) return data;
    if (method === 8) return inflateRawSync(data);
    throw new Error(`zip: ${name} uses compression method ${method}, not stored or deflate`);
  }
  return undefined;
}

/** The JS bundle of a build file, as bytes: the APK's index.android.bundle, or the .app's main.jsbundle. */
export function bundleOf(file) {
  const platform = platformOf(file);
  if (platform === "android") {
    const data = zipEntry(readFileSync(file), ANDROID_BUNDLE);
    if (!data) throw new Error(`${file}: no ${ANDROID_BUNDLE} in the APK`);
    return data;
  }
  if (platform === "ios") return readFileSync(path.join(file, IOS_BUNDLE));
  throw new Error(`${file}: not an .apk or a .app`);
}

// ------------------------------------------------------------------ the cache

const bundles = new Map(); // file -> Buffer, for this process
const caches = new Map(); // file -> { path, entry }

const buildStamp = (file) => {
  const st = statSync(file);
  // A .app is a folder: its bundle's size and time are what change between builds.
  const probe = platformOf(file) === "ios" ? statSync(path.join(file, IOS_BUNDLE)) : st;
  return { size: probe.size, mtime: probe.mtimeMs };
};

function cacheOf(file, env) {
  const got = caches.get(file);
  if (got) return got;
  const stamp = buildStamp(file);
  const id = createHash("sha1").update(`${file}|${stamp.size}|${stamp.mtime}`).digest("hex").slice(0, 16);
  const cachePath = path.join(cacheDir(env), `${id}.json`);
  let entry;
  try {
    entry = JSON.parse(readFileSync(cachePath, "utf8"));
    if (entry.file !== file || entry.size !== stamp.size || entry.mtime !== stamp.mtime) entry = undefined;
  } catch {
    entry = undefined;
  }
  entry ??= { file, ...stamp, keys: {} };
  const c = { path: cachePath, entry };
  caches.set(file, c);
  return c;
}

function save(c) {
  try {
    mkdirSync(path.dirname(c.path), { recursive: true });
    writeFileSync(c.path, JSON.stringify(c.entry));
  } catch {
    // Best effort: an unwritable cache only costs the next call an unzip.
  }
}

const bundle = (file) => {
  let b = bundles.get(file);
  if (!b) {
    b = bundleOf(file);
    bundles.set(file, b);
  }
  return b;
};

/** For tests: forget every bundle and cache entry held in this process. */
export function forget() {
  bundles.clear();
  caches.clear();
}

// ------------------------------------------------------------------ the API

const checkId = (id) => {
  if (typeof id !== "string" || id.length === 0 || /\s/.test(id)) throw new Error(`buildHas: not a testID key: ${JSON.stringify(id)}`);
};

/**
 * Whether the build's JS bundle holds `id`: true, false, or undefined when no build file is known (then the
 * row runs, since nothing says the build lacks it).
 */
export function buildHas(id, opts = {}) {
  checkId(id);
  const file = buildFile(opts);
  if (!file) return undefined;
  const c = cacheOf(file, opts.env);
  if (id in c.entry.keys) return c.entry.keys[id];
  const has = bundle(file).includes(Buffer.from(id, "utf8"));
  c.entry.keys[id] = has;
  save(c);
  return has;
}

/** The reason a row SKIPs on this build, or undefined when it has the key (or no build is known). */
export function buildLacks(id, opts = {}) {
  return buildHas(id, opts) === false ? `build lacks ${id}` : undefined;
}

/** The manifests' keys (testids.json and testids.app.json: keys and raw ids), for the caps count. */
export function manifestKeys(libDir = here) {
  const keys = new Set();
  let from = "";
  for (const name of ["testids.json", "testids.app.json"]) {
    const file = path.join(libDir, name);
    if (!existsSync(file)) continue;
    const m = JSON.parse(readFileSync(file, "utf8"));
    from += `${name}@${m.generatedFrom ?? "?"};`;
    for (const k of Object.keys(m.keys ?? {})) keys.add(k);
    for (const k of Object.keys(m.raw ?? {})) keys.add(k);
  }
  return { keys: [...keys], from };
}

/**
 * How many of the manifests' keys the build holds: `{ present, total }`, or undefined when no build file is
 * known. The HEADS line prints it as caps=<present>, a short reading of how far the build is from the drivers'
 * contract. Cached per build and manifest version.
 */
export function buildCaps(opts = {}) {
  const file = buildFile(opts);
  if (!file) return undefined;
  const { keys, from } = opts.manifest ?? manifestKeys();
  const c = cacheOf(file, opts.env);
  if (c.entry.caps && c.entry.caps.from === from && c.entry.caps.total === keys.length) return { present: c.entry.caps.present, total: c.entry.caps.total };
  const b = bundle(file);
  let present = 0;
  for (const k of keys) if (b.includes(Buffer.from(k, "utf8"))) present++;
  c.entry.caps = { from, present, total: keys.length };
  save(c);
  return { present, total: keys.length };
}

// ------------------------------------------------------------------- the CLI

function main(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--build") {
      const f = rest[++i];
      if (platformOf(f ?? "") === "android") opts.apk = f;
      else opts.app = f;
    } else if (rest[i] === "--platform") opts.platform = rest[++i];
    else args.push(rest[i]);
  }
  if (cmd === "has" && args.length === 1) {
    const has = buildHas(args[0], opts);
    console.log(has === undefined ? "unknown" : has ? "has" : "lacks");
    return has === undefined ? 2 : has ? 0 : 1;
  }
  if (cmd === "caps" && args.length === 0) {
    const caps = buildCaps(opts);
    console.log(caps ? `${caps.present}/${caps.total}` : "-");
    return caps ? 0 : 2;
  }
  console.error("usage: buildHas.js has <key> [--build <apk | .app>] [--platform ios|android] | caps [--build <file>] [--platform ios|android]");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`buildHas: ${String(err.message).split("\n")[0]}`);
    process.exitCode = 2;
  }
}
