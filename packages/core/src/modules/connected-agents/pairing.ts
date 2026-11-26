/**
 * The pairing machine: Keyring's side of connecting a person's own AI agent, as the approver of VTI's `auth/oob`
 * ceremony with the purpose `deviceEnrol` (docs/plans/agent-connect-plan.md §3.2, D48), and of the P0 fallback
 * (scan the agent's `did:key`, then `acl/grant`) until a VTA serves `deviceEnrol`.
 *
 * It is a state machine and nothing else. Every effect goes through what it is given: the clock, the resolver
 * (which VTAs this Keyring administers), the transport (the `auth/oob` tasks and the fallback grant, built in
 * step 7.5), the entry reader (the VTA's own listing, never the agent's word), the spent-request store and the
 * lockout. It holds no key, logs nothing and never renders the match number: Keyring never learns it (§3.2 step 5).
 *
 * What it leaves to its driver (the connect screens, step 7.7): writing the `AgentConnection` record, the
 * phone's biometric approval before {@link PairingMachine.approve}, when to call {@link PairingMachine.checkEnrolment}
 * again, and the cleanup a failed or unfinished pairing names (`cleanup`, carried out by revoke, step 7.10).
 *
 * The phases, in order (§3.2 step numbers):
 *
 *     idle ─start→ awaitingScan ─scan(auth/oob link)→ [claim, step 3] → awaitingNumber ─enterNumber→ [prove, step 5]
 *          ↘ locked                ─scan(fallback link)────────────────────────────────┐            ↓
 *                                                                                      awaitingApproval ─approve→ [grant, step 6-7]
 *                                                                                                           ↓
 *                                       confirmed ←─checkEnrolment (step 10)─ awaitingEnrolment ─(10 min)→ notFinished
 *
 * and from any phase before `confirmed`: `cancelled` (the owner cancels or declines), `expired`, `failed`.
 *
 * @module connected-agents/pairing
 */

import { sanitizeLabel } from '../trust-tasks/module/triggerLink'
import { deriveHandle } from './handle'
import { LockoutState, PairingLockout } from './lockout'

/**
 * The digits of the `auth/oob` match number. The specification's `MatchNumber` is two (`^[0-9]{2}$`); the plan
 * asks for four for `deviceEnrol` (§11 Q8, ledger AC-36). One constant, so the change is one edit when VTI answers.
 */
export const MATCH_NUMBER_DIGITS = 2

/** How long a temporary agent is granted for (D42): 4 hours from the approval. */
export const TEMPORARY_GRANT_MS = 4 * 60 * 60 * 1000

/** An entry still under its first key this long after the grant is "Not finished" and is removed (§3.10). */
export const NOT_FINISHED_AFTER_MS = 10 * 60 * 1000

/** The purposes an agent may be granted (§3.3). `modelTraining` is never granted. */
export const AGENT_PURPOSES = ['personalisation', 'taskExecution'] as const
export type AgentPurpose = (typeof AGENT_PURPOSES)[number]

/** The memory capabilities granted at connect (§3.3). Room capabilities are added only at the first room add. */
export const MEMORY_CAPABILITIES = ['memory-read', 'memory-write'] as const

/** The internal spelling of the consumer kind that makes an entry a delegate (§3.3; `aiAgent` on the wire). */
export const AI_AGENT_KIND = 'ai-agent'

/** What the owner chose at step 1. */
export type AgentConnectChoice = {
  /** 1 to 64 characters after sanitising (`sanitizeLabel`). */
  name: string
  /** The persona the owner acts as: the VDC's issuer (§3.4). */
  ownerPersonaDid: string
  /** The memories the agent is bound to (exact context ids, §3.15). May be empty. */
  memoryContexts: string[]
  /** With no memory chosen: the new empty context Keyring created for the agent (§3.3, `act`). */
  agentContext?: string
  purposes: AgentPurpose[]
}

/**
 * The entry Keyring asks the VTA to create (§3.3): carried as the `auth/oob` grant's `aclScope`, or, in the
 * fallback, as `acl/grant` 0.3 (the wire spelling is the transport's, step 7.5, and `VtaClient`'s, step 7.4).
 */
