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
 * 6. A match shows the approve view; 7. Approve calls `decide(id, 'approve')`, which runs the phone's owner check
 *    itself; 8. on `approved`, `onApproved` writes part 3's record; 9. Cancel before Approve denies the request if
 *    one was found, and otherwise sends nothing.
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
  | { state: 'failed'; error: string }
  | { state: 'cancelled' }

export interface HcpApproveFlowDeps {
  source: HcpApprovalSource
  /** The base path's lockout (`../lockout.ts`), shared with pairing: the same wrong-number count. */
  lockout: Pick<PairingLockout, 'state' | 'recordWrongNumber'>
  clock: () => Date
  /** Part 3 writes the record here. `approvedAt` is the clock when `decide(approve)` resolved. */
  onApproved: (view: HcpApprovalView, approvedAt: Date) => Promise<void> | void
  /** A timer, for the waits; `setTimeout` by default. Returns its cancel. */
  setTimer?: (run: () => void, ms: number) => () => void
}

export interface HcpApproveFlow {
  start(input: { name: string; link: HcpConnectLink }): Promise<HcpApproveState>
  typeNumber(digits: string): Promise<HcpApproveState>
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

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

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
        found = { id: approval.id, view: hcpApproveView(name, effects) }
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
        set({ state: 'failed', error: approval.error ?? approval.status })
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
      if (!given) return set({ state: 'failed', error: 'invalid-name' })
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

    async approve() {
      if (current.state !== 'approve' || !found) return current
      refresh()
      if (current.state !== 'approve') return current
      const { id, view } = found
      set({ state: 'approving', view })
      const listed = () => deps.source.list().find((a) => a.id === id)
      try {
        // `decide` runs the phone's owner check (face or fingerprint) itself; none is added here.
        await deps.source.decide(id, 'approve')
      } catch (error) {
        return set({ state: 'failed', error: listed()?.error ?? errorText(error) })
      }
      const after = listed()
      if (after?.status !== 'approved') return set({ state: 'failed', error: after?.error ?? 'not approved' })
      const approvedAt = deps.clock()
      try {
        await deps.onApproved(view, approvedAt)
      } catch (error) {
        return set({ state: 'failed', error: `approved, but not recorded: ${errorText(error)}` })
      }
      return set({ state: 'approved', view })
    },

    async cancel() {
      const s = current.state
      if (s === 'idle' || s === 'waiting') return set({ state: 'cancelled' })
      if ((s === 'numberEntry' || s === 'approve') && found) {
        const id = found.id
        set({ state: 'cancelled' })
        await deny(id, HCP_CANCEL_REASON)
      }
      return current
    },
  }
}
