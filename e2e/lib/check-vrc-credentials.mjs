/**
 * Offline checker for the VRCs a device run issued: reads the
 * `[VRC:IssuedCredentialJSON]` lines out of logcat artifacts (or the
 * per-credential JSON dumps the devices runner writes) and asserts the
 * credential shape the wallet is meant to emit — the context list, the
 * `issuerScope`, the Data Integrity proof and the hardware-evidence block.
 *
 * Pure Node, no dependencies, nothing imported from the harness: it never
 * touches a device, Appium or the network, so it can run while a run is in
 * flight and long after. The CLI is ../check-vrc-credentials.mjs; the usage,
 * expected values and verdict meanings are in ../CHECKS.md.
 *
 * Verdicts: FAIL (a requirement is not met), WARN (suspicious, or a check
 * could not be completed), INFO (recorded, never affects the exit code),
 * PASS. A credential's verdict is the worst of its findings.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// ---------- constants (mirrors of bifold/packages/vrc-contexts; see CHECKS.md) ----------

export const CTX_V2 = "https://www.w3.org/ns/credentials/v2";
export const CTX_V1 = "https://www.w3.org/2018/credentials/v1";
export const CTX_REGISTRY = "https://registry.trustoverip.org/dtg/context/v1";
export const CTX_HARDWARE_EVIDENCE = "https://www.firstperson.network/hardware-evidence/v1";
export const CTX_DTG_LEGACY = "https://www.firstperson.network/dtg/v1";
const CTX_ED25519_2018 = "https://w3id.org/security/suites/ed25519-2018/v1";

export const EXPECTED_CONTEXTS = {
  v5: [CTX_V2, CTX_REGISTRY, CTX_HARDWARE_EVIDENCE],
  legacy: [CTX_V2, CTX_REGISTRY, CTX_DTG_LEGACY],
};

export const MARKER = "[VRC:IssuedCredentialJSON]";

const KEY_STORAGE = ["SecureEnclave", "StrongBox", "TEE", "Software", "Unknown"];
const HARDWARE_STORAGE = ["SecureEnclave", "StrongBox", "TEE"];
const ATTESTATION_FORMATS = { android: "android-key-attestation-v3", ios: "apple-appattest-v1" };

// Members the VC 2.0 VRC builder can emit (vrc-manager.ts) plus the ones the
// credential record adds on the way through Credo.
const KNOWN_TOP_LEVEL = new Set([
  "@context",
  "id",
  "type",
  "issuer",
  "issuerScope",
  "validFrom",
  "validUntil",
  "credentialSubject",
  "evidence",
  "proof",
]);
// The evidence context scopes exactly these terms to HardwareKeyAttestation
// (hardwareEvidenceContext.ts); `id` and `type` are JSON-LD keywords.
const KNOWN_EVIDENCE = new Set([
  "id",
  "type",
  "created",
  "authenticationMethod",
  "biometricMethod",
  "hardwareBinding",
  "attestation",
  "signature",
]);

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const PEM_PLACEHOLDER = /^<PEM #(\d+): (\d+) chars>$/;
const OMITTED_PLACEHOLDER = /^<omitted \d+ chars>$/;

// ---------- extraction ----------

// `adb logcat -d` threadtime: "09-29 09:07:01.541 31346 31442 D ReactNativeJS: msg"
const THREADTIME = /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.+?)\s*:\s?(.*)$/;

function parseLogLine(line) {
  const m = THREADTIME.exec(line);
  if (!m) return null;
  return { pid: m[2], tid: m[3], level: m[4], tag: m[5], message: m[6] };
}

/**
 * Scan the JSON object starting at `start` (a `{`). Returns the index one
 * past its closing brace, or -1 when the text ends first — i.e. truncated.
 */
