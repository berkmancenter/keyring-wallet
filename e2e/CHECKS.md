# Checking what a device run issued

`check-vrc-credentials.mjs` reads the VRCs a real-device run issued out of its
log artifacts and asserts their shape. A green harness run proves the UI flow
completed; this proves the credentials that came out of it carry what the
recent changes put there. Offline and dependency-free (Node only): it never
touches a device, Appium, Metro or the network, so it is safe to run while
another run is in flight.

```sh
node check-vrc-credentials.mjs                               # newest run under artifacts/
node check-vrc-credentials.mjs artifacts/witnessed-logcat-*.txt
node check-vrc-credentials.mjs artifacts/ --expect legacy    # a run against pre-v5 peers
node check-vrc-credentials.mjs --json artifacts/vrc-check.json
node check-vrc-credentials.mjs --self-test                   # synthetic fixtures, offline
```

Exit code: 0 with no FAIL, 1 on any FAIL, 2 on a usage error.

Package scripts (from `e2e/`; the root forwarders are `yarn e2e:vrc:check`,
`e2e:vrc:check:strict`, `e2e:vrc:check:self-test`, and take the same extra
arguments):

| Script | Runs |
|---|---|
| `check:vrc` | the checker with its defaults (newest run, `--expect v5`) |
| `check:vrc:witnessed` | `--expect v5 --require-storage StrongBox,TEE,SecureEnclave`: what a real-device run should satisfy. Hardware-verify failures stay WARN |
| `check:vrc:strict` | the same plus `--strict-markers`: a `✗ Native verification failed` line FAILs. Opt-in: real phones currently fail verification on an expired Google attestation root |
| `check:vrc:self-test` | `--self-test`, offline |

