/**
 * The state card's details (SEDI/KERI holder card): the pass on top, then who the card is for, its status as this
 * phone's check left it, its dates, what the check proves, that it is a demo card, and its identifiers behind Technical
 * details. Laid out like a community card's details (CommunityPassDetails): "All cards" returns to the Wallet.
 *
 * Gated at render, not only where it is opened: with "State card (demo)" off (its remote off or the SEDI/KERI one
 * included) it draws nothing, so a remote off reaches a card that is already open.
 *
 * @module sedi/holder/StateCardDetails
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import CommunityPass from '../../trust-tasks/components/CommunityPass'

import { stateCardFace, stateCardBrand } from './StateCardPass'
import type { StateCardView } from './stateCard'
import { isStateCardEnabled } from './stateCardFlag'

export interface StateCardDetailsProps {
  view: StateCardView
  onClose: () => void
}

export const StateCardDetails: React.FC<StateCardDetailsProps> = ({ view, onClose }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [technical, setTechnical] = useState(false)
  if (!isStateCardEnabled()) return null

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    page: { paddingHorizontal: 15, paddingTop: 8, paddingBottom: 24, gap: 14 },
    close: { height: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2 },
    closeText: { color: ColorPalette.brand.primary, fontWeight: '600' },
    group: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 12, overflow: 'hidden' },
    row: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 1,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: ColorPalette.grayscale.lightGrey,
    },
    rowLabel: { fontSize: 13, color: ColorPalette.grayscale.mediumGrey },
    problem: { color: ColorPalette.semantic.error },
    note: { color: ColorPalette.grayscale.mediumGrey, marginHorizontal: 4 },
    disclosure: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    id: { fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }), fontSize: 13 },
  })

  const row = (label: string, value: string, testID?: string, valueStyle?: object) => (
    <View key={label} style={styles.row}>
      <ThemedText style={styles.rowLabel}>{label}</ThemedText>
      <ThemedText style={valueStyle} testID={testID}>
        {value}
      </ThemedText>
    </View>
  )
  const idRow = (label: string, value: string) => (
    <View key={label} style={styles.row}>
      <ThemedText style={styles.rowLabel}>{label}</ThemedText>
      <Text selectable style={styles.id}>
        {value}
      </Text>
    </View>
  )
  const { technical: ids } = view

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.page} testID={testIdWithKey('StateCardDetails')}>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={styles.close}
          hitSlop={{ left: 8, right: 8 }}
          testID={testIdWithKey('StateCardClose')}
        >
          <Icon name="chevron-left" size={24} color={ColorPalette.brand.primary} />
          <ThemedText style={styles.closeText}>{t('StateCard.AllCards')}</ThemedText>
        </Pressable>
        <CommunityPass
          face={stateCardFace(view)}
          brand={stateCardBrand(view)}
          front
          status={view.tone === 'problem' ? view.pill : undefined}
        />
        <View style={styles.group}>
          {row(t('StateCard.Card'), view.guardianOf)}
          {row(
            t('StateCard.Status'),
            view.status,
            testIdWithKey('StateCardStatus'),
            view.tone === 'problem' ? styles.problem : undefined
          )}
          {view.issued ? row(view.issued.label, view.issued.value) : null}
          {view.validUntil ? row(view.validUntil.label, view.validUntil.value) : null}
        </View>
        {view.tone === 'ok' ? (
          <ThemedText style={styles.note} testID={testIdWithKey('StateCardWhatChecked')}>
            {t('StateCard.WhatChecked', { asOf: view.asOf, interpolation: { escapeValue: false } })}
          </ThemedText>
        ) : null}
        {view.tone === 'ok' && view.source ? (
          <ThemedText style={styles.note} testID={testIdWithKey('StateCardSource')}>
            {view.source}
          </ThemedText>
        ) : null}
        {view.demoNote ? (
          <ThemedText style={styles.note} testID={testIdWithKey('StateCardDemoNote')}>
            {view.demoNote}
          </ThemedText>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: technical }}
          onPress={() => setTechnical((open) => !open)}
          style={styles.disclosure}
          testID={testIdWithKey('StateCardTechnical')}
        >
          <ThemedText>{t('StateCard.Technical')}</ThemedText>
          <ThemedText>{technical ? '−' : '+'}</ThemedText>
        </Pressable>
        {technical ? (
          <View style={styles.group} testID={testIdWithKey('StateCardTechnicalRows')}>
            {idRow(t('StateCard.HolderId'), ids.holder)}
            {idRow(t('StateCard.RootId'), ids.root ?? t('StateCard.NotKnown'))}
            {idRow(t('StateCard.CredentialId'), ids.said)}
            {idRow(t('StateCard.Expires'), ids.expires ?? t('StateCard.NotKnown'))}
            {idRow(t('StateCard.CheckResult'), ids.result)}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default StateCardDetails
