import { NavigationProp, ParamListBase } from '@react-navigation/native'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Link from '../../../components/texts/Link'
import { ThemedText } from '../../../components/texts/ThemedText'
import { useTheme } from '../../../contexts/theme'
import { Screens, Stacks } from '../../../types/navigators'

const CARD_MARGIN = 20
const CIRCLE_SIZE = 120
const CIRCLE_COLOR = 'rgba(163, 73, 164, 0.18)'
const ICON_SIZE = 56

interface WhatAreContactsProps {
  navigation: NavigationProp<ParamListBase>
}

const WhatAreContacts: React.FC<WhatAreContactsProps> = ({ navigation }) => {
  const { ColorPalette, Assets } = useTheme()
  const { t } = useTranslation()
  const styles = StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: ColorPalette.brand.primaryBackground,
    },
    cardWrapper: {
      flex: 1,
      paddingHorizontal: CARD_MARGIN,
      paddingTop: 16,
      paddingBottom: 8,
    },
    card: {
      flex: 1,
      backgroundColor: '#FFFFFF',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'rgba(170,170,170,0.4)',
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 4,
    },
    cardContent: {
      padding: 24,
    },
    iconContainer: {
      alignItems: 'center',
      marginBottom: 16,
    },
    iconCircle: {
      width: CIRCLE_SIZE,
      height: CIRCLE_SIZE,
      borderRadius: CIRCLE_SIZE / 2,
      backgroundColor: CIRCLE_COLOR,
      alignItems: 'center',
      justifyContent: 'center',
    },
    noteContainer: {
      marginTop: 16,
      padding: 15,
      backgroundColor: ColorPalette.grayscale.lightGrey,
      borderRadius: 8,
    },
  })

  const goToContactList = () => {
    navigation.getParent()?.navigate(Stacks.ContactStack, { screen: Screens.Contacts })
  }

  const bulletPoints = [
    t('WhatAreContacts.ListItemDirectMessage'),
    t('WhatAreContacts.ListItemNewCredentials'),
    t('WhatAreContacts.ListItemNotifiedOfUpdates'),
    t('WhatAreContacts.ListItemRequest'),
  ].map((text, index) => (
    <View key={index} style={{ marginBottom: 8, flexDirection: 'row' }}>
      <ThemedText style={{ paddingRight: 5, color: '#A349A4' }}>{'\u2022'}</ThemedText>
      <ThemedText style={{ flexShrink: 1 }}>{text}</ThemedText>
    </View>
  ))

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
      <View style={styles.cardWrapper}>
        <View style={styles.card}>
          <ScrollView
            contentContainerStyle={styles.cardContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.iconContainer}>
              <View style={styles.iconCircle}>
                <Assets.svg.contactsIconOutline width={ICON_SIZE} height={ICON_SIZE} fill="#000000" />
              </View>
            </View>
            <ThemedText variant="headingThree" style={{ marginBottom: 12, textAlign: 'center' }} accessibilityRole="header">
              {t('WhatAreContacts.Title')}
            </ThemedText>
            <ThemedText style={{ marginBottom: 12 }}>{t('WhatAreContacts.Preamble')}</ThemedText>
            {bulletPoints}
            <View style={styles.noteContainer}>
              <ThemedText style={{ fontStyle: 'italic' }}>
                {t('WhatAreContactsAddendum.DifferenceFromConnections' as any) as string}
              </ThemedText>
            </View>
            <ThemedText style={{ marginTop: 16 }}>
              {`${t('WhatAreContacts.RemoveContacts')} `}
              <Link linkText={t('WhatAreContacts.ContactsLink')} onPress={goToContactList} />
            </ThemedText>
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  )
}

export default WhatAreContacts
