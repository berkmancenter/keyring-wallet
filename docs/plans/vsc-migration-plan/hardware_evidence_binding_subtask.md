# Hardware-evidence content binding (G33) — subtask of the VSC migration plan

**Parent:** [`../vsc-migration-plan.md`](../vsc-migration-plan.md) §2.6 (the hardware-evidence block) and gap G33. **Reasoning and gap record:** [`2026-09-30-bam.md`](./2026-09-30-bam.md) Part 2 (§3.6 finding, §6 G33 row). This document states current design and the plan to change it; see [`../CLAUDE.md`](../CLAUDE.md) for the conventions it follows.

**Status.** Not started. Stage 1 (§4.3) closes G33. Stage 2 (§4.4) removes the key-order dependence that makes Stage 1 fragile. Both are *decided, waiting on sequencing*: they follow the pre-demo device run and the demo (§8.3). Open questions for Brendan are in §8.2.

**Citations.** Source lines are cited against bifold `508482a27` (the G32 commit, pinned by superproject `171ec80f`). Between `45e02d5b3` and `508482a27` the only source file that changed is `vrc-manager.ts`, so every other bifold line number is the same at both. `e2e/` and `docs/` paths are superproject `HEAD`.

**Handling.** Both `berkmancenter/keyring-wallet` and `berkmancenter/keyring-bifold` are public (`gh repo view`, 2026-09-30). This document describes the property gap. It deliberately gives no procedure for abusing it. Whether it is pushed before Stage 1 lands is Brendan's call (§8.2, Q-B6).

---

## 1. The property

Hardware evidence in a VRC claims that *the device key in `hardwareBinding.publicKey` signed this credential's content*. That claim holds only if the verifier recomputes the signed bytes, or their hash, from the credential it holds. A hash carried inside the evidence can never stand in for that recomputation. The evidence author picks the hash, so verifying against it proves only that the key once signed *something* with that hash.

Android-origin evidence has this property today. iOS-origin evidence (App Attest assertions) does not, because both native verifiers use the embedded `signature.signedContentHash` as the assertion's `clientDataHash`, and a mismatch with the recomputed hash only logs a warning.

## 2. Current behaviour, end to end

### 2.1 What the signer signs

1. `buildVrcCredential` (`core/src/modules/vrc/vrc-manager.ts:332`) builds the unsigned credential as a JS object literal. Key order is the literal's order: VC 2.0 `@context, type, issuer, issuerScope (G32, :395), validFrom, validUntil, credentialSubject`. Legacy VCDM 1.1 `@context, type, issuer{…}, issuanceDate, validFrom, expirationDate, validUntil, credentialSubject`.
2. Both hardware-signing call sites serialize it with insertion-order `JSON.stringify`:
   - `prepareVrcCredentialWithEvidence` (`vrc-manager.ts:644`) at `:665`. It is shared by the legacy issue-credential leg (`:781`) and the trust-task issue leg (`trust-tasks/ceremony.ts:903`).
   - `storeVrcForWitnessedExchange` (`vrc-manager.ts:1148`) at `:1168`.

   The string is taken **before** `evidence` is added (`:702`, `:1205`) and before any proof exists.
3. `requestBiometricWithHardwareSigning` (`vrc-biometric.ts:204`) → `signVrcWithHardwareKey` (`vrc-hardware-signing.ts:108`, called at `vrc-biometric.ts:251`/`:269`) → `signPayloadWithHardwareKey` (`hardware-signing/sign.ts:39`). That function UTF-8-encodes with `Buffer.from(payload, 'utf8')` (`sign.ts:52`) and calls the native `signWithHardwareBiometricAuth` (`react-native-attestation/src/index.ts:164`) with the bytes as a `number[]`.
4. Native signing:
   - **iOS** (`Attestation.mm:395`): `clientDataHash = SHA-256(bytes)` (`:423-425`). Then `DCAppAttestService generateAssertion:keyId clientDataHash:` (`:455`). The "signature" returned is the CBOR assertion `{signature, authenticatorData}`, whose ECDSA signature covers `SHA-256(authenticatorData ‖ clientDataHash)`. The resolved `clientDataHash` is base64 SHA-256(bytes) (`:475`). User verification is `LAContext evaluatePolicy` in the app (`:488`), reused for 300 s (`:16`, `:481`). The App Attest key itself carries no access control.
   - **Android** (`AttestationModule.kt:405`): `SHA256withECDSA` over the bytes, and the returned `clientDataHash` is SHA-256(bytes) (`:455-462`).
5. `HardwareEvidenceBuilder.buildEvidenceFromSignature` (`hardware-signing/evidence.ts:138`) receives `biometricResult.hardwareSignature.clientDataHash` as `signedContentHash` (`vrc-manager.ts:695-700`, `:1195-1200`). `buildEvidenceBlock` writes it into `evidence.signature.signedContentHash` (`evidence.ts:364-368`). Type: `HardwareSignature.signedContentHash?` (`hardware-signing/types.ts:89-97`), re-exported by `modules/vrc/types/evidence.ts`.
6. The credential, now carrying `evidence`, is proofed by the issuer's DID key. On the legacy leg that is the DIDComm offer (`vrc-manager.ts:797-807`). On the trust-task leg it is `agent.w3cCredentials.signCredential({ credential: JsonTransformer.fromJSON(credential, W3cCredential) … })` (`ceremony.ts:915-921`). The issuer proof covers `evidence`. The hardware signature does not cover the evidence's own metadata (see F4, §10).

### 2.2 What the verifier reconstructs

`verifyVrcHardwareEvidence` (`modules/vrc/services/BiometricSignatureVerifier.ts:56`) finds the `BiometricAttestation`/`DeviceAuthentication` entry (`:62-67`). `extractSignedContent` (`:33-49`) then:

- removes the top-level `evidence` and `proof`;
- if the object has `context` and no `@context`, rebuilds it with `@context` first (`:40-45`);
- returns `JSON.stringify` of the result, which depends on insertion order.

`HardwareSignatureVerifier.verifyEvidence` (`hardware-signing/verify.ts:80`) passes six arguments to native `verifyHardwareEvidence` (`verify.ts:91-98` → `react-native-attestation/src/index.ts:402`, spec `NativeAttestation.ts:97-104`): `certificateChain`, `signature.value`, `signedContent || ''`, `hardwareBinding.publicKey`, `attestation.format`, and **`evidence.signature.signedContentHash`**, sent as `''` when absent (`index.ts:416`).

