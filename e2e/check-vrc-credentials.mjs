#!/usr/bin/env node
/**
 * Check the VRCs a real-device run issued against the expected shape: context
 * list, issuerScope, Data Integrity proof, hardware-evidence block — and count
 * the verification markers the wallets and the witness logged. Offline: reads
 * artifacts, touches no device, Appium or network. See CHECKS.md.
 *
 * Usage:
 *   node check-vrc-credentials.mjs                          # newest run under artifacts/
 *   node check-vrc-credentials.mjs artifacts/witnessed-logcat-*.txt
 *   node check-vrc-credentials.mjs artifacts/ --expect legacy
 *   node check-vrc-credentials.mjs --self-test              # synthetic fixtures, offline
 *
 * Paths may be files, directories or single-level globs (`*`, `?` in the file
 * name). With none, the newest witnessed-/attestation-logcat dump, the
 * issued-credential-*.json dumps and the run transcript around it are read.
 *
 * Options:
 *   --expect v5|legacy|any   which @context list the peers should have been sent
 *                            (default v5: the hardware-evidence context)
 *   --allow-no-evidence      a VRC with no evidence block is a WARN, not a FAIL
 *   --require-storage A,B    FAIL unless keyStorage is one of these
 *                            (e.g. StrongBox,SecureEnclave)
 *   --strict-markers         a failure marker in the logs (HW:Verify failed, witness
 *                            Identity Check failed, ...) is a FAIL, not a WARN
 *   --allow-empty            do not fail when no credential payload is found
 *   --json <path>            also write the machine-readable summary
 *
 * Exits 0 with no FAIL, 1 on any FAIL, 2 on a usage error.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkArtifacts,
  defaultInputs,
  formatReport,
  resolveInputs,
  toJsonSummary,
} from "./lib/check-vrc-credentials.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function usageError(message) {
  process.stderr.write(`check-vrc-credentials: ${message}\n(see --help)\n`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const opts = { expect: "v5", requireEvidence: true, requireStorage: null, strictMarkers: false, allowEmpty: false };
let jsonPath = null;
let selfTest = false;
const paths = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const value = () => {
    if (i + 1 >= argv.length) usageError(`${a} needs a value`);
    return argv[++i];
  };
  if (a === "--help" || a === "-h") {
    const block = /\/\*\*([\s\S]*?)\*\//.exec(readFileSync(fileURLToPath(import.meta.url), "utf8"));
    process.stdout.write(`${block[1].split("\n").map((l) => l.replace(/^ \* ?/, "")).join("\n").trim()}\n`);
    process.exit(0);
  } else if (a === "--self-test") selfTest = true;
  else if (a === "--expect") {
    opts.expect = value();
    if (!["v5", "legacy", "any"].includes(opts.expect)) usageError(`--expect must be v5, legacy or any (got ${opts.expect})`);
  } else if (a === "--allow-no-evidence") opts.requireEvidence = false;
  else if (a === "--require-storage") opts.requireStorage = value().split(",").map((s) => s.trim()).filter(Boolean);
  else if (a === "--strict-markers") opts.strictMarkers = true;
  else if (a === "--allow-empty") opts.allowEmpty = true;
  else if (a === "--json") jsonPath = value();
  else if (a.startsWith("--")) usageError(`unknown option ${a}`);
  else paths.push(a);
}

if (selfTest) {
  const { runSelfTest } = await import("./lib/check-vrc-credentials.selftest.mjs");
  const { failed } = runSelfTest();
  process.exit(failed.length ? 1 : 0);
}

const files = paths.length ? resolveInputs(paths) : defaultInputs(path.join(here, "artifacts"));
const result = checkArtifacts(files, opts);
console.log(formatReport(result));

if (jsonPath) {
  mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(toJsonSummary(result), null, 2)}\n`);
  console.log(`[check] summary written: ${jsonPath}`);
}
process.exit(result.ok ? 0 : 1);
