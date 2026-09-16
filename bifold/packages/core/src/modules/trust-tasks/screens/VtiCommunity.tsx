/**
 * Community — S5 and the first half of S7 in `community_vetting_subtask.md`
 * §7.1: what this community asks of an applicant, and applying.
 *
 * The criteria are the community's own words, fetched from its manifest rather
 * than written into the app, because a community can change what it asks.
 *
 * @module trust-tasks/screens/VtiCommunity
 */

import type { RouteProp } from '@react-navigation/native'
import { useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { useTheme } from '../../../contexts/theme'
import { Screens, type MyAgentStackParams } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtiAgent, VtiRefusal, type VtiManifest, type VtiVerdict } from '../module/vtiAgent'

const VtiCommunity: React.FC = () => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const { params } = useRoute<RouteProp<MyAgentStackParams, Screens.VtiCommunity>>()
  const communityDid = params.communityDid

  const [manifest, setManifest] = useState<VtiManifest>()
  const [verdict, setVerdict] = useState<VtiVerdict>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  // A refusal's framework code belongs behind Details, not in the sentence.
  const [refusalCode, setRefusalCode] = useState<string>()
  const [showDetails, setShowDetails] = useState(false)

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 24, gap: 20 },
    card: { backgroundColor: ColorPalette.brand.secondaryBackground, borderRadius: 12, padding: 20, gap: 12 },
    label: { ...TextTheme.labelSubtitle, color: ColorPalette.grayscale.mediumGrey },
    value: { ...TextTheme.normal, color: TextTheme.normal.color },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    button: { backgroundColor: ColorPalette.brand.primary, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
    buttonText: { ...TextTheme.bold, color: '#FFFFFF' },
    error: { ...TextTheme.normal, color: ColorPalette.semantic.error },
  })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const result = await vtiAgent.fetchManifest(communityDid)
        if (!cancelled) setManifest(result)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          if (err instanceof VtiRefusal) setRefusalCode(err.code)
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [communityDid])

  const onApply = useCallback(async () => {
    if (!manifest) return
    setBusy(true)
    setError(undefined)
    try {
      setVerdict(await vtiAgent.apply(communityDid, manifest))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      if (err instanceof VtiRefusal) setRefusalCode(err.code)
    } finally {
      setBusy(false)
    }
  }, [communityDid, manifest])

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.label}>{t('MyAgent.Community')}</Text>
          <Text style={styles.value} testID={testIdWithKey('CommunityDid')}>
            {communityDid}
          </Text>
        </View>

        <Text style={{ ...TextTheme.headingFour, color: TextTheme.normal.color }}>{t('MyAgent.WhatIsAsked')}</Text>
        {busy && !manifest ? <ActivityIndicator color={ColorPalette.brand.primary} /> : null}
        {manifest ? (
          <View style={styles.card} testID={testIdWithKey('CommunityCriteria')}>
            {manifest.criteria.map((criterion, index) => (
              <View style={styles.row} key={criterion.id ?? String(index)}>
                <Icon name="circle-medium" size={20} color={ColorPalette.brand.primary} />
                <Text style={[styles.value, { flex: 1 }]}>{criterion.description ?? criterion.id}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {verdict ? (
          <View style={styles.card} testID={testIdWithKey('CommunityVerdict')}>
            <Text style={styles.label}>{t('MyAgent.Verdict')}</Text>
            <Text style={styles.value} testID={testIdWithKey('CommunityVerdictEffect')}>
              {verdict.effect}
            </Text>
            {verdict.needs.length > 0 ? (
              <>
                <Text style={styles.label}>{t('MyAgent.StillNeeded')}</Text>
                {verdict.needs.map((need) => (
                  <Text style={styles.value} key={need}>
                    {need}
                  </Text>
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        {error ? (
          <View style={styles.card}>
            <Text style={styles.error} testID={testIdWithKey('CommunityError')}>
              {error}
            </Text>
            {refusalCode ? (
              <Pressable
                accessibilityRole="button"
                testID={testIdWithKey('CommunityRefusalDetails')}
                onPress={() => setShowDetails((shown) => !shown)}
              >
                <Text style={{ ...TextTheme.normal, color: ColorPalette.brand.link }}>{t('MyAgent.Details')}</Text>
              </Pressable>
            ) : null}
            {showDetails && refusalCode ? (
              <Text style={styles.label} testID={testIdWithKey('CommunityRefusalCode')}>
                {refusalCode}
              </Text>
            ) : null}
          </View>
        ) : null}

        {manifest && !verdict ? (
          <Pressable
            style={styles.button}
            testID={testIdWithKey('ApplyToCommunityButton')}
            accessibilityRole="button"
            disabled={busy}
            onPress={onApply}
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{t('MyAgent.Apply')}</Text>}
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

export default VtiCommunity
