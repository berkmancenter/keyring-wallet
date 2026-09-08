/**
 * Outcome-evidence assembly and verification — the last item of §9 step 5's
 * done-list: a presentation that ships a `taskContext`-bearing credential
 * TOGETHER with its matching trust task outcome evidence, and the verifier's
 * pairing algorithm (cred-spec, Outcome Interpretability):
 *
 *  - the initiating document's `id` equals the credential's `taskContext`,
 *    and the credential's `taskDigestMultibase` REPRODUCES over it (JCS,
 *    excluding the top-level `proof`, compared as decoded multihash bytes);
 *  - the terminal document's `threadId` equals
 *    `initiating.threadId ?? initiating.id` — pairing runs through the
 *    initiating document so a minted threadId cannot orphan evidence;
 *  - the terminal document is a SUCCESS response carrying its REQUIRED
 *    proof — an error response is failure evidence, never completion.
 *
 * The evidence travels BESIDE the presentation as a bundle rather than
 * embedded inside the VP's JSON-LD: task documents are JCS-secured artifacts
 * with their own proofs, and embedding them in an RDF-canonicalized VP would
 * re-open the vocabulary trap twice fixed this week. Discovery/retrieval of
 * evidence a verifier does not hold is out of scope per the spec — absent a
 * matching pair, the credential stays valid but evidences no completion.
 */

import type { Agent } from '@credo-ts/core'
import {
  ClaimFormat,
  JsonTransformer,
  W3cJsonLdVerifiableCredential,
  W3cJsonLdVerifiablePresentation,
  W3cPresentation,
} from '@credo-ts/core'

import { getTrustTasksService } from './ceremony'
import { digestBytesEqual, taskDigestMultibase, verifyDocumentProof } from './documentProof'

const LOG_PREFIX = '[TrustTasks:Evidence]'
const ERROR_TYPE_MARKER = '/trust-task-error/'

/** A `taskContext`-bearing credential with its matching outcome evidence. */
export interface VwcPresentationBundle {
  /** The signed Verifiable Presentation wrapping the VWC. */
  presentation: Record<string, unknown>
  outcomeEvidence: {
    /** The exchange's initiating document (the witness/session request). */
    initiating: Record<string, unknown>
    /** The terminal reply (the submit#response delivering the VWC). */
    terminal: Record<string, unknown>
  }
}

export interface AssembleOptions {
  /** The stored VWC, as JSON. */
  vwc: Record<string, unknown>
  /** Verification method id of the holder key that signs the presentation. */
  verificationMethodId: string
  /** Verifier-supplied binding; both required for a real presentation. */
  challenge: string
  domain: string
}

/**
 * Assemble the holder's bundle: sign a VP over the VWC and attach the
 * retained outcome pair located by the credential's own `taskContext`.
 * Throws when either half of the pair is missing — a holder MUST include
 * matching evidence, and shipping a hollow bundle would misrepresent one.
 */
