/**
 * Reading a task-consent request the way upstream's approvers read one (VTI
 * afcf2470): the match code (vta-sdk `task_consent::match_code`), what
 * approving would do (vta-mobile-core `consent.rs`), and the request check
 * (vta-sdk `ConsentRequest::verify`).
 */
import type { Agent } from '@credo-ts/core'

import { verifyTrustTaskProof } from '@bifold/trust-tasks'
import { MultiBaseEncoder } from '@credo-ts/core'

import { VTA_TASK } from './VtaClient'

/** vta-sdk `MATCH_CODE_LEN`. */
export const MATCH_CODE_LEN = 6
/** vta-sdk `REQUEST_PROOF_PURPOSE`: the node proves it is itself asking. */
export const CONSENT_REQUEST_PROOF_PURPOSE = 'authentication'

/**
 * The operator's comparison code: the first six hex characters of the digest
 * BYTES. A `digestMultibase` always begins `zQm`, so slicing the string would
 * spend half the code on a constant, and show a different code from every
 * other approver and requester screen. None when the digest is not a
 * base-encoded 32-byte sha2-256 multihash.
 */
export function consentMatchCode(payloadDigest: unknown): string | undefined {
  if (typeof payloadDigest !== 'string') return undefined
  let bytes: Uint8Array
  try {
    bytes = MultiBaseEncoder.decode(payloadDigest).data
  } catch {
    return undefined
  }
  if (bytes.length !== 34 || bytes[0] !== 0x12 || bytes[1] !== 0x20) return undefined
  return Array.from(bytes.slice(2, 2 + Math.ceil(MATCH_CODE_LEN / 2)), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, MATCH_CODE_LEN)
}

/**
 * What approving would do: the VTA's dry-run `effects` (an open set of kinds,
 * each shown by its `summary`), else the task's static `consequences`, else
 * `unknown` — which the screen says as "could not tell", never "no effects".
 */
export type ConsentOutcome = { from: 'effects' | 'consequences'; lines: string[] } | { from: 'unknown' }

export function consentOutcome(payload: { effects?: unknown; consequences?: unknown }): ConsentOutcome {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const effects = Array.isArray(payload.effects)
    ? payload.effects
        .map((e) =>
          e && typeof e === 'object'
            ? text((e as Record<string, unknown>).summary) || text((e as Record<string, unknown>).kind)
            : ''
        )
        .filter(Boolean)
    : []
  if (effects.length > 0) return { from: 'effects', lines: effects }
  const consequences = Array.isArray(payload.consequences) ? payload.consequences.map(text).filter(Boolean) : []
  if (consequences.length > 0) return { from: 'consequences', lines: consequences }
  return { from: 'unknown' }
}

/** Why a request did not pass: vta-sdk `TaskConsentError`, one word each. */
export type ConsentRequestRefusal =
  | 'malformed'
  | 'unsigned'
  | 'proof'
  | 'wrong-purpose'
  | 'signer-not-issuer'
  | 'wrong-issuer'
  | 'wrong-recipient'
  | 'expired'

/**
 * Check a request as `ConsentRequest::verify` does, in its order: it is a
 * request, its proof verifies, for `authentication`, its signer is its issuer,
 * that issuer is the linked agent, it is addressed to this phone, and it has
 * not expired. The issuer check is what makes the rest mean anything: anyone
 * can sign a well-formed request.
 */
export async function checkConsentRequest(
  agent: Agent,
  doc: Record<string, unknown>,
  expect: { vtaDid: string; approver: string; now?: Date }
): Promise<{ ok: true } | { ok: false; reason: ConsentRequestRefusal }> {
  const refuse = (reason: ConsentRequestRefusal) => ({ ok: false as const, reason })
  const payload = doc.payload as Record<string, unknown> | undefined
  if (doc.type !== VTA_TASK.consentRequest || !payload || typeof payload !== 'object') return refuse('malformed')

  const verdict = await verifyTrustTaskProof(agent, doc, { now: expect.now })
  if (!verdict.ok) return refuse(verdict.reason)
  if ((doc.proof as Record<string, unknown>).proofPurpose !== CONSENT_REQUEST_PROOF_PURPOSE)
    return refuse('wrong-purpose')
  const issuer = typeof doc.issuer === 'string' ? doc.issuer : ''
  if (verdict.signer !== issuer) return refuse('signer-not-issuer')
  if (issuer !== expect.vtaDid) return refuse('wrong-issuer')
  if (doc.recipient !== expect.approver) return refuse('wrong-recipient')

  const expiresAt = Date.parse(String(payload.expiresAt ?? ''))
  if (!Number.isFinite(expiresAt)) return refuse('malformed')
  if (expiresAt <= (expect.now ?? new Date()).getTime()) return refuse('expired')
  return { ok: true }
}
