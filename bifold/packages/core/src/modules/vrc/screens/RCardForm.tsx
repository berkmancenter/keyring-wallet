import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat, Action as ExpoImageManipulatorAction } from 'expo-image-manipulator'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import Button, { ButtonType } from '../../../components/buttons/Button'
import ButtonLoading from '../../../components/animated/ButtonLoading'
import LimitedTextInput from '../../../components/inputs/LimitedTextInput'
import InlineErrorText, { InlineErrorType } from '../../../components/inputs/InlineErrorText'
import PopupModal from '../../../components/modals/PopupModal'
import { InfoBoxType } from '../../../components/misc/InfoBox'
import { useTheme } from '../../../contexts/theme'
import { bifoldLoggerInstance } from '../../../services/bifoldLogger'
import { RCardFormInput, RCardValidationErrors, validateRCardForm } from '../types/rcard'
import { processRCardPhoto, RCardPhotoTooLargeError, ManipulateAsyncFn } from '../utils/rcardPhoto'
import { InlineErrorConfig } from '../../../types/error'
import { ThemedText } from '../../../components/texts/ThemedText'
import { testIdWithKey } from '../../../utils/testable'

/** Adapts expo-image-manipulator's manipulateAsync to the injectable shape processRCardPhoto expects. */
const rcardManipulateAsync: ManipulateAsyncFn = (uri, actions, saveOptions) =>
  manipulateAsync(uri, actions as ExpoImageManipulatorAction[], {
    compress: saveOptions.compress,
    base64: saveOptions.base64,
    format: SaveFormat.JPEG,
  })

export class RCardPhotoPermissionDeniedError extends Error {
  constructor() {
    super('Media library permission was not granted')
    this.name = 'RCardPhotoPermissionDeniedError'
  }
}

/**
 * Launches the image picker (cropped to a square so the resize step in
 * processRCardPhoto never distorts the image) and runs the result through the
 * resize/compress budget pipeline. Returns undefined if the user cancels.
 */
export const pickAndProcessRCardPhoto = async (): Promise<string | undefined> => {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    throw new RCardPhotoPermissionDeniedError()
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  })

  if (result.canceled || !result.assets?.[0]?.uri) {
    return undefined
  }

  return processRCardPhoto(result.assets[0].uri, rcardManipulateAsync)
}

const CARD_MARGIN = 20

const INLINE_ERROR_CONFIG: InlineErrorConfig = {
  enabled: true,
  hasErrorIcon: false,
  position: undefined,
  style: { marginTop: -4 },
}

export const EMPTY_RCARD_FORM: RCardFormInput = {
  firstName: '',
  lastName: '',
  email: '',
  organization: '',
}

export interface RCardFormProps {
  /** Pre-fills the form; defaults to an empty form when omitted (the onboarding case). */
  initialValues?: RCardFormInput
  title: string
  legend: string
  submitLabel: string
  /** Called with valid, trimmed-by-caller form input. Throw to show the generic error modal. */
  onSubmit: (input: RCardFormInput) => Promise<void>
}

const RCardForm: React.FC<RCardFormProps> = ({ initialValues, title, legend, submitLabel, onSubmit }) => {
  const { t } = useTranslation()
  const { Spacing: _Spacing, OnboardingTheme, ColorPalette } = useTheme()
  const [formState, setFormState] = useState<RCardFormInput>(initialValues ?? EMPTY_RCARD_FORM)
  const [errors, setErrors] = useState<RCardValidationErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [errorModal, setErrorModal] = useState<string | undefined>(undefined)
  const [pickingPhoto, setPickingPhoto] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  const lastNameRef = useRef<TextInput>(null)
  const emailRef = useRef<TextInput>(null)
  const orgRef = useRef<TextInput>(null)

  const bgColor = OnboardingTheme?.container?.backgroundColor || ColorPalette.brand.primaryBackground

  const scrollToInput = useCallback((ref: React.RefObject<TextInput | null>) => {
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
        photoSection: {
          alignItems: 'center',
          marginBottom: 16,
        },
        photoCircle: {
          width: 96,
          height: 96,
          borderRadius: 48,
          backgroundColor: '#E8E0E8',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        photoImage: {
          width: 96,
          height: 96,
        },
        photoActionText: {
          marginTop: 8,
          fontSize: 14,
          color: ColorPalette.brand.primary,
        },
      }),
    [bgColor, ColorPalette]
  )

  const updateField = (field: keyof RCardFormInput) => (value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const handlePickPhoto = useCallback(async () => {
    setPickingPhoto(true)
    try {
      const photo = await pickAndProcessRCardPhoto()
      if (photo) {
        setFormState((prev) => ({ ...prev, photo }))
      }
    } catch (error) {
      let message = t('RCardOnboarding.Errors.PhotoGeneric')
      if (error instanceof RCardPhotoTooLargeError) {
        message = t('RCardOnboarding.Errors.PhotoTooLarge')
      } else if (error instanceof RCardPhotoPermissionDeniedError) {
        message = t('RCardOnboarding.Errors.PhotoPermissionDenied')
      }
      bifoldLoggerInstance.warn('R-card photo selection failed', {
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      setErrorModal(message)
    } finally {
      setPickingPhoto(false)
    }
  }, [t])

  const handleRemovePhoto = useCallback(() => {
    setFormState((prev) => ({ ...prev, photo: undefined }))
  }, [])

  const handleSubmit = async () => {
    const validation = validateRCardForm(formState)
    if (!validation.isValid) {
      setErrors(validation.errors)
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(formState)
    } catch (error) {
      bifoldLoggerInstance.error(
        'RCardForm: onSubmit rejected',
        {
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error : new Error(String(error))
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
                {title}
              </ThemedText>
              <ThemedText style={{ textAlign: 'center', fontSize: 17, marginBottom: 16, lineHeight: 23 }}>
                {legend}
              </ThemedText>
              <ThemedText style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
                <Text style={{ color: ColorPalette.brand.inlineError }}>*</Text>
                {' Required'}
              </ThemedText>
              <View style={styles.photoSection}>
                <TouchableOpacity
                  onPress={handlePickPhoto}
                  disabled={pickingPhoto}
                  accessibilityRole="button"
                  accessibilityLabel={t('RCardOnboarding.Fields.Photo')}
                  testID={testIdWithKey('RCardPhotoInput')}
                >
                  <View style={styles.photoCircle}>
                    {formState.photo ? (
                      <Image
                        testID={testIdWithKey('RCardPhotoPreview')}
                        style={styles.photoImage}
                        source={{ uri: formState.photo }}
                      />
                    ) : (
                      <Icon name="account-outline" size={40} color="#666666" />
                    )}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={formState.photo ? handleRemovePhoto : handlePickPhoto} disabled={pickingPhoto}>
                  <ThemedText style={styles.photoActionText}>
                    {pickingPhoto
                      ? t('RCardOnboarding.Fields.PhotoProcessing')
                      : formState.photo
                        ? t('RCardOnboarding.Fields.PhotoRemove')
                        : t('RCardOnboarding.Fields.PhotoAdd')}
                  </ThemedText>
                </TouchableOpacity>
              </View>
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
              title={submitLabel}
              buttonType={ButtonType.Primary}
              onPress={handleSubmit}
              accessibilityLabel={submitLabel}
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

export default RCardForm
