/**
 * The pairing carriage (docs/plans/agent-connect-plan.md §3.2, §7.5): what the pairing machine (pairing.ts) sends,
 * and how it reads the VTA back.
 *
 * - The `deviceEnrol` path: Keyring as the approver of `auth/oob` at the owner's VTA. DRAFT: built on
 *   trustoverip/dtgwg-trust-tasks-tf #1386 through one seam (deviceEnrolDraft.ts), proven only against a fake service.
 *   No VTA serves `auth/oob` today.
 * - The P0 fallback: the agent's `did:key` scanned, then `acl/grant` 0.3 as the VTA's administrator (step 7.4).
 * - Reading the entry back (step 10), from the VTA's own listings, never from the agent.
 * - Finishing a `deviceEnrol` pairing whose grant could carry one memory: the rest are added with one `acl/update`
 *   0.3, computed from the entry as read back ({@link completeEnrolment}).
 *
 * Every effect goes through a port. Step 7.7 wires the real ones: the VTA's `TrustTaskHTTPS` endpoint for `auth/oob`
 * (as sign-in reaches a community's), `VtaClient` for the access list, the agent's KMS for the administrator's
 * signature, and `verifyDocumentProof` for the VTA's answers.
 *
 * @module connected-agents/carriage
 */

import { newThrowawayKey, type ThrowawayKey } from '../trust-tasks/module/oobSignIn'
import {
  DEVICE_ENROL,
  DEVICE_ENROL_REFUSAL,
  claimAnswer,
  claimDocument,
  draftAclScope,
  grantDocument,
  proveAnswer,
  proveDocument,
  respondDocument,
  type AdministratorSigner,
  type ProvedRequest,
} from './deviceEnrolDraft'
import {
  AI_AGENT_KIND,
  type AgentAclScope,
  type ClaimOutcome,
  type ConfirmedAgent,
  type EntryReader,
  type GrantOutcome,
  type ListedEntry,
  type PairingTransport,
  type ProveOutcome,
} from './pairing'

/** What sending one `auth/oob` document to the owner's VTA came to. */
export type OobSendResult = { answer: Record<string, unknown> } | { refused: string } | { unreachable: string }

/** The owner's VTA as an `auth/oob` service. Production: its `TrustTaskHTTPS` endpoint, as sign-in posts (step 7.7). */
export interface OobServicePort {
  send(vtaDid: string, document: Record<string, unknown>): Promise<OobSendResult>
}

/** Whether a VTA answer carries a proof by that VTA for `assertionMethod`. Production: `verifyDocumentProof`. */
export type AnswerVerifier = (answer: Record<string, unknown>, vtaDid: string) => Promise<boolean>

/** An access-list entry as `VtaClient` reads it (its `VtaAclEntry`), the members this carriage uses. */
export type AccessEntry = {
  subject: string
  role: string
  act?: { stated: string; contexts?: string[] }
  capabilityScope?: { stated: 'ceiling' } | { stated: 'none' } | { stated: 'listed'; capabilities: string[] }
  purposes?: { scope: 'any' } | { scope: 'listed'; purposes: string[] }
  keys?: { scope: string }
  expiresAt?: string
}

/** The access-list calls of step 7.4, as `VtaClient` makes them. */
export interface AgentAccessPort {
  grantApplication(grant: {
    subject: string
    contexts: string[]
    capabilities: string[]
    purposes: string[]
    label?: string
    expiresAt?: string
  }): Promise<unknown>
  findAgentEntries(query: { deviceId?: string; subject?: string }): Promise<{
    complete: boolean
    matches: { entry: AccessEntry; deviceId?: string; kind?: string }[]
  }>
  narrowOrWidenCapabilities(change: {
    subject: string
    act?: { from: readonly string[]; to: readonly string[] }
  }): Promise<unknown>
}

export type CarriageDeps = {
  oob: OobServicePort
  verify: AnswerVerifier
  administrator: AdministratorSigner
  access: AgentAccessPort
  /** A fresh lock key per request; a test passes its own. */
  newKey?: () => ThrowawayKey
}

const isUnsupported = (code: string) => /unsupported(Type|Version)/.test(code)
const isExpired = (code: string) => /expired|windowClosed|decisionClosed/i.test(code)

/** The pairing transport over the draft's `deviceEnrol` and the `acl/grant` fallback. */
export class PairingCarriage implements PairingTransport {
  private readonly requests = new Map<string, { lock: ThrowawayKey; proved?: ProvedRequest }>()

  public constructor(private readonly deps: CarriageDeps) {}

  /** Send, and accept only an answer the VTA signed. A refusal or an unsigned answer comes back as such. */
  private async exchange(vtaDid: string, document: Record<string, unknown>): Promise<OobSendResult> {
    const result = await this.deps.oob.send(vtaDid, document)
    if (!('answer' in result)) return result
    if (!(await this.deps.verify(result.answer, vtaDid))) return { unreachable: 'the answer is not signed by the VTA' }
    return result
  }