export function scanJsonObject(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Every `[VRC:IssuedCredentialJSON]` payload in one artifact's text. Each
 * entry is { source, line, side, exchange, record, status, credential?, error? }
 * with status "ok", "truncated" or "unparsable" — a payload that cannot be read
 * is reported as such, never skipped.
 *
 * A file that is itself one JSON object (the issued-credential-*.json dumps)
 * is taken whole. Otherwise the marker is found on each line, after whatever
 * logcat prefix precedes it. If the JSON does not close on the marker's line,
 * following lines from the same pid/tid/tag are appended (a logger that splits
 * a long message into entries); if it still does not close, the payload was
 * cut off and is reported as truncated.
 */
export function extractCredentials(text, source) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && !trimmed.includes(MARKER)) {
    try {
      const credential = JSON.parse(trimmed);
      const side = (/-(INVITER|RECEIVER)-/.exec(source) || [])[1] || "unknown";
      return [{ source, line: 1, side, exchange: "", record: "", status: "ok", credential }];
    } catch (e) {
      return [{ source, line: 1, side: "unknown", exchange: "", record: "", status: "unparsable", error: e.message }];
    }
  }

  const lines = text.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].indexOf(MARKER);
    if (at < 0) continue;
    const head = parseLogLine(lines[i]);
    let payload = lines[i].slice(at + MARKER.length).trim();
    const entry = { source, line: i + 1, side: "unknown", exchange: "", record: "", status: "ok" };
    const meta = payload.slice(0, Math.max(payload.indexOf("{"), 0));
    entry.side = (/side=(\w+)/.exec(meta) || [])[1] || "unknown";
    entry.exchange = (/exchange=(\S+)/.exec(meta) || [])[1] || "";
    entry.record = (/record=(\S+)/.exec(meta) || [])[1] || "";

    const jsonStart = payload.indexOf("{");
    if (jsonStart < 0) {
      found.push({ ...entry, status: "unparsable", error: "no JSON object after the marker" });
      continue;
    }
    let end = scanJsonObject(payload, jsonStart);
    let continued = 0;
    if (end < 0 && head) {
      for (let j = i + 1; j < lines.length && j <= i + 60 && end < 0; j++) {
        const next = parseLogLine(lines[j]);
        if (!next || next.pid !== head.pid || next.tid !== head.tid || next.tag !== head.tag) continue;
        if (/^\[[A-Za-z]/.test(next.message)) break; // the next log message, not a continuation
        payload += next.message;
        continued++;
        end = scanJsonObject(payload, jsonStart);
      }
    }
    if (end < 0) {
      found.push({
        ...entry,
        status: "truncated",
        error:
          `JSON object never closes (${payload.length - jsonStart} chars read` +
          `${continued ? `, ${continued} continuation lines joined` : ""}); ` +
          "logcat cuts a line at ~4 KB, or an artifact filter dropped the continuation",
      });
      continue;
    }
    try {
      found.push({ ...entry, credential: JSON.parse(payload.slice(jsonStart, end)) });
    } catch (e) {
      found.push({ ...entry, status: "unparsable", error: e.message });
    }
  }
  return found;
}

// ---------- the credential checks ----------

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v.length > 0;
const isDid = (v) => typeof v === "string" && /^did:[a-z0-9]+:.+/.test(v);
const isIso = (v) => typeof v === "string" && ISO_8601.test(v) && !Number.isNaN(Date.parse(v));
const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Check one parsed credential. Returns { kind, findings, keyStorage, chainLength, contextList }.
 * `kind` is "vrc" (RelationshipCredential) or "other" (a credential the same
 * marker logged that is not a VRC — a VWC or card — recorded and not judged).
 * opts: { expect: "v5" | "legacy" | "any", requireEvidence: boolean, requireStorage?: string[] }
 */
