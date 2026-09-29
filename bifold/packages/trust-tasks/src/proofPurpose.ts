import type { ProofPurpose } from './documentProof'

/**
 * Registry slugs whose request documents are the issuer's attestation — an
 * approver's decision a third party relies on — and so are signed for
 * `assertionMethod`. Every other document is operational and is signed for
 * `authentication` (vta-sdk `ATTESTATION_SLUGS`, VTI afcf2470
 * vta-sdk/src/trust_task_proof/purpose.rs; VTI-KEY-106, VTI-KEY-022).
 */
export const ATTESTATION_SLUGS = ['auth/step-up/approve-response', 'task-consent/decision', 'confirm/response'] as const

// A Trust Task type URI on the public registry: exactly
// `https://trusttasks.org/spec/<slug>/<major>.<minor>`, lower case, with an
// optional `#request` or `#response`. Anything else — another host, a port,
// user info, a prefix, a capital — is not a registry type and is classified
// operational, as vta-sdk's TypeUri::canonical comparison does.
const REGISTRY_TYPE = /^https:\/\/trusttasks\.org\/spec\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)\/\d+\.\d+(#request|#response)?$/

/**
 * The purpose a Trust Task document of `typeUri` is signed for, as vta-sdk
 * signs it (`purpose_for_document_type`): `assertionMethod` only for a request
 * document of an attestation slug, `authentication` for everything else,
 * including that slug's `#response`. Nothing but the type decides it.
 */
export function purposeForDocumentType(typeUri: string): ProofPurpose {
  const match = REGISTRY_TYPE.exec(typeUri)
  if (!match || match[2] === '#response') return 'authentication'
  return (ATTESTATION_SLUGS as readonly string[]).includes(match[1]) ? 'assertionMethod' : 'authentication'
}
