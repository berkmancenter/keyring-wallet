import {
  BasicMessageRecord,
  CredentialExchangeRecord as CredentialRecord,
  CredentialState,
  MdocRecord,
  ProofExchangeRecord,
  ProofState,
  SdJwtVcRecord,
  W3cCredentialRecord,
} from '@credo-ts/core'
import { useBasicMessages, useCredentialByState, useProofByState } from '@credo-ts/react-hooks'
import { ProofCustomMetadata, ProofMetadata } from '@bifold/verifier'
import { useEffect, useState } from 'react'

import {
  BasicMessageMetadata,
  CredentialMetadata,
  basicMessageCustomMetadata,
  credentialCustomMetadata,
} from '../types/metadata'
import { useOpenID } from '../modules/openid/hooks/openid'
import { CustomNotification } from '../types/notification'
import { OpenId4VPRequestRecord } from '../modules/openid/types'

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

export type NotificationReturnType = Array<
  | BasicMessageRecord
  | CredentialRecord
  | ProofExchangeRecord
  | CustomNotification
  | SdJwtVcRecord
  | W3cCredentialRecord
  | MdocRecord
  | OpenId4VPRequestRecord
>

export const useNotifications = ({
  openIDUri,
  openIDPresentationUri,
}: NotificationsInputProps): NotificationReturnType => {
  const [notifications, setNotifications] = useState<NotificationReturnType>([])
  const { records: basicMessages } = useBasicMessages()
  const offers = useCredentialByState(CredentialState.OfferReceived)
  const proofsRequested = useProofByState(ProofState.RequestReceived)
  const credsReceived = useCredentialByState(CredentialState.CredentialReceived)
  const credsDone = useCredentialByState(CredentialState.Done)
  const proofsDone = useProofByState([ProofState.Done, ProofState.PresentationReceived])
  const openIDCredRecieved = useOpenID({ openIDUri: openIDUri, openIDPresentationUri: openIDPresentationUri })
  
  // Subscribe to exclusion changes so notifications re-filter when witness connections are excluded
  const exclusionVersion = useExclusionVersion()

  useEffect(() => {
    // Helper to check if a notification should be excluded based on connectionId
    const isExcluded = (connectionId?: string): boolean => {
      if (!connectionId) return false
      return excludedConnectionIds.has(connectionId)
    }

    // get all unseen messages
    const unseenMessages: BasicMessageRecord[] = basicMessages.filter((msg) => {
      if (isExcluded(msg.connectionId)) {
        return false
      }
      const meta = msg.metadata.get(BasicMessageMetadata.customMetadata) as basicMessageCustomMetadata
      return !meta?.seen
    })

    // add one unseen message per contact to notifications
    const contactsWithUnseenMessages: string[] = []
    const messagesToShow: BasicMessageRecord[] = []

    unseenMessages.forEach((msg) => {
      if (!contactsWithUnseenMessages.includes(msg.connectionId)) {
        contactsWithUnseenMessages.push(msg.connectionId)
        messagesToShow.push(msg)
      }
    })

    // Filter offers from excluded connections
    const filteredOffers = offers.filter((offer) => !isExcluded(offer.connectionId))

    // Filter proofs from excluded connections
    const filteredProofsRequested = proofsRequested.filter((proof) => !isExcluded(proof.connectionId))

    const validProofsDone = proofsDone.filter((proof: ProofExchangeRecord) => {
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

    const openIDCreds: Array<SdJwtVcRecord | W3cCredentialRecord | MdocRecord | OpenId4VPRequestRecord> = []
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
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    setNotifications(notif)
  }, [basicMessages, credsReceived, proofsDone, proofsRequested, offers, credsDone, openIDCredRecieved, exclusionVersion])

  return notifications
}
