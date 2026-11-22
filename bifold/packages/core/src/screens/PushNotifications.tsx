import React from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import Button, { ButtonType } from '../components/buttons/Button'
import PushNotificationsContent from '../components/views/PushNotificationsContent'
import { TOKENS, useServices } from '../container-api'
import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'
import { testIdWithKey } from '../utils/testable'
import ScreenWrapper from '../components/views/ScreenWrapper'
import { ThemedText } from '../components/texts/ThemedText'

// Screen to show during onboarding that prompts
// for push notification permissions
const PushNotifications: React.FC = () => {
  const { t } = useTranslation()
  const [, dispatch] = useStore()
  const [{ enablePushNotifications }] = useServices([TOKENS.CONFIG])

  if (!enablePushNotifications) {
    throw new Error('Push notification configuration not found')
  }

  const activatePushNotifications = async () => {
    const state = await enablePushNotifications.setup()
    dispatch({ type: DispatchAction.USE_PUSH_NOTIFICATIONS, payload: [state === 'granted'] })
  }

  // "Not now" answers the step without asking the system: the system's prompt
  // is shown once per install on iOS, so it stays unspent for Settings →
  // Notifications, where the person can turn notifications on later.
  const notNow = () => {
    dispatch({ type: DispatchAction.USE_PUSH_NOTIFICATIONS, payload: [false] })
  }

  const controls = (
    <View style={{ gap: 12 }}>
      <Button
        buttonType={ButtonType.Primary}
        title={t('PushNotifications.TurnOn')}
        accessibilityLabel={t('PushNotifications.TurnOn')}
        testID={testIdWithKey('PushNotificationContinue')}
        onPress={activatePushNotifications}
      />
      <Button
        buttonType={ButtonType.Secondary}
        title={t('Global.NotNow')}
        accessibilityLabel={t('Global.NotNow')}
        testID={testIdWithKey('PushNotificationNotNow')}
        onPress={notNow}
      />
      <ThemedText style={{ textAlign: 'center' }} testID={testIdWithKey('PushNotificationChangeLater')}>
        {t('PushNotifications.ChangeLater')}
      </ThemedText>
    </View>
  )

  return (
    <ScreenWrapper controls={controls}>
      <PushNotificationsContent />
    </ScreenWrapper>
  )
}

export default PushNotifications
