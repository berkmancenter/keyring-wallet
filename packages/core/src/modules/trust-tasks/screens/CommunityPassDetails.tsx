/**
 * A community card's Details in the Wallet: the same pass as in the stack, on top, then what the card says in plain
 * rows (nothing on it is personal, so nothing is masked), where it is kept, the way to the community (a card is given
 * up by leaving the community, not removed here), and its identifiers behind Technical details.
 *
 * Replaces, for community cards only, the generic W3C details: a fixed-height card the colour of the page with an
 * empty body, and every field hidden behind Show.
 *
 * In the Wallet the card opens in place (onClose, liftFrom): the pass lifts from where it sat in the stack to the top,
 * the rest of the card comes in under it, and "All cards" (or Back) returns to the stack. With Reduce Motion on, nothing
 * travels: the pass is in its place at once and the rest of the card dissolves in. Opened any other way (the Details
 * screen) it simply shows.
 *
 * @module trust-tasks/screens/CommunityPassDetails
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { readReduceMotion, useReduceMotion } from '../../../hooks/reduce-motion'
import { CredentialErrors, GenericCredentialExchangeRecord } from '../../../types/credentials'
import { testIdWithKey } from '../../../utils/testable'
import { useCredentialErrorsFromRegistry } from '../../openid/hooks/useCredentialErrorsFromRegistry'
import CommunityPass from '../components/CommunityPass'
import { CLOSE_ROW_HEIGHT, OPEN_GAP, OPEN_PAGE_TOP, PASS_MARGIN } from '../components/passGeometry'
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
  /** Opened in place in the Wallet: "All cards" above the pass returns to the stack. */
  onClose?: () => void
  /** Opened in place: how far below its place here the pass sat in the stack (passGeometry's liftFrom); it lifts from there. */
  liftFrom?: number
}

/** The lift's and the reveal's timing: the pass settles first, the rest of the card follows it in. */
const LIFT_MS = 320
const REVEAL_MS = 240
const REVEAL_DELAY_MS = 120
const REVEAL_RISE = 16
/** With Reduce Motion on: the rest of the card dissolves in, in place. */
const DISSOLVE_MS = 150

export const CommunityPassDetails: React.FC<CommunityPassDetailsProps> = ({
  card,
  record,
  onOpenCommunity,
  onClose,
  liftFrom,
}) => {
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
  // Opened in place: the pass starts where it sat in the stack and the rest of the card starts hidden. Values made once,
  // on the first render, so a re-render mid-lift does not restart it.
  // With Reduce Motion known to be on, the pass starts in its place. The very first open after launch cannot know yet
  // (the system answers asynchronously): with it on, that one open draws the pass at its stack place for a frame, then
  // sets it in place, rather than holding the frame for the answer.
  const reduceMotion = useReduceMotion()
  const lift = useRef(new Animated.Value(reduceMotion ? 0 : (liftFrom ?? 0))).current
  const reveal = useRef(new Animated.Value(liftFrom === undefined ? 1 : 0)).current
  const opened = liftFrom !== undefined
  const announcement = opened ? face?.accessibilityLabel : undefined
  useEffect(() => {
    if (!opened) return
    // The stack it was opened from is gone, so a screen reader is told which card is now open.
    if (announcement) AccessibilityInfo.announceForAccessibility(announcement)
    let live = true
    readReduceMotion().then((reduce) => {
      if (!live) return
      if (reduce) {
        lift.setValue(0)
        Animated.timing(reveal, { toValue: 1, duration: DISSOLVE_MS, useNativeDriver: true }).start()
        return
      }
      Animated.parallel([
        Animated.timing(lift, {
          toValue: 0,
          duration: LIFT_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(reveal, {
          toValue: 1,
          duration: REVEAL_MS,
          delay: REVEAL_DELAY_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start()
    })
    return () => {
      live = false
    }
    // Once, when the card opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!of || !face || !communityDid) return null

  const community = communityHeadingOf(communityDid, t, { claim: 'plain' })
  const subject = (card.credentialSubject as { id?: unknown } | undefined)?.id
  // The kind row carries the role line's id by what it is, not where it sits: a row added ahead of it cannot move the
  // id onto a date.
  const rows: { label: string; value: string; role?: true }[] = [
    { label: t('Community.PassCardKind') as string, value: face.kind, role: true },
    ...[face.field, face.secondField].filter((f): f is { label: string; value: string } => !!f),
  ]
  const styles = StyleSheet.create({
    page: { paddingHorizontal: PASS_MARGIN, paddingTop: OPEN_PAGE_TOP, paddingBottom: 16, gap: OPEN_GAP },
    rest: { gap: OPEN_GAP },
    close: { height: CLOSE_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2 },
    closeText: { color: ColorPalette.brand.primary, fontWeight: '600' },
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
      {onClose ? (
        <Animated.View style={{ opacity: reveal }}>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.close}
            hitSlop={{ left: 8, right: 8 }}
            testID={testIdWithKey('PassOpenClose')}
          >
            <Icon name="chevron-left" size={24} color={ColorPalette.brand.primary} />
            <ThemedText style={styles.closeText}>{t('Community.PassAllCards')}</ThemedText>
          </Pressable>
        </Animated.View>
      ) : null}
      <Animated.View style={{ transform: [{ translateY: lift }], zIndex: 1 }} testID={testIdWithKey('PassOpenLift')}>
        <CommunityPass face={face} brand={brand} front status={revoked ? t('CredentialDetails.Revoked') : undefined} />
      </Animated.View>
      <Animated.View
        style={[
          styles.rest,
          {
            opacity: reveal,
            transform: [
              {
                translateY: reveal.interpolate({
                  inputRange: [0, 1],
                  outputRange: [reduceMotion ? 0 : REVEAL_RISE, 0],
                }),
              },
            ],
          },
        ]}
      >
        <View style={styles.group}>
          {rows.map((row) => (
            <View key={row.label} style={styles.row} testID={testIdWithKey('CommunityPassRow')}>
              <ThemedText style={styles.rowLabel}>{row.label}</ThemedText>
              {/* The role line's id is on the text itself, as before: the end-to-end flows read it for "member". */}
              <ThemedText testID={row.role ? testIdWithKey('CommunityCardRole') : undefined}>{row.value}</ThemedText>
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
      </Animated.View>
    </View>
  )
}

export default CommunityPassDetails
