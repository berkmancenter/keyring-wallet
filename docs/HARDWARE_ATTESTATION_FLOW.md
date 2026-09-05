# Hardware Attestation & Biometric Signing Flow

Technical documentation for the VRC (Verifiable Relationship Credential) hardware
attestation and biometric / device-credential signing path.

Last reviewed: 2026-07-13 (aligned with native `verifyHardwareEvidence` + Google
multi-root trust anchors + real-device E2E).

---

## Implementation Status at a Glance

| Feature | Status | Notes |
|---------|--------|-------|
| Hardware key generation | ✅ | iOS Secure Enclave, Android StrongBox → TEE → Software fallback |
| User-verified signing | ✅ | Biometric **or** device passcode (`DevicePasscode`) |
| Attestation retrieval | ✅ | Apple App Attest, Android Key Attestation |
| Evidence block (W3C) | ✅ | Attached to VRC before Credo LD proof |
| Full X.509 chain verification | ✅ | **Native** — iOS `SecTrust`, Android `CertPathValidator` |
| Trust anchors | ✅ | Apple App Attest chain; Google roots (legacy RSA, re-signed RSA, RKP ECDSA) |
| Public key ↔ leaf match | ✅ | Native compares evidence pubkey to leaf cert |
| Certificate expiry / path checks | ✅ | Native chain validation |
| Signature / assertion verify | ✅ | Android DER ECDSA; iOS App Attest CBOR assertion |
| Preference gate | ✅ | `useHardwareAttestation` (default **off** in store; Settings → Secure Exchanges) |
| Standalone use (no Credo/DIDComm) | ✅ | `core/src/hardware-signing/` — see "Using it without VRC, Credo or DIDComm" |
| Emulator / simulator E2E | ⚠️ | No real App Attest / TEE attestation — evidence skipped |
| Real-device E2E | ✅ | `yarn e2e:vrc:devices` — requires Secure Exchange banner both ways |

---

## Overview

When two wallets exchange a VRC **and** hardware attestation is enabled, each
issuer signs the credential content with a **hardware-backed key** (Secure Enclave /
StrongBox/TEE) after user verification (biometric or device passcode). The
evidence block proves: (1) a human approved the exchange, (2) the key lives in
attested hardware, (3) that key signed this VRC content.

This is **orthogonal** to the VC Linked Data / Data Integrity **proof suite**
(today `Ed25519Signature2018` on the relationship DID key). See
[`CRYPTO_SUITE_FOLLOWUP.md`](./CRYPTO_SUITE_FOLLOWUP.md).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           JAVASCRIPT LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ vrc-manager  │→ │ vrc-biometric│→ │vrc-hardware- │→ │ Evidence-   │  │
│  │              │  │              │  │   signing    │  │  Builder    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘  │
│         │                                            ↓                    │
│         │          react-native-attestation (JS bridge)                   │
│         ↓                                          │                     │
│  BiometricSignatureVerifier.verifyEvidence() ──────┘                     │
│         → native verifyHardwareEvidence(...)                              │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Native Bridge
┌────────────────────────────────────┴────────────────────────────────────┐
│                            NATIVE LAYER                                  │
│  ┌────────────────────────┐          ┌─────────────────────────────┐    │
│  │ iOS: Attestation.mm    │          │ Android: AttestationModule  │    │
│  │ • Secure Enclave       │          │ • KeyStore / StrongBox/TEE  │    │
│  │ • App Attest           │          │ • GoogleAttestationChain-   │    │
│  │ • SecTrust verify      │          │   Validator + Roots         │    │
│  └────────────────────────┘          └─────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

JS no longer owns PEM trust-anchor string matching. `CertificateVerifier.ts` /
JS `trustedRoots.ts` were superseded by native verification.

---

## Signing Flow (issuer, when creating a VRC)

### Prerequisite: preference on

`PersistentStorage` / Preferences: `useHardwareAttestation`. Default in the React
store is **`false`**. Users enable it under Settings → **Secure Exchanges**
(PIN-gated). Real-device E2E turns this on after onboarding.

### Step 1: UI confirmation

`BiometricConfirmationModal` → `requestBiometricWithHardwareSigning()`.

### Step 2: Hardware key

`ensureHardwareSigningKey()` — create or reuse EC P-256 key in Secure Enclave /
StrongBox/TEE, user-verification bound.

### Step 3: Attestation pre-warm (first install)

iOS App Attest registration can need retries (`preWarmAttestation()`).

### Step 4: Content to sign

VRC JSON **without** `evidence` / Credo `proof` is hashed/serialized; native
signing returns DER ECDSA (Android) or App Attest assertion material (iOS), plus
`signedContentHash` for cross-platform verify.

### Step 5: Evidence block

`EvidenceBuilder.buildEvidenceFromSignature()` — current shape (passcode example
from real-device E2E):