export type AgentAclScope = {
  role: 'application'
  contexts: string[]
  capabilities: { scope: 'listed'; listed: string[] } | { scope: 'none' }
  keys: { scope: 'none' }
  purposes: AgentPurpose[]
  /** ISO 8601. */
  expiresAt: string
  label: string
  consumerKind: typeof AI_AGENT_KIND
}

/** A pairing code, as the scanner read it (`readTrigger`), classified by {@link pairingLinkFromTrigger}. */
export type PairingLink =
  /** `auth/oob`: `_from` is the VTA. */
  | { kind: 'oob'; vtaDid: string; requestId: string; exp: number }
  /** The P0 fallback (`agent-connect` flow): `_from` is the agent's throwaway `did:key` `K_t`. */
  | { kind: 'fallback'; agentDid: string; requestId: string; exp: number }

export type ClaimOutcome =
  | { ok: true; vtaDid: string; purpose: string; decisionDeadline: number }
  | { ok: false; refused: 'expired' | 'spent' | 'unsupported' | 'unreachable' }

/** Step 2 of the disclosure ladder (§3.2 step 5): shown on Approve. Never the match number. */
export type PairingDisclosure = {
  requester?: string
  requestedScope?: unknown
  sameNetwork?: boolean
  /** The starter's key `K_t`, the subject the entry will be made for, where the specification discloses it. */
  starterDid?: string
}

export type ProveOutcome =
  | { ok: true; disclosure: PairingDisclosure }
  | { ok: false; refused: 'numberMismatch' | 'expired' | 'unreachable' }

export type GrantOutcome =
  | {
      ok: true
      subject?: string
      /**
       * The contexts the grant wrote, when fewer than chosen: draft #1386's `aclScope` carries one (§7.5). The rest are
       * the confirmed agent's `contextsToAdd`. Absent: all of them.
       */
      grantedContexts?: string[]
    }
  | { ok: false; refused: 'outsideScope' | 'notAdministrator' | 'expired' | 'unreachable' }

/**
 * The `auth/oob` tasks Keyring sends as the approver, and the fallback's `acl/grant`. Built in step 7.5 (against
 * the VTA's `vti-oob-server`, and a fake in jest until VTI serves `deviceEnrol`, ledger AC-36). Times in ms.
 */
export interface PairingTransport {
  /** `auth/oob/claim` under the specification's throwaway lock key (step 3). */
  claim(vtaDid: string, requestId: string): Promise<ClaimOutcome>
  /** `auth/oob/prove` with the typed digits and a signed `identify` from the owner's administrator DID (step 5). */
  prove(vtaDid: string, requestId: string, digits: string): Promise<ProveOutcome>
  /** `auth/oob/grant` carrying `aclScope`, after the phone's user verification (step 6). */
  grant(vtaDid: string, requestId: string, scope: AgentAclScope): Promise<GrantOutcome>
  /** The specification's decline (step 6, or a cancel after the claim). */
  decline(vtaDid: string, requestId: string): Promise<void>
  /** The fallback: `acl/grant` (0.3 shape) for the agent's `K_t`, as this VTA's administrator. */
  grantFallback(vtaDid: string, subject: string, scope: AgentAclScope): Promise<GrantOutcome>
}

/** Which VTAs this Keyring administers. */
export interface PairingResolver {
  administers(vtaDid: string): boolean
  /** The VTA this Keyring administers and pairs on: the fallback grants there. */
  ownVta(): string | undefined
}

/** An entry as the VTA lists it (`listAcl`, and `device/list` for its `deviceId`), in Keyring's spelling. */
export type ListedEntry = {
  subject: string
  deviceId?: string
  /** `ai-agent` once the agent ran `device/register` with `serviceKind` `aiAgent`. */
  consumerKind?: string
  role: string
  contexts: string[]
  capabilities: { scope: 'listed'; listed: string[] } | { scope: 'none' }
  keys: { scope: string }
  purposes: string[]
  expiresAt?: string
}

