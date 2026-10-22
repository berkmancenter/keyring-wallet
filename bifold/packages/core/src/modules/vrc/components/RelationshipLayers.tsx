/**
 * "How you know <name>": the relationship's layers on a contact, newest first
 * — each set of cards (said to be signed with secure hardware only once its
 * evidence verifies) and each witness record, in person when the witness
 * confirmed it. Only what the records show.
 *
 * @module vrc/components/RelationshipLayers
 */
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { verifyVrcHardwareEvidence } from '../services/BiometricSignatureVerifier'
import type { RelationshipLayer } from '../utils/relationshipLayers'

const dateOf = (at?: string) => (at ? new Date(at).toLocaleDateString() : '')

export const RelationshipLayers: React.FC<{ name: string; layers: RelationshipLayer[] }> = ({ name, layers }) => {
  const { t } = useTranslation()
  const { ColorPalette } = useTheme()
  const [verified, setVerified] = useState<Record<number, boolean>>({})

  useEffect(() => {
    let live = true
    layers.forEach((layer, index) => {
      if (layer.kind !== 'card' || !layer.hardwareEvidence) return
      verifyVrcHardwareEvidence(layer.raw as never)
        .then((result) => live && setVerified((v) => ({ ...v, [index]: result?.valid === true })))
        .catch(() => live && setVerified((v) => ({ ...v, [index]: false })))
    })
    return () => {
      live = false
    }
  }, [layers])

  if (layers.length === 0) return null
  const styles = StyleSheet.create({
    section: { gap: 6, marginTop: 16 },
    title: { fontWeight: 'bold' },
    muted: { color: ColorPalette.grayscale.mediumGrey },
  })
  return (
    <View style={styles.section} testID={testIdWithKey('RelationshipLayers')}>
      <ThemedText style={styles.title}>
        {t('Relationship.LayersTitle', { name, interpolation: { escapeValue: false } })}
      </ThemedText>
      {layers.map((layer, index) => (
        <View key={index} testID={testIdWithKey('RelationshipLayer')}>
          <ThemedText>
            {layer.kind === 'card'
              ? t(verified[index] ? 'Relationship.LayerCardsHardware' : 'Relationship.LayerCards', {
                  date: dateOf(layer.at),
                })
              : layer.witnessName
                ? t('Relationship.LayerWitnessed', {
                    witness: layer.witnessName,
                    date: dateOf(layer.at),
                    interpolation: { escapeValue: false },
                  })
                : t('Relationship.LayerWitnessedUnnamed', { date: dateOf(layer.at) })}
          </ThemedText>
          {layer.kind === 'witnessed' && layer.inPerson ? (
            <ThemedText style={styles.muted}>{t('Relationship.LayerInPerson')}</ThemedText>
          ) : null}
        </View>
      ))}
    </View>
  )
}

export default RelationshipLayers
