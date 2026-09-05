import { ContactCardProps, testIdWithKey } from '@bifold/core'
import React from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { useTradingCardBranding } from './useTradingCardBranding'

/**
 * An exchanged R-Card, drawn as a trading card.
 *
 * Nothing here is new machinery. The photo, name and organisation arrive in
 * the R-Card the other person issued during an ordinary VRC exchange; the two
 * badges are what that exchange proved (hardware attestation, a witness). The
 * only thing this file does is decide how they look — which is exactly the
 * "hook for a developer to determine how to make their trading card" the demo
 * is for.
 *
 * It is a plain function component. What puts it on screen is one line in
 * TradingCardProfile.register:
 *
 *   registerInstance(TOKENS.COMPONENT_CONTACT_CARD, TradingCard)
 */

/** What the exchange proved, as a collector would grade it. */
export const rarityFor = (hardwareVerified: boolean, witnessed?: boolean): string => {
  if (hardwareVerified && witnessed) return 'HOLO RARE'
  if (hardwareVerified) return 'RARE — hardware signed'
  if (witnessed) return 'RARE — witnessed'
  return 'COMMON'
}

const TradingCard: React.FC<ContactCardProps> = ({ contact, hardwareVerified, onPress }) => {
  const { primary, secondary, setName } = useTradingCardBranding()
  const { name, organization, photo } = contact.issuer
  const rarity = rarityFor(hardwareVerified, contact.hasWitnessCredentials)

  const styles = StyleSheet.create({
    card: {
      marginHorizontal: 16,
      marginVertical: 8,
      borderRadius: 16,
      borderWidth: 3,
      borderColor: secondary,
      backgroundColor: primary,
      padding: 10,
      overflow: 'hidden',
    },
    setName: {
      color: secondary,
      fontSize: 11,
      letterSpacing: 2,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    portrait: {
      aspectRatio: 1,
      width: '100%',
      borderRadius: 8,
      borderWidth: 2,
      borderColor: secondary,
      backgroundColor: '#0F0A1E',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    portraitImage: {
      width: '100%',
      height: '100%',
    },
    portraitPlaceholder: {
      color: secondary,
      fontSize: 40,
    },
    namePlate: {
      marginTop: 10,
      backgroundColor: secondary,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    name: {
      color: primary,
      fontSize: 18,
      fontWeight: '700',
    },
    organization: {
      color: primary,
      fontSize: 12,
      marginTop: 2,
    },
    rarity: {
      color: secondary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      marginTop: 8,
    },
  })

  return (
    <TouchableOpacity
      testID={testIdWithKey('TradingCard')}
      style={styles.card}
      onPress={onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`Contact: ${name}`}
    >
      <Text style={styles.setName}>{setName}</Text>
      <View style={styles.portrait}>
        {photo ? (
          <Image
            testID={testIdWithKey('ContactAvatarImage')}
            style={styles.portraitImage}
            source={{ uri: photo }}
            resizeMode="cover"
          />
        ) : (
          <Text style={styles.portraitPlaceholder}>?</Text>
        )}
      </View>
      <View style={styles.namePlate}>
        <Text style={styles.name}>{name}</Text>
        {organization ? <Text style={styles.organization}>{organization}</Text> : null}
      </View>
      <Text testID={testIdWithKey('TradingCardRarity')} style={styles.rarity}>
        {rarity}
      </Text>
    </TouchableOpacity>
  )
}

export default TradingCard