```json
{
  "id": "urn:uuid:...",
  "type": ["DeviceAuthentication", "HardwareKeyAttestation"],
  "created": "2026-07-13T23:47:53.516Z",
  "authenticationMethod": {
    "type": "DevicePasscode",
    "authenticatorType": "platform",
    "userVerification": "required"
  },
  "hardwareBinding": {
    "keyStorage": "SecureEnclave",
    "platform": "ios",
    "keyType": "EC-P256",
    "algorithm": "ECDSA-SHA256",
    "publicKey": "BASE64..."
  },
  "attestation": {
    "format": "apple-appattest-v1",
    "certificateChain": ["LEAF_PEM", "CA_PEM"]
  },
  "signature": {
    "value": "BASE64...",
    "algorithm": "ECDSA-SHA256",
    "signedContentHash": "BASE64..."
  }
}
```

Biometric path uses `type: ["BiometricAttestation", "HardwareKeyAttestation"]` and
an equivalent `authenticationMethod` / legacy `biometricMethod`.

### Step 6: Offer over DIDComm

Credo signs the credential with **`Ed25519Signature2018`** (relationship DID) and
sends the offer. Hardware evidence is already on the credential object.

---

## Verification Flow (holder, when receiving a VRC)

Single path: `HardwareSignatureVerifier.verifyEvidence()` → native
`verifyHardwareEvidence(...)`.

Native checks (both platforms where applicable):

1. Parse PEMs → X.509 certificates  
2. Full chain validation (signatures, expiry, constraints) against platform /
   embedded Google roots  
3. Evidence public key matches leaf certificate  
4. Signature or App Attest assertion verifies over `signedContentHash` / content  
5. Android: attestation extension fields; CRL where implemented  

### Verification levels (current)

| Level | Meaning |
|-------|---------|
| `cryptographic` | Native verification returned `valid=true` |
| `none` | Native verification failed |

(Older docs mentioned `attestation_trust` / `platform_trust` JS fallbacks — those
paths are gone; native crypto is always available on device builds.)

UI: Credential Offer shows **Secure Exchange** (`AttestationVerified`) when peer
evidence verifies.

---

## Google attestation roots

Embedded in `GoogleAttestationRoots.kt` (from bifold PR #23 / issue #20 work):

- Legacy RSA Google Hardware Attestation Root  
- Re-signed RSA root  
- RKP ECDSA root  

Validation uses `GoogleAttestationChainValidator` — **only** recognized Google
roots as trust anchors (no “self-as-anchor”). The historical single hard-coded
RSA root expired **2026-05-24**; multi-root embedding is required for new devices
and post-rotation chains.

---

## Known limitations

1. **Preference default off** — forgotten toggle ⇒ no evidence, no Secure Exchange.  
2. **Simulators** — cannot prove real hardware attestation; use `yarn e2e:vrc:devices`.  
3. **Log noise** — some JS paths may still warn about an expired *legacy* root copy;
   native multi-root validation is authoritative.  
4. **VC proof suite** — hardware evidence ≠ Data Integrity cryptosuite; see
   [`CRYPTO_SUITE_FOLLOWUP.md`](./CRYPTO_SUITE_FOLLOWUP.md).
5. **Older Android devices past the legacy root's expiry (2026-05-24)** —
   observed 2026-08-04 on a real-device `yarn e2e:vrc:witnessed:android-only`
   run: a Galaxy S20+ (Android, provisioned pre-RKP) issued a VRC whose
   hardware evidence the witness accepted (its check is a plain signature
   verify, not a chain/date check) but the **receiving** phone's local
   `GoogleAttestationChainValidator` rejected — "Hardware Verification Issue"
   instead of "Secure Exchange" — while the same run's Galaxy S25+ (RKP root,
   valid to 2035) verified cleanly both ways. `PKIXParameters` validates
   against the *current* date with no override, so any chain still
   terminating at the now-expired `LEGACY_RSA_ROOT_PEM` will keep failing this
   check going forward, regardless of retries — this isn't flaky, it's the
   root reaching its documented end of life. Whether Google is serving this
   specific device class a re-signed chain under `RESIGNED_RSA_ROOT_PEM`
   (expires 2042) wasn't confirmed here — the E2E harness omits raw PEMs from
   its credential dumps (`[VRC:IssuedCredentialJSON]`, by design) so the
   actual chain wasn't inspected — only the app's local `valid=false` verdict.
   An older factory-keyed device may now be permanently unable to pass the
   receiving side's *local* re-validation — but that's a fact about the
   physical device, not the app's exchange flow, which still completed
   correctly (VRC issued and accepted, VWC issued by the witness). The E2E
   harness (`acceptCredentialOfferFromChat` / `assertContactShields` in
   `e2e/lib/flows.js`) therefore treats the "Hardware Verification Issue"
   (`AttestationWarning`) banner as an accepted outcome, not a failure — only
   evidence never showing up at all still fails the run. Prefer a device
   provisioned after Google's RKP rollout (~2022+) if you specifically need
   to exercise the full "Secure Exchange" verified path.

---

## File Reference