/** Reads the entry made for this pairing from the VTA (step 10). Never from the agent. */
export interface EntryReader {
  find(query: {
    subject: string
    deviceId?: string
  }): Promise<{ reachable: false } | { reachable: true; entry?: ListedEntry }>
}

/**
 * Request ids Keyring has used: claimed, cancelled, refused or seen expire (§7.2: a request is spent on cancel,
 * wrong number, expiry and first claim). Keyring never claims one twice.
 */
export interface SpentRequestStore {
  has(requestId: string): Promise<boolean>
  add(requestId: string, until: number): Promise<void>
}

export type PairingFailure =
  | 'expired'
  | 'spent'
  | 'wrong-number'
  | 'foreign-vta'
  | 'not-a-pairing-code'
  | 'vta-unreachable'
  | 'grant-refused'
  | 'unsupported'
  | 'rotation-lost-limits'
  | 'handle-collision'
  | 'invalid-choice'

/**
 * The owner-facing words for each failure, as the plan gives them (§3.2, §3.10). Where the plan gives none yet,
 * the screen's own copy decides (step 7.7); those are undefined here.
 */
export const PAIRING_FAILURE_COPY: Record<PairingFailure, string | undefined> = {
  expired: 'This code has expired. Run the command again.',
  spent: 'This code has expired. Run the command again.',
  'wrong-number': "That isn't the number in your terminal. Nothing was connected.",
  'foreign-vta': "This code is for a VTA you don't manage. Nothing was connected.",
  'not-a-pairing-code': "This code can't be used.",
  'vta-unreachable': "We couldn't reach your VTA, so nothing changed.",
  'grant-refused': "We couldn't reach your VTA, so nothing changed.",
  unsupported: "We couldn't reach your VTA, so nothing changed.",
  'rotation-lost-limits': undefined,
  'handle-collision': undefined,
  'invalid-choice': undefined,
}

/** The lock's words, with the minutes left. */
export const lockedCopy = (minutesLeft: number): string =>
  `Too many wrong numbers. Try again in ${minutesLeft} minutes.`

/** What a failed or unfinished pairing leaves at the VTA, for the driver to remove (by `deviceId` first, §3.9). */
export type PairingCleanup = { vtaDid: string; subject: string; deviceId?: string }

/** A connected agent, ready to be stored as an `AgentConnection` in state `active` once its VDC pair verifies. */
export type ConfirmedAgent = {
  name: string
  handle: string
  agentDid: string
  deviceId: string
  vtaDid: string
  ownerPersonaDid: string
  contexts: string[]
  memoryContexts: string[]
  capabilities: AgentAclScope['capabilities']
  purposes: AgentPurpose[]
  expiresAt: string
  grantType: 'temporary'
  /**
   * Chosen memories the grant could not carry (§7.5: draft #1386's `aclScope` holds one context), to be added with one
   * `acl/update` 0.3 computed from the entry as read back (carriage `completeEnrolment`). Empty on the fallback path.
   */
  contextsToAdd: string[]
}

type Pending = { choice: AgentConnectChoice; link: PairingLink; vtaDid: string; requestId: string; deadline: number }

export type PairingState =
  | { phase: 'idle' }
  | { phase: 'locked'; lockout: Extract<LockoutState, { locked: true }> }
  | { phase: 'awaitingScan'; choice: AgentConnectChoice }
  | ({ phase: 'awaitingNumber' } & Pending)
  | ({ phase: 'awaitingApproval'; disclosure?: PairingDisclosure; subject?: string } & Pending)
  | {
      phase: 'awaitingEnrolment'
      choice: AgentConnectChoice
      vtaDid: string
      scope: AgentAclScope
      /** The contexts the grant wrote: what the entry is checked against at step 10. */
      grantedContexts: string[]
      /** The key the entry was made for (`K_t`); undefined until the VTA names it (§11 Q7(c)). */
      subject?: string
      deviceId?: string
      grantedAt: number
    }
  | { phase: 'confirmed'; agent: ConfirmedAgent }
  | { phase: 'notFinished'; cleanup?: PairingCleanup }
  | { phase: 'cancelled'; cleanup?: PairingCleanup }
  | { phase: 'expired' }
  | { phase: 'failed'; reason: PairingFailure; lockout?: LockoutState; cleanup?: PairingCleanup }

