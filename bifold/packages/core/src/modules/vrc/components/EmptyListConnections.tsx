import { StackNavigationProp } from '@react-navigation/stack'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { useTheme } from '../../../contexts/theme'
import { ContactStackParams, Screens, Stacks } from '../../../types/navigators'
import Link from '../../../components/texts/Link'
import { ThemedText } from '../../../components/texts/ThemedText'

const CIRCLE_SIZE = 180
const CIRCLE_COLOR = 'rgba(163, 73, 164, 0.18)'
const ICON_SIZE = 80

export interface EmptyListConnectionsProps {
  navigation: StackNavigationProp<ContactStackParams, Screens.Contacts>
}

const EmptyListConnections: React.FC<EmptyListConnectionsProps> = ({ navigation }) => {
  const { t } = useTranslation()
  const { Assets, ColorPalette } = useTheme()
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
  })

  const navigateToWhatAreConnections = () => {
    navigation.getParent()?.navigate(Stacks.ContactStack, { screen: Screens.WhatAreConnections })
  }

  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Assets.svg.tabFourFocusedIcon fill="#000000" width={ICON_SIZE} height={ICON_SIZE} />
      </View>
      <ThemedText variant="headingThree" style={[styles.text, { marginTop: 28, fontSize: 22, fontWeight: '700' }]} accessibilityRole="header">
        {t('Connections.EmptyList' as any)}
      </ThemedText>
      <ThemedText style={[styles.text, { color: ColorPalette.grayscale.mediumGrey, fontSize: 16, lineHeight: 22 }]}>
        {t('Connections.PeopleAndOrganizations' as any)}
      </ThemedText>
      <Link
        style={styles.link}
        linkText={t('Connections.WhatAreConnections' as any)}
        onPress={navigateToWhatAreConnections}
      />
    </View>
  )
}

export default EmptyListConnections