### 2.3 Native verification, Apple CBOR-assertion path

Both natives branch into this path when `format == "apple-appattest-v1"`, the signature is longer than 80 bytes, and its first byte is not `0x30` (`AttestationModule.kt:1505-1506`, `Attestation.mm:1428`).

| Step | Kotlin (`AttestationModule.kt`) | Obj-C++ (`Attestation.mm`) |
|---|---|---|
| Chain | PKIX `CertPathValidator` to the Apple App Attestation Root or Apple Root CA G3. The last cert is dropped if it equals an anchor. Revocation is off (`:1386-1428`) | `SecTrust` with `SecPolicyCreateBasicX509`, anchors-only, same two roots (`:1306-1387`) |
| Key match | leaf SPKI == normalized evidence key (`:1461-1483`) | `publicKeysMatch(leaf, evidence)` (`:1389-1408`) |
| clientDataHash | `computedHash = SHA-256(signedContent UTF-8)` (`:1518`). **If an embedded hash is non-empty, it is used instead**, at any decoded length. A mismatch only logs `⚠ Embedded hash differs … expected for cross-device VRC` (`:1516-1535`) | same substitution (`:1443-1452`). A decoded hash that is not 32 bytes falls back silently to the computed hash (`:1445-1447`) |
| Signature | `SHA256withECDSA` over `nonce = SHA-256(authData ‖ clientDataHash)` (`:1537-1549`) | `SecKeyVerifySignature(…MessageX962SHA256, nonce)` (`:1458-1469`) |
| Content required | no. An empty `signedContent` still verifies with an embedded hash | yes (`:1412-1414`) |
| Result | `valid = chain && sig && keyMatch && not revoked` (`:1619-1620`) | `valid = chain && sig && keyMatch` (`:1527`) |

**Not checked by either native, on this path:**

- `authenticatorData`'s RP ID hash, which should equal SHA-256(`<teamId>.<bundleId>`);
- the sign counter (no per-key state);
- the flags byte;
- the credential certificate's nonce extension;
- the attestation object itself. It is not carried, only its x5c chain (`Attestation.mm:350`).

The witness-server's Node verifier for locality transcripts (`witness-server/src/trustTasks/appAttest.ts:264-304`) *does* always recompute `clientDataHash` from the message (`:284`). It optionally pins the App ID (`:273-278`) and the counter (`:280-282`). It is the in-repo reference for the correct algorithm, and it has never been checked against a real device capture (`:40-47`, `describe.skip` in `__tests__/unit/appAttest.test.ts:295`).

### 2.4 Native verification, Android raw-DER path

`SHA256withECDSA`/`SecKeyVerifySignature` run directly over `signedContent` UTF-8 (`AttestationModule.kt:1562-1575`, `Attestation.mm:1481-1497`). The embedded hash is ignored. This path is content-bound. The Android path also parses the key-attestation extension (`AttestationModule.kt:1582+`), which the result exposes but no caller enforces.

### 2.5 Every consumer

| Consumer | What it does with the verdict |
|---|---|
| `screens/CredentialOffer.tsx:304-375` | Runs on the **offer's** credential (legacy DIDComm leg, before any issuer proof exists, `:229-235`) and sets the offer banner (`AttestationVerified`/`AttestationWarning`) |
| `modules/vrc/screens/ContactDetails.tsx:113`, `ListContacts.tsx:261` | Recomputed at display time from the stored record (`getVrcCredentialJsonForSubject`, `utils/witnessCredentialUtils.ts:155-178` → `toRawCredential`, `utils/rcardDisplayUtils.ts:30-45`, which is `record.encoded`, i.e. Credo JSON). Drives the "Secure Exchange" badge |
| `hardware-signing/verify.ts:179-185` `verifySignedPayload` / `service.ts:139-141` | The standalone, Credo-free service API (exported from `core/src/index.ts:354`). Same gap: its doc says a relying party "should still confirm that `attestation.payload` is the challenge it issued", but the verdict on iOS evidence does not depend on `payload`. No in-repo caller today |
| witness-server `credentialBuilder.ts:169`, `:270-273` | **Does not verify** hardware evidence. `hardwareAttestationIncluded` means presence only |
| witness-server `extractVrcHardwareAttestationPublicKey` (`credentialBuilder.ts:345-356`) → `WitnessTaskSessions.ts:611`, `locality.ts:242` `transcriptKeyMatchesVrcSigner` | Takes the evidence public key, unverified, and requires the live locality transcript to be signed by it |
| `vrc-shared` | Document loader only (`documentLoader.ts:273-280`). No evidence logic |
| `vrc-reference` | Fixtures only (`diConformance.test.ts`) |

### 2.6 What the gap allows, and what still holds

Stated as properties. No procedure is given.

**What still holds.**
- A third party cannot alter a received credential without breaking the issuer's proof. Once a credential is proofed, that proof covers `evidence`, so the hardware check is not the credential's only integrity protection.
- Android-origin evidence is bound to content.
- A locality-confirmed witnessed exchange also requires a live transcript signature from the evidence key.

**What does not hold, for iOS-origin evidence.**
- The native verdict does not depend on the credential body. A complete, valid iOS evidence block verifies as "hardware-signed" attached to *any* credential content. Every counterparty who has received a VRC from an iPhone holds such a block, and so does a witness that received one in a VP.
- Nothing binds `hardwareBinding.publicKey` to the issuer DID, the relationship, or the connection.

**Consequences.**
- The "Secure Exchange" banner and badge can be shown for evidence that was never produced over that credential. This includes the offer screen, where no issuer proof exists yet.
- The standalone `verifySignedPayload` accepts a payload the evidence was never produced over.
- A verifier that checks hardware evidence without the issuer proof learns nothing about the content.

**What G33 does not change.** On iOS, user verification is enforced by the app (`LAContext`), not by the key (§2.1 step 4). A modified app on the key's own device can therefore obtain assertions without a prompt whether or not G33 is fixed. G33 concerns binding the assertion to content and to the credential, not presence enforcement (F4, §10).

