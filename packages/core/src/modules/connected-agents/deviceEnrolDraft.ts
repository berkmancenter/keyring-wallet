/**
 * DRAFT. The one seam between Keyring and the `auth/oob` `deviceEnrol` ceremony as an open upstream pull request
 * defines it: trustoverip/dtgwg-trust-tasks-tf #1386 (Keyring's ask, ledger AC-36), read at
 * {@link DEVICE_ENROL_DRAFT_COMMIT}. Nothing here is a specification's, and nothing built on it is proven against a
 * real service: no VTA serves `auth/oob` today (step 7.1: `unsupportedType` on VTA 0.79.0, 0.84.0 and 0.87.0).
 *
 * Everything the draft decides lives in this file: the task versions, how each document is built, the `aclScope`
 * Keyring sends, which members of each answer it reads, and the refusal codes. When the draft changes, this file and
 * the fixtures beside its tests change; the carriage (carriage.ts) and the machine (pairing.ts) do not.
 *
 * Keyring is the approver (docs/plans/agent-connect-plan.md §3.2, §7.5). The owner's VTA is the service. Three keys sign:
 * - the throwaway lock key `K_lock`, Keyring's for one request: it signs the claim (making it the lock) and every
 *   later envelope, for `authentication`, as sign-in's K_a does (oobSignIn.ts);
 * - the phone's administrator DID, the DID on the VTA's ACL as its administrator: `identify` 0.2 for
 *   `authentication` and the grant 0.4 for `assertionMethod`, signed on the phone with its own key (§7.5, proposed);
 * - the VTA's own key, on every answer, checked by the carriage.
 *
 * @module connected-agents/deviceEnrolDraft
 */

import { digestMultibase } from '@bifold/trust-tasks'

import { oobEnvelope, type ThrowawayKey } from '../trust-tasks/module/oobSignIn'
import type { AgentAclScope } from './pairing'

/** The draft's head this file was written against (fixtures `auth-oob-draft-1386/DRAFT_COMMIT.sha`). */
export const DEVICE_ENROL_DRAFT_COMMIT = 'ceda53bca5c0ba3ca5d18c65b7e727b0a750dc49'

const OOB = 'https://trusttasks.org/spec/auth/oob'

/** The versions #1386 defines `deviceEnrol` at. Only the draft has them, so each is sent at exactly this version. */
export const DEVICE_ENROL_TASK = {
  // version-draft: only draft #1386 defines this version; sign-in's login stays on the accepted ones
  claim: `${OOB}/claim/0.3`,
  // version-draft: only draft #1386 defines this version; sign-in's login stays on the accepted ones
  prove: `${OOB}/prove/0.4`,
  // version-draft: only draft #1386 defines this version; sign-in's login stays on the accepted ones
  identify: `${OOB}/identify/0.2`,
  // version-draft: only draft #1386 defines this version; sign-in's login stays on the accepted ones
  grant: `${OOB}/grant/0.4`,
  // version-draft: only draft #1386 defines this version; sign-in's login stays on the accepted ones
  respond: `${OOB}/respond/0.4`,
} as const

/** The purpose. */
export const DEVICE_ENROL = 'deviceEnrol'

/** The refusal codes #1386 names for the tasks Keyring sends. */
export const DEVICE_ENROL_REFUSAL = {
  alreadyClaimed: 'auth/oob/claim:alreadyClaimed',
  numberMismatch: 'auth/oob/prove:numberMismatch',
  contextMismatch: 'auth/oob/respond:contextMismatch',
  scopeExceedsRequest: 'auth/oob/respond:scopeExceedsRequest',
} as const

/** Signs as the phone's administrator DID. Production: `signDocumentProof` through the agent's KMS (step 7.7). */
export interface AdministratorSigner {
  did: string
  sign(
    document: Record<string, unknown>,
    proofPurpose: 'authentication' | 'assertionMethod'
  ): Promise<Record<string, unknown>>
}

const ISSUED_AT = () => new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(/\.000Z$/, 'Z')

/** A document the administrator signs: the framework members and nothing else, as sign-in's `personaDocument`. */
function administratorDocument(type: string, payload: Record<string, unknown>, issuer: string, vtaDid: string) {
  return {
    id: `urn:uuid:${globalThis.crypto?.randomUUID?.() ?? uuid()}`,
    type,
    issuer,
    recipient: vtaDid,
    issuedAt: ISSUED_AT(),
    payload,
  }
}

/** A v4 UUID without the platform's crypto (React Native lacks `randomUUID`). */
function uuid(): string {
  const hex = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16))
  hex[12] = '4'
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16)
  const h = hex.join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** `claim` 0.3, signed by the lock key: making it the request's lock. */
export function claimDocument(lock: ThrowawayKey, vtaDid: string, requestId: string): Record<string, unknown> {
  // version-pinned: deviceEnrol exists only at draft #1386's versions, so there is nothing to step down to
  return lock.sign(oobEnvelope(DEVICE_ENROL_TASK.claim, { requestId }, lock.did, vtaDid, requestId), 'authentication')
}

