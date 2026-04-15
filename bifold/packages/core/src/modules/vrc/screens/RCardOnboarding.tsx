import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Button, { ButtonType } from '../../../components/buttons/Button'
import ButtonLoading from '../../../components/animated/ButtonLoading'
import LimitedTextInput from '../../../components/inputs/LimitedTextInput'
import InlineErrorText, { InlineErrorType } from '../../../components/inputs/InlineErrorText'
import PopupModal from '../../../components/modals/PopupModal'
import { InfoBoxType } from '../../../components/misc/InfoBox'
import { DispatchAction } from '../../../contexts/reducers/store'
import { useStore } from '../../../contexts/store'
import { useTheme } from '../../../contexts/theme'
import { Agent } from '@credo-ts/core'
import { storeRCardTemplate } from '../services/rCardCredential'
import { bifoldLoggerInstance } from '../../../services/bifoldLogger'
import {
  RCardFormInput,
  RCardValidationErrors,
  buildRCardTemplate,
  extractFormInputFromJCard,
  validateRCardForm,
} from '../types/rcard'
import { InlineErrorConfig } from '../../../types/error'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'

const CARD_MARGIN = 20

const INLINE_ERROR_CONFIG: InlineErrorConfig = {
  enabled: true,
  hasErrorIcon: false,
  position: undefined,
  style: { marginTop: -4 },
}

const INITIAL_FORM: RCardFormInput = {
  firstName: '',
  lastName: '',
  email: '',
  organization: '',
}

interface RCardOnboardingProps {
  agent?: Agent | null
}