export type PairingDeps = {
  clock: () => number
  resolver: PairingResolver
  transport: PairingTransport
  entries: EntryReader
  spent: SpentRequestStore
  lockout: PairingLockout
  /** The handles the owner's other agents hold. */
  takenHandles: () => Iterable<string>
  onTransition?: (state: PairingState) => void
}

/** A number entry that was not sent: the wrong length or not digits. Uses no attempt. */
export type NumberEntry = { sent: false; reason: 'needs-digits'; digits: number } | { sent: true }

const TERMINAL: PairingState['phase'][] = ['confirmed', 'notFinished', 'cancelled', 'expired', 'failed']

/**
 * Classify a link the scanner accepted inside "Connect an agent": the fallback's `agent-connect` flow, or the
 * `auth/oob` sign-in flow whose `_from` is a VTA (the purpose is learned at the claim, and checked there).
 * Undefined for anything else, which the screen answers as any code it cannot use.
 */
export function pairingLinkFromTrigger(trigger: {
  flow: string | null
  from: string
  id: string
  exp: number | null
}): PairingLink | undefined {
  if (trigger.exp === null) return undefined
  if (trigger.flow === 'agent-connect' && trigger.from.startsWith('did:key:'))
    return { kind: 'fallback', agentDid: trigger.from, requestId: trigger.id, exp: trigger.exp }
  if (trigger.flow === 'sign-in' && !trigger.from.startsWith('did:key:'))
    return { kind: 'oob', vtaDid: trigger.from, requestId: trigger.id, exp: trigger.exp }
  return undefined
}

/** Why the choice cannot be granted, or undefined. */
export function choiceProblem(choice: AgentConnectChoice): string | undefined {
  const name = sanitizeLabel(choice.name)
  if (!name) return 'name'
  if (choice.purposes.length === 0) return 'purposes'
  if (choice.purposes.some((p) => !(AGENT_PURPOSES as readonly string[]).includes(p))) return 'purposes'
  if (choice.memoryContexts.length === 0 && !choice.agentContext) return 'contexts'
  if (!choice.ownerPersonaDid.startsWith('did:')) return 'persona'
  return undefined
}

/** The entry of §3.3 for a choice, expiring {@link TEMPORARY_GRANT_MS} after `approvedAt`. */
export function aclScopeFor(choice: AgentConnectChoice, approvedAt: number): AgentAclScope {
  const memory = choice.memoryContexts.length > 0
  return {
    role: 'application',
    contexts: memory ? [...choice.memoryContexts] : [choice.agentContext as string],
    capabilities: memory ? { scope: 'listed', listed: [...MEMORY_CAPABILITIES] } : { scope: 'none' },
    keys: { scope: 'none' },
    purposes: [...choice.purposes],
    expiresAt: new Date(approvedAt + TEMPORARY_GRANT_MS).toISOString(),
    label: sanitizeLabel(choice.name) as string,
    consumerKind: AI_AGENT_KIND,
  }
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))

/**
 * Whether a rotated entry kept everything the grant set (§3.10: "Rotation lost `expiresAt`, capabilities or kind").
 * Which members `acl/swap-key` actually keeps is measured in step 0.1(c); this check holds whatever it finds.
 */
export function entryKeptLimits(entry: ListedEntry, scope: AgentAclScope): boolean {
  if (entry.consumerKind !== AI_AGENT_KIND) return false
  if (!entry.deviceId) return false
  if (entry.role !== scope.role) return false
  if (entry.keys.scope !== 'none') return false
  if (!sameSet(entry.contexts, scope.contexts)) return false
  if (!sameSet(entry.purposes, scope.purposes)) return false
  if (entry.capabilities.scope !== scope.capabilities.scope) return false
  if (entry.capabilities.scope === 'listed' && scope.capabilities.scope === 'listed') {
    if (!sameSet(entry.capabilities.listed, scope.capabilities.listed)) return false
  }
  if (entry.expiresAt === undefined) return false
  return Date.parse(entry.expiresAt) === Date.parse(scope.expiresAt)
}

