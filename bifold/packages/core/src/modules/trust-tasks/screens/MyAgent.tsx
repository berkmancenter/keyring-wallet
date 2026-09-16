/**
 * My Agent — S1, S3 and S4 of `community_vetting_subtask.md` §7.1, which are
 * one screen read at three moments: before an agent is connected, while it is
 * connecting, and once it is.
 *
 * A community is reached through an agent, so this is where that relationship
 * is made and shown: the agent's host and the DID this wallet presents as its
 * member identity, then the communities it can talk to.
 *
 * @module trust-tasks/screens/MyAgent
 */

import { useNavigation } from '@react-navigation/native'
import type { StackNavigationProp } from '@react-navigation/stack'
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { useTheme } from '../../../contexts/theme'
import { Screens, type MyAgentStackParams } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtiAgent } from '../module/vtiAgent'

/** The DID is long and the host is what a person recognises, so lead with it. */
const shortDid = (did?: string) => (did && did.length > 32 ? `${did.slice(0, 22)}…${did.slice(-8)}` : did)

export interface MyAgentProps {
  /** The mediator a VTI agent advertises, and the community to offer. */
  config?: { mediatorDid?: string; communityDid?: string }
}

const MyAgent: React.FC<MyAgentProps> = ({ config }) => {
  const { t } = useTranslation()
  const { ColorPalette, TextTheme } = useTheme()
  const { agent } = useAgent()
  const navigation = useNavigation<StackNavigationProp<MyAgentStackParams>>()
  const state = useSyncExternalStore(vtiAgent.subscribe, vtiAgent.getState)

  const mediatorDid = config?.mediatorDid
  const communityDid = config?.communityDid

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: ColorPalette.brand.primaryBackground },
    content: { padding: 24, gap: 24 },
    card: {
      backgroundColor: ColorPalette.brand.secondaryBackground,
      borderRadius: 12,
      padding: 20,
      gap: 8,
    },
    label: { ...TextTheme.labelSubtitle, color: ColorPalette.grayscale.mediumGrey },
    value: { ...TextTheme.normal, color: TextTheme.normal.color },
    button: {
      backgroundColor: ColorPalette.brand.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
    },
    buttonText: { ...TextTheme.bold, color: '#FFFFFF' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    error: { ...TextTheme.normal, color: ColorPalette.semantic.error },
  })

  const onConnect = useCallback(async () => {
    if (!agent || !mediatorDid) return
    try {
      await vtiAgent.connect(agent, mediatorDid)
    } catch {
      // the failure is already on screen, from the controller's state
    }
  }, [agent, mediatorDid])

  if (!mediatorDid) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content}>
          <Text style={styles.value} testID={testIdWithKey('MyAgentNotConfigured')}>
            {t('MyAgent.NotConfigured')}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  // S3 — connecting. Each step is named, because "please wait" tells a person
  // nothing about which leg is slow when one is.
  if (state.status === 'resolving' || state.status === 'authenticating') {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.content}>
          <View style={styles.row}>
            <ActivityIndicator color={ColorPalette.brand.primary} />
            <Text style={styles.value} testID={testIdWithKey('MyAgentConnecting')}>
              {state.status === 'resolving' ? t('MyAgent.Resolving') : t('MyAgent.Authenticating')}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // S4 — connected.
  if (state.status === 'connected') {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card} testID={testIdWithKey('MyAgentCard')}>
            <Text style={styles.label}>{t('MyAgent.Host')}</Text>
            <Text style={styles.value} testID={testIdWithKey('MyAgentHost')}>
              {state.host}
            </Text>
            <Text style={styles.label}>{t('MyAgent.YourIdentity')}</Text>
            <Text style={styles.value} testID={testIdWithKey('MyAgentDid')}>
              {shortDid(state.did)}
            </Text>
            <View style={styles.row}>
              <Icon name="check-circle" size={18} color={ColorPalette.semantic.success} />
              <Text style={styles.value}>{t('MyAgent.Connected')}</Text>
            </View>
          </View>

          <Text style={{ ...TextTheme.headingFour, color: TextTheme.normal.color }}>{t('MyAgent.Communities')}</Text>
          {communityDid ? (
            <Pressable
              style={styles.card}
              testID={testIdWithKey('MyAgentCommunityRow')}
              accessibilityRole="button"
              onPress={() => navigation.navigate(Screens.VtiCommunity, { communityDid })}
            >
              <Text style={styles.value}>{shortDid(communityDid)}</Text>
              <Text style={styles.label}>{t('MyAgent.NotAMember')}</Text>
            </Pressable>
          ) : (
            <Text style={styles.value}>{t('MyAgent.NoCommunities')}</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    )
  }

  // S1 — not connected (and the failed state, which says why and offers a retry).
  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={{ ...TextTheme.headingThree, color: TextTheme.normal.color }}>{t('MyAgent.Title')}</Text>
        <Text style={styles.value}>{t('MyAgent.WhatItIs')}</Text>
        {state.error ? (
          <Text style={styles.error} testID={testIdWithKey('MyAgentError')}>
            {state.error}
          </Text>
        ) : null}
        <Pressable
          style={styles.button}
          testID={testIdWithKey('ConnectMyAgentButton')}
          accessibilityRole="button"
          onPress={onConnect}
        >
          <Text style={styles.buttonText}>
            {state.status === 'failed' ? t('MyAgent.TryAgain') : t('MyAgent.Connect')}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

export default MyAgent
