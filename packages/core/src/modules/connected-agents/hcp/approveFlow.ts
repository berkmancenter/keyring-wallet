/**
 * The HCP approval, as a small state machine (step 7.27 track C, part 2, "The flow, decided"):
 *
 * 1. The person names the agent (the name is Keyring's, never the request's) and scans the link: {@link start}.
 * 2. Keyring waits for the VTA's consent request for that link ({@link findHcpApproval}).
 * 3. It waits at most {@link HCP_SCAN_WAIT_MS} from the scan, then `expired`.
 * 4. An approval whose own `expiresAt` has passed is `expired` too.
 * 5. The person types the four digits from their terminal: one try. A mismatch denies the request and counts one
 *    wrong number on `../lockout.ts`, as the base path's pairing does; while locked out, scanning gives `locked`
 *    before any wait.
 * 6. A match shows the approve view. When the request names no purpose, the person picks one of the `choose: true`
 *    purposes first ({@link HcpApproveFlow.choosePurpose}); Approve does nothing until they have;
 * 7. Approve first writes part 3's approval in flight (`beforeApprove`, naming the
 *    grant), then calls `decide(id, 'approve')`, which runs the phone's owner check itself; 8. on `approved`,
 *    `onApproved` makes it part 3's connection; 9. Cancel before Approve denies the request if one was found, and
 *    otherwise sends nothing.
 *
 * The match number is never kept: not in a state, a view, a call or a log. The typed digits are compared and dropped.
 *
 * @module connected-agents/hcp/approveFlow
 */
import type { PairingLockout } from '../lockout'
import {
  findHcpApproval,
  hcpApprovalExpired,
  isHcpApprovalFor,
  readHcpEffects,
  type HcpApprovalSource,
} from './approvals'
import { hcpApproveView } from './approveView'
import { hcpNumberMatches } from './matchNumber'
import { isHcpEnabled } from './hcpFlag'
import type { HcpApprovalView, HcpConnectLink } from './types'

/** How long Keyring waits for the consent request after the scan: the same bound as the request's `expiresAt`. */
export const HCP_SCAN_WAIT_MS = 5 * 60 * 1000

/** The reason sent with the deny when the typed number does not match. */
export const HCP_WRONG_NUMBER_REASON = 'the number did not match'
/** The reason sent with the deny when the person cancels. */
export const HCP_CANCEL_REASON = 'cancelled'

/** Where the flow is. Messages are copy keys (`./copy.ts`); no state holds the match number. */
export type HcpApproveState =
  | { state: 'idle' }
  | { state: 'locked'; minutes: number; message: { key: 'Locked'; params: { n: string } } }
  | { state: 'waiting' }
  | { state: 'expired'; message: { key: 'CodeExpired' } }
  | { state: 'wrongNumber'; message: { key: 'WrongNumber' } }
  | { state: 'numberEntry' }
  | { state: 'approve'; view: HcpApprovalView }
  | { state: 'approving'; view: HcpApprovalView }
  | { state: 'approved'; view: HcpApprovalView }
  | { state: 'failed'; error: string; message: HcpApproveFailure }
  | { state: 'cancelled'; message: { key: 'ApproveCancelled' } }

/**
 * What a `failed` state shows, chosen by case, never from the error: `error` is the raw text (a thrown message, the
 * VTA's own error or status) for logs and tests, and is never what the person reads.
 * - `ApproveNotApproved`: nothing was approved (no name, or the record before `decide` failed); another try is safe.
 * - `ApproveNotRecorded`: approved, the grant exists, only the record failed; the reconcile completes it, and no other
 *   try may be offered (a second approval creates a second grant).
 * - `ApproveDeclined`: the VTA did not approve (`decide` failed, or the request settled other than approved).
 * - `ApproveAnsweredElsewhere`: approved outside this flow while it waited.
 */
export type HcpApproveFailure =
  | { key: 'ApproveNotApproved' }
  | { key: 'ApproveNotRecorded'; params: { name: string } }
  | { key: 'ApproveDeclined' }
  | { key: 'ApproveAnsweredElsewhere' }