export function checkCredential(credential, opts = {}) {
  const { expect = "v5", requireEvidence = true, requireStorage = null } = opts;
  const findings = [];
  const add = (level, code, message) => findings.push({ level, code, message });
  const out = { kind: "vrc", findings, keyStorage: null, chainLength: null, contextList: null };

  if (!isObject(credential)) {
    add("FAIL", "shape", "credential is not a JSON object");
    return out;
  }

  const types = Array.isArray(credential.type) ? credential.type : [credential.type];
  if (!types.includes("RelationshipCredential")) {
    out.kind = "other";
    add("INFO", "not-a-vrc", `not a RelationshipCredential (type ${JSON.stringify(credential.type)}); not judged`);
    return out;
  }

  // -- @context
  const ctx = credential["@context"];
  out.contextList = ctx;
  const vc11 = Array.isArray(ctx) && ctx[0] === CTX_V1;
  const vc20 = Array.isArray(ctx) && ctx[0] === CTX_V2;
  if (vc11) {
    // The VCDM 1.1 VRC is what a peer below RCE v3 receives. No registry
    // context, no issuerScope, no evidence context: none of the checks below apply.
    if (expect === "v5") {
      add("FAIL", "vc11-in-v5", "VCDM 1.1 VRC, but every peer is expected to be RCE v3+ (a VC 2.0 VRC with issuerScope and a DI proof)");
    } else {
      add("INFO", "vc11", "VCDM 1.1 VRC (peer below RCE v3); the VC 2.0 checks do not apply");
    }
    return out;
  }
  if (!vc20) {
    add("FAIL", "context-base", `@context does not start with ${CTX_V2} or ${CTX_V1}: ${JSON.stringify(ctx)}`);
    return out;
  }

  const isV5 = sameList(ctx, EXPECTED_CONTEXTS.v5);
  const isLegacy = sameList(ctx, EXPECTED_CONTEXTS.legacy);
  if (ctx.includes(CTX_ED25519_2018)) {
    add("FAIL", "context-ed25519-2018", "the Ed25519Signature2018 suite context is listed; a VC 2.0 VRC is DI-only now");
  } else if (isV5 && (expect === "v5" || expect === "any")) {
    add("PASS", "context", "@context is [credentials/v2, registry v1, hardware-evidence v1]");
  } else if (isLegacy && expect === "legacy") {
    add("PASS", "context", "@context is [credentials/v2, registry v1, legacy DTG v1] (as expected for pre-v5 peers)");
  } else if (isLegacy && expect === "any") {
    add("INFO", "context", "@context is [credentials/v2, registry v1, legacy DTG v1] (legacy mode, accepted by --expect any)");
  } else if (isLegacy) {
    add(
      "FAIL",
      "context-legacy-in-v5",
      "@context carries the legacy DTG context (https://www.firstperson.network/dtg/v1) where the v5 hardware-evidence " +
        "context is expected: either the counterparty did not announce RCE v5 (the v5 gate sent the legacy list), or the " +
        "wallet did not pick the new context. Expected for a pre-v5 peer; pass --expect legacy or --expect any for such a run"
    );
  } else if (isV5 && expect === "legacy") {
    add(
      "FAIL",
      "context-v5-in-legacy",
      "@context carries the hardware-evidence context, but peers are expected to be pre-v5: a wallet that does not " +
        "bundle it resolves the IRI over the network and gets a 404 HTML body (plan 2026-09-30 §3.5)"
    );
  } else {
    add(
      "FAIL",
      "context",
      `@context is not the expected list (${JSON.stringify(EXPECTED_CONTEXTS[expect === "legacy" ? "legacy" : "v5"])}): ${JSON.stringify(ctx)}`
    );
  }

  // -- type, issuerScope, issuer, dates
  for (const t of ["VerifiableCredential", "DTGCredential", "RelationshipCredential"]) {
    if (!types.includes(t)) add("FAIL", "type", `type does not include ${t}: ${JSON.stringify(credential.type)}`);
  }
  if (credential.issuerScope === "pairwise") add("PASS", "issuerScope", "issuerScope is pairwise");
  else add("FAIL", "issuerScope", `issuerScope is ${JSON.stringify(credential.issuerScope)}, expected "pairwise" (G32)`);

  if (isDid(credential.issuer)) add("PASS", "issuer", "issuer is a DID string");
  else add("FAIL", "issuer", `issuer is not a DID string: ${JSON.stringify(credential.issuer)}`);

  if (isIso(credential.validFrom)) add("PASS", "validFrom", "validFrom present");
  else add("FAIL", "validFrom", `validFrom missing or not ISO 8601: ${JSON.stringify(credential.validFrom)}`);

  if (!isObject(credential.credentialSubject) || !isDid(credential.credentialSubject.id)) {
    add("WARN", "subject", "credentialSubject.id is not a DID string");
  }

  // -- proof
  const proof = credential.proof;
  if (!isObject(proof)) {
    add("FAIL", "proof", `proof is missing or not a single object: ${JSON.stringify(proof)?.slice(0, 80)}`);
  } else {
    if (proof.type === "DataIntegrityProof" && proof.cryptosuite === "eddsa-rdfc-2022") {
      add("PASS", "proof", "proof is DataIntegrityProof / eddsa-rdfc-2022");
    } else {
      add(
        "FAIL",
        "proof",
        `proof is type=${JSON.stringify(proof.type)} cryptosuite=${JSON.stringify(proof.cryptosuite)}, ` +
          "expected DataIntegrityProof / eddsa-rdfc-2022 (G32: no VC 2.0 VRC may carry Ed25519Signature2018)"
      );
    }
    if (proof.proofPurpose !== "assertionMethod") {
      add("WARN", "proofPurpose", `proof.proofPurpose is ${JSON.stringify(proof.proofPurpose)}, expected "assertionMethod"`);
    }
    if (!isNonEmptyString(proof.verificationMethod) || !isNonEmptyString(proof.proofValue)) {
      add("WARN", "proof-members", "proof lacks verificationMethod or proofValue");
    }
  }

  // -- unknown top-level members
  for (const key of Object.keys(credential)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      add("WARN", "unknown-member", `unknown top-level member "${key}" (outside the declared contexts; safe-mode signing would have rejected a typo)`);
    }
  }

  // -- evidence
  checkEvidence(credential.evidence, { requireEvidence, requireStorage, add, out });
  return out;
}