const RCardOnboarding: React.FC<RCardOnboardingProps> = ({ agent }) => {
  const { t } = useTranslation()
  const { Spacing: _Spacing, OnboardingTheme, ColorPalette } = useTheme()
  const [, dispatch] = useStore()
  const [formState, setFormState] = useState<RCardFormInput>(INITIAL_FORM)
  const [errors, setErrors] = useState<RCardValidationErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [errorModal, setErrorModal] = useState<string | undefined>(undefined)
  const scrollRef = useRef<ScrollView>(null)
  const lastNameRef = useRef<TextInput>(null)
  const emailRef = useRef<TextInput>(null)
  const orgRef = useRef<TextInput>(null)

  const bgColor = OnboardingTheme?.container?.backgroundColor || ColorPalette.brand.primaryBackground

  const scrollToInput = useCallback((ref: React.RefObject<TextInput>) => {
    if (!ref.current || !scrollRef.current) return
    setTimeout(() => {
      ref.current?.measureLayout(
        scrollRef.current as any,
        (_x, y) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true })
        },
        () => {}
      )
    }, 300)
  }, [])

  useEffect(() => {
    if (Platform.OS !== 'ios') return
    const sub = Keyboard.addListener('keyboardWillHide', () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true })
    })
    return () => sub.remove()
  }, [])

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safeArea: {
          flex: 1,
          backgroundColor: bgColor,
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
          padding: 20,
          paddingBottom: 120,
          flexGrow: 1,
        },
        footer: {
          alignItems: 'center' as const,
          paddingTop: 12,
          paddingBottom: 16,
        },
        buttonInner: {
          width: '42%' as any,
          minWidth: 148,
        },
      }),
    [bgColor]
  )

  const updateField = (field: keyof RCardFormInput) => (value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const handleSubmit = async () => {
    const validation = validateRCardForm(formState)
    if (!validation.isValid) {
      setErrors(validation.errors)
      return
    }

    setSubmitting(true)
    try {
      const template = buildRCardTemplate(formState)

      if (!agent) {
        dispatch({ type: DispatchAction.R_CARD_TEMPLATE_STAGED, payload: [template] })
        dispatch({ type: DispatchAction.DID_SETUP_R_CARD })

        const formData = extractFormInputFromJCard(template.jcard)
        bifoldLoggerInstance.info(
          'R-card onboarding completed (staged in state, will migrate to Credo when agent is ready)',
          {
            id: template.id,
            templateId: template.templateId,
            label: template.label,
            firstName: formData.firstName,
            lastName: formData.lastName,
            email: formData.email,
            organization: formData.organization,
            storedInCredo: false,
            timestamp: new Date().toISOString(),
          }
        )
      } else {
        const persisted = await storeRCardTemplate(template, agent)

        if (!persisted) {
          bifoldLoggerInstance.warn('Failed to persist R-card to Credo, staging for later migration', {
            id: template.id,
            templateId: template.templateId,
          })
          dispatch({ type: DispatchAction.R_CARD_TEMPLATE_STAGED, payload: [template] })
        } else {
          dispatch({ type: DispatchAction.R_CARD_CREDENTIAL_SYNCED, payload: [template] })
          const formData = extractFormInputFromJCard(template.jcard)
          bifoldLoggerInstance.info('R-card onboarding completed successfully', {
            id: template.id,
            templateId: template.templateId,
            label: template.label,
            firstName: formData.firstName,
            lastName: formData.lastName,
            email: formData.email,
            organization: formData.organization,
            storedInCredo: true,
            timestamp: new Date().toISOString(),
          })
        }

        dispatch({ type: DispatchAction.DID_SETUP_R_CARD })
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error))
      bifoldLoggerInstance.error(
        'Error during R-card credential storage',
        {
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          agentAvailable: !!agent,
        },
        errorObj
      )
      setErrorModal(t('RCardOnboarding.Errors.Generic'))
    } finally {
      setSubmitting(false)
    }
  }

  const fieldError = (field: keyof RCardFormInput) => {
    const errorKey = errors[field]
    if (!errorKey) {
      return null
    }

    const translatedMessage = String(t(errorKey as any))

    return (
      <InlineErrorText message={translatedMessage} inlineType={InlineErrorType.error} config={INLINE_ERROR_CONFIG} />
    )
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 20}
      >
        <View style={styles.cardWrapper}>
          <View style={styles.card}>
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={styles.cardContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              showsVerticalScrollIndicator={false}
            >
              <ThemedText style={{ fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 4 }}>
                {t('RCardOnboarding.Title')}
              </ThemedText>
              <ThemedText style={{ textAlign: 'center', fontSize: 17, marginBottom: 16, lineHeight: 23 }}>
                {t('RCardOnboarding.Legend')}
              </ThemedText>
              <ThemedText style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
                <Text style={{ color: ColorPalette.brand.inlineError }}>*</Text>
                {' Required'}
              </ThemedText>
              <View>
                <LimitedTextInput
                  showLimitCounter={false}
                  label={[
                    t('RCardOnboarding.Fields.FirstName'),
                    <Text key="firstNameRequired" style={{ color: ColorPalette.brand.inlineError }}>
                      {' *'}
                    </Text>,
                  ]}
                  limit={64}
                  defaultValue={formState.firstName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  handleChangeText={updateField('firstName')}
                  testID={testIdWithKey('RCardFirstNameInput')}
                  accessibilityLabel={t('RCardOnboarding.Fields.FirstName')}
                  returnKeyType="next"
                  onSubmitEditing={() => lastNameRef.current?.focus()}
                  blurOnSubmit={false}
                />
                {fieldError('firstName')}
                <LimitedTextInput
                  ref={lastNameRef}
                  showLimitCounter={false}
                  label={[
                    t('RCardOnboarding.Fields.LastName'),
                    <Text key="lastNameRequired" style={{ color: ColorPalette.brand.inlineError }}>
                      {' *'}
                    </Text>,
                  ]}
                  limit={64}
                  defaultValue={formState.lastName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  handleChangeText={updateField('lastName')}
                  testID={testIdWithKey('RCardLastNameInput')}
                  accessibilityLabel={t('RCardOnboarding.Fields.LastName')}
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  blurOnSubmit={false}
                />
                {fieldError('lastName')}
                <LimitedTextInput
                  ref={emailRef}
                  showLimitCounter={false}
                  label={t('RCardOnboarding.Fields.Email')}
                  limit={120}
                  defaultValue={formState.email}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                  handleChangeText={updateField('email')}
                  testID={testIdWithKey('RCardEmailInput')}
                  accessibilityLabel={t('RCardOnboarding.Fields.Email')}
                  returnKeyType="next"
                  onSubmitEditing={() => orgRef.current?.focus()}
                  blurOnSubmit={false}
                  onFocus={() => scrollToInput(emailRef)}
                />
                {fieldError('email')}
                <LimitedTextInput
                  ref={orgRef}
                  showLimitCounter={false}
                  label={t('RCardOnboarding.Fields.Organization')}
                  limit={120}
                  defaultValue={formState.organization}
                  autoCapitalize="words"
                  handleChangeText={updateField('organization')}
                  testID={testIdWithKey('RCardOrganizationInput')}
                  accessibilityLabel={t('RCardOnboarding.Fields.Organization')}
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  onFocus={() => scrollToInput(orgRef)}
                />
                {fieldError('organization')}
              </View>
            </ScrollView>
          </View>
        </View>
        <View style={styles.footer}>
          <View style={styles.buttonInner}>
            <Button
              title={t('Global.Continue')}
              buttonType={ButtonType.Primary}
              onPress={handleSubmit}
              accessibilityLabel={t('Global.Continue')}
              testID={testIdWithKey('RCardSubmit')}
              disabled={submitting}
            >
              {submitting && <ButtonLoading />}
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>
      {errorModal && (
        <PopupModal
          title={t('Global.SomethingWentWrong')}
          description={errorModal}
          notificationType={InfoBoxType.Error}
          onCallToActionLabel={t('Global.Okay')}
          onCallToActionPressed={() => setErrorModal(undefined)}
        />
      )}
    </SafeAreaView>
  )
}

export default RCardOnboarding