export interface HcpApproveFlowDeps {
  source: HcpApprovalSource
  /** The base path's lockout (`../lockout.ts`), shared with pairing: the same wrong-number count. */
  lockout: Pick<PairingLockout, 'state' | 'recordWrongNumber'>
  clock: () => Date
  /**
   * Part 3 writes the approval in flight here, BEFORE `decide(approve)` (`./store.ts`, `beginHcpApproval`): it names
   * the grant the approval would create, so a failure or a stop from here on leaves a record for the reconcile rather
   * than a grant with none. If it fails, nothing is approved. `startedAt` is the clock just before the write.
   */
  beforeApprove: (
    view: HcpApprovalView,
    approval: { id: string; expiresAt: string },
    startedAt: Date
  ) => Promise<void> | void
  /**
   * Part 3 makes the approval in flight the connection here (`recordHcpApproval`). `approvedAt` is the clock when
   * `decide(approve)` resolved. If it fails, the approval in flight stays and the reconcile completes it.
   */
  onApproved: (view: HcpApprovalView, approvedAt: Date) => Promise<void> | void
  /** A timer, for the waits; `setTimeout` by default. Returns its cancel. */
  setTimer?: (run: () => void, ms: number) => () => void
}

export interface HcpApproveFlow {
  start(input: { name: string; link: HcpConnectLink }): Promise<HcpApproveState>
  typeNumber(digits: string): Promise<HcpApproveState>
  /** In `approve`, pick one of the view's `purposeChoice` options (by purpose IRI); anything else changes nothing. */
  choosePurpose(purpose: string): HcpApproveState
  approve(): Promise<HcpApproveState>
  cancel(): Promise<HcpApproveState>
  state(): HcpApproveState
  subscribe(listener: () => void): () => void
}

const TERMINAL = new Set<HcpApproveState['state']>([
  'locked',
  'expired',
  'wrongNumber',
  'approved',
  'failed',
  'cancelled',
])

const EXPIRED: HcpApproveState = { state: 'expired', message: { key: 'CodeExpired' } }

const defaultTimer = (run: () => void, ms: number) => {
  const t = setTimeout(run, ms)
  return () => clearTimeout(t)
}

const CANCELLED: HcpApproveState = { state: 'cancelled', message: { key: 'ApproveCancelled' } }

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const failed = (error: string, message: HcpApproveFailure): HcpApproveState => ({ state: 'failed', error, message })