function checkEvidence(evidence, { requireEvidence, requireStorage, add, out }) {
  if (evidence === undefined) {
    add(
      requireEvidence ? "FAIL" : "WARN",
      "evidence-missing",
      "no evidence block: the VRC was issued without hardware attestation (emulator, biometric declined, or attestation unavailable)"
    );
    return;
  }
  if (!Array.isArray(evidence) || evidence.length !== 1) {
    add("FAIL", "evidence-shape", `evidence must be a one-element array, got ${Array.isArray(evidence) ? `${evidence.length} elements` : typeof evidence}`);
    return;
  }
  const ev = evidence[0];
  if (!isObject(ev)) {
    add("FAIL", "evidence-shape", "evidence[0] is not an object");
    return;
  }

  const evTypes = Array.isArray(ev.type) ? ev.type : [ev.type];
  const hasHardware = evTypes.includes("HardwareKeyAttestation");
  const hasAuth = evTypes.includes("BiometricAttestation") || evTypes.includes("DeviceAuthentication");
  if (hasHardware && hasAuth) add("PASS", "evidence-type", `evidence type ${JSON.stringify(ev.type)}`);
  else add("FAIL", "evidence-type", `evidence type must include HardwareKeyAttestation and BiometricAttestation|DeviceAuthentication: ${JSON.stringify(ev.type)}`);

  if (typeof ev.id === "string" && /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ev.id)) {
    add("PASS", "evidence-id", "evidence.id is a urn:uuid");
  } else {
    add("FAIL", "evidence-id", `evidence.id is not a urn:uuid: ${JSON.stringify(ev.id)}`);
  }
  if (!isIso(ev.created)) add("FAIL", "evidence-created", `evidence.created missing or not ISO 8601: ${JSON.stringify(ev.created)}`);

  if (!isObject(ev.authenticationMethod) || !isNonEmptyString(ev.authenticationMethod.type)) {
    add("FAIL", "authenticationMethod", "evidence.authenticationMethod.type missing");
  } else {
    const passcode = ev.authenticationMethod.type === "DevicePasscode";
    if (passcode !== evTypes.includes("DeviceAuthentication")) {
      add("WARN", "authenticationMethod", `authenticationMethod.type ${ev.authenticationMethod.type} does not match evidence type ${JSON.stringify(ev.type)}`);
    }
  }

  for (const key of Object.keys(ev)) {
    if (!KNOWN_EVIDENCE.has(key)) {
      add("WARN", "unknown-evidence-member", `unknown evidence member "${key}" (not a term in the hardware-evidence context; safe-mode signing would have rejected a typo)`);
    }
  }

  // hardwareBinding
  const hb = ev.hardwareBinding;
  let platform = null;
  if (!isObject(hb)) {
    add("FAIL", "hardwareBinding", "evidence.hardwareBinding missing");
  } else {
    if (!KEY_STORAGE.includes(hb.keyStorage)) {
      add("FAIL", "keyStorage", `hardwareBinding.keyStorage ${JSON.stringify(hb.keyStorage)} is not one of ${KEY_STORAGE.join("|")}`);
    } else {
      out.keyStorage = hb.keyStorage;
      if (hb.keyStorage === "StrongBox" || hb.keyStorage === "SecureEnclave") {
        add("INFO", "keyStorage", `key storage is ${hb.keyStorage}`);
      } else {
        add("INFO", "keyStorage", `key storage is ${hb.keyStorage}, not StrongBox/SecureEnclave`);
      }
      if (requireStorage && !requireStorage.includes(hb.keyStorage)) {
        add("FAIL", "keyStorage-required", `key storage ${hb.keyStorage} is not in the required set ${requireStorage.join("|")}`);
      }
    }
    if (hb.platform === "android" || hb.platform === "ios") platform = hb.platform;
    else add("FAIL", "platform", `hardwareBinding.platform ${JSON.stringify(hb.platform)} is not android|ios`);
    for (const k of ["keyType", "algorithm", "publicKey"]) {
      if (!isNonEmptyString(hb[k])) add("FAIL", "hardwareBinding", `hardwareBinding.${k} missing or not a string`);
    }
    if (hb.keyType !== undefined && hb.keyType !== "EC-P256") add("WARN", "keyType", `hardwareBinding.keyType is ${JSON.stringify(hb.keyType)}, the wallet emits EC-P256`);
    if (hb.algorithm !== undefined && hb.algorithm !== "ECDSA-SHA256") add("WARN", "algorithm", `hardwareBinding.algorithm is ${JSON.stringify(hb.algorithm)}, the wallet emits ECDSA-SHA256`);
  }

  // attestation
  const att = ev.attestation;
  if (!isObject(att)) {
    add("FAIL", "attestation", "evidence.attestation missing");
  } else {
    const formats = Object.values(ATTESTATION_FORMATS);
    if (!formats.includes(att.format)) {
      add("FAIL", "attestation-format", `attestation.format ${JSON.stringify(att.format)} is not one of ${formats.join("|")}`);
    } else if (platform && ATTESTATION_FORMATS[platform] !== att.format) {
      add("FAIL", "attestation-format", `attestation.format ${att.format} does not match platform ${platform}`);
    }
    if (!Array.isArray(att.certificateChain)) {
      add("FAIL", "certificateChain", "attestation.certificateChain is not an array");
    } else {
      const chain = att.certificateChain;
      out.chainLength = chain.length;
      const bad = chain.findIndex((c) => !isNonEmptyString(c));
      if (bad >= 0) {
        add("FAIL", "certificateChain", `certificateChain[${bad}] is not a non-empty string`);
      }
      // A chain the log redaction replaced keeps its order: "<PEM #1: N chars>", "#2", ...
      const placeholders = chain.map((c) => PEM_PLACEHOLDER.exec(String(c)));
      placeholders.forEach((m, i) => {
        if (m && Number(m[1]) !== i + 1) add("FAIL", "certificateChain", `placeholder at index ${i} is numbered #${m[1]}, expected #${i + 1}`);
      });
      if (chain.length === 0) {
        if (HARDWARE_STORAGE.includes(out.keyStorage)) {
          add("FAIL", "certificateChain", `empty certificateChain with ${out.keyStorage} key storage: hardware-backed but nothing to attest it`);
        } else {
          add("WARN", "certificateChain", `empty certificateChain (key storage ${out.keyStorage ?? "unknown"})`);
        }
      } else if (bad < 0) {
        add("PASS", "certificateChain", `certificateChain has ${chain.length} certificate(s)`);
      }
    }
  }

  // signature
  const sig = ev.signature;
  if (!isObject(sig) || !isNonEmptyString(sig.value) || !isNonEmptyString(sig.algorithm)) {
    add("FAIL", "evidence-signature", "evidence.signature needs a value and an algorithm");
  } else if (sig.signedContentHash !== undefined && !isNonEmptyString(sig.signedContentHash)) {
    add("FAIL", "evidence-signature", "evidence.signature.signedContentHash is present but not a string");
  } else if (sig.value.length <= 4 && !OMITTED_PLACEHOLDER.test(sig.value)) {
    add("WARN", "evidence-signature", `evidence.signature.value is implausibly short (${sig.value.length} chars)`);
  }
}

