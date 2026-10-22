/**
 * "Add to this relationship", on a contact: ask to sign the relationship cards
 * again (with secure hardware now), or add a witness when you are together —
 * always on the relationship you already have, never a new one. Each request
 * asks first and says what it shares; one tap sends once; a pending request
 * says so and can be withdrawn on this phone.
 *
 * @module vrc/components/RelationshipUpgradeSection
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import Button, { ButtonType } from '../../../components/buttons/Button'
import SafeAreaModal from '../../../components/modals/SafeAreaModal'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import {
  cancelRelationshipUpgrade,
  pendingUpgradeOf,
  upgradeRelationship,
  type RelationshipUpgradeResult,
} from '../../trust-tasks/ceremony'
import { getConnectedWitnessConnectionId } from '../vrc-manager'

export interface RelationshipUpgradeSectionProps {
  connectionId: string
  name: string
  /** This contact's cards already carry verified hardware evidence. */
  hardwareSigned: boolean
}

type Ask = 'resign' | 'witness'

const NOTE: Record<Exclude<RelationshipUpgradeResult['kind'], 'sent'>, string> = {
  noRelationship: 'Relationship.NoRelationship',
  noWitness: 'Relationship.NoWitness',
  peerUnsupported: 'Relationship.PeerUnsupported',
}

export const RelationshipUpgradeSection: React.FC<RelationshipUpgradeSectionProps> = ({
  connectionId,
  name,
  hardwareSigned,
}) => {
  const { t } = useTranslation()
  const { agent } = useAgent()
  const { ColorPalette } = useTheme()
  const [pending, setPending] = useState<{ exchangeId: string; witnessed: boolean }>()
  const [asking, setAsking] = useState<Ask>()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string>()
  const witnessConnected = Boolean(getConnectedWitnessConnectionId())
  const words = { name, interpolation: { escapeValue: false } }

  const refresh = useCallback(async () => {
    if (!agent) return
    setPending(await pendingUpgradeOf(agent as never, connectionId).catch(() => undefined))
  }, [agent, connectionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const send = async () => {
    if (!agent || !asking || busy) return
    setBusy(true)
    setNote(undefined)
    try {
      const result = await upgradeRelationship(agent as never, connectionId, { witnessed: asking === 'witness' })
      setAsking(undefined)
      if (result.kind === 'sent') await refresh()
      else setNote(t(NOTE[result.kind], words))
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async () => {
    if (!agent || !pending) return
    await cancelRelationshipUpgrade(agent as never, connectionId, pending.exchangeId)
    setPending(undefined)
  }

  const styles = StyleSheet.create({
    section: { gap: 10, marginTop: 16 },
    title: { fontWeight: 'bold' },
    row: { gap: 2, paddingVertical: 8 },
    link: { color: ColorPalette.brand.link },
    muted: { color: ColorPalette.grayscale.mediumGrey },
    sheetBack: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: {
      backgroundColor: ColorPalette.brand.modalPrimaryBackground,
      padding: 24,
      gap: 12,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
  })

  return (
    <View style={styles.section} testID={testIdWithKey('RelationshipUpgrade')}>
      <ThemedText style={styles.title}>{t('Relationship.UpgradeTitle')}</ThemedText>
      {pending ? (
        <View style={styles.row}>
          <ThemedText testID={testIdWithKey('RelationshipUpgradeWaiting')}>
            {t('Relationship.WaitingForAnswer', words)}
          </ThemedText>
          <Button
            title={t('Relationship.CancelRequest')}
            buttonType={ButtonType.Secondary}
            onPress={() => void withdraw()}
            testID={testIdWithKey('RelationshipUpgradeCancel')}
          />
        </View>
      ) : (
        <>
          {hardwareSigned ? (
            <ThemedText style={styles.row} testID={testIdWithKey('RelationshipUpgradeHardwareDone')}>
              {t('Relationship.HardwareDone')}
            </ThemedText>
          ) : (
            <Pressable
              style={styles.row}
              onPress={() => setAsking('resign')}
              accessibilityRole="button"
              testID={testIdWithKey('RelationshipUpgradeResign')}
            >
              <ThemedText style={styles.link}>{t('Relationship.Resign')}</ThemedText>
              <ThemedText style={styles.muted}>{t('Relationship.ResignSubtitle', words)}</ThemedText>
            </Pressable>
          )}
          <Pressable
            style={styles.row}
            onPress={() => witnessConnected && setAsking('witness')}
            disabled={!witnessConnected}
            accessibilityRole="button"
            accessibilityState={{ disabled: !witnessConnected }}
            testID={testIdWithKey('RelationshipUpgradeWitness')}
          >
            <ThemedText style={witnessConnected ? styles.link : styles.muted}>{t('Relationship.Witness')}</ThemedText>
            <ThemedText style={styles.muted}>
              {t(witnessConnected ? 'Relationship.WitnessSubtitle' : 'Relationship.NoWitness')}
            </ThemedText>
          </Pressable>
        </>
      )}
      {note ? (
        <ThemedText style={styles.muted} testID={testIdWithKey('RelationshipUpgradeNote')}>
          {note}
        </ThemedText>
      ) : null}
      <SafeAreaModal visible={asking !== undefined} transparent animationType="slide">
        <View style={styles.sheetBack}>
          {asking ? (
            <View style={styles.sheet} testID={testIdWithKey('RelationshipUpgradeConfirm')}>
              <ThemedText variant="headingThree">
                {t(
                  asking === 'witness' ? 'Relationship.ConfirmWitnessTitle' : 'Relationship.ConfirmResignTitle',
                  words
                )}
              </ThemedText>
              <ThemedText>
                {t(asking === 'witness' ? 'Relationship.ConfirmWitnessBody' : 'Relationship.ConfirmResignBody', words)}
              </ThemedText>
              <Button
                title={t('Relationship.Send')}
                buttonType={ButtonType.Primary}
                onPress={() => void send()}
                disabled={busy}
                testID={testIdWithKey('RelationshipUpgradeSend')}
              />
              <Button
                title={t('Relationship.Back')}
                buttonType={ButtonType.Secondary}
                onPress={() => setAsking(undefined)}
                disabled={busy}
                testID={testIdWithKey('RelationshipUpgradeDismiss')}
              />
            </View>
          ) : null}
        </View>
      </SafeAreaModal>
    </View>
  )
}

export default RelationshipUpgradeSection