export function createHcpApproveFlow(deps: HcpApproveFlowDeps): HcpApproveFlow {
  const setTimer = deps.setTimer ?? defaultTimer
  const listeners = new Set<() => void>()
  let current: HcpApproveState = { state: 'idle' }
  let starting = false
  let name = ''
  let link: HcpConnectLink | undefined
  let scanAt = 0
  /** The approval found for the link: its id and what Approve shows. */
  let found: { id: string; view: HcpApprovalView } | undefined
  let stopSource: (() => void) | undefined
  let stopTimer: (() => void) | undefined

  const teardown = () => {
    stopSource?.()
    stopSource = undefined
    stopTimer?.()
    stopTimer = undefined
  }

  const set = (next: HcpApproveState): HcpApproveState => {
    current = next
    if (TERMINAL.has(next.state)) teardown()
    listeners.forEach((l) => l())
    return current
  }

  const armAt = (at: number) => {
    stopTimer?.()
    stopTimer = setTimer(refresh, Math.max(0, at - deps.clock().getTime()))
  }

  /** Look again at the approvals and the time: on every change of the source, and when a wait runs out. */
  function refresh(): void {
    if (!link) return
    const now = deps.clock()
    const approvals = deps.source.list()
    if (current.state === 'waiting') {
      const approval = findHcpApproval(approvals, link, now)
      if (approval) {
        const effects = readHcpEffects(approval)
        if (!effects) return
        found = { id: approval.id, view: hcpApproveView(name, effects, link.threadId) }
        set({ state: 'numberEntry' })
        armAt(Date.parse(approval.expiresAt))
        return
      }
      const lapsed = approvals.some(
        (a) =>
          isHcpApprovalFor(a, link as HcpConnectLink) &&
          (a.status === 'expired' || (a.status === 'pending' && hcpApprovalExpired(a, now)))
      )
      if (lapsed || now.getTime() - scanAt >= HCP_SCAN_WAIT_MS) set(EXPIRED)
      return
    }
    if ((current.state === 'numberEntry' || current.state === 'approve') && found) {
      const approval = approvals.find((a) => a.id === found?.id)
      if (!approval || approval.status === 'expired' || hcpApprovalExpired(approval, now)) {
        set(EXPIRED)
      } else if (approval.status !== 'pending') {
        // Decided somewhere else (the ordinary Requests screen): this flow has nothing left to approve.
        set(
          failed(
            approval.error ?? approval.status,
            approval.status === 'approved' ? { key: 'ApproveAnsweredElsewhere' } : { key: 'ApproveDeclined' }
          )
        )
      }
    }
  }

  const deny = async (id: string, reason: string) => {
    await deps.source.decide(id, 'deny', reason).catch(() => undefined)
  }

  return {
    state: () => current,

    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async start(input) {
      if (current.state !== 'idle' || starting) return current
      // Nothing runs unless both flags are on.
      if (!isHcpEnabled()) return current
      const given = input.name.trim()
      if (!given) return set(failed('invalid-name', { key: 'ApproveNotApproved' }))
      starting = true
      try {
        const lock = await deps.lockout.state()
        if (current.state !== 'idle') return current
        if (lock.locked) {
          return set({
            state: 'locked',
            minutes: lock.minutesLeft,
            message: { key: 'Locked', params: { n: String(lock.minutesLeft) } },
          })
        }
        name = given
        link = input.link
        scanAt = deps.clock().getTime()
        set({ state: 'waiting' })
        stopSource = deps.source.subscribe(refresh)
        armAt(scanAt + HCP_SCAN_WAIT_MS)
        refresh()
        return current
      } finally {
        starting = false
      }
    },

    async typeNumber(digits) {
      if (current.state !== 'numberEntry' || !found || !link) return current
      // Exactly four ASCII digits, or nothing is sent and the one try is not used (as pairing does).
      if (typeof digits !== 'string' || !/^[0-9]{4}$/.test(digits)) return current
      refresh()
      if (current.state !== 'numberEntry') return current
      if (hcpNumberMatches(digits, link.threadId, link.clientVid)) return set({ state: 'approve', view: found.view })
      // One try (plan §6): a mismatch ends the flow, denies the request and counts toward the lockout.
      const id = found.id
      set({ state: 'wrongNumber', message: { key: 'WrongNumber' } })
      await deny(id, HCP_WRONG_NUMBER_REASON)
      await deps.lockout.recordWrongNumber()
      return current
    },

    choosePurpose(purpose) {
      if (current.state !== 'approve' || !found) return current
      if (!found.view.purposeChoice?.options.some((o) => o.purpose === purpose)) return current
      found = { ...found, view: { ...found.view, chosenPurpose: purpose } }
      return set({ state: 'approve', view: found.view })
    },

    async approve() {
      if (current.state !== 'approve' || !found) return current
      // A request that names no purpose is approved only with the person's choice.
      // TODO(vti): the choice is kept on Keyring's own records only. The consent decision (`vtaAgent.decide`,
      // task-consent/decision) has no field to carry it to the VTA; open question for the VTA side (VTI hcp.md §5.1).
      if (found.view.purposeChoice && !found.view.chosenPurpose) return current
      refresh()
      if (current.state !== 'approve') return current
      const { id, view } = found
      set({ state: 'approving', view })
      const listed = () => deps.source.list().find((a) => a.id === id)
      const approval = listed()
      if (!approval) return set(EXPIRED)
      try {
        // The record first, then the approval: from here on a failure leaves a record naming the grant, not a gap.
        await deps.beforeApprove(view, { id, expiresAt: approval.expiresAt }, deps.clock())
      } catch (error) {
        return set(failed(`not recorded, so not approved: ${errorText(error)}`, { key: 'ApproveNotApproved' }))
      }
      try {
        // `decide` runs the phone's owner check (face or fingerprint) itself; none is added here.
        await deps.source.decide(id, 'approve')
      } catch (error) {
        return set(failed(listed()?.error ?? errorText(error), { key: 'ApproveDeclined' }))
      }
      const after = listed()
      if (after?.status !== 'approved') return set(failed(after?.error ?? 'not approved', { key: 'ApproveDeclined' }))
      const approvedAt = deps.clock()
      try {
        await deps.onApproved(view, approvedAt)
      } catch (error) {
        return set(
          failed(`approved, but not recorded: ${errorText(error)}`, {
            key: 'ApproveNotRecorded',
            params: { name: view.title.params.name },
          })
        )
      }
      return set({ state: 'approved', view })
    },

    async cancel() {
      const s = current.state
      if (s === 'idle' || s === 'waiting') return set(CANCELLED)
      if ((s === 'numberEntry' || s === 'approve') && found) {
        const id = found.id
        set(CANCELLED)
        await deny(id, HCP_CANCEL_REASON)
      }
      return current
    },
  }
}