/** Worst level in a findings list: FAIL > WARN > PASS. INFO does not count. */
export function verdictOf(findings) {
  if (findings.some((f) => f.level === "FAIL")) return "FAIL";
  if (findings.some((f) => f.level === "WARN")) return "WARN";
  return "PASS";
}

// ---------- log markers ----------

/**
 * Lines that show verification or issuance outcomes at the receiving wallet
 * and the witness. `level` is what a line's presence means: INFO for a
 * success marker, WARN for a failure. Counts only; a failure marker does not by
 * itself fail the run unless the CLI is given --strict-markers.
 */
export const LOG_MARKERS = [
  { id: "evidence-added", level: "INFO", re: /Evidence block added \[(\d+) certs(?:, source=(\w+))?\]/, what: "wallet built an evidence block (issuing side)" },
  { id: "evidence-not-built", level: "WARN", re: /Could not build evidence block|VRC will be issued without hardware attestation evidence|issued without hardware attestation evidence/, what: "VRC issued without evidence" },
  { id: "no-hw-attestation", level: "WARN", re: /proceeding without hardware attestation/, what: "biometric step failed or declined; attestation skipped" },
  { id: "hw-verify-pass", level: "INFO", re: /\[(?:HW|VRC):Verify\] ✓ Native verification passed/, what: "receiving wallet verified hardware evidence" },
  { id: "hw-verify-fail", level: "WARN", re: /\[(?:HW|VRC):Verify\] ✗ Native verification (?:failed|error)/, what: "hardware evidence verification failed" },
  { id: "vrc-verify-error", level: "WARN", re: /\[VRC:Verify\] Verification error/, what: "verifyVrcHardwareEvidence threw" },
  { id: "hw-verification-issue", level: "WARN", re: /Hardware Verification Issue/, what: "the Hardware Verification Issue banner text" },
  { id: "wallet-vwc-stored", level: "INFO", re: /\[TrustTasks:Witness\] VWC stored/, what: "wallet stored the witness credential" },
  { id: "wallet-ceremony-complete", level: "INFO", re: /witness session complete — VWC bound and stored/, what: "wallet finished the witness ceremony" },
  { id: "witness-identity-check", level: "INFO", re: /VRC signature cryptographically verified \(Identity Check\)/, what: "witness Identity Check passed (run transcript)" },
  { id: "witness-identity-fail", level: "WARN", re: /VRC signature verification FAILED|VRC verification exception/, what: "witness Identity Check failed (run transcript)" },
  { id: "witness-vwc-issued", level: "INFO", re: /VWC issued \(taskContext bound\)/, what: "witness issued a VWC (run transcript)" },
  { id: "witness-all-checks", level: "INFO", re: /All verification checks passed for connection/, what: "witness passed every presentation check (run transcript)" },
];

