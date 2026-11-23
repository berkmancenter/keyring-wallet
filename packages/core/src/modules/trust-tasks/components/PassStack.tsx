/**
 * The Wallet's community cards as a stack of passes: each tucked behind the next so its top strip (monogram, name,
 * what it is) shows, the newest in front with its dates. Tapping any pass opens that card (in place, in the Wallet:
 * onOpen says which pass, counted from the back, so it can lift from where it sat). A long stack (ten cards or more)
 * is not folded: it scrolls with the Wallet, a strip per card, so every card stays one tap away.
 *
 * @module trust-tasks/components/PassStack
 */
import type { W3cCredentialRecord } from '@credo-ts/core'
import React, { useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Animated, useWindowDimensions, View } from 'react-native'

import { CredentialErrors } from '../../../types/credentials'
import { testIdWithKey } from '../../../utils/testable'
import { useCredentialErrorsFromRegistry } from '../../openid/hooks/useCredentialErrorsFromRegistry'
import { toRawCredential } from '../../vrc/utils/rcardDisplayUtils'
import { useCommunityBrand } from '../module/useCommunityBrand'
import { communityTarget } from '../module/vtiCommunityLink'
import { classifyCredential } from '../module/vtiInbox'
import { passFace } from '../screens/communityPass'

import CommunityPass, { PASS_ASPECT, PASS_STRIP } from './CommunityPass'
import { PASS_MARGIN, STACK_TOP } from './passGeometry'

export { PASS_MARGIN }

/** How long the stack takes to come back when an open card closes. */
const RETURN_MS = 200

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
  onOpen: () => void
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
        onPress={onOpen}
        status={revoked ? t('CredentialDetails.Revoked') : undefined}
      />
    </View>
  )
}

export interface PassStackProps {
  /** Community cards, newest first (the Wallet's order). */
  records: W3cCredentialRecord[]
  /** A pass was tapped: its record, and where it sits in the stack (0 at the back, as drawn). */
  onOpen: (record: W3cCredentialRecord, index: number) => void
  /** Coming back from an open card: the stack fades in rather than appearing at once. */
  returning?: boolean
}

export const PassStack: React.FC<PassStackProps> = ({ records, onOpen, returning = false }) => {
  const { width } = useWindowDimensions()
  const shown = useRef(new Animated.Value(returning ? 0 : 1)).current
  useEffect(() => {
    if (returning) Animated.timing(shown, { toValue: 1, duration: RETURN_MS, useNativeDriver: true }).start()
    // Once, when the stack comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
    <Animated.View
      style={{ marginHorizontal: PASS_MARGIN, marginTop: STACK_TOP, opacity: shown }}
      testID={testIdWithKey('PassStack')}
    >
      {cards.map(({ record, vc, communityDid }, index) => (
        <StackedPass
          key={record.id}
          record={record}
          vc={vc}
          communityDid={communityDid}
          front={index === cards.length - 1}
          overlap={index === 0 ? 0 : passHeight - PASS_STRIP}
          onOpen={() => onOpen(record, index)}
        />
      ))}
    </Animated.View>
  )
}

export default PassStack
