/**
 * Standalone hardware signing — "sign this payload with a device key, and get
 * verifiable evidence back", without instantiating Credo or DIDComm.
 *
 * ```ts
 * import { createHardwareSigningService } from '@bifold/core/hardware-signing'
 *
 * const signer = createHardwareSigningService()
 * if (await signer.isAvailable()) {
 *   const outcome = await signer.signPayload(loginChallenge)
 *   // outcome.attestation is self-contained: POST it to the relying party
 * }
 * ```
 *
 * ## Why this directory exists, and what must stay true of it
 *
 * The hardware-attestation stack is the most mature piece of infrastructure in
 * this repo (`docs/HARDWARE_ATTESTATION_FLOW.md`), but until now it could only
 * be reached through VRC credential issuance. Everything here is that stack
 * with the VRC orchestration taken off:
 *
 * - `key.ts`, `sign.ts` — extracted from `modules/vrc/vrc-hardware-signing.ts`
 * - `evidence.ts` — extracted from `modules/vrc/services/EvidenceBuilder.ts`
 * - `verify.ts` — moved from `modules/vrc/services/BiometricSignatureVerifier.ts`
 *
 * **Nothing under `src/hardware-signing/` may import `@credo-ts/*`, `tsyringe`,
 * or anything else from `@bifold/core` outside this directory.** That is not a
 * style preference: it is what makes the directory a `git mv` away from being
 * its own package, and it is what lets a relying-party service embed the
 * verification half without installing an agent framework (the pure /
 * Credo-adapter split argued in
 * `docs/plans/reference-app-sdk-packaging/2026-09-01-al.md`). The rule is
 * enforced by `__tests__/hardware-signing/credo-free-boundary.test.ts`, which
 * fails the build rather than letting the boundary rot.
 *
 * The permitted external dependencies are exactly three:
 * `@bifold/react-native-attestation` (the native module this is a client of),
 * `react-native` (`Platform`) and `buffer`.
 *
 * The Credo-side callers keep their existing signatures and behaviour — see
 * `modules/vrc/vrc-hardware-signing.ts` and
 * `modules/vrc/services/EvidenceBuilder.ts`, which are now thin adapters that
 * supply `agent.config.logger`, `utils.uuid` and the Askar-backed attestation
 * cache.
 *
 * @module hardware-signing
 */

export { createHardwareSigningService } from './service'
export type {
  HardwareSigningService,
  HardwareSigningServiceOptions,
  SignPayloadRequest,
  SignPayloadOutcome,
} from './service'

export { ensureHardwareKey, isHardwareSigningAvailable, preWarmAttestation, consoleLogger } from './key'
export type { HardwareKeyHandle } from './key'

export { signPayloadWithHardwareKey } from './sign'
export type { SignPayloadOptions } from './sign'

export { HardwareEvidenceBuilder, createInMemoryAttestationCache } from './evidence'
export type {
  AttestationCache,
  AttestationCacheEntry,
  BuildEvidenceResult,
  HardwareEvidenceBuilderOptions,
} from './evidence'

export { HardwareSignatureVerifier, verifySignedPayload } from './verify'
export type { SignatureVerificationResult, VerificationLevel } from './verify'

export type {
  AttestationCertificateChain,
  AttestationFormat,
  AuthenticationMethod,
  AuthenticationMethodType,
  BiometricMethod,
  BuildEvidenceInput,
  EvidenceTypeArray,
  HardwareAttestationEvidence,
  HardwareBinding,
  HardwareKeySignature,
  HardwareKeyStorage,
  HardwarePlatform,
  HardwareSignature,
  HardwareSigningLogger,
  HardwareSigningResult,
  SignedPayloadAttestation,
} from './types'