**Not established in this pass:**
- whether Credo's JSON-LD holder flow verifies the issuer proof on receipt before the credential is stored and badged;
- whether any path other than `JsonTransformer` (JSON-LD compaction, a non-JS peer) re-serializes the VRC between signer and verifier;
- how Hermes and JSC handle lone surrogates in `JSON.stringify` and `Buffer`, compared with Kotlin `toByteArray(UTF_8)` (which substitutes `?`) and `dataUsingEncoding:` (which returns `nil`).

## 3. Why the embedded hash exists, and why recomputation is enough

**Verified from history** (bifold `git log --all -S`).
- The embedded hash, the substitution, and the "expected for cross-device VRC" warning arrive together in `081c6d7e3` (2026-03-05, "implement verification on the native level"). At that commit:
  - both natives verify the assertion signature over `authData ‖ clientDataHash` itself, without the `SHA-256` nonce step Apple's algorithm requires (`git show 081c6d7e3:…/Attestation.mm`, `:1291-1299`);
  - `extractSignedContent` does not restore `@context` from Credo's `context`.
- `007788b28` (2026-03-06, "fix verification for VRC when android-ios exchange") fixes both: the nonce hash in both natives, and the `@context` restore in `extractSignedContent`. It also deletes a Kotlin fallback that retried with the computed hash, and the per-byte diagnostics. It leaves the substitution and the warning in place.

**Inference, well-supported but not proven from the commit messages.** The embedded hash was a workaround for a cross-platform failure whose real causes were the missing nonce hash and the `context`/`@context` rename. Both are fixed. Nothing in the history names any other serialization difference.

**Verified by measurement** (standalone Node script against the installed Credo `0.7.1-pr-2704-20260909134930`, `bifold/packages/core/node_modules/@credo-ts/core`, run 2026-09-30).

The script built each shape, attached evidence and a proof, round-tripped it through `JsonTransformer.fromJSON(…, W3cJsonLdVerifiableCredential)` → `toJSON`, and applied `extractSignedContent`. Shapes: the VC 2.0 VRC with and without `issuerScope`, the legacy VCDM 1.1 VRC with a non-ASCII issuer name, a member set to `undefined`, and a timestamp without milliseconds. Proofs: `DataIntegrityProof` and `Ed25519Signature2018`.

- For every one of those shapes the result is byte-identical to `JSON.stringify` of the builder output, for both proof types.
- Credo 0.7 emits `@context`, not `context`, so the restore branch in `extractSignedContent` is not exercised by these shapes.
- Top-level key order is preserved, including for members Credo does not model (`issuerScope`).
- `vrcSignedContentKeyOrder.test.ts` (bifold `508482a27`) pins the same property for the real builder at RCE v3 and v5.

**Verified latent break.** `W3cCredential` and `W3cJsonLdVerifiableCredential` move `credentialSubject.id` *after* the other subject members: `{id, relationship}` comes back as `{relationship, id}`. `W3cV2Credential` does not do this. Today's VRC subject is `{id}` alone, so the effect is invisible. The first subject member added to a VRC (a predicate, a vetting reference, anything) breaks Android-origin verification under the current binding, and on iOS the embedded hash would mask it. Stage 2 exists for this reason.

**Standing conclusion.** For every VRC shape Keyring emits today, the verifier's reconstruction equals the signer's bytes. So `SHA-256(reconstruction)` equals the embedded hash whenever the evidence is genuine, and the embedded hash adds nothing a verifier needs. Keeping the substitution buys no compatibility and removes the binding. The "cross-device" comments in both natives are wrong and must not be carried forward.

## 4. Design

### 4.1 Options

**(A) Canonical signed bytes: JCS (RFC 8785) of the credential with `evidence` and `proof` removed, and a hash mismatch is a hard failure.**
- Removes insertion-order dependence (§3 latent break) and matches the Digest Encoding convention that `taskDigestMultibase` already implements (`trust-tasks/src/documentProof.ts`, plan §3.1).
- Needs a marker so a verifier knows which bytes to rebuild, and dual-read for evidence without it.
- Implementation choice:
  - `@bifold/vrc-contexts` `jcsCanonicalize` (`vrc-contexts/src/jcs.ts:29-53`) is hand-rolled. It sorts by UTF-16 code units, defers numbers and strings to `JSON.stringify`, drops `undefined` members, and turns `undefined` array elements into `null`. Its header comment has no key-order or `kind` caveat beyond recording that it replaced a top-level-only sort (`:17-20`).
  - `@bifold/trust-tasks` `jcsCanonicalize` (`documentProof.ts:43`) wraps the `canonicalize` package, which `core/src/modules/trust-tasks/deviceLocality.ts:22-34` also uses on device.
  - The two must agree on every VRC shape; a test pins that (§7.1).
  - Neither rejects lone surrogates, which RFC 8785 (I-JSON input) excludes. The binding helper rejects content that does not round-trip through UTF-8.

**(B) Hardware-sign the credential digest (`digestMultibase` / `taskDigestMultibase`) so one digest serves the VWC and the hardware binding.**
- Not a distinct option. `taskDigestMultibase` removes only `proof` (plan §3.1). The VWC's `object.digestMultibase` therefore covers `evidence`, and the hardware signature cannot cover the block that contains it.
- The evidence-less digest is `SHA-256(JCS(credential − evidence − proof))`, which is exactly (A)'s iOS `clientDataHash`. So (B) reduces to (A) with a different label.
- Its only extra property would be letting a verifier check the hardware signature from the digest alone, without the credential. That is the substitution this plan removes.
- The VWC edge still binds transitively: VWC → VRC including evidence → hardware signature → content.

**(C) Bind through the Data Integrity proof.**
- Rejected: an App Attest key can produce only `generateAssertion` output, never a plain ECDSA signature (`witness-server/src/trustTasks/appAttest.ts:21-24`), so it cannot author a standard `ecdsa-*` DI proof.
- Having it sign the RDFC hash data instead would require RDF canonicalization, with the right document loader and contexts, on the signing device before `evidence` exists. That ties the hardware binding to the context-rollout problem (G30, G36) and does nothing for the legacy `Ed25519Signature2018` VCDM 1.1 path.
- The issuer's DI proof already covers `evidence`; it cannot also be the hardware binding.

**(D) Drop the embedded hash from verification and always recompute, keeping today's signed bytes.**
- The minimal fix. No wire change, and a native change in two places.
- Safe for every existing credential, per §3.
- Leaves the §3 latent break in place.

