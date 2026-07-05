import { ParamListBase } from '@react-navigation/native'
import { StackScreenProps } from '@react-navigation/stack'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AccessibilityInfo,
  DeviceEventEmitter,
  Keyboard,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  findNodeHandle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// eslint-disable-next-line import/no-named-as-default
import { ButtonType } from '../components/buttons/Button-api'
import PINInput from '../components/inputs/PINInput'
import PINValidationHelper from '../components/misc/PINValidationHelper'
import AlertModal from '../components/modals/AlertModal'
import { EventTypes, minPINLength } from '../constants'
import { TOKENS, useServices } from '../container-api'
import { useAnimatedComponents } from '../contexts/animated-components'
import { useAuth } from '../contexts/auth'
import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'
import { useTheme } from '../contexts/theme'
import usePreventScreenCapture from '../hooks/screen-capture'
import { usePINValidation } from '../hooks/usePINValidation'
import { BifoldError } from '../types/error'
import { Screens } from '../types/navigators'
import { testIdWithKey } from '../utils/testable'

const CARD_MARGIN = 20

interface PINCreateProps extends StackScreenProps<ParamListBase, Screens.CreatePIN> {
  setAuthenticated: (status: boolean) => void
  explainedStatus: boolean
}

const PINCreate: React.FC<PINCreateProps> = ({ setAuthenticated, explainedStatus }) => {
  const { setPIN: setWalletPIN } = useAuth()
  const [PIN, setPIN] = useState('')
  const [PINTwo, setPINTwo] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [, dispatch] = useStore()
  const { t } = useTranslation()

  const { ColorPalette, OnboardingTheme } = useTheme()
  const { ButtonLoading } = useAnimatedComponents()
  const PINTwoInputRef = useRef<TextInput>(null)
  const createPINButtonRef = useRef<View>(null)
  const [PINExplainer, PINHeader, { showPINExplainer, preventScreenCapture }, Button, inlineMessages] = useServices([
    TOKENS.SCREEN_PIN_EXPLAINER,
    TOKENS.COMPONENT_PIN_HEADER,
    TOKENS.CONFIG,
    TOKENS.COMP_BUTTON,
    TOKENS.INLINE_ERRORS,
  ])

  const [explained, setExplained] = useState(explainedStatus || showPINExplainer === false)
  const { PINValidations, validatePINEntry, inlineMessageField1, inlineMessageField2, modalState, PINSecurity } =
    usePINValidation(PIN, PINTwo)
  usePreventScreenCapture(preventScreenCapture)

  const bgColor = OnboardingTheme?.container?.backgroundColor || ColorPalette.brand.primaryBackground

  const style = StyleSheet.create({
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

  const passcodeCreate = useCallback(
    async (PIN: string) => {
      try {
        await setWalletPIN(PIN)
        setAuthenticated(true)
        dispatch({
          type: DispatchAction.DID_CREATE_PIN,
        })
      } catch (err: unknown) {
        const error = new BifoldError(
          t('Error.Title1040'),
          t('Error.Message1040'),
          (err as Error)?.message ?? err,
          1040
        )

        DeviceEventEmitter.emit(EventTypes.ERROR_ADDED, error)
      }
    },
    [setWalletPIN, setAuthenticated, dispatch, t]
  )

  const handleCreatePinTap = useCallback(async () => {
    setIsLoading(true)
    if (validatePINEntry(PIN, PINTwo)) {
      await passcodeCreate(PIN)
    }
    setIsLoading(false)
  }, [PIN, PINTwo, passcodeCreate, validatePINEntry])

  const isContinueDisabled = useMemo((): boolean => {
    if (inlineMessages.enabled) {
      return false
    }
    return isLoading || PIN.length < minPINLength || PINTwo.length < minPINLength
  }, [isLoading, PIN, PINTwo, inlineMessages])

  const continueCreatePIN = useCallback(() => {
    setExplained(true)
  }, [])

  return explained ? (
    <SafeAreaView style={style.safeArea} edges={['left', 'right', 'bottom']}>
      <View style={style.cardWrapper}>
        <View style={style.card}>
          <ScrollView
            contentContainerStyle={style.cardContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <PINHeader />
            <PINInput
              label={t('PINCreate.EnterPINTitle')}
              onPINChanged={(p: string) => {
                setPIN(p)
                if (p.length === minPINLength && PINTwoInputRef?.current) {
                  PINTwoInputRef.current.focus()
                  const reactTag = findNodeHandle(PINTwoInputRef.current)
                  if (reactTag) {
                    AccessibilityInfo.setAccessibilityFocus(reactTag)
                  }
                }
              }}
              testID={testIdWithKey('EnterPIN')}
              accessibilityLabel={t('PINCreate.EnterPIN')}
              autoFocus={false}
              inlineMessage={inlineMessageField1}
            />
            <PINInput
              label={t('PINCreate.ReenterPIN')}
              onPINChanged={(p: string) => {
                setPINTwo(p)
                if (p.length === minPINLength) {
                  Keyboard.dismiss()
                  const reactTag = createPINButtonRef?.current && findNodeHandle(createPINButtonRef.current)
                  if (reactTag) {
                    AccessibilityInfo.setAccessibilityFocus(reactTag)
                  }
                }
              }}
              testID={testIdWithKey('ReenterPIN')}
              accessibilityLabel={t('PINCreate.ReenterPIN')}
              autoFocus={false}
              ref={PINTwoInputRef}
              inlineMessage={inlineMessageField2}
            />
            {PINSecurity.displayHelper && <PINValidationHelper validations={PINValidations} />}
            {modalState.visible && (
              <AlertModal title={modalState.title} message={modalState.message} submit={modalState.onModalDismiss} />
            )}
          </ScrollView>
        </View>
      </View>
      <View style={style.footer}>
        <View style={style.buttonInner}>
          <Button
            title={t('PINCreate.CreatePIN')}
            testID={testIdWithKey('CreatePIN')}
            accessibilityLabel={t('PINCreate.CreatePIN')}
            buttonType={ButtonType.Primary}
            disabled={isContinueDisabled}
            onPress={handleCreatePinTap}
            ref={createPINButtonRef}
          >
            {isLoading ? <ButtonLoading /> : null}
          </Button>
        </View>
      </View>
    </SafeAreaView>
  ) : (
    <PINExplainer continueCreatePIN={continueCreatePIN} />
  )
}

export default PINCreate
