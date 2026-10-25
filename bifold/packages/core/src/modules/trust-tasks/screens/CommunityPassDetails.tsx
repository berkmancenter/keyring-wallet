/**
 * A community card's Details in the Wallet: the same pass as in the stack, on top, then what the card says in plain
 * rows (nothing on it is personal, so nothing is masked), where it is kept, the way to the community (a card is given
 * up by leaving the community, not removed here), and its identifiers behind Technical details.
 *
 * Replaces, for community cards only, the generic W3C details: a fixed-height card the colour of the page with an
 * empty body, and every field hidden behind Show.
 *
 * @module trust-tasks/screens/CommunityPassDetails
 */
import React, { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { CredentialErrors, GenericCredentialExchangeRecord } from '../../../types/credentials'
import { testIdWithKey } from '../../../utils/testable'
import { useCredentialErrorsFromRegistry } from '../../openid/hooks/useCredentialErrorsFromRegistry'
import CommunityPass from '../components/CommunityPass'
import { useCommunityBrand } from '../module/useCommunityBrand'
import { communityTarget } from '../module/vtiCommunityLink'

import { CardKeptRow } from './CardKeptRow'
import { communityCardKey } from './CommunityCard'
import { communityCardOf } from './CommunityCardDetails'
import { communityHeadingOf } from './communityName'
import { passFace } from './communityPass'

export interface CommunityPassDetailsProps {
  card: Record<string, unknown>
  /** The card's record, so the pass says "Revoked" when the credential registry knows it is, as the Details before did. */
  record?: GenericCredentialExchangeRecord
  onOpenCommunity: (communityDid: string) => void
}

export const CommunityPassDetails: React.FC<CommunityPassDetailsProps> = ({ card, record, onOpenCommunity }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const of = communityCardOf(card)
  const communityDid = of?.communityDid
  const published = useSyncExternalStore(communityTarget.subscribe, () =>
    communityDid ? communityTarget.publishedNameOf(communityDid) : undefined
  )
  const brand = useCommunityBrand(communityDid, published)
  const [technical, setTechnical] = useState(false)
  const revoked = useCredentialErrorsFromRegistry(record).includes(CredentialErrors.Revoked)
  const face = passFace(card, t, published)
  if (!of || !face || !communityDid) return null

  const community = communityHeadingOf(communityDid, t, { claim: 'plain' })
  const subject = (card.credentialSubject as { id?: unknown } | undefined)?.id
  const rows = [
    { label: t('Community.PassCardKind') as string, value: face.kind },
    ...[face.field, face.secondField].filter((f): f is { label: string; value: string } => !!f),
  ]
  const styles = StyleSheet.create({
    page: { padding: 16, gap: 14 },
    group: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 12,
      overflow: 'hidden',
    },
    row: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 1,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: ColorPalette.grayscale.lightGrey,
    },
    rowLabel: { fontSize: 13, color: ColorPalette.grayscale.mediumGrey },
    kept: { paddingHorizontal: 16, paddingVertical: 12 },
    note: { color: ColorPalette.grayscale.mediumGrey, marginTop: -6, marginHorizontal: 4 },
    disclosure: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    id: { fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }), fontSize: 13 },
  })

  return (
    // The ids of the Details this replaced (CommunityCardDetails, …) are kept on what does the same job here: the
    // wallet's end-to-end flows find the screen, the role line and the way to the community by them.
    <View style={styles.page} testID={testIdWithKey('CommunityCardDetails')}>
      <CommunityPass face={face} brand={brand} front status={revoked ? t('CredentialDetails.Revoked') : undefined} />
      <View style={styles.group}>
        {rows.map((row, index) => (
          <View key={row.label} style={styles.row} testID={testIdWithKey('CommunityPassRow')}>
            <ThemedText style={styles.rowLabel}>{row.label}</ThemedText>
            {/* The role line's id is on the text itself, as before: the end-to-end flows read it for "member". */}
            <ThemedText testID={index === 0 ? testIdWithKey('CommunityCardRole') : undefined}>{row.value}</ThemedText>
          </View>
        ))}
        <View style={styles.kept}>
          <CardKeptRow
            card={card}
            kind={of.kind === 'membership' ? 'membership' : 'role'}
            handle={communityCardKey(communityDid)}
            community={community}
          />
        </View>
      </View>
      <Button
        title={t('Community.PassOpenCommunity')}
        buttonType={ButtonType.Secondary}
        onPress={() => onOpenCommunity(communityDid)}
        testID={testIdWithKey('CommunityCardOpenCommunity')}
      />
      <ThemedText style={styles.note}>{t('Community.PassLeaveNote')}</ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: technical }}
        onPress={() => setTechnical((open) => !open)}
        style={styles.disclosure}
        testID={testIdWithKey('CommunityPassTechnical')}
      >
        <ThemedText>{t('Community.PassTechnical')}</ThemedText>
        <ThemedText>{technical ? '−' : '+'}</ThemedText>
      </Pressable>
      {technical ? (
        <View style={styles.group} testID={testIdWithKey('CommunityPassTechnicalRows')}>
          <View style={styles.row}>
            <ThemedText style={styles.rowLabel}>{t('Community.PassCommunityId')}</ThemedText>
            <Text selectable style={styles.id}>
              {communityDid}
            </Text>
          </View>
          {typeof subject === 'string' ? (
            <View style={styles.row}>
              <ThemedText style={styles.rowLabel}>{t('Community.PassYourId')}</ThemedText>
              <Text selectable style={styles.id}>
                {subject}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

export default CommunityPassDetails