**(E) The verifier's own JS computes the hash and passes it as the sixth native argument.**
- Old native binaries prefer that argument, so a JS-only change makes an *already installed* native verifier content-bound.
- It is trustworthy: the hash comes from the verifier's own reconstruction of the credential it holds, not from the evidence.
- Combined with (D) in the natives, it gives defence in depth and covers `verifySignedPayload` for free.

### 4.2 Recommendation

Adopt **D + E now (Stage 1, closes G33)**, then **A (Stage 2)** before any member is added to a VRC's `credentialSubject`, and in any case before the upstream drafts' worked examples are presented as what Keyring emits (§8.4). B and C are rejected for the reasons above.

Why this split:
- Stage 1 changes no wire format and needs no RCE bump. It is safe for every stored credential (§3), is testable in Jest, and can be proven on devices on its own.
- Stage 2 is a wire change (a new evidence member, and new signed bytes for new credentials), with a dual-read and compatibility surface of its own (§5.4).
- Bundling them would make a failed device run ambiguous.

### 4.3 Stage 1 design (G33)

- **Signed bytes unchanged.** The legacy insertion-order `JSON.stringify` of the credential without `evidence`/`proof`, with the `context`→`@context` restore kept.
- **JS gate** in `HardwareSignatureVerifier.verifyEvidence`:
  - `signedContent` is required; empty content returns `valid: false` without calling native.
  - The gate computes `contentHash = base64(SHA-256(UTF-8(signedContent)))` using `@noble/hashes/sha2.js`, which `core` already imports in `trust-tasks/deviceLocality.ts:26`.
  - If `evidence.signature.signedContentHash` is present and differs from `contentHash`, it returns `valid: false`, `signatureValid: false`, error `contentBindingMismatch: embedded signedContentHash does not equal SHA-256 of the credential content`, and does not call native.
  - Otherwise it calls native with **`contentHash`** as the sixth argument, never the embedded value.
- **Native gate**, both platforms, Apple path:
  - `clientDataHash` is always the computed hash.
  - A non-empty sixth argument that does not decode to exactly 32 bytes equal to the computed hash sets `sigValid = false` and adds the error `contentBindingMismatch: …`.
  - Empty `signedContent` is an error on Kotlin as it already is on iOS.
  - The "expected for cross-device VRC" and "WILL FAIL for cross-device verification" log lines are removed.
  - The Android raw path applies the same consistency check when the argument is non-empty. Android signers embed it too (`AttestationModule.kt:462`).
- **No TurboModule spec change.** The mismatch surfaces through `errors` with the stable `contentBindingMismatch` prefix. This avoids touching `NativeAttestation.ts`'s `NativeVerificationResult` and the codegen (`UPGRADE_PROGRESS.md:512` names the codegen task). Whether adding an optional field to a promise-resolved object needs codegen was not established, and this design does not depend on it.
- **Signer unchanged.** It keeps emitting `signedContentHash` as an informative value, so pre-Stage-1 verifiers, which substitute it, keep verifying iOS-origin evidence.

### 4.4 Stage 2 design (canonical bytes)

- **Signed bytes:** `jcsCanonicalize(credential − evidence − proof)`, with the `context`→`@context` restore applied first. The signer builds them in one helper shared by both call sites (§2.1 step 2) and the verifier.
- **Marker:** `evidence.signature.canonicalization: "jcs-rfc8785"`. The name is provisional (Q-B2).
  - It lives **inside `signature`**, which is `@type: @json` in the hardware-evidence context (`vrc-contexts/src/hardwareEvidenceContext.ts:60`), so it canonicalizes as part of a JSON literal with no context change.
  - Under the legacy `DTG_CONTEXT_URL` `@vocab`, it is a nested member signed through `@vocab`.
  - A new *top-level* evidence member would throw in safe mode under the `@protected` context (companion Part 1, G29) and would need a new context document. That is why the marker is not one.
- **Verifier selection.** Marker present → JCS. Marker absent → the legacy bytes, the Stage 1 path. An unknown marker value fails closed (`unsupportedCanonicalization`).
- **`signedContentHash`** stays emitted, informative only, equal to SHA-256 of whichever bytes were signed. The Stage 1 consistency check still applies.
- The upstream drafts propose the same binding (§8.4).

## 5. Interactions

### 5.1 G32 (landed at bifold `508482a27`)

- `issuerScope: 'pairwise'` is emitted before hardware signing (`vrc-manager.ts:395`), so it is inside the signed bytes. It is a top-level member, and its position survives the Credo round trip (§3 measurement; `vrcSignedContentKeyOrder.test.ts`).
- `useDi = useVc20` (`:349`), and `counterpartySpeaksVc20` now requires RCE ≥ 3, so every VC 2.0 VRC carries `DataIntegrityProof`. This does not change the hardware binding. It does mean the issuer proof covering `evidence` is always a DI proof on VC 2.0.
- Neither Stage changes G32 behaviour.

### 5.2 The hardware-evidence context (G29/G30)

- Stage 1 changes no evidence member.
- Stage 2's marker sits inside the `@json` `signature` (§4.4). No context bytes change, which matters because contexts are frozen and credentials issued against the provisional IRI must keep resolving (plan §2.6).
- `hardwareEvidenceVocabulary.test.ts` gains the marker under both contexts (§7.1).

### 5.3 The VWC digest

`object.digestMultibase = taskDigestMultibase(VRC)` covers `evidence` as data (plan §3.1). Neither Stage changes how it is computed. Stage 2 changes the signature bytes inside the evidence of *new* credentials only, and a VWC is always computed over the VRC it witnesses. There is no effect on `checkSubjectBinding` (`trust-tasks/witnessCeremony.ts`).

### 5.4 Compatibility and versioning

Keyring is pre-production. Anything not stored on a current demo device may break freely. Dual-read is kept where a stored credential's badge would otherwise flip.

