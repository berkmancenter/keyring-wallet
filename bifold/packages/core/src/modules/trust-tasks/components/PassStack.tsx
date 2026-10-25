/**
 * The Wallet's community cards as a stack of passes: each tucked behind the next so its top strip (monogram, name,
 * what it is) shows, the newest in front with its dates. Tapping any pass opens that card. A long stack (ten cards or
 * more) is not folded: it scrolls with the Wallet, a strip per card, so every card stays one tap away.
 *
 * @module trust-tasks/components/PassStack
 */
import type { W3cCredentialRecord } from '@credo-ts/core'
import React, { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useWindowDimensions, View } from 'react-native'

import { CredentialErrors } from '../../../types/credentials'
import { testIdWithKey } from '../../../utils/testable'
import { useCredentialErrorsFromRegistry } from '../../openid/hooks/useCredentialErrorsFromRegistry'
import { toRawCredential } from '../../vrc/utils/rcardDisplayUtils'
import { useCommunityBrand } from '../module/useCommunityBrand'
import { communityTarget } from '../module/vtiCommunityLink'
import { classifyCredential } from '../module/vtiInbox'
import { passFace } from '../screens/communityPass'

import CommunityPass, { PASS_ASPECT, PASS_STRIP } from './CommunityPass'

/** The Wallet list's side margin, so a pass is as wide as the cards around it. */
export const PASS_MARGIN = 15

function usePublishedName(communityDid: string | undefined): string | undefined {
  return useSyncExternalStore(communityTarget.subscribe, () =>
    communityDid ? communityTarget.publishedNameOf(communityDid) : undefined
  )
}

const StackedPass: React.FC<{
  record: W3cCredentialRecord
  vc: Record<string, unknown>
  communityDid: string
  front: boolean
  overlap: number
  onOpen: (record: W3cCredentialRecord) => void
}> = ({ record, vc, communityDid, front, overlap, onOpen }) => {
  const { t } = useTranslation()
  const published = usePublishedName(communityDid)
  const brand = useCommunityBrand(communityDid, published)
  // What the card before the pass showed from the credential registry, kept.
  const revoked = useCredentialErrorsFromRegistry(record).includes(CredentialErrors.Revoked)
  const face = passFace(vc, t, published)
  if (!face) return null
  return (
    <View style={{ marginTop: -overlap }} testID={testIdWithKey('PassStackItem')}>
      <CommunityPass
        face={face}
        brand={brand}
        front={front}
        onPress={() => onOpen(record)}
        status={revoked ? t('CredentialDetails.Revoked') : undefined}
      />
    </View>
  )
}

export interface PassStackProps {
  /** Community cards, newest first (the Wallet's order). */
  records: W3cCredentialRecord[]
  onOpen: (record: W3cCredentialRecord) => void
}

export const PassStack: React.FC<PassStackProps> = ({ records, onOpen }) => {
  const { width } = useWindowDimensions()
  const passHeight = (width - 2 * PASS_MARGIN) / PASS_ASPECT
  // Oldest first, so the newest is drawn last: in front, with its dates.
  const ordered = [...records].reverse()
  const cards = ordered.flatMap((record) => {
    const vc = toRawCredential(record) as Record<string, unknown> | undefined
    const communityDid = vc ? classifyCredential(vc).communityDid : undefined
    return vc && communityDid ? [{ record, vc, communityDid }] : []
  })
  if (cards.length === 0) return null
  return (
    <View style={{ marginHorizontal: PASS_MARGIN, marginTop: 15 }} testID={testIdWithKey('PassStack')}>
      {cards.map(({ record, vc, communityDid }, index) => (
        <StackedPass
          key={record.id}
          record={record}
          vc={vc}
          communityDid={communityDid}
          front={index === cards.length - 1}
          overlap={index === 0 ? 0 : passHeight - PASS_STRIP}
          onOpen={onOpen}
        />
      ))}
    </View>
  )
}

export default PassStack
