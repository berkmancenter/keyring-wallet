#!/usr/bin/env node
// ref-07h-vsc-credo-suites — plan §5: "sign and verify a VSC through Credo 0.7
// with our patch set, under both suites we actually ship (Ed25519Signature2018
// and eddsa-rdfc-2022), and assert the D6 check against a credential Credo
// verified rather than one the rung signed itself."
//
// Bootstraps the repo's patched @credo-ts/core into this rung's own
// node_modules BEFORE any ESM import touches it (see ensurePatchedCore below
// and the README) — imports are hoisted, so the fixup and the Credo-touching
// code must live in separate files.
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const PATCH_MARKER = "verifyCredentialSubjectAuthentication";
const QUIET = process.argv.includes("--quiet");
const say = (...a) => {
  if (!QUIET) console.log(...a);
};

function coreIsPatched(coreDir) {
  const buildDir = path.join(coreDir, "build");
  if (!fs.existsSync(buildDir)) return false;
  try {
    execSync(`grep -rl "${PATCH_MARKER}" "${buildDir}"`, { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function ensurePatchedCore() {
  const localCore = path.join(__dirname, "node_modules/@credo-ts/core");
  const rootCore = path.join(REPO_ROOT, "node_modules/@credo-ts/core");
  if (!fs.existsSync(rootCore)) {
    throw new Error(
      `Expected the workspace's patched @credo-ts/core at ${rootCore} — run "yarn install" at the repo root first.`
    );
  }
  if (!coreIsPatched(rootCore)) {
    throw new Error(
      `${rootCore} does not contain the patch marker ("${PATCH_MARKER}") — the repo's .yarn/patches/@credo-ts-core-*.patch may not have applied. This rung specifically tests "Credo 0.7 with our patch set" (plan §5); it must not silently run against stock Credo.`
    );
  }
  if (coreIsPatched(localCore)) {
    say("  (this rung's @credo-ts/core is already the patched build)");
    return;
  }
  say("  (copying the workspace's patched @credo-ts/core into this rung's node_modules — one-time)");
  fs.rmSync(localCore, { recursive: true, force: true });
  fs.cpSync(rootCore, localCore, { recursive: true, dereference: true });
  if (!coreIsPatched(localCore)) {
    throw new Error("Copy completed but the copy still lacks the patch marker — something is wrong with the copy step.");
  }
}

say("── ref-07h: VSC through Credo 0.7's real proof-suite path ──\n");
ensurePatchedCore();

const { main } = await import("./main.mjs");
await main({ say, QUIET });
