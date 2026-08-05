import { AnonCredsCredentialMetadataKey } from '@credo-ts/anoncreds'
import {
  DidCommBasicMessageRecord,
  DidCommCredentialExchangeRecord,
  DidCommCredentialState,
  DidCommProofExchangeRecord,
  DidCommProofState,
} from '@credo-ts/didcomm'
import { useCredentialByState, useProofByState, useBasicMessages } from '@bifold/react-hooks'
import {
  useStore,
  BasicMessageMetadata,
  CredentialMetadata,
  basicMessageCustomMetadata,
  credentialCustomMetadata,
} from '@bifold/core'
import { ProofCustomMetadata, ProofMetadata } from '@bifold/verifier'
import { useEffect, useState } from 'react'

import { showPersonCredentialSelector } from '@/keyring-theme/features/person-flow/utils/BCIDHelper'
import { BCState } from '@/store'

function isProtocolMessage(content: string): boolean {
  try {
    const parsed = JSON.parse(content)
    return typeof parsed === 'object' && parsed !== null && ('type' in parsed || '@type' in parsed)
  } catch {
    return false
  }
}

export const useNotifications = (): Array<
  DidCommBasicMessageRecord | DidCommCredentialExchangeRecord | DidCommProofExchangeRecord
> => {
  const [store] = useStore<BCState>()
  const offers = useCredentialByState(DidCommCredentialState.OfferReceived)
  const proofsRequested = useProofByState(DidCommProofState.RequestReceived)
  const [notifications, setNotifications] = useState([])
  const { records: basicMessages } = useBasicMessages()

  const credsReceived = useCredentialByState(DidCommCredentialState.CredentialReceived)
  const credsDone = useCredentialByState(DidCommCredentialState.Done)
  const proofsDone = useProofByState([DidCommProofState.Done, DidCommProofState.PresentationReceived])

  useEffect(() => {
    // get all unseen messages, excluding protocol/witness messages
    const unseenMessages: DidCommBasicMessageRecord[] = basicMessages.filter((msg) => {
      if (isProtocolMessage(msg.content)) return false
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

    const revoked = credsDone.filter((cred: DidCommCredentialExchangeRecord) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const metadata = cred!.metadata.get(CredentialMetadata.customMetadata) as credentialCustomMetadata
      if (cred?.revocationNotification && metadata?.revoked_seen == undefined) {
        return cred
      }
    })

    const credentials = [...credsDone, ...credsReceived]
    // Filter for AnonCreds credentials only (they have credentialDefinitionId)
    // JSON-LD/W3C credentials (like VRC) don't have this metadata
    const credentialDefinitionIDs = credentials
      .filter((c) => c.metadata.data[AnonCredsCredentialMetadataKey]?.credentialDefinitionId)
      .map((c) => c.metadata.data[AnonCredsCredentialMetadataKey].credentialDefinitionId as string)
    const invitationDate = new Date()
    const custom =
      showPersonCredentialSelector(credentialDefinitionIDs) &&
      !store.dismissPersonCredentialOffer.personCredentialOfferDismissed
        ? [{ type: 'CustomNotification', createdAt: invitationDate, id: 'custom' }]
        : []
    const proofs = [...proofsRequested, ...proofsDone].filter((proof) => {
      return (
        ![DidCommProofState.Done, DidCommProofState.PresentationReceived].includes(proof.state) ||
        (proof.isVerified !== undefined &&
          !(proof.metadata.data[ProofMetadata.customMetadata] as ProofCustomMetadata)?.details_seen)
      )
    })
    const notif = [...messagesToShow, ...offers, ...proofs, ...revoked].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )

    const notificationsWithCustom = [...custom, ...notif]
    setNotifications(notificationsWithCustom as never[])
  }, [
    offers,
    credsReceived,
    credsDone,
    basicMessages,
    proofsRequested,
    proofsDone,
    store.dismissPersonCredentialOffer.personCredentialOfferDismissed,
  ])

  return notifications
}