export class PairingMachine {
  private current: PairingState = { phase: 'idle' }

  public constructor(private readonly deps: PairingDeps) {}

  public get state(): PairingState {
    return this.current
  }

  private set(next: PairingState): PairingState {
    this.current = next
    this.deps.onTransition?.(next)
    return next
  }

  private isTerminal(): boolean {
    return TERMINAL.includes(this.current.phase)
  }

  private async spend(requestId: string, until: number): Promise<void> {
    await this.deps.spent.add(requestId, until)
  }

  private async fail(reason: PairingFailure, extra: Partial<Extract<PairingState, { phase: 'failed' }>> = {}) {
    return this.set({ phase: 'failed', reason, ...extra })
  }

  /** A deadline passed: the request is spent and the pairing has expired. */
  private async expireIfDue(): Promise<boolean> {
    const s = this.current
    if (s.phase !== 'awaitingNumber' && s.phase !== 'awaitingApproval') return false
    if (this.deps.clock() < s.deadline) return false
    await this.spend(s.requestId, s.deadline)
    this.set({ phase: 'expired' })
    return true
  }

  /** Step 1: the owner chose the name, memories and purposes. Refused while locked. */
  public async start(choice: AgentConnectChoice): Promise<PairingState> {
    if (this.current.phase !== 'idle') throw new Error(`start in phase ${this.current.phase}`)
    if (choiceProblem(choice)) return this.fail('invalid-choice')
    const lock = await this.deps.lockout.state()
    if (lock.locked) return this.set({ phase: 'locked', lockout: lock })
    return this.set({ phase: 'awaitingScan', choice })
  }

  /** Steps 3 and 4 (or the fallback's scan): the code the owner scanned or pasted. */
  public async scan(link: PairingLink): Promise<PairingState> {
    const s = this.current
    if (s.phase !== 'awaitingScan') throw new Error(`scan in phase ${s.phase}`)
    const now = this.deps.clock()
    const exp = link.exp * 1000
    if (await this.deps.spent.has(link.requestId)) return this.fail('spent')
    if (exp <= now) {
      await this.spend(link.requestId, exp)
      return this.set({ phase: 'expired' })
    }

    if (link.kind === 'fallback') {
      const vtaDid = this.deps.resolver.ownVta()
      if (!vtaDid) return this.fail('vta-unreachable')
      return this.set({
        phase: 'awaitingApproval',
        choice: s.choice,
        link,
        vtaDid,
        requestId: link.requestId,
        deadline: exp,
        subject: link.agentDid,
        // TODO(0.1(h)): the requested scope the fallback link carries, once its encoding within 251 bytes is measured.
      })
    }

    // Step 3: never claim a code for a VTA this Keyring does not administer (no lockout count).
    if (!this.deps.resolver.administers(link.vtaDid)) return this.fail('foreign-vta')
    // The request is spent from the first claim sent, whatever comes back.
    await this.spend(link.requestId, exp)
    const claim = await this.deps.transport.claim(link.vtaDid, link.requestId)
    if (!claim.ok) {
      if (claim.refused === 'expired') return this.set({ phase: 'expired' })
      if (claim.refused === 'spent') return this.fail('spent')
      if (claim.refused === 'unsupported') return this.fail('unsupported')
      return this.fail('vta-unreachable')
    }
    // Step 4: the VTA named at the claim must be the one scanned, and one this Keyring administers.
    if (claim.vtaDid !== link.vtaDid || !this.deps.resolver.administers(claim.vtaDid)) {
      await this.deps.transport.decline(link.vtaDid, link.requestId).catch(() => undefined)
      return this.fail('foreign-vta')
    }
    if (claim.purpose !== 'deviceEnrol') {
      // A sign-in (or any other purpose) is never approved as an agent's enrolment.
      await this.deps.transport.decline(link.vtaDid, link.requestId).catch(() => undefined)
      return this.fail('not-a-pairing-code')
    }
    return this.set({
      phase: 'awaitingNumber',
      choice: s.choice,
      link,
      vtaDid: claim.vtaDid,
      requestId: link.requestId,
      deadline: claim.decisionDeadline,
    })
  }

