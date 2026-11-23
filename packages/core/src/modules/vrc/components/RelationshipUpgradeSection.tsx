/**
 * A contact's quick actions, under their name: Message, Sign again and Add a witness. The last two add to the
 * relationship you already have, never a new one: ask to sign the cards again (with secure hardware now), or sign
 * again in front of a witness when you are together. Each asks first and says what it shares; one tap sends once; a
 * pending request says so and can be withdrawn on this phone.
 *
 * An action that can't be used now is shown, disabled, with the reason under the row: never hidden, never looking as
 * if it works.
 *
 * @module vrc/components/RelationshipUpgradeSection
 */
import { useAgent } from '@bifold/react-hooks'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

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
  /** The relationship's connection, or null while there is none on this phone: then nothing can be asked. */
  connectionId: string | null
  name: string
  /** This contact's cards already carry verified hardware evidence. */
  hardwareSigned: boolean
  /** Opens the contact's chat; absent when there is none to open. */
  onMessage?: () => void
}

type Ask = 'resign' | 'witness'

const NOTE: Record<Exclude<RelationshipUpgradeResult['kind'], 'sent'>, string> = {
  noRelationship: 'Relationship.NoRelationship',
  noWitness: 'Relationship.NoWitness',
  peerUnsupported: 'Relationship.PeerUnsupported',
}

interface TileProps {
  label: string
  icon: string
  onPress?: () => void
  disabled: boolean
  primary?: boolean
  testID: string
}

const Tile: React.FC<TileProps> = ({ label, icon, onPress, disabled, primary, testID }) => {
  const { ColorPalette } = useTheme()
  const filled = primary && !disabled
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      style={{
        flex: 1,
        minHeight: 68,
        borderRadius: 14,
        borderWidth: filled ? 0 : 1,
        borderColor: '#E3DEE3',
        backgroundColor: filled ? ColorPalette.brand.primary : ColorPalette.grayscale.white,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingHorizontal: 4,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Icon name={icon} size={22} color={filled ? ColorPalette.grayscale.white : ColorPalette.brand.primary} />
      <ThemedText
        style={{
          fontSize: 14,
          fontWeight: '600',
          textAlign: 'center',
          color: filled ? ColorPalette.grayscale.white : ColorPalette.grayscale.black,
        }}
      >
        {label}
      </ThemedText>
    </Pressable>
  )
}

export const RelationshipUpgradeSection: React.FC<RelationshipUpgradeSectionProps> = ({
  connectionId,
  name,
  hardwareSigned,
  onMessage,
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
    if (!agent || !connectionId) return
    setPending(await pendingUpgradeOf(agent as never, connectionId).catch(() => undefined))
  }, [agent, connectionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const send = async () => {
    if (!agent || !connectionId || !asking || busy) return
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
    if (!agent || !connectionId || !pending) return
    await cancelRelationshipUpgrade(agent as never, connectionId, pending.exchangeId)
    setPending(undefined)
  }

  const styles = StyleSheet.create({
    section: { gap: 8, marginTop: 16 },
    tiles: { flexDirection: 'row', gap: 10 },
    reason: { fontSize: 13, lineHeight: 18, color: ColorPalette.grayscale.mediumGrey },
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
      <View style={styles.tiles}>
        <Tile
          label={t('ContactDetails.QuickMessage')}
          icon="message-text-outline"
          onPress={onMessage}
          disabled={!onMessage}
          primary
          testID={testIdWithKey('ContactViewMessages')}
        />
        <Tile
          label={t('Relationship.Resign')}
          icon="draw"
          onPress={() => setAsking('resign')}
          disabled={!connectionId || Boolean(pending) || hardwareSigned}
          testID={testIdWithKey('RelationshipUpgradeResign')}
        />
        <Tile
          label={t('Relationship.Witness')}
          icon="account-check-outline"
          onPress={() => setAsking('witness')}
          disabled={!connectionId || Boolean(pending) || !witnessConnected}
          testID={testIdWithKey('RelationshipUpgradeWitness')}
        />
      </View>
      {!connectionId ? (
        <ThemedText style={styles.reason}>{t('Relationship.NoRelationship', words)}</ThemedText>
      ) : pending ? (
        <>
          <ThemedText style={styles.reason} testID={testIdWithKey('RelationshipUpgradeWaiting')}>
            {t('Relationship.WaitingForAnswer', words)}
          </ThemedText>
          <Button
            title={t('Relationship.CancelRequest')}
            buttonType={ButtonType.Secondary}
            onPress={() => void withdraw()}
            testID={testIdWithKey('RelationshipUpgradeCancel')}
          />
        </>
      ) : (
        <>
          {hardwareSigned ? (
            <ThemedText style={styles.reason} testID={testIdWithKey('RelationshipUpgradeHardwareDone')}>
              {t('Relationship.ResignUnavailable')}
            </ThemedText>
          ) : null}
          {!witnessConnected ? (
            <ThemedText style={styles.reason} testID={testIdWithKey('RelationshipUpgradeNoWitness')}>
              {t('Relationship.WitnessUnavailable')}
            </ThemedText>
          ) : null}
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
