import React from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { useTheme } from '../../contexts/theme'
import { testIdWithKey } from '../../utils/testable'
import { ThemedText } from '../texts/ThemedText'

/** Below this height (pt) a screen counts as short. */
export const SHORT_SCREEN_PT = 700

const PushNotificationsContent: React.FC = () => {
  const { t } = useTranslation()
  const { TextTheme, Assets, ColorPalette } = useTheme()
  // A bullet with no words is left out: Keyring's notifications carry one
  // kind of thing, said in the body, not a list.
  const list = [
    t('PushNotifications.BulletOne'),
    t('PushNotifications.BulletTwo'),
    t('PushNotifications.BulletThree'),
    t('PushNotifications.BulletFour'),
  ].filter((item) => item.trim().length > 0)
  const whatItSays = t('PushNotifications.WhatItSays')

  // On a short phone (an iPhone SE is 667 pt tall) a 200 pt picture pushed
  // "A notification only says that something is waiting" below the buttons,
  // out of sight: the picture shrinks there, so what a notification shows is
  // read before the choice (234, SE look).
  const { height } = useWindowDimensions()
  const imageHeight = height < SHORT_SCREEN_PT ? 120 : 200
  const style = StyleSheet.create({
    image: {
      height: imageHeight,
      marginBottom: 20,
    },
    heading: {
      marginBottom: 20,
    },
    listItem: {
      ...TextTheme.normal,
      flex: 1,
      paddingLeft: 5,
    },
  })

  return (
    <>
      <View style={style.image} testID={testIdWithKey('PushNotificationImage')}>
        <Assets.svg.pushNotificationImg />
      </View>
      <ThemedText variant="headingThree" style={style.heading}>
        {t('PushNotifications.EnableNotifications')}
      </ThemedText>
      <ThemedText>{t('PushNotifications.BeNotified')}</ThemedText>
      {/* What a notification shows: only that something waits; the rest stays behind the PIN. */}
      {whatItSays.trim() ? (
        <ThemedText
          style={{ marginTop: 20, color: ColorPalette.grayscale.mediumGrey }}
          testID={testIdWithKey('PushNotificationWhatItSays')}
        >
          {whatItSays}
        </ThemedText>
      ) : null}
      {list.map((item, index) => (
        <View style={{ flexDirection: 'row', marginTop: 20 }} key={index}>
          <ThemedText>{'\u2022'}</ThemedText>
          <ThemedText style={style.listItem}>{item}</ThemedText>
        </View>
      ))}
    </>
  )
}

export default PushNotificationsContent
