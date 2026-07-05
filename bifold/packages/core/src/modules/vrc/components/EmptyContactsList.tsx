import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { StackNavigationProp } from '@react-navigation/stack'

import { useTheme } from '../../../contexts/theme'
import { testIdWithKey } from '../../../utils/testable'
import { ThemedText } from '../../../components/texts/ThemedText'
import Button, { ButtonType } from '../../../components/buttons/Button'
import Link from '../../../components/texts/Link'
import { ContactStackParams, Screens, Stacks } from '../../../types/navigators'
import QRCodeExchangeSlider from './QRCodeExchangeSlider'

const CIRCLE_SIZE = 180
const CIRCLE_COLOR = 'rgba(163, 73, 164, 0.18)'
const ICON_SIZE = 80

const EmptyContactsList: React.FC = () => {
  const { t } = useTranslation()
  const { Assets, ColorPalette } = useTheme()
  const navigation = useNavigation<StackNavigationProp<ContactStackParams>>()
  const [showQRCodeModal, setShowQRCodeModal] = useState(false)

  const handleInviteContact = () => {
    setShowQRCodeModal(true)
  }

  const navigateToWhatAreContacts = () => {
    navigation.getParent()?.navigate(Stacks.ContactStack, { screen: Screens.WhatAreContacts })
  }

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 40,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    iconCircle: {
      width: CIRCLE_SIZE,
      height: CIRCLE_SIZE,
      borderRadius: CIRCLE_SIZE / 2,
      backgroundColor: CIRCLE_COLOR,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: {
      textAlign: 'center',
      marginTop: 10,
    },
    link: {
      textAlign: 'center',
      marginTop: 10,
      alignSelf: 'center',
    },
    buttonContainer: {
      marginTop: 24,
      width: '75%',
      alignSelf: 'center',
    },
  })

  return (
    <>
      <View style={styles.container}>
        <View style={styles.iconCircle}>
          <Assets.svg.contactsIconOutline fill="#000000" width={ICON_SIZE} height={ICON_SIZE} />
        </View>
        <ThemedText variant="headingThree" style={[styles.text, { marginTop: 28, fontSize: 22, fontWeight: '700' }]} accessibilityRole="header">
          {t('Contacts.EmptyList' as any)}
        </ThemedText>
        <ThemedText style={[styles.text, { color: ColorPalette.grayscale.mediumGrey, fontSize: 16, lineHeight: 22 }]} testID={testIdWithKey('NoContacts')}>
          {t('Contacts.PeopleAndOrganizations' as any)}
        </ThemedText>
        <Link style={styles.link} linkText={t('Contacts.WhatAreContacts' as any)} onPress={navigateToWhatAreContacts} />
        <View style={styles.buttonContainer}>
          <Button
            title={t('Contacts.InviteContact')}
            accessibilityLabel={t('Contacts.InviteContact')}
            testID={testIdWithKey('InviteContact')}
            onPress={handleInviteContact}
            buttonType={ButtonType.Primary}
          />
        </View>
      </View>
      <QRCodeExchangeSlider
        visible={showQRCodeModal}
        onDismiss={() => setShowQRCodeModal(false)}
        navigation={navigation as any}
      />
    </>
  )
}

export default EmptyContactsList