/** Count the LOG_MARKERS in one artifact's text. Returns [{ id, level, what, count, sample }]. */
export function scanMarkers(text) {
  const rows = LOG_MARKERS.map((m) => ({ id: m.id, level: m.level, what: m.what, count: 0, sample: "" }));
  const credentialLines = { id: "credential-json", level: "INFO", what: `${MARKER} lines`, count: 0, sample: "" };
  for (const line of text.split(/\r?\n/)) {
    if (line.includes(MARKER)) credentialLines.count++;
    for (let i = 0; i < LOG_MARKERS.length; i++) {
      if (LOG_MARKERS[i].re.test(line)) {
        rows[i].count++;
        if (!rows[i].sample) rows[i].sample = line.replace(/^.*?(ReactNativeJS:\s*|\[witness\]\s*)/, "").trim().slice(0, 160);
      }
    }
  }
  return [credentialLines, ...rows];
}

// ---------- artifact discovery ----------

const ARTIFACT_PATTERNS = [
  /^witnessed-logcat-.*\.txt$/,
  /^attestation-logcat-.*\.txt$/,
  /^issued-credential-.*\.json$/,
];
const TRANSCRIPT_PATTERN = /^run-vrc-exchange.*\.log$/;
const RUN_WINDOW_MS = 5 * 60 * 1000;

