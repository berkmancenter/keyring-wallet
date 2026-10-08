/**
 * Logcat capture + credential-check hook shared by the Android device runners.
 *
 * Two problems it solves:
 *  - the runners filter logcat by pattern, and Android splits a log message
 *    over ~4 KB into several entries, so the continuation lines of a long
 *    `[VRC:IssuedCredentialJSON]` payload (which carry no marker) were dropped
 *    and the payload arrived truncated — `filterKeepingContinuations` keeps them;
 *  - a run that issued credentials but captured none passed silently —
 *    `enforceCredentialCheck` runs the offline checker over what was saved and
 *    fails the run (process.exitCode = 1) when the credentials are missing or
 *    wrong. Hardware-verification marker failures stay WARN (no
 *    --strict-markers) unless E2E_VRC_STRICT_MARKERS=1.
 *
 * Env: E2E_VRC_CHECK=off skips the check; E2E_VRC_EXPECT=v5|legacy|any
 * (default v5); E2E_VRC_ALLOW_NO_EVIDENCE=1; E2E_VRC_STRICT_MARKERS=1.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { MARKER, checkArtifacts, extractCredentials, formatReport } from "./check-vrc-credentials.mjs";

const THREADTIME = /^\d\d-\d\d \d\d:\d\d:\d\d\.\d+\s+(\d+)\s+(\d+)\s+[VDIWEF]\s+(.+?)\s*:\s?(.*)$/;

/**
 * Lines of `raw` matching `pattern`, plus — after a line carrying the
 * credential marker — the following lines from the same pid/tid/tag that are
 * continuations of it (not the start of a new `[...]` message).
 */
export function filterKeepingContinuations(raw, pattern) {
  const lines = raw.split("\n");
  const out = [];
  let open = null; // { pid, tid, tag } of the marker line whose payload may continue
  for (const l of lines) {
    const m = THREADTIME.exec(l);
    if (open && m && m[1] === open.pid && m[2] === open.tid && m[3] === open.tag && !/^\[[A-Za-z]/.test(m[4])) {
      out.push(l);
      continue;
    }
    open = null;
    if (pattern.test(l)) {
      out.push(l);
      if (l.includes(MARKER) && m) open = { pid: m[1], tid: m[2], tag: m[3] };
    }
  }
  return out;
}

/**
 * Write one `issued-credential-<udid>-<side>-<n>.json` per readable credential
 * payload in `text`. Returns the written file paths.
 */
export function saveIssuedCredentialFiles(udid, text, dir = "artifacts") {
  mkdirSync(dir, { recursive: true });
  const written = [];
  let n = 0;
  for (const entry of extractCredentials(text, `logcat-${udid}`)) {
    if (entry.status !== "ok") continue;
    const side = entry.side || "unknown";
    const file = `${dir}/issued-credential-${udid}-${side}-${n++}.json`;
    writeFileSync(file, JSON.stringify(entry.credential, null, 2));
    written.push(file);
  }
  return written;
}

/** Save the unfiltered ReactNativeJS lines beside the filtered dump (diagnosis). */
export function saveReactNativeJsLines(udid, raw, dir = "artifacts") {
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/rnjs-logcat-${udid}-${Date.now()}.txt`;
  writeFileSync(file, raw.split("\n").filter((l) => /ReactNativeJS/.test(l)).join("\n"));
  return file;
}

/** Checker options for a device run, from the environment. */
export function checkOptionsFromEnv(env = process.env) {
  return {
    expect: env.E2E_VRC_EXPECT || "v5",
    requireEvidence: env.E2E_VRC_ALLOW_NO_EVIDENCE !== "1",
    requireStorage: ["StrongBox", "TEE", "SecureEnclave"],
    strictMarkers: env.E2E_VRC_STRICT_MARKERS === "1",
    allowEmpty: false,
  };
}

/**
 * Run the checker over the files a dump just wrote. Sets process.exitCode = 1
 * and prints the report when a requirement fails. On a run that has already
 * failed (exitCode 1) the report is informational: an empty capture is not
 * added as a second failure. Returns the checker result (or null when off).
 */
export function enforceCredentialCheck(files, env = process.env) {
  if (env.E2E_VRC_CHECK === "off") {
    console.log("[e2e] VRC credential check skipped (E2E_VRC_CHECK=off)");
    return null;
  }
  const runAlreadyFailed = process.exitCode === 1;
  const opts = { ...checkOptionsFromEnv(env), allowEmpty: runAlreadyFailed };
  const result = checkArtifacts(files, opts);
  console.log(`\n[e2e] ---- VRC credential check ----\n${formatReport(result)}`);
  if (!result.ok) {
    console.error(
      "\n[e2e] ❌ VRC CREDENTIAL CHECK FAILED — the harness flow passed but the issued credentials " +
        "are missing or do not match the expected shape (see report above; e2e/CHECKS.md). " +
        `Rerun the checker offline: node check-vrc-credentials.mjs ${files.join(" ")}`
    );
    process.exitCode = 1;
  }
  return result;
}

/**
 * True when the log carries an actual hardware-verification PASS on the
 * receiving wallet: `[HW:Verify] ✓ Native verification passed [...]` (native
 * verifier, hardware-signing/verify.ts) or the `[VRC:Verify]` equivalent
 * (BiometricSignatureVerifier). An attempt line (`▶ Verifying`) or a
 * `✗ Native verification failed` line is not a pass.
 */
export function hwVerifiedMarkerSeen(log) {
  return /\[(?:HW|VRC):Verify\] ✓ Native verification passed/.test(log ?? "");
}

/** E2E_REQUIRE_HW_VERIFIED=1: the Secure Exchange assertions require an actual verify pass. */
export function requireHwVerified(env = process.env) {
  return env.E2E_REQUIRE_HW_VERIFIED === "1";
}
