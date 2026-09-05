import React from 'react'
import { Image, Platform, StyleSheet, TouchableOpacity, View } from 'react-native'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import { ThemedText } from '../../../components/texts/ThemedText'
import { ContactCardProps } from '../../../types/contact-card'
import { testIdWithKey } from '../../../utils/testable'

/**
 * The default drawing of one exchanged R-Card in the contacts list: a row with
 * the contact's photo, their name, and badges for hardware attestation and a
 * witnessed exchange.
 *
 * This is registered on `TOKENS.COMPONENT_CONTACT_CARD` by the core container,
 * which is the seam an app or a demo profile overrides to render the same
 * R-Card as something else entirely — see
 * `app/src/demo-profiles/trading-card/` for a worked example.
 */
const CARD_BG = '#F5F5F5'
const CARD_BORDER = 'rgba(170, 170, 170, 0.4)'
const AVATAR_BG = '#E8E0E8'
const NAME_COLOR = '#010B13'
const BADGE_HW_TEAL = '#4D7A8B'
const BADGE_WITNESS_PURPLE = '#A349A4'

const styles = StyleSheet.create({
  itemContainer: {
    backgroundColor: CARD_BG,
    marginHorizontal: 14,
    marginVertical: 4,
    paddingHorizontal: 14,
    paddingVertical: 0,
    height: 62,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: AVATAR_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 36,
    height: 36,
  },
  itemText: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 16,
    color: NAME_COLOR,
    flex: 1,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  badgeIcon: {
    marginLeft: 4,
  },
})

const ContactCard: React.FC<ContactCardProps> = ({ contact, hardwareVerified, onPress }) => {
  return (
    <TouchableOpacity
      style={styles.itemContainer}
      onPress={onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`Contact: ${contact.issuer.name}`}
    >
      <View style={styles.avatarCircle}>
        {contact.issuer.photo ? (
          <Image
            testID={testIdWithKey('ContactAvatarImage')}
            style={styles.avatarImage}
            source={{ uri: contact.issuer.photo }}
          />
        ) : (
          <Icon name="account-outline" size={22} color="#666666" />
        )}
      </View>
      <ThemedText style={styles.itemText}>{contact.issuer.name}</ThemedText>
      <View style={styles.badgeContainer}>
        {hardwareVerified && <Icon name="shield-check" size={18} color={BADGE_HW_TEAL} style={styles.badgeIcon} />}
        {contact.hasWitnessCredentials && (
          <Icon name="check-decagram" size={18} color={BADGE_WITNESS_PURPLE} style={styles.badgeIcon} />
        )}
      </View>
    </TouchableOpacity>
  )
}

export default ContactCard