/** A glob over a single directory level: `*` and `?` in the file name only. */
function expandGlob(pattern) {
  const dir = path.dirname(pattern);
  const base = path.basename(pattern);
  if (!/[*?]/.test(base)) return existsSync(pattern) ? [pattern] : [];
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^${base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Turn CLI paths into files. A directory contributes the logcat / credential
 * dumps and run transcripts it holds; a glob is expanded; a file is taken as is.
 */
export function resolveInputs(args) {
  const files = [];
  for (const arg of args) {
    if (existsSync(arg) && statSync(arg).isDirectory()) {
      for (const f of readdirSync(arg).sort()) {
        if (ARTIFACT_PATTERNS.some((p) => p.test(f)) || TRANSCRIPT_PATTERN.test(f)) files.push(path.join(arg, f));
      }
    } else {
      files.push(...expandGlob(arg));
    }
  }
  return [...new Set(files)];
}

/**
 * With no paths: the newest run in an artifacts directory — the newest
 * witnessed-logcat / attestation-logcat / issued-credential file by mtime, every
 * such file within five minutes of it (one run dumps one file per phone, seconds
 * apart), plus the newest run transcript within ten minutes of it (the witness's
 * own lines live there, not in logcat).
 */
export function defaultInputs(artifactsDir) {
  if (!existsSync(artifactsDir)) return [];
  const entries = readdirSync(artifactsDir)
    .filter((f) => ARTIFACT_PATTERNS.some((p) => p.test(f)))
    .map((f) => ({ file: path.join(artifactsDir, f), mtime: statSync(path.join(artifactsDir, f)).mtimeMs }));
  if (entries.length === 0) return [];
  const newest = Math.max(...entries.map((e) => e.mtime));
  const picked = entries.filter((e) => newest - e.mtime <= RUN_WINDOW_MS).map((e) => e.file);
  const transcripts = readdirSync(artifactsDir)
    .filter((f) => TRANSCRIPT_PATTERN.test(f))
    .map((f) => ({ file: path.join(artifactsDir, f), mtime: statSync(path.join(artifactsDir, f)).mtimeMs }))
    .filter((t) => Math.abs(t.mtime - newest) <= 2 * RUN_WINDOW_MS)
    .sort((a, b) => b.mtime - a.mtime);
  if (transcripts.length) picked.push(transcripts[0].file);
  return picked.sort();
}

// ---------- whole-run check ----------

/**
 * Check a set of artifact files. Returns
 * { ok, expect, files, credentials: [{ entry + kind, verdict, keyStorage, chainLength, findings, seenIn }],
 *   markers: [{ source, rows }], findings, counts }.
 * The same credential logged in more than one artifact (a witnessed-logcat and
 * an attestation-logcat from the same phone) is judged once and lists every
 * place it was seen.
 */
export function checkArtifacts(files, opts = {}) {
  const { allowEmpty = false, strictMarkers = false } = opts;
  const credentials = [];
  const markers = [];
  const unreadable = [];
  const seen = new Map();

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (e) {
      unreadable.push({ source: file, error: e.message });
      continue;
    }
    markers.push({ source: file, rows: scanMarkers(text) });
    for (const entry of extractCredentials(text, file)) {
      if (entry.status === "ok") {
        const key = JSON.stringify(entry.credential);
        if (seen.has(key)) {
          seen.get(key).seenIn.push(`${path.basename(file)}:${entry.line}`);
          continue;
        }
        const checked = checkCredential(entry.credential, opts);
        const row = {
          ...entry,
          credential: undefined,
          kind: checked.kind,
          verdict: checked.kind === "other" ? "SKIP" : verdictOf(checked.findings),
          keyStorage: checked.keyStorage,
          chainLength: checked.chainLength,
          contextList: checked.contextList,
          findings: checked.findings,
          seenIn: [`${path.basename(file)}:${entry.line}`],
        };
        seen.set(key, row);
        credentials.push(row);
      } else {
        credentials.push({
          ...entry,
          kind: "unreadable",
          verdict: "FAIL",
          keyStorage: null,
          chainLength: null,
          findings: [{ level: "FAIL", code: entry.status, message: `${entry.status} ${MARKER} payload: ${entry.error}` }],
          seenIn: [`${path.basename(file)}:${entry.line}`],
        });
      }
    }
  }

  const findings = [];
  for (const u of unreadable) findings.push({ level: "FAIL", code: "unreadable-file", message: `${u.source}: ${u.error}` });
  if (files.length === 0) {
    findings.push({ level: "FAIL", code: "no-input", message: "no artifact files found (pass logcat paths, a directory or a glob)" });
  }
  const judged = credentials.filter((c) => c.kind === "vrc" || c.kind === "unreadable");
  if (files.length > 0 && judged.length === 0 && !allowEmpty) {
    findings.push({
      level: "FAIL",
      code: "no-credentials",
      message:
        `no ${MARKER} VRC payload in ${files.length} file(s): the run issued nothing this checker can judge, ` +
        "or the log lines were not captured (an artifact filter, a cleared buffer, or a build that predates the marker)",
    });
  }

  const totals = {};
  for (const row of markers.flatMap((m) => m.rows)) totals[row.id] = (totals[row.id] || 0) + row.count;
  if (strictMarkers) {
    for (const m of LOG_MARKERS) {
      if (m.level === "WARN" && totals[m.id] > 0) {
        findings.push({ level: "FAIL", code: m.id, message: `${totals[m.id]} line(s): ${m.what} (--strict-markers)` });
      }
    }
  }
  const expectsEvidence = credentials.some((c) => c.kind === "vrc" && c.chainLength > 0);
  if (expectsEvidence && !totals["hw-verify-pass"] && !totals["hw-verify-fail"]) {
    findings.push({
      level: "WARN",
      code: "no-verify-marker",
      message: "evidence was issued but no [HW:Verify]/[VRC:Verify] result line was captured, so receiving-side verification is unproven by these artifacts",
    });
  }
  for (const m of LOG_MARKERS) {
    if (m.level === "WARN" && totals[m.id] > 0 && !strictMarkers) {
      findings.push({ level: "WARN", code: m.id, message: `${totals[m.id]} line(s): ${m.what}` });
    }
  }

  const all = [...findings, ...credentials.flatMap((c) => c.findings)];
  const counts = { FAIL: 0, WARN: 0, INFO: 0, PASS: 0 };
  for (const f of all) counts[f.level]++;
  const vrcCounts = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0 };
  for (const c of credentials) vrcCounts[c.verdict]++;
  const ok = !all.some((f) => f.level === "FAIL");
  return { ok, expect: opts.expect ?? "v5", files, credentials, markers, totals, findings, counts, credentialVerdicts: vrcCounts };
}