  public async claim(vtaDid: string, requestId: string): Promise<ClaimOutcome> {
    const lock = (this.deps.newKey ?? newThrowawayKey)()
    const result = await this.exchange(vtaDid, claimDocument(lock, vtaDid, requestId))
    if ('refused' in result) {
      if (result.refused === DEVICE_ENROL_REFUSAL.alreadyClaimed) return { ok: false, refused: 'spent' }
      if (isUnsupported(result.refused)) return { ok: false, refused: 'unsupported' }
      if (isExpired(result.refused)) return { ok: false, refused: 'expired' }
      return { ok: false, refused: 'unreachable' }
    }
    if ('unreachable' in result) return { ok: false, refused: 'unreachable' }
    const read = claimAnswer(result.answer)
    const issuer = typeof result.answer.issuer === 'string' ? result.answer.issuer : undefined
    if (!read || !issuer) return { ok: false, refused: 'unreachable' }
    this.requests.set(requestId, { lock })
    return { ok: true, vtaDid: issuer, purpose: read.purpose, decisionDeadline: read.decisionClosesAt }
  }

  public async prove(vtaDid: string, requestId: string, digits: string): Promise<ProveOutcome> {
    const request = this.requests.get(requestId)
    if (!request) return { ok: false, refused: 'unreachable' }
    const document = await proveDocument(request.lock, this.deps.administrator, vtaDid, requestId, digits)
    const result = await this.exchange(vtaDid, document)
    if ('refused' in result) {
      if (result.refused === DEVICE_ENROL_REFUSAL.numberMismatch) return { ok: false, refused: 'numberMismatch' }
      if (isExpired(result.refused)) return { ok: false, refused: 'expired' }
      return { ok: false, refused: 'unreachable' }
    }
    if ('unreachable' in result) return { ok: false, refused: 'unreachable' }
    const read = proveAnswer(result.answer)
    if (!read) return { ok: false, refused: 'unreachable' }
    request.proved = { sessionKey: read.sessionKey, origin: read.origin, contextDigest: read.contextDigest }
    return {
      ok: true,
      disclosure: {
        starterDid: read.sessionKey,
        ...(read.requester !== undefined ? { requester: read.requester } : {}),
        ...(read.requestedScope !== undefined ? { requestedScope: read.requestedScope } : {}),
        ...(read.sameNetwork !== undefined ? { sameNetwork: read.sameNetwork } : {}),
      },
    }
  }

  public async grant(vtaDid: string, requestId: string, scope: AgentAclScope): Promise<GrantOutcome> {
    const request = this.requests.get(requestId)
    if (!request?.proved) return { ok: false, refused: 'unreachable' }
    const { aclScope, grantedContexts } = draftAclScope(scope)
    const grant = await grantDocument(this.deps.administrator, vtaDid, requestId, request.lock, request.proved, {
      approve: aclScope,
    })
    const result = await this.exchange(vtaDid, respondDocument(request.lock, vtaDid, requestId, grant))
    if ('refused' in result) {
      if (result.refused === DEVICE_ENROL_REFUSAL.scopeExceedsRequest) return { ok: false, refused: 'outsideScope' }
      if (result.refused === DEVICE_ENROL_REFUSAL.contextMismatch) return { ok: false, refused: 'notAdministrator' }
      if (isExpired(result.refused)) return { ok: false, refused: 'expired' }
      return { ok: false, refused: 'unreachable' }
    }
    if ('unreachable' in result) return { ok: false, refused: 'unreachable' }
    this.requests.delete(requestId)
    return {
      ok: true,
      subject: request.proved.sessionKey,
      ...(grantedContexts.length < scope.contexts.length ? { grantedContexts } : {}),
    }
  }

  /**
   * The draft's decline: a grant with `decision: decline` and no `aclScope`, carried by `respond`. It needs step 2's
   * answer to bind to, so before the number is proved there is nothing to send: the claimed request lapses at its
   * decision window, and the machine has already spent it.
   */
  public async decline(vtaDid: string, requestId: string): Promise<void> {
    const request = this.requests.get(requestId)
    this.requests.delete(requestId)
    if (!request?.proved) return
    const grant = await grantDocument(
      this.deps.administrator,
      vtaDid,
      requestId,
      request.lock,
      request.proved,
      'decline'
    )
    await this.exchange(vtaDid, respondDocument(request.lock, vtaDid, requestId, grant))
  }