| Signer | Verifier | iOS-origin evidence | Android-origin evidence |
|---|---|---|---|
| any pre-Stage-2 | Stage 1+ | verifies (reconstruction == signer bytes, §3) | verifies (unchanged) |
| any pre-Stage-2 | pre-Stage-1 (old app) | verifies (substitution) | verifies |
| Stage 2 (JCS + marker) | Stage 2 | verifies | verifies |
| Stage 2 | Stage 1 | **warning badge**: marker ignored, legacy bytes rebuilt ≠ JCS bytes, `contentBindingMismatch` | **warning badge** |
| Stage 2 | pre-Stage-1 (old app) | verifies (substitution of the informative hash) | **warning badge**: legacy bytes ≠ JCS bytes; the key orders differ for every current shape (e.g. `credentialSubject` sorts before `issuer`) |

- **The witness is unaffected by both Stages.** It does not verify hardware evidence (`credentialBuilder.ts:270-273`), and the marker canonicalizes under both contexts.
- The witness-loader risk in the companion (Part 1 G30 "Open risk"; Part 2 §3.5) concerns the *context IRI*. Stage 2 adds none, so it creates no new witness-ordering constraint.
- The legacy-peer and old-witness failure simulations in the companion's Part 2 §5 item 2 are unaffected.

**`RCE_PROTOCOL_VERSION`** (currently 5, `vrc-manager.ts:148`):
- Stage 1 needs no bump; it is verifier-only.
- Stage 2 needs a bump only if an un-upgraded peer must keep showing "Secure Exchange" for Stage-2 evidence. The gate would sign JCS bytes only for a peer announcing v6, the same pattern as the v5 context gate (plan §2.6).
- The degradation without a bump is a non-blocking warning badge. The exchange itself completes (`CredentialOffer.tsx:333-341` only logs and sets state).
- Recommendation: **no bump** (pre-production, fleet upgraded together after the demo). The decision is Brendan's (Q-B1).
- Stage 2 dual-read of marker-less evidence stays **permanently**. It costs one branch, and every VRC stored before Stage 2 depends on it.

## 6. Implementation steps

Each commit is one conventional commit in bifold (DCO sign-off as the last line), then a superproject bump. Line numbers refer to §2.

### Stage 1 (G33)

**S1.1 — JS binding gate.** `fix(hardware-signing): verify App Attest evidence against the recomputed content hash`
- New `core/src/hardware-signing/binding.ts`:
  - `contentHashBase64(content: string): string` using `@noble/hashes/sha2.js` and `TextEncoder`;
  - `checkEmbeddedContentHash(evidence, content): { ok: true } | { ok: false; error: string }`.
- `verify.ts` `verifyEvidence`:
  - make `signedContent` required;
  - run the gate before the native call;
  - pass `contentHashBase64(signedContent)` as the sixth argument (`:91-98`);
  - map a native `contentBindingMismatch` error to `signatureValid: false`.
- `BiometricSignatureVerifier.ts`: unchanged apart from comments, since `extractSignedContent` stays the reconstruction. Export it through a test-only path, or move it to `binding.ts` so Stage 2 can extend it.
- `react-native-attestation/src/index.ts:400` JSDoc: the sixth argument is "SHA-256 of `signedContent`, computed by the caller; never a value taken from evidence".
- *Acceptance:* §7.1 unit tests U1–U8 green; `core` `yarn test`; root `yarn typecheck`.

**S1.2 — Kotlin native gate.** `fix(attestation): fail App Attest verification when the supplied hash differs from the content`
- Extract a pure function in a new `android/src/main/java/com/attestation/ContentBinding.kt`: `resolveClientDataHash(content: ByteArray, suppliedB64: String): Result` (hash or error). It uses `java.util.Base64`, because the module's `android.util.Base64` returns defaults under `unitTests.returnDefaultValues = true` (`android/build.gradle:85-86`).
- Use it at `:1516-1535`. Apply the consistency check on the raw path (`:1562`). Require non-empty `signedContent`. Remove the two stale log lines.
- *Acceptance:* new `ContentBindingTest.kt` (JUnit) green under the attestation module's `testDebugUnitTest`. The expected invocation is `cd app/android && ./gradlew :bifold_react-native-attestation:testDebugUnitTest`; the project name comes from `UPGRADE_PROGRESS.md:512`, and it was not run here. `./gradlew assembleDebug` builds.

**S1.3 — Obj-C++ native gate.** Same subject, iOS.
- A static C helper `checkSuppliedClientDataHash(NSData *computed, NSString *suppliedB64, NSString **error)` replaces `:1437-1456`. A wrong-length or undecodable value is an error, not a silent fallback.
- Apply the same consistency check on the raw path (`:1481`).
- *Acceptance:* the iOS device build succeeds (`e2e/README.md:197-205`). There is no XCTest target in the package; behaviour is proven by §7.4.

**S1.4 — e2e strictness.** `test(e2e): an opt-in strict hardware-verification mode for device runs`
- `E2E_REQUIRE_HW_VERIFIED=1` disables the Android "attempt seen, continuing" fallback in `assertSecureExchangeBadge` (`e2e/lib/flows.js:1537-1546`). Without that change, a fail-closed Android verifier passes `yarn e2e:vrc:devices`.
- It also turns on `requireSecureExchange` in `witnessedExchangeFlow.js:496-500`.
- It adds log assertions:
  - the absence of `contentBindingMismatch` in both platforms' logs;
  - for iOS-origin evidence on Android, the presence of `✓ Apple CBOR assertion signature valid` (`AttestationModule.kt:1552`);
  - for iOS-origin evidence on iOS, `3/3 Assertion signature: VALID` (`Attestation.mm:1471`).
- The harness's existing Android JS-log reader and the iOS `idevicesyslog`/`getLogs('syslog')` captures (`run-vrc-exchange-devices.js:218-230`; `e2e/README.md:386-390`) supply the logs.
- *Acceptance:* the device run in §7.4.

**S1.5 — superproject.** Bump bifold and update `docs/HARDWARE_ATTESTATION_FLOW.md` item "iOS hash trust" (G34 overlap). Record G33 in plan §2.6 and the companion.

**Rebuilds for Stage 1.**
- JS: Android debug builds load JS from Metro. `@bifold/core`, `@bifold/react-native-attestation` and `@bifold/trust-tasks` are Metro source packages (`app/metro.config.js:32-42`), so no package build is needed for a JS-only change, only `yarn start --reset-cache`.
- iOS device builds bundle JS (`FORCE_BUNDLING=1`, `e2e/README.md:67-69`, `:197-205`) and need a rebuild for any change.
- Native: Android `cd app/android && ./gradlew assembleDebug`. iOS: rebuild the device app. `pod install` is needed only if the podspec or file list changes, and adding a `.kt` file or editing `.mm` does not change the podspec.
- Witness: none. It runs from the working tree with `ts-node --transpile-only` (`e2e/lib/witness.js:179-182`) and does not verify hardware evidence.
- `vrc-contexts`/`vrc-shared`/`trust-tasks` builds: none for Stage 1.