| File | Purpose |
|------|---------|
| `core/src/hardware-signing/` | **Credo-free signing/evidence/verification core** (see below) |
| `core/src/modules/vrc/vrc-manager.ts` | Issue/offer; preference gate; offer `proofType` |
| `core/src/modules/vrc/vrc-biometric.ts` | Confirm UI + signing orchestration |
| `core/src/modules/vrc/vrc-hardware-signing.ts` | Credo adapter: `Agent` → logger, keeps the VRC-facing API |
| `core/src/modules/vrc/services/EvidenceBuilder.ts` | Credo adapter: Askar attestation cache + `utils.uuid` |
| `core/src/modules/vrc/services/BiometricSignatureVerifier.ts` | VRC-shaped verify wrapper (strips `evidence`/`proof`, restores `@context`) |
| `core/src/modules/vrc/types/evidence.ts` | Re-exports the evidence types; holds `VrcCredentialWithEvidence` |
| `core/src/screens/ToggleHardwareAttestation.tsx` | Settings toggle (PIN-gated) |
| `react-native-attestation/.../Attestation.mm` | iOS SE / App Attest / verify |
| `react-native-attestation/.../AttestationModule.kt` | Android KeyStore / verify |
| `react-native-attestation/.../GoogleAttestationRoots.kt` | Embedded Google roots |
| `react-native-attestation/.../GoogleAttestationChainValidator.kt` | Android chain vs Google anchors |

---

## Using it without VRC, Credo or DIDComm

`core/src/hardware-signing/` is the signing, evidence-assembly and verification
stack with the VRC orchestration removed. It imports exactly three things —
`@bifold/react-native-attestation`, `react-native` (`Platform`) and `buffer` —
and **no `@credo-ts/*`, not even as a type**. A boundary test
(`core/__tests__/hardware-signing/credo-free-boundary.test.ts`) fails the build
if that stops being true, because the point of the directory is that it can move
into its own package, or into a relying-party service, as a directory move.

```ts
import { createHardwareSigningService } from '@bifold/core/hardware-signing'

const signer = createHardwareSigningService()

if (await signer.isAvailable()) {
  await signer.prepare()                       // optional: front-load key + attestation
  const outcome = await signer.signPayload(loginChallenge)

  if (outcome.success) {
    // outcome.attestation is self-contained — POST it to the relying party
    // { payload, payloadHash, signedAt, evidence }
    // outcome.hasAttestation is false on emulators/simulators: the signature is
    // real, but there is no Apple/Google certificate chain behind it.
  }
}

// On the receiving side (no Credo needed, but native verification is, so this
// runs on a device):
const result = await signer.verify(attestation)
```

`SignedPayloadAttestation` is deliberately **not** a credential and not a
`credentialSubject` fragment: it is a payload plus the evidence block that a
specific attested device key signed exactly those bytes. A credential embeds one
of these in its `evidence` array — which is what VRC issuance does — but a
caller proving "this login challenge was signed by this device" does not have to
construct a credential to do it.

Two dependencies are injectable so the wallet's behaviour is unchanged while a
standalone caller still works with no setup:

| Injection | Wallet supplies | Default |
|---|---|---|
| `logger` | `agent.config.logger` | `console` |
| `attestationCache` | Askar-backed `AttestationStorageRepository` | in-memory, process lifetime |
| `generateId` | `utils.uuid` from `@credo-ts/core` | local RFC 4122 v4 |

---

## Log Prefixes

| Prefix | Component |
|--------|-----------|
| `[HW:Sign]` | Hardware signing (`src/hardware-signing/`) |
| `[HW:Evidence]` | Evidence building (`src/hardware-signing/`) |
| `[HW:Verify]` | Native verification wrapper (`src/hardware-signing/`) |
| `[VRC:Sign]` | The VRC adapter around `[HW:Sign]` |
| `[VRC:Biometric]` | Confirm / auth mode |
| `[VRC:Verify]` | VRC credential → evidence extraction |
| `[VRC:Attest]` | Attestation fetch / cache |
| `[VRC:IssuedCredentialJSON]` | Slim credential dump (E2E; PEMs omitted) |
| `VRC:Android` / iOS native tags | Native sign / verify |

---

## Testing

```sh
# Simulators — VRC exchange without real hardware evidence
yarn e2e:vrc

# Real phones — attestation + Secure Exchange (attended biometrics/passcode)
yarn e2e:vrc:devices
```

Details: [`../e2e/README.md`](../e2e/README.md). Artifacts under `e2e/artifacts/`
include attestation logcat filters and slim issued-credential JSON dumps.

---

## Security notes

1. Private key never leaves SE / StrongBox / TEE when those storages are used.  
2. Each signature requires user verification (biometric or device credential).  
3. Attestation chain proves platform vouchers for the hardware key.  
4. Hardware signs VRC **content** before evidence / Credo LD proof are attached.  
5. Receiver verifies evidence **natively** before treating the exchange as Secure.