  /**
   * Step 5: the digits the owner typed from the terminal. Exactly {@link MATCH_NUMBER_DIGITS} digits, or nothing is
   * sent and no attempt is used. One attempt per pairing: a mismatch ends it and counts toward the lockout.
   */
  public async enterNumber(digits: string): Promise<NumberEntry> {
    const s = this.current
    if (s.phase !== 'awaitingNumber') throw new Error(`enterNumber in phase ${s.phase}`)
    if (!new RegExp(`^[0-9]{${MATCH_NUMBER_DIGITS}}$`).test(digits)) {
      return { sent: false, reason: 'needs-digits', digits: MATCH_NUMBER_DIGITS }
    }
    if (await this.expireIfDue()) return { sent: true }
    const proved = await this.deps.transport.prove(s.vtaDid, s.requestId, digits)
    if (!proved.ok) {
      if (proved.refused === 'numberMismatch') {
        const lockout = await this.deps.lockout.recordWrongNumber()
        this.fail('wrong-number', { lockout })
      } else if (proved.refused === 'expired') {
        this.set({ phase: 'expired' })
      } else {
        this.fail('vta-unreachable')
      }
      return { sent: true }
    }
    // Only the members Approve shows are kept: nothing else the VTA answered (a number included) enters the state.
    const d = proved.disclosure
    const disclosure: PairingDisclosure = {
      ...(typeof d.requester === 'string' ? { requester: d.requester } : {}),
      ...(d.requestedScope !== undefined ? { requestedScope: d.requestedScope } : {}),
      ...(typeof d.sameNetwork === 'boolean' ? { sameNetwork: d.sameNetwork } : {}),
      ...(typeof d.starterDid === 'string' ? { starterDid: d.starterDid } : {}),
    }
    this.set({ ...s, phase: 'awaitingApproval', disclosure, subject: disclosure.starterDid })
    return { sent: true }
  }

  /**
   * Steps 6 and 7: the owner approved, after the phone's user verification (the driver's). The VTA, or in the
   * fallback Keyring as its administrator, creates the entry of §3.3.
   */
  public async approve(): Promise<PairingState> {
    const s = this.current
    if (s.phase !== 'awaitingApproval') throw new Error(`approve in phase ${s.phase}`)
    if (await this.expireIfDue()) return this.current
    const now = this.deps.clock()
    const scope = aclScopeFor(s.choice, now)
    if (s.link.kind === 'fallback') await this.spend(s.requestId, s.deadline)
    const granted =
      s.link.kind === 'oob'
        ? await this.deps.transport.grant(s.vtaDid, s.requestId, scope)
        : await this.deps.transport.grantFallback(s.vtaDid, s.link.agentDid, scope)
    if (!granted.ok) {
      if (granted.refused === 'expired') return this.set({ phase: 'expired' })
      if (granted.refused === 'unreachable') return this.fail('vta-unreachable')
      return this.fail('grant-refused')
    }
    return this.set({
      phase: 'awaitingEnrolment',
      choice: s.choice,
      vtaDid: s.vtaDid,
      scope,
      grantedContexts: granted.grantedContexts ? [...granted.grantedContexts] : [...scope.contexts],
      subject: granted.subject ?? s.subject,
      grantedAt: now,
    })
  }