The real-device runners call the checker themselves when they finish
(`enforceCredentialCheck` in `lib/vrcCapture.js`, at the end of
`dumpAndroidWitnessLogs` and of the attestation runner's dump): a run that
issued no capturable VRC, or one with the wrong shape, exits 1 even though the
UI flow passed. `E2E_VRC_CHECK=off` skips it, `E2E_VRC_EXPECT=v5|legacy|any`,
`E2E_VRC_ALLOW_NO_EVIDENCE=1` and `E2E_VRC_STRICT_MARKERS=1` tune it. On a run
that has already failed, an empty capture is reported but not added as a
second failure.

### Requiring a verification pass (`E2E_REQUIRE_HW_VERIFIED=1`)

`assertSecureExchangeBadge` (the plain real-device exchange) accepts a missing
Secure Exchange badge when Android's log shows a verification was merely
attempted (an aging attestation root, say). With `E2E_REQUIRE_HW_VERIFIED=1`
the receiving wallet's log must also carry an actual pass,
`[HW:Verify] ✓ Native verification passed [...]` (or the `[VRC:Verify]`
equivalent) — an attempt line or a `✗ Native verification failed` line fails
the run with a message naming the missing marker. Default behaviour is
unchanged; on iOS the log is not readable here, so the check is skipped with a
warning.

## Inputs

The wallet logs each issued VRC as one line, on the DIDComm credential-exchange
path when an exchange reaches `done` and, between v4+ peers, on the Trust Task
path: `side=ISSUER` when the VRC is sent and `side=RECEIVER` when it is stored
(`ceremony.ts`). Before 2026-09-30 only the first path logged it, and the
Trust Task path is the one real-device runs take, so nothing was captured. Each
line is
`[VRC:IssuedCredentialJSON] side=… exchange=… record=… {json}`, with
certificate chains already replaced by `<PEM #n: N chars>` and any string over
500 characters by `<omitted N chars>` (`slimCredentialForLog` in
`vrc-credential-log.ts`). The checker takes these from:

- `witnessed-logcat-<udid>-*.txt` and `attestation-logcat-<udid>-*.txt` (the
  runners' filtered logcat dumps; the `VRC:` filter keeps the marker line),
- `issued-credential-*.json` (the per-credential dumps the devices runner
  writes from the same lines),
- `run-vrc-exchange*.log` (the run transcript; it carries the witness
  process's own `[witness]` lines, which logcat does not).

With no path it reads the newest logcat dump, every such file within five
minutes of it (one run writes one per phone) and the nearest run transcript.
The same credential found in two artifacts is judged once.

A payload that cannot be read is reported, never skipped: a JSON object that
does not close is `truncated` (Android cuts a log entry at about 4 KB, and the
runners' `VRC:|…` filter drops a continuation line that lacks the marker), and
bad JSON is `unparsable`. Both are FAIL. If it happens, capture an unfiltered
`adb logcat -d -s ReactNativeJS:*` for the run and point the checker at that.
No credential payload at all is also a FAIL (`no-credentials`; `--allow-empty`
downgrades that), because then nothing was proven.

## What each VC 2.0 VRC must carry

| Member | Expected |
|---|---|
| `@context` | exactly `[https://www.w3.org/ns/credentials/v2, https://registry.trustoverip.org/dtg/context/v1, https://www.firstperson.network/hardware-evidence/v1]` for `--expect v5` (default); the last entry is `https://www.firstperson.network/dtg/v1` for `--expect legacy`; `--expect any` takes either |
| `type` | includes `VerifiableCredential`, `DTGCredential`, `RelationshipCredential` |
| `issuerScope` | `pairwise` |
| `issuer` | a DID string |
| `validFrom` | present, ISO 8601 |
| `proof` | `type` `DataIntegrityProof`, `cryptosuite` `eddsa-rdfc-2022` |
| `evidence` | a one-element array (FAIL if absent; `--allow-no-evidence` makes that a WARN) |
| `evidence[0].type` | `HardwareKeyAttestation` and `BiometricAttestation` or `DeviceAuthentication` |
| `evidence[0].id` / `created` | `urn:uuid:…` / ISO 8601 |
| `evidence[0].authenticationMethod.type` | present |
| `evidence[0].hardwareBinding` | `keyStorage` in `SecureEnclave`, `StrongBox`, `TEE`, `Software`, `Unknown`; `platform` `android` or `ios`; `keyType`; `algorithm`; `publicKey` (strings) |
| `evidence[0].attestation` | `format` `android-key-attestation-v3` (android) or `apple-appattest-v1` (ios); `certificateChain` at least one entry |
| `evidence[0].signature` | `value`, `algorithm`, optional `signedContentHash` |

A credential whose first context is the VCDM 1.1 one is what a peer below RCE
v3 receives: FAIL under `--expect v5`, INFO otherwise, and the VC 2.0 checks are
skipped. A credential that is not a `RelationshipCredential` (a VWC, a card) is
listed as `skipped` and not judged.

Members outside the known set, at the credential's top level or in the evidence
block, are a WARN: the hardware-evidence context has no `@vocab`, so a
misspelled member would have been rejected by the safe-mode signer, and seeing
one means something other than the current builder produced the credential.

## Verdicts

- **FAIL** — a requirement above is not met, a payload is unreadable, or none
  was found. The exit code is 1.
- **WARN** — suspicious or incomplete, but the requirement is not broken: an
  empty chain on a `Software` key, a missing `proofPurpose`, an unknown member,
  a failure marker in the logs (see below), evidence issued with no
  `[HW:Verify]`/`[VRC:Verify]` result line captured.
- **INFO** — recorded only: the `keyStorage` of each credential (StrongBox and
  SecureEnclave versus TEE and Software — `--require-storage StrongBox,SecureEnclave`
  turns a mismatch into a FAIL), a skipped credential, every success marker.
- **PASS** — every check on that credential held.

An empty `certificateChain` is a FAIL when `keyStorage` is `StrongBox`, `TEE` or
`SecureEnclave` (hardware-backed, nothing to attest it) and a WARN for `Software`.

## Log markers

Counted across the same files, with the first line of each shown in the JSON
summary's source. Failure markers are WARN, or FAIL with `--strict-markers`.

| Marker | Meaning |
|---|---|
| `Evidence block added [N certs, source=…]` | the issuing wallet built evidence (INFO) |
| `Could not build evidence block`, `issued without hardware attestation evidence`, `proceeding without hardware attestation` | the VRC went out unattested (WARN) |
| `[HW:Verify]` / `[VRC:Verify]` `✓ Native verification passed` | the receiving wallet verified the evidence (INFO) |
| `… ✗ Native verification failed`, `[VRC:Verify] Verification error` | it did not (WARN) |
| `Hardware Verification Issue` | the banner text (WARN) |
| `[TrustTasks:Witness] VWC stored`, `witness session complete — VWC bound and stored` | the wallet's side of the witness ceremony (INFO) |
| `VRC signature cryptographically verified (Identity Check)`, `VWC issued (taskContext bound)`, `All verification checks passed` | the witness process, from the run transcript (INFO) |
| `VRC signature verification FAILED`, `VRC verification exception` | the witness rejected the VRC (WARN) |

`Evidence block added` is logged by the wallet's logger, not with the `VRC:`
prefix the runners filter on, so it may appear only in the run transcript (the
harness prints it from its own unfiltered read).

## Mapping to the VSC plan acceptance (docs/plans/vsc-migration-plan/2026-09-30-bam.md)

- **G32 (`issuerScope` and Data Integrity on every VC 2.0 VRC).** Checked per
  credential: `issuerScope` is `pairwise`, `proof` is `DataIntegrityProof` with
  `eddsa-rdfc-2022`, no Ed25519 suite context is listed. This is the
  "real-device `yarn e2e:vrc:devices`" evidence the plan says is missing.
- **G36 (rollout of the evidence-context swap).** `--expect v5` asserts that v5
  peers are sent `hardware-evidence/v1`, and `--expect legacy` that pre-v5 peers
  are sent the legacy DTG context and never the new one (the 404 hazard in plan
  §3.5). Running both expectations against the matching runs is the
  v5-gets-new, old-gets-legacy half of phase-2 item 3. The witness-ordering half
  is not visible here.
- **G38 item 4 (real hardware).** The evidence shape, `keyStorage`, chain length
  and format per credential, plus the `[HW:Verify]` pass/fail lines from the
  receiving wallet. A `✓ … passed` line for each direction, and no failure line,
  is the "evidence verifies on the counterpart under the new context" criterion.
  Items 1 and 2 are device-free and not covered here.

The checker reads what was logged; it cannot prove a signature valid. The
signature itself is proven by the receiving wallet's and the witness's own
verification, which is why their marker lines are part of the report.

## Self-test

`--self-test` runs synthetic fixtures through the same code: a good v5 VRC with
evidence (PASS), the legacy context (FAIL in v5, PASS in legacy), an
`Ed25519Signature2018` proof (FAIL), a missing `issuerScope` (FAIL), an empty
chain on StrongBox (FAIL), a truncated payload (reported as truncated), a split
payload (joined), and an unknown evidence member (WARN).
