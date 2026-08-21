import { MdocRecord, SdJwtVcRecord, W3cCredentialRecord, W3cV2CredentialRecord } from '@credo-ts/core'
import { useBasicMessages, useCredentialByState, useProofByState } from '@bifold/react-hooks'
import {
  DidCommBasicMessageRecord,
  DidCommCredentialExchangeRecord as CredentialRecord,
  DidCommCredentialState,
  DidCommProofExchangeRecord,
  DidCommProofState,
} from '@credo-ts/didcomm'
import { ProofCustomMetadata, ProofMetadata } from '@bifold/verifier'
import { useEffect, useMemo, useState } from 'react'

import {
  BasicMessageMetadata,
  CredentialMetadata,
  basicMessageCustomMetadata,
  credentialCustomMetadata,
} from '../types/metadata'
import { useOpenID } from '../modules/openid/hooks/openid'
import { CustomNotification } from '../types/notification'
import { OpenIDNotificationData } from '../modules/openid/features/notifications/types'
import { OpenId4VPRequestRecord } from '../modules/openid/types'
import { useExpiredNotifications } from '../modules/openid/hooks/useExpiredNotifications'
import { useReplacementNotifications } from '../modules/openid/hooks/useReplacementNotifications'
import { OpenIDCredentialRecord } from '../modules/openid/credentialRecord'

/**
 * Module-level store for connection IDs to exclude from notifications.
 * Used to filter out witness connection notifications.
 */
const excludedConnectionIds = new Set<string>()

/**
 * Subscribers that get notified when exclusions change.
 * Each subscriber is a callback that will be called when the exclusion list changes.
 */
const exclusionChangeSubscribers = new Set<() => void>()

/**
 * Notify all subscribers that the exclusion list has changed
 */
function notifyExclusionChange(): void {
  exclusionChangeSubscribers.forEach((callback) => callback())
}

/**
 * Subscribe to exclusion list changes
 * @param callback - Function to call when exclusions change
 * @returns Unsubscribe function
 */
export function subscribeToExclusionChanges(callback: () => void): () => void {
  exclusionChangeSubscribers.add(callback)
  return () => {
    exclusionChangeSubscribers.delete(callback)
  }
}

/**
 * Add a connection ID to be excluded from notifications
 * @param connectionId - The connection ID to exclude (e.g., witness connection)
 */
export function addExcludedNotificationConnectionId(connectionId: string): void {
  const hadId = excludedConnectionIds.has(connectionId)
  excludedConnectionIds.add(connectionId)
  // Only notify if we actually added a new ID
  if (!hadId) {
    notifyExclusionChange()
  }
}

/**
 * Remove a connection ID from the exclusion list
 * @param connectionId - The connection ID to stop excluding
 */
export function removeExcludedNotificationConnectionId(connectionId: string): void {
  const hadId = excludedConnectionIds.has(connectionId)
  excludedConnectionIds.delete(connectionId)
  // Only notify if we actually removed an ID
  if (hadId) {
    notifyExclusionChange()
  }
}

/**
 * Check if a connection ID is excluded from notifications
 * @param connectionId - The connection ID to check
 */
export function isConnectionExcludedFromNotifications(connectionId: string): boolean {
  return excludedConnectionIds.has(connectionId)
}

/**
 * Get all excluded connection IDs
 */
export function getExcludedNotificationConnectionIds(): string[] {
  return Array.from(excludedConnectionIds)
}

/**
 * Clear all excluded connection IDs (for testing purposes)
 * @internal This should only be used in tests
 */
export function clearExcludedNotificationConnectionIds(): void {
  excludedConnectionIds.clear()
  notifyExclusionChange()
}

/**
 * Hook to subscribe to exclusion list changes.
 * Returns a version number that increments when exclusions change,
 * causing the component to re-render.
 */
export function useExclusionVersion(): number {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const unsubscribe = subscribeToExclusionChanges(() => {
      setVersion((v) => v + 1)
    })
    return unsubscribe
  }, [])

  return version
}

export type NotificationsInputProps = {
  openIDUri?: string
  openIDPresentationUri?: string
}

export type NotificationItemType =
  | DidCommBasicMessageRecord
  | CredentialRecord
  | DidCommProofExchangeRecord
  | CustomNotification
  | SdJwtVcRecord
  | W3cCredentialRecord
  | W3cV2CredentialRecord
  | MdocRecord
  | OpenId4VPRequestRecord
  | OpenIDNotificationData