  /**
   * Step 10: read the entry from the VTA. Confirmed once it is under a key other than `K_t`, with every limit the
   * grant set, the consumer kind `ai-agent` and a `deviceId`; the handle is fixed then. Still under `K_t` (or not
   * listed yet) it waits, and after {@link NOT_FINISHED_AFTER_MS} it is "Not finished" with the entry to remove.
   * How often to call this is the driver's (§11 Q7(c): a re-list).
   */
  public async checkEnrolment(): Promise<PairingState> {
    const s = this.current
    if (s.phase !== 'awaitingEnrolment') throw new Error(`checkEnrolment in phase ${s.phase}`)
    const now = this.deps.clock()
    const overdue = now - s.grantedAt >= NOT_FINISHED_AFTER_MS
    const cleanup = (deviceId = s.deviceId): PairingCleanup | undefined =>
      s.subject ? { vtaDid: s.vtaDid, subject: s.subject, ...(deviceId ? { deviceId } : {}) } : undefined
    if (!s.subject) {
      // TODO(§11 Q7(c), step 7.5): how Keyring learns the subject in the auth/oob path if neither prove nor grant names it.
      return overdue ? this.set({ phase: 'notFinished' }) : s
    }
    const read = await this.deps.entries.find({ subject: s.subject, deviceId: s.deviceId })
    if (!read.reachable) return overdue ? this.set({ phase: 'notFinished', cleanup: cleanup() }) : s
    const entry = read.entry
    if (!entry || entry.subject === s.subject) {
      const deviceId = entry?.deviceId ?? s.deviceId
      if (overdue) return this.set({ phase: 'notFinished', cleanup: cleanup(deviceId) })
      return deviceId === s.deviceId ? s : this.set({ ...s, deviceId })
    }
    // Rotated: the entry is under the agent's lasting key now.
    const rotatedCleanup: PairingCleanup = {
      vtaDid: s.vtaDid,
      subject: entry.subject,
      ...(entry.deviceId ? { deviceId: entry.deviceId } : {}),
    }
    if (!entryKeptLimits(entry, { ...s.scope, contexts: s.grantedContexts }))
      return this.fail('rotation-lost-limits', { cleanup: rotatedCleanup })
    const handle = deriveHandle(s.choice.name, entry.subject, this.deps.takenHandles())
    if (!handle.ok) return this.fail('handle-collision', { cleanup: rotatedCleanup })
    return this.set({
      phase: 'confirmed',
      agent: {
        name: s.scope.label,
        handle: handle.handle,
        agentDid: entry.subject,
        deviceId: entry.deviceId as string,
        vtaDid: s.vtaDid,
        ownerPersonaDid: s.choice.ownerPersonaDid,
        contexts: [...s.grantedContexts],
        contextsToAdd: s.scope.contexts.filter((c) => !s.grantedContexts.includes(c)),
        memoryContexts: [...s.choice.memoryContexts],
        capabilities: s.scope.capabilities,
        purposes: [...s.scope.purposes],
        expiresAt: s.scope.expiresAt,
        grantType: 'temporary',
      },
    })
  }

  /** The owner cancels (or declines on Approve). Not a wrong number. After a claim, the VTA is sent the decline. */
  public async cancel(): Promise<PairingState> {
    if (this.isTerminal()) return this.current
    const s = this.current
    if (s.phase === 'awaitingEnrolment') {
      // The entry exists: cancelling now means removing it.
      const cleanup = s.subject
        ? { vtaDid: s.vtaDid, subject: s.subject, ...(s.deviceId ? { deviceId: s.deviceId } : {}) }
        : undefined
      return this.set({ phase: 'cancelled', ...(cleanup ? { cleanup } : {}) })
    }
    if (s.phase === 'awaitingNumber' || s.phase === 'awaitingApproval') {
      await this.spend(s.requestId, s.deadline)
      if (s.link.kind === 'oob') await this.deps.transport.decline(s.vtaDid, s.requestId).catch(() => undefined)
    }
    return this.set({ phase: 'cancelled' })
  }

  /** Re-check the clock (the driver calls it on a timer): a deadline that passed ends the pairing as expired. */
  public async tick(): Promise<PairingState> {
    await this.expireIfDue()
    return this.current
  }
}
