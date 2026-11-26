/**
 * When the person's agent last held a rooms task for consent, kept across launches, so the phone does not ask it again
 * for a day.
 *
 * A task an agent's policy holds is refused at once here (`waitForConsent: false`), but the agent has already sent its
 * consent requests by then: to this phone, or to a trusted approver's, where a request stays pending for 15 minutes
 * (vta-service `policy_gate.rs`, docs/02-vta/task-consent.md) and nothing on this side can withdraw it. A rooms task the
 * phone sends on its own (a page's batch read, a room's watch) would raise one on every launch, and through every
 * session after the last one stopped. So a hold is noted here, by agent and task type, and the task is not sent to that
 * agent again until {@link CONSENT_HOLD_BACKOFF_MS} has passed. What it would have done is done the old way meanwhile.
 *
 * - **By agent**, which is the policy's scope: every identity this phone holds on one agent is held by the same rules,
 *   so a hold met while asking as one identity stops the task for all of them. The agent is the phone's own VTA, the
 *   one it is linked to, whichever identity a shared session is signed in as.
 * - **Compared at use.** A batch or a watch about to go out asks {@link ConsentHolds.heldRecently} with the time it is
 *   now, against the time the hold was noted. There is no timer and none is wanted: a timer would not survive a
 *   relaunch, and what it would do is already the comparison.
 * - **Fails toward holding.** A row that can't be read or parsed, or no agent to key it by, reads as held: the task is
 *   an optimisation, and an approval request on someone else's phone is not its to raise.
 *
 * @module rooms/real/consentHolds
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

/** How long a task an agent held for consent is not sent to that agent again. */
export const CONSENT_HOLD_BACKOFF_MS = 24 * 60 * 60 * 1000

const KEY = 'rooms.consentHolds.v1'

export interface ConsentHolds {
  /** True when the agent held `type` for consent in the last day, or when that cannot be told. */
  heldRecently(type: string, now: number): Promise<boolean>
  /** Note that the agent held `type` for consent at `now`. */
  noteHeld(type: string, now: number): Promise<void>
}

type Rows = Record<string, Record<string, number>>

interface Storage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

/** The rows as stored; `undefined` when what is stored can't be read as rows. No row at all is no holds. */
function parse(raw: string | null): Rows | undefined {
  // Nothing stored is null, as AsyncStorage answers it. Anything else that is not rows, undefined included, reads as held.
  if (raw === null) return {}
  try {
    const rows: unknown = JSON.parse(raw)
    if (typeof rows !== 'object' || rows === null || Array.isArray(rows)) return undefined
    for (const byType of Object.values(rows))
      if (typeof byType !== 'object' || byType === null || Array.isArray(byType)) return undefined
    return rows as Rows
  } catch {
    return undefined
  }
}

/**
 * Holds kept in AsyncStorage, under the agent `agentId()` names at the time of each call: the agent can be unlinked
 * and another linked while the app runs.
 */
export function storedConsentHolds(agentId: () => string | undefined, storage: Storage = AsyncStorage): ConsentHolds {
  return {
    async heldRecently(type, now) {
      const agent = agentId()
      if (!agent) return true
      const rows = parse(await storage.getItem(KEY))
      if (!rows) return true
      const at = rows[agent]?.[type]
      if (at === undefined) return false
      if (typeof at !== 'number' || !Number.isFinite(at)) return true
      // A hold noted ahead of this clock (the clock was set back) still ends a day after it was noted.
      return now < at + CONSENT_HOLD_BACKOFF_MS
    },
    async noteHeld(type, now) {
      const agent = agentId()
      if (!agent) return
      // What can't be read is replaced: the hold being noted is what matters now, and it reads as held either way.
      // A read that throws at once is caught here as one that rejects.
      const rows =
        parse(
          await Promise.resolve()
            .then(() => storage.getItem(KEY))
            .catch(() => null)
        ) ?? {}
      const kept: Rows = {}
      for (const [a, byType] of Object.entries(rows)) {
        const live = Object.entries(byType).filter(
          ([, at]) => typeof at === 'number' && Number.isFinite(at) && now < at + CONSENT_HOLD_BACKOFF_MS
        )
        if (live.length) kept[a] = Object.fromEntries(live)
      }
      kept[agent] = { ...kept[agent], [type]: now }
      await storage.setItem(KEY, JSON.stringify(kept))
    },
  }
}
