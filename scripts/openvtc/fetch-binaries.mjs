#!/usr/bin/env node
// fetch-binaries.mjs — download.firstperson.dev prebuilt binaries (vta, pnm,
// mediator, did-hosting-daemon, vtc, openvtc), pinned by BINARY_PINS.json.
//
// Sibling to sync-external.mjs/setup-external.mjs, but for prebuilt binaries
// rather than git-cloned source: that server has no versioned-artifact URLs,
// only 'latest' (newest tagged release) / 'main' (newest compiled commit)
// moving pointers, plus a named release *channel* for the pnm/openvtc client
// builds. So "pinning" here means recording the last verified version for
// drift detection, not freezing a re-fetchable historical URL — advancing a
// pin means "we verified a newer build", never "roll back to an old one".
//
// Policy: only pinned builds reach the cache (see binaryPolicy.mjs). A binary
// in the local pinned snapshot is copied from there; any other is downloaded
// and cached only if its sha256 equals the pin. A moving latest/main build is
// refused unless --latest (or FETCH_BINARIES_ALLOW_LATEST=1) opts in. The pin
// file only changes on an explicit --advance.
//
//   node scripts/openvtc/fetch-binaries.mjs                 → fetch + verify every pinned binary into external/bin/
//   node scripts/openvtc/fetch-binaries.mjs vta pnm-server   → fetch + verify only the named binaries
//   node scripts/openvtc/fetch-binaries.mjs --latest         → cache whatever latest/main serves, drift reported
//   node scripts/openvtc/fetch-binaries.mjs --check          → probe latest/current without touching the cache
//   node scripts/openvtc/fetch-binaries.mjs --status         → report the cache's state, no network
//   node scripts/openvtc/fetch-binaries.mjs --advance vta --why "reason"
//                                                             → re-fetch, update BINARY_PINS.json, append the log
//
// FETCH_BINARIES_PINS_DIR names the pinned snapshot (default DEFAULT_PINS_DIR).
//
// Exit code 1 if any binary drifted from its pin, was refused, or failed to
// fetch/verify — same convention as sync-external.mjs's tripwires.

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allowLatest, DEFAULT_PINS_DIR, downloadVerdict, parseManifest, SNAPSHOT_NAMES } from "./binaryPolicy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
// The overrides exist for fetch-binaries.test.mjs.
const binDir = process.env.FETCH_BINARIES_BIN_DIR || join(repoRoot, "external", "bin");
const pinsPath = process.env.FETCH_BINARIES_PINS_FILE || join(here, "BINARY_PINS.json");
const logPath = join(here, "BINARY_PINS_LOG.md");

const DOWNLOAD_ORIGIN = process.env.FETCH_BINARIES_ORIGIN || "https://download.firstperson.dev";

const args = process.argv.slice(2);
const STATUS_ONLY = args.includes("--status");
const CHECK_ONLY = args.includes("--check");
const LATEST = allowLatest(args, process.env);
const snapshotDir = process.env.FETCH_BINARIES_PINS_DIR || DEFAULT_PINS_DIR;
const advanceIdx = args.indexOf("--advance");
const advanceName = advanceIdx >= 0 ? args[advanceIdx + 1] : null;
const whyIdx = args.indexOf("--why");
const advanceWhy = whyIdx >= 0 ? args[whyIdx + 1] : null;
const explicitNames = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--advance" && args[i - 1] !== "--why");

const pins = JSON.parse(readFileSync(pinsPath, "utf8"));

function resolveUrl(binary, def) {
  if (def.urlPath) return `${DOWNLOAD_ORIGIN}/${def.urlPath}`;
  if (def.urlPathTemplate) {
    const os = platform() === "darwin" ? "macOS" : "x86";
    const path = def.urlPathTemplate.replace("{channel}", pins.releaseChannel).replace("{os}", os);
    return `${DOWNLOAD_ORIGIN}/${path}`;
  }
  throw new Error(`${binary}: no urlPath or urlPathTemplate in BINARY_PINS.json`);
}

