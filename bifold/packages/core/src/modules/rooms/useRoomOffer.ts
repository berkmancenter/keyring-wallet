/**
 * One room offer, as its consent screen shows it: the service's preview of exactly what accepting does, then
 * accept or hide. The offer is named by an `offerRef`, so the screen never depends on how it was reached: the
 * offers list today, a join link or QR later (rooms member sprint, "Join entry points").
 *
 * Accepting sends the preview's token. A token that has gone stale (older than ten minutes, or from before the
 * app restarted) is not an error the person caused: the preview is read again and the screen asks them to look
 * once more, since what they agreed to may have changed. Nothing is sent in that case.
 *
 * An accept the community answers is an admission, said in a notice ({@link ROOM_ADMITTED_EVENT}) as the screen
 * moves into the room. One it answers "admission pending" is asked again in the background for a few minutes
 * (admissionResend), and the same notice says when it is through, wherever the member is then.
 *
 * @module rooms/useRoomOffer
 */
import { useCallback, useEffect, useState } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { resendAdmission, stopAdmissionResend } from './admissionResend'
import type { OfferPreview, OperationStatus, RoomsReason, RoomsService } from './types'

/** The member was admitted to a room: an accept the community answered. */
export const ROOM_ADMITTED_EVENT = 'rooms:admitted'

export interface RoomAdmitted {
  roomId: string
  roomName: string
}

export type OfferStep = 'reading' | 'ready' | 'accepting' | 'hiding'

export interface RoomOfferState {
  /** Undefined until the first read answers. */
  acceptStatus?: OperationStatus
  hideStatus?: OperationStatus
  preview?: OfferPreview
  step: OfferStep
  /** The offer could not be read. */
  readFailed: boolean
  /** The last accept or hide failed; nothing changed. */
  actFailed?: 'accept' | 'hide'
  /** Why the last accept was refused, when the service said; undefined for a failure with no reason (try again). */
  refusal?: AcceptRefusal
  /** The preview was stale and has been read again: ask the person to check it once more. */
  refreshed: boolean
  reload: () => void
  /** Accepts the previewed offer and answers the room it joined; undefined when nothing was accepted. */
  accept: () => Promise<string | undefined>
  /** Hides the offer on this phone; false when it could not. */
  hide: () => Promise<boolean>
}

const isExpired = (e: unknown): boolean => e instanceof Error && e.name === 'RoomsPreviewExpired'

/**
 * A refused accept, as the service reports it:
 * - `RoomsUnavailable`: the operation is not served (its `reason`, worded as every rooms screen words it);
 * - `RoomsRefused`: the community answered with a refusal `code` (vtc/rooms/offers/accept/0.1, without the task
 *   prefix), and whether trying again can help.
 */
export type AcceptRefusal = { reason: RoomsReason } | { code: string; retryable: boolean }

const refusalOf = (e: unknown): AcceptRefusal | undefined => {
  if (!(e instanceof Error)) return undefined
  const fields = e as Error & { reason?: RoomsReason; code?: unknown; retryable?: unknown }
  if (e.name === 'RoomsUnavailable' && fields.reason) return { reason: fields.reason }
  if (e.name === 'RoomsRefused' && typeof fields.code === 'string')
    return { code: fields.code, retryable: fields.retryable === true }
  return undefined
}

export function useRoomOffer(service: RoomsService | undefined, offerRef: string): RoomOfferState {
  const [acceptStatus, setAcceptStatus] = useState<OperationStatus>()
  const [hideStatus, setHideStatus] = useState<OperationStatus>()
  const [preview, setPreview] = useState<OfferPreview>()
  const [step, setStep] = useState<OfferStep>('reading')
  const [readFailed, setReadFailed] = useState(false)
  const [actFailed, setActFailed] = useState<'accept' | 'hide'>()
  const [refusal, setRefusal] = useState<AcceptRefusal>()
  const [refreshed, setRefreshed] = useState(false)
  const [generation, setGeneration] = useState(0)
  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  useEffect(() => {
    if (!service) return
    let live = true
    setStep('reading')
    setReadFailed(false)
    void (async () => {
      try {
        const capabilities = await service.capabilities({ refresh: generation > 0 })
        if (!live) return
        setAcceptStatus(capabilities.acceptOffer)
        setHideStatus(capabilities.hideOffer)
        if (capabilities.acceptOffer.status !== 'available') return setStep('ready')
        const read = await service.previewOffer(offerRef)
        if (!live) return
        setPreview(read)
        setStep('ready')
      } catch {
        if (live) {
          setReadFailed(true)
          setStep('ready')
        }
      }
    })()
    return () => {
      live = false
    }
  }, [service, offerRef, generation])

  const accept = useCallback(async () => {
    if (!service || !preview) return undefined
    setActFailed(undefined)
    setRefusal(undefined)
    setRefreshed(false)
    setStep('accepting')
    // The member asking again themselves: the background tries step aside.
    stopAdmissionResend(preview.offer.offerId)
    try {
      const { roomId } = await service.acceptOffer(preview.token)
      setStep('ready')
      const admitted: RoomAdmitted = { roomId, roomName: String(preview.offer.roomName) }
      DeviceEventEmitter.emit(ROOM_ADMITTED_EVENT, admitted)
      return roomId
    } catch (e) {
      if (isExpired(e)) {
        try {
          setPreview(await service.previewOffer(offerRef))
          setRefreshed(true)
        } catch {
          setReadFailed(true)
        }
      } else {
        setActFailed('accept')
        const refusal = refusalOf(e)
        setRefusal(refusal)
        if (refusal && 'code' in refusal && refusal.code === 'admissionPending') resendAdmission(service, preview)
      }
      setStep('ready')
      return undefined
    }
  }, [service, preview, offerRef])

  const hide = useCallback(async () => {
    if (!service) return false
    setActFailed(undefined)
    setStep('hiding')
    try {
      await service.hideOffer(offerRef)
      setStep('ready')
      return true
    } catch {
      setActFailed('hide')
      setStep('ready')
      return false
    }
  }, [service, offerRef])

  return { acceptStatus, hideStatus, preview, step, readFailed, actFailed, refusal, refreshed, reload, accept, hide }
}
