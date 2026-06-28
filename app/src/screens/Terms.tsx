import { Button, ButtonType, DispatchAction, testIdWithKey, useTheme, useStore } from '@bifold/core'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export const TermsVersion = '2'

const Terms: React.FC = () => {
  const [store, dispatch] = useStore()
  const { t } = useTranslation()
  const { TextTheme } = useTheme()
  const style = StyleSheet.create({
    safeAreaView: {
      flex: 1,
    },
    scrollViewContentContainer: {
      padding: 20,
      flexGrow: 1,
    },
    footer: {
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    bodyText: {
      ...TextTheme.normal,
      flexShrink: 1,
    },
  })

  const onSubmitPressed = useCallback(() => {
    dispatch({
      type: DispatchAction.DID_AGREE_TO_TERMS,
      payload: [{ DidAgreeToTerms: TermsVersion }],
    })
  }, [dispatch])

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={style.safeAreaView}>
      <ScrollView contentContainerStyle={style.scrollViewContentContainer}>
        {/* TODO: Replace with Keyring terms of service */}
        <Text style={[style.bodyText, { marginTop: 20 }]}>
          Terms of service coming soon. By accepting, you agree to use Keyring in accordance with applicable laws and
          regulations.
        </Text>
        <View style={{ marginBottom: 30 }} />
      </ScrollView>
      {!(store.onboarding.didAgreeToTerms === TermsVersion && store.authentication.didAuthenticate) && (
        <View style={style.footer}>
          <Button
            title={t('Global.Accept')}
            accessibilityLabel={t('Global.Accept')}
            testID={testIdWithKey('Accept')}
            onPress={onSubmitPressed}
            buttonType={ButtonType.Primary}
          />
        </View>
      )}
    </SafeAreaView>
  )
}

export default Terms