export async function assembleVwcPresentation(agent: Agent, options: AssembleOptions): Promise<VwcPresentationBundle> {
  const subject = Array.isArray(options.vwc.credentialSubject)
    ? (options.vwc.credentialSubject[0] as Record<string, unknown>)
    : (options.vwc.credentialSubject as Record<string, unknown> | undefined)
  const taskContext = String(subject?.taskContext ?? '')
  if (!taskContext) throw new Error('credential carries no taskContext')

  const service = getTrustTasksService(agent)
  const pair = await service.getOutcomeEvidencePair(agent.context, taskContext)
  if (!pair.initiating || !pair.terminal) {
    throw new Error(`outcome evidence incomplete for taskContext ${taskContext}`)
  }

  const holderDid = options.verificationMethodId.split('#')[0]
  const contexts: unknown[] = Array.isArray(options.vwc['@context'])
    ? (options.vwc['@context'] as unknown[])
    : [options.vwc['@context']]
  const vpContext = contexts.includes('https://www.w3.org/ns/credentials/v2')
    ? 'https://www.w3.org/ns/credentials/v2'
    : 'https://www.w3.org/2018/credentials/v1'
  const vpUnsigned = JsonTransformer.fromJSON(
    {
      '@context': [vpContext],
      type: ['VerifiablePresentation'],
      holder: holderDid,
      verifiableCredential: [options.vwc],
    },
    W3cPresentation
  )
  // proofPurpose omitted deliberately — same runtime note as the witnessed
  // submit path: vc builds an AuthenticationProofPurpose from challenge+domain.
  const signedVp = await agent.w3cCredentials.signPresentation({
    format: ClaimFormat.LdpVp,
    presentation: vpUnsigned,
    verificationMethod: options.verificationMethodId,
    proofType: 'Ed25519Signature2018',
    challenge: options.challenge,
    domain: options.domain,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  return {
    presentation: JsonTransformer.toJSON(signedVp) as Record<string, unknown>,
    outcomeEvidence: {
      initiating: pair.initiating.document,
      terminal: pair.terminal.document,
    },
  }
}

/**
 * The verifier's verdict: never a bare boolean. `completionEvidenced` is the
 * Outcome-Interpretability inference specifically; `failures` name what
 * broke; `residuals` name what this verification cannot rule out.
 */
export interface EvidenceVerdict {
  credentialValid: boolean
  completionEvidenced: boolean
  failures: string[]
  residuals: string[]
}

export interface VerifyBundleOptions {
  bundle: VwcPresentationBundle
  challenge: string
  domain: string
}

/** Run the Outcome-Interpretability pairing algorithm over a bundle. */
export async function verifyVwcPresentationBundle(agent: Agent, options: VerifyBundleOptions): Promise<EvidenceVerdict> {
  const failures: string[] = []
  const { bundle } = options

  // Surface credo's own error detail when a proof fails. This function used to
  // discard it — verifyPresentation/verifyCredential expose only isValid, and
  // the credential path had a bare `catch {}` — so a failing self-check could
  // only ever report "did not verify", and the witness-share was withheld with
  // no way to learn why.
  //
  // That cost real time: the actual cause turned out to be a 296 ms clock skew
  // making the VWC not-yet-valid ("current date time … is before validFrom"),
  // which read as an intermittent, platform-specific crypto failure for weeks.
  // Keep these: an unregistered cryptosuite, an unresolvable context, a stale
  // clock and a genuinely bad signature are indistinguishable from isValid.
  const logger = agent.config.logger
  const detail = (r: unknown): string => {
    try {
      const anyR = r as { error?: unknown; validations?: unknown }
      const parts: string[] = []
      if (anyR?.error) parts.push(`error=${(anyR.error as Error)?.message ?? JSON.stringify(anyR.error)}`)
      if (anyR?.validations) parts.push(`validations=${JSON.stringify(anyR.validations)}`)
      return parts.join(' ') || JSON.stringify(r)
    } catch {
      return '<unserialisable>'
    }
  }

  // 1. The presentation verifies under the verifier's challenge and domain.
  let vwc: Record<string, unknown> | undefined
  try {
    const vp = JsonTransformer.fromJSON(bundle.presentation, W3cJsonLdVerifiablePresentation)
    const result = await agent.w3cCredentials.verifyPresentation({
      presentation: vp as never,
      challenge: options.challenge,
      domain: options.domain,
    })
    if (!result.isValid) {
      failures.push('presentation proof did not verify')
      logger.warn(
        `[TrustTasks:Evidence] presentation verification failed — challenge=${options.challenge} ` +
          `domain=${options.domain} ${detail(result)}`
      )
    }
    const credentials = (bundle.presentation as { verifiableCredential?: unknown[] }).verifiableCredential ?? []
    vwc = credentials[0] as Record<string, unknown> | undefined
  } catch (e) {
    failures.push(`presentation is not well-formed: ${(e as Error).message}`)
    logger.warn(`[TrustTasks:Evidence] presentation threw: ${(e as Error).stack ?? (e as Error).message}`)
  }
  if (!vwc) failures.push('presentation carries no credential')

  // 2. Ordinary credential verification — independent of outcome evidence.
  let credentialValid = false
  if (vwc) {
    try {
      const instance = JsonTransformer.fromJSON(vwc, W3cJsonLdVerifiableCredential)
      const credResult = await agent.w3cCredentials.verifyCredential({ credential: instance })
      credentialValid = credResult.isValid
      if (!credentialValid) {
        logger.warn(`[TrustTasks:Evidence] credential verification failed — ${detail(credResult)}`)
      }
    } catch (e) {
      credentialValid = false
      logger.warn(`[TrustTasks:Evidence] credential threw: ${(e as Error).stack ?? (e as Error).message}`)
    }
    if (!credentialValid) failures.push('credential proof did not verify')
  }

  if (failures.length) {
    // The proof types and issuers narrow it fast: a suite that is not
    // registered, a context the loader cannot resolve, and a genuinely bad
    // signature look identical from isValid alone.
    try {
      const vpProof = (bundle.presentation as { proof?: Record<string, unknown> })?.proof
      const vcProof = (vwc as { proof?: Record<string, unknown> } | undefined)?.proof
      logger.warn(
        `[TrustTasks:Evidence] bundle shape — vpProof=${JSON.stringify(vpProof)} ` +
          `vcIssuer=${JSON.stringify((vwc as { issuer?: unknown })?.issuer)} vcProof=${JSON.stringify(vcProof)}`
      )
    } catch {
      /* diagnostics must never break the check */
    }
  }

  // 3–7. The pairing checklist.
  const subject = vwc
    ? Array.isArray(vwc.credentialSubject)
      ? (vwc.credentialSubject[0] as Record<string, unknown>)
      : (vwc.credentialSubject as Record<string, unknown> | undefined)
    : undefined
  const taskContext = String(subject?.taskContext ?? '')
  const taskDigest = String(subject?.taskDigestMultibase ?? '')
  const { initiating, terminal } = bundle.outcomeEvidence

  if (!taskContext) failures.push('credential carries no taskContext')
  if (!taskDigest) failures.push('credential carries no taskDigestMultibase')
  if (taskContext && String(initiating.id ?? '') !== taskContext) {
    failures.push('initiating document id does not equal taskContext')
  }
  // The binder: id equality only LOCATES; the digest confirms the bytes.
  if (taskDigest && !digestBytesEqual(taskDigest, taskDigestMultibase(initiating))) {
    failures.push('taskDigestMultibase does not reproduce over the initiating document')
  }
  const expectedThread = String(initiating.threadId ?? initiating.id ?? '')
  if (String(terminal.threadId ?? '') !== expectedThread) {
    failures.push('terminal document threadId does not pair with the initiating document')
  }
  const terminalType = String(terminal.type ?? '')
  if (terminalType.includes(ERROR_TYPE_MARKER)) {
    failures.push('terminal document is an error response — failure evidence, not completion')
  } else if (!terminalType.endsWith('#response')) {
    failures.push('terminal document is not a success response')
  }
  if (terminal.proof === undefined) {
    failures.push('terminal document carries no proof — outcome evidence must be integrity-protected')
  } else if (!(await verifyDocumentProof(agent, terminal, String(terminal.issuer ?? '')))) {
    failures.push('terminal document proof did not verify under its issuer')
  }

  const completionEvidenced = failures.length === 0
  if (completionEvidenced) {
    agent.config.logger.info(`${LOG_PREFIX} outcome evidence verified (taskContext ${taskContext})`)
  }
  return {
    credentialValid,
    completionEvidenced,
    failures,
    // What this verification deliberately does not settle — named, per the
    // spec's verdict style, so no caller mistakes silence for coverage.
    residuals: [
      'witness identity legibility (issuer-to-witness mapping is registry/naming work)',
      'revocation status',
    ],
  }
}
