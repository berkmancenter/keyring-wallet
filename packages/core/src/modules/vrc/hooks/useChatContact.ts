/**
 * The contact behind a chat, as its contact page knows them: their relationship DID (the issuer id their cards carry)
 * and the name, email and organization from their RCard (or a legacy VRC's issuer fields). `viewContact` opens that
 * contact page; it is undefined until the relationship is found, and stays undefined for a chat with none.
 *
 * Shared by the chat header's title (tap the photo and name) and its ⋯ menu (View Contact), so both open the same page.
 *
 * @module vrc/hooks/useChatContact
 */
import { useAgent } from '@bifold/react-hooks'
import { useNavigation } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { RootStackParams, Screens, Stacks } from '../../../types/navigators'
import { useOpenIDCredentials } from '../../openid/context/OpenIDCredentialRecordProvider'
import { RelationshipDidRepository } from '../repositories/RelationshipDidRepository'
import { resolveContactDisplayInfo } from '../utils/rcardDisplayUtils'

export interface ChatContact {
  /** Their relationship DID on this connection, or null until (or unless) one is found. */
  issuerDid: string | null
  issuerName: string | null
  issuerEmail?: string
  issuerOrganization?: string
  /** Opens their contact page; undefined while there's no relationship to open. */
  viewContact?: () => void
}

export function useChatContact(connectionId: string | undefined): ChatContact {
  const navigation = useNavigation<StackNavigationProp<RootStackParams>>()
  const { t } = useTranslation()
  const { agent } = useAgent()
  const {
    openIdState: { w3cCredentialRecords },
  } = useOpenIDCredentials()
  const [found, setFound] = useState<Omit<ChatContact, 'viewContact'>>({ issuerDid: null, issuerName: null })

  // The counterparty's relationship DID for this connection: the issuer.id their VRC credentials carry.
  useEffect(() => {
    if (!agent || !connectionId) return
    let live = true
    const lookup = async () => {
      try {
        const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
        const record = (await repository.getAll(agent.context)).find((r) => r.connectionId === connectionId)
        const did = record?.counterpartyRelationshipDid
        if (!did || !live) return
        // Contact info source: received RCard first, then legacy VRC issuer object fields
        const info = resolveContactDisplayInfo(w3cCredentialRecords, did)
        setFound({
          issuerDid: did,
          // Not a piece of the DID in the name's place (#12).
          issuerName: info.name || t('ContactDetails.UnnamedContact'),
          issuerEmail: info.email,
          issuerOrganization: info.organization,
        })
      } catch (_error) {
        /* ignore lookup failure */
      }
    }
    void lookup()
    return () => {
      live = false
    }
  }, [agent, connectionId, w3cCredentialRecords, t])

  const { issuerDid, issuerName, issuerEmail, issuerOrganization } = found
  const open = useCallback(() => {
    if (!issuerDid || !issuerName) return
    navigation.navigate(Stacks.ContactStack, {
      screen: Screens.ContactDetails,
      params: {
        contact: { issuer: { id: issuerDid, name: issuerName, email: issuerEmail, organization: issuerOrganization } },
      },
    })
  }, [navigation, issuerDid, issuerName, issuerEmail, issuerOrganization])

  return { ...found, viewContact: issuerDid && issuerName ? open : undefined }
}