/** `prove` 0.4 carrying `identify` 0.2 with the typed digits, signed by the administrator; the envelope by the lock. */
export async function proveDocument(
  lock: ThrowawayKey,
  administrator: AdministratorSigner,
  vtaDid: string,
  requestId: string,
  enteredNumber: string
): Promise<Record<string, unknown>> {
  const identify = await administrator.sign(
    // version-pinned: deviceEnrol exists only at draft #1386's versions, so there is nothing to step down to
    administratorDocument(
      DEVICE_ENROL_TASK.identify,
      { requestId, approverKey: lock.did, enteredNumber },
      administrator.did,
      vtaDid
    ),
    'authentication'
  )
  // version-pinned: deviceEnrol exists only at draft #1386's versions, so there is nothing to step down to
  return lock.sign(oobEnvelope(DEVICE_ENROL_TASK.prove, { identify }, lock.did, vtaDid, requestId), 'authentication')
}

/**
 * The `aclScope` of draft #1386's grant: exactly one context ("Exactly one in this version"), so the first memory
 * chosen; the rest are added after the entry is confirmed (§7.5). Capabilities and purposes in the `acl` 0.3 shape,
 * no keys, the expiry, the name, and the consumer kind as the device binding spells it.
 */
export function draftAclScope(scope: AgentAclScope): { aclScope: Record<string, unknown>; grantedContexts: string[] } {
  const first = scope.contexts[0]
  if (!first) throw new Error('an agent entry names at least one context')
  return {
    grantedContexts: [first],
    aclScope: {
      contexts: [first],
      role: scope.role,
      capabilities:
        scope.capabilities.scope === 'listed'
          ? { scope: 'listed', grants: scope.capabilities.listed.map((capability) => ({ capability })) }
          : { scope: 'none' },
      purposes: { scope: 'listed', purposes: [...scope.purposes] },
      keys: { scope: 'none' },
      expiresAt: scope.expiresAt,
      label: scope.label,
      consumerKind: { kind: 'service', serviceKind: 'aiAgent' },
    },
  }
}

/** What step 2 (the `prove` answer) gave, as the grant needs it. */
export type ProvedRequest = { sessionKey: string; origin: string; contextDigest: string }

/** The grant 0.4: approve with the `aclScope`, or decline without one; signed by the administrator for `assertionMethod`. */
export async function grantDocument(
  administrator: AdministratorSigner,
  vtaDid: string,
  requestId: string,
  lock: ThrowawayKey,
  proved: ProvedRequest,
  decision: { approve: Record<string, unknown> } | 'decline'
): Promise<Record<string, unknown>> {
  const payload = {
    requestId,
    purpose: DEVICE_ENROL,
    decision: decision === 'decline' ? 'decline' : 'approve',
    sessionKey: proved.sessionKey,
    approverKey: lock.did,
    origin: proved.origin,
    contextDigest: proved.contextDigest,
    ...(decision === 'decline' ? {} : { aclScope: decision.approve }),
  }
  return administrator.sign(
    // version-pinned: deviceEnrol exists only at draft #1386's versions, so there is nothing to step down to
    administratorDocument(DEVICE_ENROL_TASK.grant, payload, administrator.did, vtaDid),
    'assertionMethod'
  )
}

/** `respond` 0.4 carrying the signed grant, the envelope signed by the lock. */
export function respondDocument(lock: ThrowawayKey, vtaDid: string, requestId: string, grant: Record<string, unknown>) {
  // version-pinned: deviceEnrol exists only at draft #1386's versions, so there is nothing to step down to
  return lock.sign(oobEnvelope(DEVICE_ENROL_TASK.respond, { grant }, lock.did, vtaDid, requestId), 'authentication')
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/** The members of the claim answer Keyring reads, and nothing else. Undefined when one it needs is missing. */
export function claimAnswer(
  answer: Record<string, unknown>
): { purpose: string; decisionClosesAt: number; service: unknown } | undefined {
  const p = (answer.payload ?? {}) as Record<string, unknown>
  const purpose = str(p.purpose)
  const closes = str(p.decisionClosesAt)
  const at = closes === undefined ? NaN : Date.parse(closes)
  if (!purpose || Number.isNaN(at)) return undefined
  return { purpose, decisionClosesAt: at, service: p.service }
}

/**
 * The members of the `prove` answer (step 2) Keyring reads, allow-listed: the starter's key (`sessionKey`), the
 * origin, the client's own name (`client.displayName`, which the starter wrote and nothing vouches for), the requested
 * scope, and the same-network signal (`requester.sameNetwork`: a boolean, or `unknown`, which is kept as absent); and
 * the digest of the whole signed answer, which the grant binds to (`contextDigest`).
 */
export function proveAnswer(
  answer: Record<string, unknown>
):
  | (ProvedRequest & { requester?: string; requestedScope?: unknown; sameNetwork?: boolean; identifiedAs?: string })
  | undefined {
  const p = (answer.payload ?? {}) as Record<string, unknown>
  const sessionKey = str(p.sessionKey)
  const origin = str(p.origin)
  if (!sessionKey || !origin) return undefined
  const client = (p.client ?? {}) as { displayName?: unknown }
  const sameNetwork = ((p.requester ?? {}) as { sameNetwork?: unknown }).sameNetwork
  return {
    sessionKey,
    origin,
    contextDigest: digestMultibase(answer),
    ...(str(client.displayName) ? { requester: str(client.displayName) } : {}),
    ...(p.requestedScope !== undefined ? { requestedScope: p.requestedScope } : {}),
    ...(typeof sameNetwork === 'boolean' ? { sameNetwork } : {}),
    ...(str(p.identifiedAs) ? { identifiedAs: str(p.identifiedAs) } : {}),
  }
}
