import type { Agent } from '@credo-ts/core'

import { verifyTrustTaskProof } from '@bifold/trust-tasks'

const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/'

/** What a VTA reply's proof says about it. */
export type VtaReplyVerdict =
  | { kind: 'exempt' }
  | { kind: 'verified'; signer: string }
  | { kind: 'wrongSigner'; signer: string }
  | { kind: 'unsigned' }
  | { kind: 'invalid'; detail: string }

/**
 * Check a VTA's reply the way vta-sdk's client does (`VtaClient::verify_reply`,
 * VTI afcf2470 vta-sdk/src/client/mod.rs:2177-2245). An error document is
 * exempt: its proof is only RECOMMENDED (SPEC §8.1). Anything else must carry a
 * proof that verifies, and its proven signer must be `vtaDid`. A proof by
 * another key verifies perfectly well, and that it is not the agent this client
 * is talking to is a separate comparison.
 *
 * Never throws: a verifier that fails (a DID that will not resolve, say) is
 * reported as `invalid` with why, so a caller that only logs is never broken
 * by the check.
 */
export async function checkVtaReply(
  agent: Agent,
  document: Record<string, unknown>,
  vtaDid: string,
  verify: typeof verifyTrustTaskProof = verifyTrustTaskProof
): Promise<VtaReplyVerdict> {
  if (String(document.type ?? '').startsWith(TASK_ERROR)) return { kind: 'exempt' }
  try {
    const result = await verify(agent, document)
    if (result.ok) return result.signer === vtaDid ? { kind: 'verified', signer: result.signer } : { kind: 'wrongSigner', signer: result.signer }
    return result.reason === 'unsigned' ? { kind: 'unsigned' } : { kind: 'invalid', detail: result.detail }
  } catch (error) {
    return { kind: 'invalid', detail: error instanceof Error ? error.message : String(error) }
  }
}