**Rollback, Stage 1.** Revert S1.1–S1.3. No stored data or wire format changed, so a revert is complete. With S1.1 alone reverted, the natives still enforce the binding. With the natives alone reverted, S1.1 still enforces it through (E).

### Stage 2 (canonical bytes)

**S2.1 — binding helper.** `feat(hardware-signing): canonical (JCS) signed-content bytes with a version marker`
- `binding.ts` gains:
  - `CANONICALIZATION_JCS = 'jcs-rfc8785'`;
  - `signedContentFor(credential, scheme: 'legacy' | 'jcs-rfc8785')`, which strips `evidence`/`proof`, restores `@context`, and rejects non-well-formed UTF-16;
  - `schemeOf(evidence)`.
- Choose one `jcsCanonicalize`. Recommended: `@bifold/trust-tasks`' (`canonicalize` package, already used on device), and pin its agreement with `vrc-contexts`' (§7.1 U10).
- `types.ts:89-97` gains `canonicalization?: 'jcs-rfc8785'`. `BuildEvidenceInput` (`types.ts:144-161`) and `buildEvidenceBlock` (`evidence.ts:364-368`) carry it.
- `modules/vrc/services/EvidenceBuilder.ts:60-65` and `hardware-signing/service.ts:111-114` pass it through.

**S2.2 — signer.** `feat(vrc): hardware-sign the JCS form of the VRC`
- `vrc-manager.ts:665` and `:1168` call `signedContentFor(credential, 'jcs-rfc8785')` and pass `canonicalization` to `buildEvidenceFromSignature` (`:695`, `:1195`).
- If Q-B1 decides a v6 gate, add `counterpartySpeaksJcsBinding` beside `counterpartySpeaksHardwareEvidenceContext`, bump `RCE_PROTOCOL_VERSION` to 6 with a doc line in its header comment (`vrc-manager.ts:114-148`), and have `witness-server` announce nothing, since it is not a peer.

**S2.3 — verifier.** `BiometricSignatureVerifier.verifyVrcHardwareEvidence` selects bytes by `schemeOf(evidence)`. An unknown scheme is `valid: false`.

**S2.4 — context test.** Extend `hardwareEvidenceVocabulary.test.ts` and `diConformance.test.ts` with the marker under both contexts.