async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  chmodSync(dest, 0o755);
  return buf;
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Best-effort human-readable version — NOT the drift signal (see below), just
 * a friendlier label in reports/pins when a binary happens to support it.
 * Not every binary here does: `vta --version` works, but `pnm`'s clap CLI has
 * no top-level --version at all (only a version banner on real subcommands,
 * which need network/state to invoke safely) — verified empirically, so this
 * silently returns null there rather than guessing at a workaround.
 */
function readVersion(binaryPath) {
  try {
    return execFileSync(binaryPath, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .split(/\s+/)
      .pop();
  } catch {
    return null;
  }
}

/**
 * Fetch and report on one binary. The drift signal is the content sha256 —
 * uniform across every binary here, unlike --version (see readVersion) — so
 * `pinnedSha256` is what --advance actually updates; `pinnedVersion` just
 * rides along as a label when the download happens to report one.
 */
async function fetchAndVerify(name, def, { toCache }) {
  const url = resolveUrl(name, def);
  const tmp = join(mkdtempSync(join(tmpdir(), "fetch-binaries-")), name);
  try {
    const buf = await downloadTo(url, tmp);
    const sha256 = sha256Hex(buf);
    const version = readVersion(tmp);
    const cache = typeof toCache === "function" ? toCache(sha256) : toCache;
    if (cache) copyFileSync(tmp, join(binDir, name));
    return { url, sha256, version, cached: cache };
  } finally {
    rmSync(dirname(tmp), { recursive: true, force: true });
  }
}

/** The pinned snapshot's copy of `name`, or null when the snapshot doesn't carry it. */
function snapshotEntry(name) {
  const file = SNAPSHOT_NAMES[name];
  const manifest = join(snapshotDir, "MANIFEST.tsv");
  if (!file || !existsSync(manifest)) return null;
  const entry = parseManifest(readFileSync(manifest, "utf8")).get(file);
  return entry ? { ...entry, path: join(snapshotDir, file) } : null;
}

/** Copies a pinned snapshot binary into the cache once its bytes match the manifest. */
function installFromSnapshot(name, entry) {
  const sha256 = existsSync(entry.path) ? sha256Hex(readFileSync(entry.path)) : null;
  if (sha256 !== entry.sha256) {
    console.log(`  ! ${name.padEnd(20)} REFUSED: ${entry.path} is ${sha256 ? `sha256:${sha256.slice(0, 12)}` : "missing"}, its manifest says ${entry.sha256.slice(0, 12)}`);
    return 1;
  }
  copyFileSync(entry.path, join(binDir, name));
  chmodSync(join(binDir, name), 0o755);
  console.log(`  ✓ ${name.padEnd(20)} ${entry.version} (${sha256.slice(0, 12)}) from pinned ${snapshotDir}`);
  return 0;
}

function report(name, def, { url, sha256, version, cached }) {
  const label = version ? `${version} (${sha256.slice(0, 12)})` : `sha256:${sha256.slice(0, 12)}`;
  const { status } = downloadVerdict({ sha256, pinnedSha256: def.pinnedSha256, latest: LATEST });
  const refused = CHECK_ONLY || cached ? "" : " — REFUSED, not cached (--latest to take it anyway)";
  if (status === "unpinned") {
    console.log(`  ? ${name.padEnd(20)} fetched ${label} — no pin recorded yet (never verified)${refused}`);
    return refused ? 1 : 0;
  }
  if (status === "match") {
    console.log(`  ✓ ${name.padEnd(20)} ${label} (matches pin, ${def.pinnedOn})`);
    return 0;
  }
  console.log(`  ▲ ${name.padEnd(20)} pin ${(def.pinnedVersion ?? def.pinnedSha256.slice(0, 12))} (${def.pinnedOn}) → latest ${label}  DRIFT${refused}`);
  console.log(`      url: ${url}`);
  return 1;
}

async function main() {
  const names = explicitNames.length ? explicitNames : Object.keys(pins.binaries);
  for (const n of names) {
    if (!pins.binaries[n]) {
      console.error(`unknown binary "${n}". Known: ${Object.keys(pins.binaries).join(", ")}`);
      process.exit(2);
    }
  }

  console.log(`\n=== fetch-binaries · ${new Date().toISOString().slice(0, 10)} ===`);
  console.log(`pins last updated: ${pins.updated} · release channel: ${pins.releaseChannel}\n`);

  if (STATUS_ONLY) {
    let problems = 0;
    for (const name of names) {
      const def = pins.binaries[name];
      const cached = join(binDir, name);
      if (!existsSync(cached)) {
        console.log(`  ✗ ${name.padEnd(20)} not cached (run without --status to fetch)`);
        problems++;
        continue;
      }
      const version = readVersion(cached);
      const sha256 = sha256Hex(readFileSync(cached));
      const label = version ? `${version} (${sha256.slice(0, 12)})` : `sha256:${sha256.slice(0, 12)}`;
      if (def.pinnedSha256 && sha256 !== def.pinnedSha256) {
        console.log(`  ~ ${name.padEnd(20)} cached ${label}, pin is ${def.pinnedVersion ?? def.pinnedSha256.slice(0, 12)}`);
        problems++;
      } else {
        console.log(`  ✓ ${name.padEnd(20)} ${label}`);
      }
    }
    console.log(`\n=== status done · ${problems} problem(s) ===`);
    process.exit(problems > 0 ? 1 : 0);
  }

  if (advanceName) {
    const def = pins.binaries[advanceName];
    if (!def) {
      console.error(`--advance: unknown binary "${advanceName}". Known: ${Object.keys(pins.binaries).join(", ")}`);
      process.exit(2);
    }
    if (!advanceWhy) {
      console.error(`--advance requires --why "reason"`);
      process.exit(2);
    }
    mkdirSync(binDir, { recursive: true });
    const beforeLabel = def.pinnedVersion ?? (def.pinnedSha256 ? def.pinnedSha256.slice(0, 12) : "(unpinned)");
    const { url, sha256, version } = await fetchAndVerify(advanceName, def, { toCache: true });
    const afterLabel = version ?? sha256.slice(0, 12);
    def.pinnedSha256 = sha256;
    def.pinnedVersion = version; // may be null (e.g. pnm-family) — that's fine, sha256 is the real signal
    def.pinnedOn = new Date().toISOString().slice(0, 10);
    def.why = advanceWhy;
    pins.updated = def.pinnedOn;
    writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + "\n");
    appendFileSync(
      logPath,
      `\n- **${def.pinnedOn}** · \`${advanceName}\` ${beforeLabel} → ${afterLabel} — ${advanceWhy}. (${url})`,
    );
    console.log(`ADVANCED ${advanceName}: ${beforeLabel} → ${afterLabel}. BINARY_PINS.json + BINARY_PINS_LOG.md updated.`);
    process.exit(0);
  }

  mkdirSync(binDir, { recursive: true });
  if (!CHECK_ONLY) console.log(LATEST ? "LATEST opted in: moving builds are cached even when they drift.\n" : `pinned only · snapshot ${snapshotDir}\n`);
  let problems = 0;
  for (const name of names) {
    const def = pins.binaries[name];
    try {
      const snap = CHECK_ONLY || LATEST ? null : snapshotEntry(name);
      if (snap) {
        problems += installFromSnapshot(name, snap);
        continue;
      }
      const toCache = CHECK_ONLY
        ? false
        : (sha256) => downloadVerdict({ sha256, pinnedSha256: def.pinnedSha256, latest: LATEST }).cache;
      const result = await fetchAndVerify(name, def, { toCache });
      problems += report(name, def, result);
    } catch (e) {
      console.log(`  ! ${name.padEnd(20)} FAILED: ${e.message}`);
      problems++;
    }
  }

  console.log(`\n=== ${CHECK_ONLY ? "check" : "fetch"} done · ${problems} problem(s) ===`);
  if (!CHECK_ONLY) {
    console.log(`Binaries cached in ${binDir} — e2e/lib/vta.js's VTA_BIN defaults to the cached vta if present.`);
  }
  process.exit(problems > 0 ? 1 : 0);
}

main();
