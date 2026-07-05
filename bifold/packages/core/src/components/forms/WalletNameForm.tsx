import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Keyboard, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { DispatchAction } from '../../contexts/reducers/store'
import { useStore } from '../../contexts/store'
import { useTheme } from '../../contexts/theme'
import { generateRandomWalletName } from '../../utils/helpers'
import { testIdWithKey } from '../../utils/testable'
import ButtonLoading from '../animated/ButtonLoading'
import Button, { ButtonType } from '../buttons/Button'
import LimitedTextInput from '../inputs/LimitedTextInput'
import { InfoBoxType } from '../misc/InfoBox'
import PopupModal from '../modals/PopupModal'
import { ThemedText } from '../texts/ThemedText'

const CARD_MARGIN = 20
const CIRCLE_SIZE = 140
const CIRCLE_COLOR = 'rgba(163, 73, 164, 0.18)'
const ICON_SIZE = 72

type ErrorState = {
  visible: boolean
  title: string
  description: string
}

interface NameWalletProps {
  isRenaming?: boolean
  onSubmitSuccess?: (name: string) => void
  onCancel?: () => void
}

const NameWalletForm: React.FC<NameWalletProps> = ({ isRenaming, onSubmitSuccess, onCancel }) => {
  const { t } = useTranslation()
  const { OnboardingTheme, ColorPalette, Spacing, Assets } = useTheme()
  const [store, dispatch] = useStore()
  const [loading, setLoading] = useState(false)
  const [walletName, setWalletName] = useState(store.preferences.walletName ?? generateRandomWalletName())
  const scrollRef = useRef<ScrollView>(null)
  const inputLayoutY = useRef(0)
  const [errorState, setErrorState] = useState<ErrorState>({
    visible: false,
    title: '',
    description: '',
  })

  const bgColor = OnboardingTheme?.container?.backgroundColor || ColorPalette.brand.primaryBackground

  const styles = StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: bgColor,
    },
    cardWrapper: {
      flex: 1,
      paddingHorizontal: CARD_MARGIN,
      paddingTop: 28,
      paddingBottom: 16,
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
      flexGrow: 1,
      justifyContent: 'center',
    },
    footer: {
      alignItems: 'center' as const,
      paddingTop: 20,
      paddingBottom: 16,
    },
    buttonInner: {
      width: '42%' as any,
      minWidth: 148,
    },
  })

  const handleChangeText = (text: string) => {
    setWalletName(text)
  }

  const handleContinuePressed = () => {
    if (walletName.length < 1) {
      setErrorState({
        title: t('NameWallet.EmptyNameTitle'),
        description: t('NameWallet.EmptyNameDescription'),
        visible: true,
      })
    } else if (walletName.length > 50) {
      setErrorState({
        title: t('NameWallet.CharCountTitle'),
        description: t('NameWallet.CharCountDescription'),
        visible: true,
      })
    } else {
      setLoading(true)
      dispatch({
        type: DispatchAction.UPDATE_WALLET_NAME,
        payload: [walletName],
      })
      dispatch({ type: DispatchAction.DID_NAME_WALLET })
      onSubmitSuccess?.(walletName)
    }
  }

  const handleDismissError = () => {
    setErrorState((prev) => ({ ...prev, visible: false }))
  }

  useEffect(() => {
    if (Platform.OS !== 'ios') return

    const sub1 = Keyboard.addListener('keyboardWillShow', () => {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true })
      }, 50)
    })
    const sub2 = Keyboard.addListener('keyboardWillHide', () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true })
    })
    return () => {
      sub1.remove()
      sub2.remove()
    }
  }, [])

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
      <View style={styles.cardWrapper}>
        <View style={styles.card}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.cardContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            <View style={{ alignItems: 'center', marginBottom: 20 }}>
              <View
                style={{
                  width: CIRCLE_SIZE,
                  height: CIRCLE_SIZE,
                  borderRadius: CIRCLE_SIZE / 2,
                  backgroundColor: CIRCLE_COLOR,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Assets.svg.contactBook
                  width={ICON_SIZE}
                  height={ICON_SIZE}
                  fill="#000000"
                  stroke="#000000"
                  strokeWidth={0.8 * (469 / ICON_SIZE)}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </View>
            </View>
            <ThemedText style={{ fontSize: 22, fontWeight: '600', textAlign: 'center', marginBottom: Spacing.md }}>
              {t('NameWallet.NameYourWallet')}
            </ThemedText>
            <ThemedText style={{ textAlign: 'center', marginBottom: Spacing.lg }}>
              {t('NameWallet.ThisIsTheName')}
            </ThemedText>
            <View
              style={{ width: '100%' }}
              onLayout={(e) => {
                inputLayoutY.current = e.nativeEvent.layout.y
              }}
            >
              <LimitedTextInput
                defaultValue={walletName}
                label={t('NameWallet.NameYourWallet')}
                limit={50}
                handleChangeText={handleChangeText}
                accessibilityLabel={t('NameWallet.NameYourWallet')}
                testID={testIdWithKey('NameInput')}
              />
            </View>
            <View style={{ height: 160 }} />
          </ScrollView>
        </View>
      </View>
      <View style={styles.footer}>
        <View style={styles.buttonInner}>
          <Button
            title={isRenaming ? t('Global.Save') : t('Global.Continue')}
            buttonType={ButtonType.Primary}
            testID={isRenaming ? testIdWithKey('Save') : testIdWithKey('Continue')}
            accessibilityLabel={isRenaming ? t('Global.Save') : t('Global.Continue')}
            onPress={handleContinuePressed}
            disabled={loading}
          >
            {loading && <ButtonLoading />}
          </Button>
          {isRenaming && (
            <View style={{ marginTop: Spacing.sm }}>
              <Button
                title={t('Global.Cancel')}
                buttonType={ButtonType.Secondary}
                testID={testIdWithKey('Cancel')}
                accessibilityLabel={t('Global.Cancel')}
                onPress={onCancel}
              />
            </View>
          )}
        </View>
      </View>
      {errorState.visible && (
        <PopupModal
          notificationType={InfoBoxType.Info}
          onCallToActionLabel={t('Global.Okay')}
          onCallToActionPressed={handleDismissError}
          title={errorState.title}
          description={errorState.description}
        />
      )}
    </SafeAreaView>
  )
}

export default NameWalletForm