**Rebuilds for Stage 2.**
- `@bifold/trust-tasks` and `@bifold/vrc-contexts` are Metro source packages for the app.
- The **witness** and `vrc-reference` resolve `build/index.js` (`package.json` `main`), so rebuild whichever one S2.1 touches (`yarn workspace @bifold/<pkg> run build`; never bifold's root `yarn build`, `e2e/README.md:127-132`). Stage 2 does not change witness behaviour; the rebuild only keeps its tests' imports current.
- iOS device rebuild; Android via Metro. No native change.

**Rollback, Stage 2.** Revert S2.2 first, which stops emitting the marker. Keep S2.1/S2.3's dual-read so credentials issued while Stage 2 was live keep verifying. Do not revert the verifier while any such credential is stored.

## 7. Test plan

### 7.1 JS unit tests (`core`, Jest; the native module mocked as in `BiometricSignatureVerifier.test.ts`)

| # | Test | Expect |
|---|---|---|
| U1 | Genuine iOS-shaped evidence; embedded hash = SHA-256(content) | native called with the **computed** hash; valid |
| U2 | Credential body tampered after signing, evidence kept (embedded hash still the original) | `contentBindingMismatch`, native **not** called |
| U3 | Embedded hash swapped for SHA-256 of different content | `contentBindingMismatch` |
| U4 | Embedded hash absent | native called with the computed hash |
| U5 | Empty or missing `signedContent` to `verifyEvidence` | `valid: false`, native not called |
| U6 | `verifySignedPayload` with a payload other than the one signed | `contentBindingMismatch` |
| U7 | Evidence from credential X attached to credential Y (both genuine shapes) | mismatch |
| U8 | Top-level keys reordered in the received credential (legacy scheme) | mismatch under Stage 1. It passes under Stage 2's JCS scheme (S2) |
| U9 | Credo round trip: the real builder output → `W3cCredential` and `W3cJsonLdVerifiableCredential` → reconstruction equals signed bytes, both schemes (extends `vrcSignedContentKeyOrder.test.ts`) | equal |
| U10 | `@bifold/trust-tasks` and `@bifold/vrc-contexts` `jcsCanonicalize` agree on every VRC shape and every evidence variant (S2) | equal |
| U11 | Subject with an extra member: legacy bytes differ after the Credo round trip, JCS bytes equal (pins the §3 latent break) | as stated |
| U12 | Unknown `canonicalization` value (S2) | `valid: false` |
| U13 | Lone surrogate in content (S2) | rejected before hashing |

The real cryptographic negatives run in Node, not against the mock. A test-only helper mirrors the native algorithm: it verifies a *captured real* App Attest assertion with `appAttest.ts`'s `verifyAppAttestAssertion` against `SHA-256(reconstruction)`. That turns U2, U3 and U7 into real-signature failures rather than mock assertions, and it fills the `describe.skip` at `witness-server/__tests__/unit/appAttest.test.ts:295` from the same capture.

### 7.2 Native tests

- **Kotlin:** JUnit exists (`android/src/test/java/com/attestation/AttestationModuleTest.kt`, `junit:4.13.2` at `android/build.gradle:123`). S1.2's pure `ContentBinding.kt` gets `ContentBindingTest.kt`, covering: supplied hash equal, differing, wrong length, undecodable, empty; empty content.
- A full-path JVM test of `verifyHardwareEvidence` is not planned. It needs React Native `Arguments`/`Promise` and `android.util.Base64`, which is Robolectric territory. The pure-function split is the design response.
- Whether JUnit runs in CI was **not established**: `.github/workflows/quality.yml:125` runs `yarn test` only.
- **iOS:** no XCTest target exists in `react-native-attestation`. Adding one to `app/ios` is optional and not required for acceptance. The helper in S1.3 is a static C function precisely so a future target can call it.

### 7.3 Cross-platform matrix

| Signer → verifier | Path | Existing scenario that covers it | Strict today? |
|---|---|---|---|
| iOS → Android | Kotlin CBOR (the G33 leg) | `yarn e2e:vrc:devices` (Android receives Bob's evidence) | **No**: Android fallback at `flows.js:1540-1546` continues when any `[VRC:Verify]` line exists |
| Android → iOS | Obj-C raw | `yarn e2e:vrc:devices` (iOS receives Alice's) | yes (the fallback returns false on iOS, `flows.js:1489`) |
| iOS → iOS | Obj-C CBOR | `yarn e2e:vrc:witnessed:ios-devices` (`requireSecureExchange: true`, `run-vrc-exchange-witnessed-ios-devices.js:110`) | yes |
| Android → Android | Kotlin raw | `yarn e2e:vrc:devices:android-only`, `yarn e2e:vrc:witnessed:android-only` | no (same fallback; the witnessed runner defaults `requireSecureExchange` to false, `witnessedExchangeFlow.js:496-500`) |
| witness as verifier | none: the witness does not verify hardware evidence | the locality key match only (`yarn e2e:vrc:witnessed:locality:*`) | not applicable |

### 7.4 Real-device acceptance (attended, Brendan with the assistant)

**Before the demo, on the current code (no G33 change).** Capture the diagnostic that makes Stage 1 safe to ship.
- In the `yarn e2e:vrc:devices` run, Android logcat must show **no** `Embedded hash differs from SHA256(signedContent)` line when verifying Bob's (iOS) evidence.
- In `yarn e2e:vrc:witnessed:ios-devices`, the iOS syslog must show no `⚠ Embedded hash differs` line.
- Either line appearing means some path re-serializes the VRC. Stage 1 would then flip that badge to a warning, and the path must be found first.
- Also save one iOS-origin VRC **with its full evidence**. The in-app `[VRC:IssuedCredentialJSON]` dump omits PEMs (`run-vrc-exchange-devices.js:185-186`), so add a debug-only full dump or read the record. It becomes the fixture for §7.1's real-signature negatives.

**Stage 1 run.**

Prepare:
- Android APK (`./gradlew assembleDebug`) and iOS device app (`FORCE_BUNDLING=1 …`), both built from the same superproject commit, after `yarn mediator` has written `app/.env` (tunnel mode for devices);
- one Android phone with a post-RKP attestation chain (older devices only reach the warning, `e2e/README.md:414-422`), one iPhone, and an iPad for the iOS↔iOS leg;
- Face ID/Touch ID and a passcode on each, Developer Mode, and UI Automation (iOS);
- `adb logcat -c` before the run.

Run, all with `E2E_REQUIRE_HW_VERIFIED=1`:
1. `yarn e2e:vrc:devices`
2. `yarn e2e:vrc:witnessed:ios-devices`
3. `yarn e2e:vrc:devices:android-only`, if a second post-RKP Android phone is available

Capture:
- `e2e/artifacts/attestation-logcat-*.txt`, `attestation-syslog-*.txt`, the `ios-device-*.log` files, and the badge screenshots;
- the native verifier lines, from Android `VRC:Android` tags and iOS `[VRC:iOS]`.

Pass:
- the "Secure Exchange" badge for the peer on every receiver, with no fallback;
- the platform's native "signature valid" line for each direction;
- **zero** `contentBindingMismatch`, and zero `Embedded hash differs` (the line no longer exists; its presence means a stale binary).

Fail:
- any missing badge;
- any `contentBindingMismatch`;
- a banner showing `AttestationWarning` on a receiver whose device chain verified in the pre-demo run.

**Stage 2 run.** Same preparation and the same three scripts. In addition:
- the saved issued-credential dumps show `signature.canonicalization: "jcs-rfc8785"`;
- a pre-Stage-2 VRC stored on the device before the upgrade still shows "Secure Exchange" after it (dual-read).

For the dual-read check, keep one pair with an exchange made on the Stage 1 build, upgrade the build in place, and reopen the contact. The harness installs fresh by default, so this check is manual, or uses `E2E_KEEP_STATE=1` where the runner honours it (`e2e/README.md:514-519` shows the pattern for another runner).

**Only a real-device run proves:**
- that real App Attest assertions and real StrongBox/TEE signatures verify under the new gate;
- that the iOS↔Android byte reconstruction holds on Hermes on both platforms;
- that no path between signer and verifier re-serializes the credential.

## 8. Risks, questions, sequencing, upstream

### 8.1 Risks

1. **An unmeasured re-serialization path** (a non-JS peer, JSON-LD compaction, a future Credo release) flips genuine iOS-origin badges to warnings under Stage 1. Mitigation: the pre-demo log check (§7.4); Stage 2 removes the dependence.
2. **The e2e harness hides fail-closed Android verification** (`flows.js:1540-1546`). Without S1.4, the G33 leg can regress silently.
3. **Two JCS implementations** (hand-rolled and `canonicalize`) disagree on an input class that no current VRC contains, such as numbers or unusual strings. Mitigation: U10, plus rejecting non-well-formed strings.
4. **Stage 2 and the demo fleet.** A mixed fleet shows warning badges for Stage-2 evidence at un-upgraded verifiers (§5.4). This is non-blocking but visible.
5. **The binary and the JS drift apart on iOS** (a bundled JS build with a stale native, or the reverse). Mitigation: (E) makes either half sufficient for the binding on its own.
6. **Pushing this analysis** to the public repos before Stage 1 is on devices (Q-B6).

### 8.2 Open questions for Brendan

- **Q-B1** Stage 2: gate JCS signing on RCE v6, or not (recommended: not; §5.4).
- **Q-B2** The marker name and value (`signature.canonicalization: "jcs-rfc8785"` proposed). Align with the registry draft's `binding` wording if it is filed first.
- **Q-B3** Should the Android key-attestation extension (`attestationSecurityLevel`, `verifiedBootState`) be *enforced*, not just reported? It is outside G33 and recorded as F-item candidates (§10).
- **Q-B4** Pin the App Attest App ID (rpIdHash) in both natives (F1)? It needs the per-build `<teamId>.<bundleId>` (team `947XHQ9DVC`, `e2e/README.md:197-205`) and a decision on development versus production App Attest environments.
- **Q-B5** Whether `verifySignedPayload`, which has no in-repo caller, should stay public API or be marked experimental until F1/F2 land.
- **Q-B6** Whether this document and the G33 text in plan §2.6 are pushed before Stage 1 lands. `feat/vsc-migration` is 67 commits ahead of `origin` at the time of writing, so nothing about G33 is public yet.

### 8.3 Sequencing (recommended)

1. **Now, pre-demo:** the device run on the current changes (companion Part 2 §5 item 4, G38), with the §7.4 "before the demo" diagnostic and fixture capture added. No G33 code.
2. **Demo.**
3. **Stage 1** as its own change with its own device run (§7.4 "Stage 1 run").
4. **Stage 2** as a separate change, before any VRC `credentialSubject` member is added, with its own device run.

Stage 1's JS half (S1.1) is small and could technically ship before the demo. It is held back because an unexpected mismatch on the demo fleet would flip visible badges, and the pre-demo diagnostic is what shows that it will not.

### 8.4 The upstream drafts

`/srv/dev/scratch/2026-09-30-bam-cred-spec-issue-evidence-extension-members.md` (binding requirement, `:194`) and `…-registry-issue-evidence-vocabulary.md` (`:146` Android binding; `:234` `signedContentHash` "informative only"; `:255`) propose the general rule: *a verifier recomputes the binding from the credential it holds, and a hash carried in the evidence never substitutes for it; the RECOMMENDED input is the JCS form without `evidence` and `proof`*.

- **Filing does not have to wait for G33 code.** The rule is general, discloses nothing Keyring-specific, and the drafts make no claim that Keyring's current emitter conforms. The cover note already frames it this way (`…-evidence-issues-cover.md:38-40`).
- **What conformance takes.** Our emitter satisfies "never substitute" only after Stage 1, and "JCS input" only after Stage 2, on **both** platforms: the Android emitter signs insertion-order JSON too.
- **One wording change is needed.** The registry draft's Android and Apple profile sketches read naturally as descriptions of "the evidence block one wallet already emits" (`:120`). Until Stage 2 lands, keep every binding statement explicitly a *proposed profile requirement*, and avoid any sentence tying the JCS binding to Keyring's current output.
- **Honest public framing:** "we propose this binding rule and are aligning our implementation to it". There is no mention of G33, and no description of what a non-conforming verifier would accept. The gap is in Keyring's own pre-production code with no external deployments known to this plan, so no third-party disclosure is involved.
- **Filing stays gated** on Brendan's review and the phase-2 verification (companion Part 2 §4).

## 9. Acceptance criteria and effort

| # | Criterion | Proven by | Device only? |
|---|---|---|---|
| A1 | A native verdict on iOS-origin evidence depends on the credential content: tampered body → invalid | U2, U7 (mock and Node real-signature), `ContentBindingTest.kt` | real assertion: yes (fixture from §7.4) |
| A2 | A supplied or embedded hash that differs from SHA-256(content) is a hard failure with `contentBindingMismatch`, on both natives and in JS | U2, U3, `ContentBindingTest.kt`, S1.3 code review | the iOS native path: yes |
| A3 | Every genuine exchange still verifies: iOS→Android, Android→iOS, iOS→iOS, Android→Android | §7.4 Stage 1 run, strict mode | **yes** |
| A4 | The e2e harness fails a device run on a missing "Secure Exchange" badge when strict | S1.4, observed in the Stage 1 run | yes |
| A5 | `verifySignedPayload` rejects a payload the evidence was not produced over | U6 | no |
| A6 | Reversed certificate chain, or wrong public key → invalid (regression guard) | existing chain/key-match behaviour; add U-tests with the §7.4 fixture | the real chain: yes |
| A7 | (S2) New VRCs sign JCS bytes and carry the marker; the marker canonicalizes under both contexts; reordered keys still verify | U8, U9, U11, S2.4 tests, dumps from the Stage 2 run | Hermes byte agreement: yes |
| A8 | (S2) A pre-Stage-2 stored VRC keeps its badge after upgrade | §7.4 Stage 2 dual-read check | yes |
| A9 | No witness behaviour change | `witness-server` `yarn test` green, no witness source diff in Stage 1 | no |

**Effort as work items, no calendar:**
- **Stage 1** is five commits (S1.1–S1.5). About eight JS unit tests, one Kotlin test file, one Obj-C helper. One harness flag with three log assertions. One attended device session covering three scripts.
- **Stage 2** is four commits (S2.1–S2.4). About five more JS tests and two context-test extensions. One attended device session, including a manual in-place upgrade check.
- **Pre-demo diagnostic:** two log greps and one full-evidence fixture capture, inside the already-planned device run.

## 10. Adjacent gaps found here, not in G33's scope

Numbered F-items so the parent can assign G numbers. None is decided.

- **F1** App Attest `rpIdHash` is not checked on either native, so an assertion from any app's App Attest key with a valid Apple chain passes. `appAttest.ts:227-278` shows the check. See Q-B4.
- **F2** No sign-counter state. With the content binding in place, a replayed assertion only re-proves identical bytes, but the badge cannot say "fresh".
- **F3** The credential certificate's nonce extension is not checked, and the attestation object is not carried, only its x5c chain.
- **F4** The hardware signature does not cover the evidence metadata (`authenticationMethod`, `keyStorage`, `created`), which rests on the issuer proof alone. On iOS, user verification is an app-enforced `LAContext` gate, not a key property, so `BiometricAttestation` from iOS is the app's claim.
- **F5** `hardwareBinding.publicKey` is not bound to the issuer DID or the relationship. The witness takes the evidence key unverified for the locality key match (`credentialBuilder.ts:345-356`), which is mitigated by the live transcript signature (`locality.ts:242`).
- **F6** On the Android verifier, the Kotlin Apple path accepts an embedded hash of any length (`AttestationModule.kt:1522-1523`). Subsumed by Stage 1.
- **F7** Credo 0.7 moves `credentialSubject.id` last on round trip (§3). This also matters to anything else that signs or digests insertion-order JSON of a Credo-rebuilt credential. It is not a JCS or `digestMultibase` issue.