export type NotificationReturnType = Array<NotificationItemType>

export const useNotifications = ({
  openIDUri,
  openIDPresentationUri,
}: NotificationsInputProps): NotificationReturnType => {
  const doneStates = useMemo(() => [DidCommProofState.Done, DidCommProofState.PresentationReceived] as DidCommProofState[], [])

  const [notifications, setNotifications] = useState<NotificationReturnType>([])
  const { records: basicMessages } = useBasicMessages()
  const offers = useCredentialByState(DidCommCredentialState.OfferReceived)
  const proofsRequested = useProofByState(DidCommProofState.RequestReceived)
  const credsReceived = useCredentialByState(DidCommCredentialState.CredentialReceived)
  const credsDone = useCredentialByState(DidCommCredentialState.Done)
  const proofsDone = useProofByState(doneStates)
  const openIDCredRecieved = useOpenID({ openIDUri: openIDUri, openIDPresentationUri: openIDPresentationUri })
  const openIDExpiredNotifs = useExpiredNotifications()
  const openIDReplacementNotifs = useReplacementNotifications()

  // Subscribe to exclusion changes so notifications re-filter when witness connections are excluded
  const exclusionVersion = useExclusionVersion()

  useEffect(() => {
    // Helper to check if a notification should be excluded based on connectionId
    const isExcluded = (connectionId?: string): boolean => {
      if (!connectionId) return false
      return excludedConnectionIds.has(connectionId)
    }

    // get all unseen messages
    const unseenMessages: DidCommBasicMessageRecord[] = basicMessages.filter((msg) => {
      if (isExcluded(msg.connectionId)) {
        return false
      }
      const meta = msg.metadata.get(BasicMessageMetadata.customMetadata) as basicMessageCustomMetadata
      return !meta?.seen
    })

    // add one unseen message per contact to notifications
    const contactsWithUnseenMessages: string[] = []
    const messagesToShow: DidCommBasicMessageRecord[] = []

    unseenMessages.forEach((msg) => {
      if (!contactsWithUnseenMessages.includes(msg.connectionId)) {
        contactsWithUnseenMessages.push(msg.connectionId)
        messagesToShow.push(msg)
      }
    })

    // Filter offers from excluded connections and RCard (contact card)
    // exchanges — those are auto-accepted plumbing, not user-actionable
    const filteredOffers = offers.filter(
      (offer) =>
        !isExcluded(offer.connectionId) &&
        !offer.metadata.get('rcardExchange') &&
        !offer.metadata.get('offerClassifying')
    )

    // Filter proofs from excluded connections
    const filteredProofsRequested = proofsRequested.filter((proof) => !isExcluded(proof.connectionId))

    const validProofsDone = proofsDone.filter((proof: DidCommProofExchangeRecord) => {
      // Filter out excluded connections
      if (isExcluded(proof.connectionId)) {
        return false
      }
      if (proof.isVerified === undefined) {
        return false
      }

      const metadata = proof.metadata.get(ProofMetadata.customMetadata) as ProofCustomMetadata

      return !metadata?.details_seen
    })

    const revoked = credsDone.filter((cred: CredentialRecord) => {
      // Filter out excluded connections
      if (isExcluded(cred.connectionId)) {
        return false
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const metadata = cred!.metadata.get(CredentialMetadata.customMetadata) as credentialCustomMetadata
      if (cred?.revocationNotification && metadata?.revoked_seen == undefined) {
        return cred
      }
    })

    const openIDCreds: Array<OpenIDCredentialRecord | OpenId4VPRequestRecord> = []
    if (openIDCredRecieved) {
      openIDCreds.push(openIDCredRecieved)
    }

    const notif = [
      ...messagesToShow,
      ...filteredOffers,
      ...filteredProofsRequested,
      ...validProofsDone,
      ...revoked,
      ...openIDCreds,
      ...openIDReplacementNotifs,
      ...openIDExpiredNotifs,
    ].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())

    setNotifications(notif)
  }, [
    basicMessages,
    credsReceived,
    proofsDone,
    proofsRequested,
    offers,
    credsDone,
    openIDCredRecieved,
    openIDReplacementNotifs,
    openIDExpiredNotifs,
    exclusionVersion,
  ])

  return notifications
}