  /** The P0 fallback: `acl/grant` 0.3 for the agent's `K_t`, every chosen memory at once (step 7.4). */
  public async grantFallback(_vtaDid: string, subject: string, scope: AgentAclScope): Promise<GrantOutcome> {
    try {
      await this.deps.access.grantApplication({
        subject,
        contexts: [...scope.contexts],
        capabilities: scope.capabilities.scope === 'listed' ? [...scope.capabilities.listed] : [],
        purposes: [...scope.purposes],
        label: scope.label,
        expiresAt: scope.expiresAt,
      })
      return { ok: true, subject }
    } catch (error) {
      // No acl 0.3 at that VTA (AgentAccessUnsupportedError), or a network failure: "We couldn't reach your VTA".
      if (error instanceof Error && error.name === 'VtiRefusal') return { ok: false, refused: 'notAdministrator' }
      return { ok: false, refused: 'unreachable' }
    }
  }
}

/** An access entry, as the pairing machine reads one. */
export function listedEntryFrom(match: { entry: AccessEntry; deviceId?: string; kind?: string }): ListedEntry {
  const { entry } = match
  const capabilities: ListedEntry['capabilities'] =
    entry.capabilityScope?.stated === 'listed'
      ? { scope: 'listed', listed: [...entry.capabilityScope.capabilities] }
      : { scope: 'none' }
  return {
    subject: entry.subject,
    ...(match.deviceId ? { deviceId: match.deviceId } : {}),
    ...(match.kind === AI_AGENT_KIND
      ? { consumerKind: AI_AGENT_KIND }
      : match.kind
        ? { consumerKind: match.kind }
        : {}),
    role: entry.role,
    contexts: entry.act?.stated === 'contexts' ? [...(entry.act.contexts ?? [])] : [],
    capabilities,
    // An entry whose key scope the listing did not state reads as unknown, which no limit check accepts.
    keys: { scope: entry.keys?.scope ?? 'unknown' },
    purposes: entry.purposes?.scope === 'listed' ? [...entry.purposes.purposes] : entry.purposes ? ['any'] : [],
    ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}),
  }
}

/**
 * The machine's view of the VTA's listings (step 10): the entry with the stored `deviceId` if there is one, else the
 * one under the subject. A listing that could not be read to its end, with nothing in it, is "not reachable": an
 * absent entry proves nothing then (§3.9).
 */
export function accessEntryReader(access: AgentAccessPort): EntryReader {
  return {
    async find(query) {
      try {
        const found = await access.findAgentEntries({
          subject: query.subject,
          ...(query.deviceId ? { deviceId: query.deviceId } : {}),
        })
        if (found.matches.length === 0) return found.complete ? { reachable: true } : { reachable: false }
        const match =
          (query.deviceId && found.matches.find((m) => m.deviceId === query.deviceId)) ||
          found.matches.find((m) => m.entry.subject !== query.subject) ||
          found.matches[0]
        return { reachable: true, entry: listedEntryFrom(match) }
      } catch {
        return { reachable: false }
      }
    },
  }
}

export type EnrolmentCompletion = { complete: true } | { complete: false; missing: string[] }

/**
 * Finish a `deviceEnrol` pairing whose grant carried one memory (§7.5): add the agent's `contextsToAdd` with one
 * `acl/update` 0.3. The write is computed from the entry as read back, never from the set intended, so it is safe to
 * re-send; and it adds only memories still in `currentChoice`, the owner's choice for this agent now, so a memory the
 * owner removed since is never re-added. This finishes the widening the owner approved at Approve for this pairing; it
 * is not a "Change memories" widening (§7.7, D34). A failure leaves the agent connected with what its entry holds, and
 * says which memories are missing.
 */
export async function completeEnrolment(
  access: AgentAccessPort,
  agent: Pick<ConfirmedAgent, 'deviceId' | 'agentDid' | 'contextsToAdd'>,
  currentChoice: readonly string[]
): Promise<EnrolmentCompletion> {
  const wanted = agent.contextsToAdd.filter((c) => currentChoice.includes(c))
  if (wanted.length === 0) return { complete: true }
  try {
    const found = await access.findAgentEntries({ deviceId: agent.deviceId, subject: agent.agentDid })
    const match = found.matches.find((m) => m.deviceId === agent.deviceId) ?? found.matches[0]
    if (!match) return { complete: false, missing: wanted }
    const held = match.entry.act?.stated === 'contexts' ? [...(match.entry.act.contexts ?? [])] : []
    const toAdd = wanted.filter((c) => !held.includes(c))
    if (toAdd.length === 0) return { complete: true }
    await access.narrowOrWidenCapabilities({
      subject: match.entry.subject,
      act: { from: held, to: [...held, ...toAdd] },
    })
    return { complete: true }
  } catch {
    return { complete: false, missing: wanted }
  }
}

/** The purpose a carriage claims for; anything else is refused by the machine (`not-a-pairing-code`). */
export const CARRIAGE_PURPOSE = DEVICE_ENROL