// ---------- reporting ----------

const pad = (s, n) => String(s).padEnd(n);

/** The compact human report. */
export function formatReport(result) {
  const out = [];
  out.push(`VRC credential check: ${result.files.length} file(s), expect=${result.expect}`);
  for (const f of result.files) out.push(`  - ${f}`);
  out.push("");
  if (result.credentials.length) {
    out.push(`${pad("#", 3)}${pad("verdict", 8)}${pad("kind", 11)}${pad("side", 10)}${pad("keyStorage", 14)}${pad("chain", 6)}source`);
    result.credentials.forEach((c, i) => {
      out.push(
        `${pad(i + 1, 3)}${pad(c.verdict, 8)}${pad(c.kind, 11)}${pad(c.side, 10)}${pad(c.keyStorage ?? "-", 14)}${pad(c.chainLength ?? "-", 6)}${c.seenIn.join(", ")}`
      );
    });
    out.push("");
    result.credentials.forEach((c, i) => {
      const notable = c.findings.filter((f) => f.level !== "PASS");
      if (!notable.length) return;
      out.push(`credential #${i + 1}${c.exchange ? ` (exchange ${c.exchange})` : ""}:`);
      for (const f of notable) out.push(`  ${pad(f.level, 5)} ${f.code}: ${f.message}`);
    });
  }
  if (result.findings.length) {
    out.push("run-level:");
    for (const f of result.findings) out.push(`  ${pad(f.level, 5)} ${f.code}: ${f.message}`);
  }
  out.push("");
  out.push("log markers (total across files):");
  const rows = Object.entries(result.totals).filter(([, n]) => n > 0);
  if (rows.length === 0) out.push("  (none of the tracked markers appear)");
  const meta = new Map([{ id: "credential-json", level: "INFO", what: `${MARKER} lines` }, ...LOG_MARKERS].map((m) => [m.id, m]));
  for (const [id, n] of rows) out.push(`  ${pad(meta.get(id).level, 5)} ${pad(n, 5)} ${id}: ${meta.get(id).what}`);
  out.push("");
  const v = result.credentialVerdicts;
  out.push(
    `RESULT: ${result.ok ? "PASS" : "FAIL"} — credentials PASS ${v.PASS}, WARN ${v.WARN}, FAIL ${v.FAIL}, skipped ${v.SKIP}; ` +
      `findings FAIL ${result.counts.FAIL}, WARN ${result.counts.WARN}`
  );
  return out.join("\n");
}

/** The machine-readable summary written by --json. */
export function toJsonSummary(result) {
  return {
    ok: result.ok,
    expect: result.expect,
    files: result.files,
    counts: result.counts,
    credentialVerdicts: result.credentialVerdicts,
    markerTotals: result.totals,
    findings: result.findings,
    credentials: result.credentials.map((c) => ({
      sources: c.seenIn,
      side: c.side,
      exchange: c.exchange,
      record: c.record,
      kind: c.kind,
      verdict: c.verdict,
      keyStorage: c.keyStorage,
      certificateChainLength: c.chainLength,
      context: c.contextList ?? null,
      findings: c.findings,
    })),
  };
}
