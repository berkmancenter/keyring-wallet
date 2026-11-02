/**
 * An accept the community answered "admission pending", asked again in the background. The community is still
 * settling the admission with its own agent, and the phone's own resends (agentRoomsService, about 7 s) ran out
 * before it had; nothing tells the phone when it has. So the same accept is sent again after
 * {@link ADMISSION_RESEND_MS}, only while the app is in the foreground, until the community answers, and the member
 * is told in the admission notice ("You've been admitted to …", roomNotices).
 *
 * A preview token is good for one accept, so each try reads the offer again first. An offer whose terms are no longer
 * the ones the member agreed to (its room, tier, access or who they join as) is not accepted: it stops there, and the
 * member decides again from the offer. A repeat is answered as the first was: the agent gives the KeyPackage it
 * already gave, and an admission already made is simply done.
 *
 * It stops at the first answer that isn't "still settling": admitted, a refusal, an offer gone. A try that fails for
 * any other reason (the agent or the community not reached) waits for the next. The member accepting again from the
 * offer stops it too. In memory only: a relaunch forgets it, and the offer stays listed to accept again.
 *
 * @module rooms/admissionResend
 */
import { AppState, DeviceEventEmitter } from 'react-native'

import type { OfferPreview, RoomsService } from './types'
import { ROOM_ADMITTED_EVENT, type RoomAdmitted } from './useRoomOffer'

/** The waits before each try: about eight and a half minutes in all. */
export const ADMISSION_RESEND_MS = [30_000, 60_000, 120_000, 300_000]

/** The community's answers that mean "still settling": the same accept may get past them. */
const SETTLING = new Set(['admissionPending', 'keyHolderRefused'])

// By offer, the way to stop its tries. In memory only (see above); not named `*Store`, which tier.mjs reads, with a
// `.delete(`, as deleting stored records.
const resending = new Map<string, () => void>()

const sameTerms = (agreed: OfferPreview, now: OfferPreview): boolean =>
  agreed.offer.roomId === now.offer.roomId &&
  agreed.offer.tier === now.offer.tier &&
  [...agreed.offer.verbs].sort().join(',') === [...now.offer.verbs].sort().join(',') &&
  agreed.actingAs.did === now.actingAs.did

const refusedCode = (e: unknown): string | undefined => {
  if (!(e instanceof Error) || e.name !== 'RoomsRefused') return undefined
  const { code } = e as Error & { code?: unknown }
  return typeof code === 'string' ? code : undefined
}

/** Resolves once the app is in the foreground, or false if stopped first. */
const inForeground = (stopped: () => boolean): Promise<boolean> =>
  new Promise((resolve) => {
    if (stopped()) return resolve(false)
    if (AppState.currentState === 'active') return resolve(true)
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && !stopped()) return
      sub.remove()
      resolve(!stopped())
    })
  })

/** Stops the tries for an offer, if any are under way. */
export function stopAdmissionResend(offerId: string): void {
  resending.get(offerId)?.()
}

/** Stops every offer's tries: for tests, so no timer outlives the one that started it. */
export function stopAllAdmissionResends(): void {
  ;[...resending.values()].forEach((stop) => stop())
}

/** Starts asking again for an accept the community answered "admission pending". */
export function resendAdmission(service: RoomsService, agreed: OfferPreview): void {
  const offerId = agreed.offer.offerId
  stopAdmissionResend(offerId)
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let wake: (() => void) | undefined
  const stop = () => {
    stopped = true
    if (timer) clearTimeout(timer)
    wake?.()
    if (resending.get(offerId) === stop) resending.delete(offerId)
  }
  resending.set(offerId, stop)
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve
      timer = setTimeout(resolve, ms)
    })

  void (async () => {
    for (const ms of ADMISSION_RESEND_MS) {
      await wait(ms)
      if (!(await inForeground(() => stopped))) return
      try {
        const now = await service.previewOffer(offerId)
        if (stopped) return
        if (!sameTerms(agreed, now)) return stop()
        const { roomId } = await service.acceptOffer(now.token)
        if (stopped) return
        stop()
        const admitted: RoomAdmitted = { roomId, roomName: String(now.offer.roomName) }
        DeviceEventEmitter.emit(ROOM_ADMITTED_EVENT, admitted)
        return
      } catch (e) {
        const code = refusedCode(e)
        // Any other refusal is the community's answer: an offer gone, or not for this member. Accepting no longer
        // served at all (the agent changed) is not going to pass either.
        if ((code && !SETTLING.has(code)) || (e instanceof Error && e.name === 'RoomsUnavailable')) return stop()
      }
    }
    stop()
  })()
}
