import {
  useTheme,
  InfoBox,
  InfoBoxType,
  testIdWithKey,
  TOKENS,
  useServices,
  BifoldError,
  useStore,
  useAuth,
  SplashProps,
} from '@bifold/core'
import { RemoteOCABundleResolver } from '@bifold/oca/build/legacy'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View, Text, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import LinearGradient from 'react-native-linear-gradient'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'

import KeyRingLogoWhite from '@assets/img/Keyring_Logo_White.svg'
import { BCState } from '@/store'

const Splash: React.FC<SplashProps> = ({ initializeAgent }) => {
  const { t } = useTranslation()
  const { walletSecret } = useAuth()
  const { ColorPalette, TextTheme, GradientTheme } = useTheme()
  const [stepText, setStepText] = useState<string>(t('Init.Starting'))
  const [store] = useStore<BCState>()
  const [currentStep, setCurrentStep] = useState(0)
  const [initAgentCount, setInitAgentCount] = useState(0)
  const [initError, setInitError] = useState<BifoldError | null>(null)
  const [reported, setReported] = useState(false)
  const initializing = useRef(false)
  const [logger, ocaBundleResolver] = useServices([TOKENS.UTIL_LOGGER, TOKENS.UTIL_OCA_RESOLVER, TOKENS.CONFIG])

  const gradientColors = GradientTheme?.headerGradient?.colors ?? ['#2E4953', '#622C62', '#6E121D']
  const gradientLocations = GradientTheme?.headerGradient?.locations ?? [0.00962, 0.50962, 1]

  const report = useCallback(() => {
    if (initError) {
      logger.report(initError)
    }
    setReported(true)
  }, [logger, initError])

  const steps: string[] = useMemo(
    () => [
      t('Init.Starting'),
      t('Init.FetchingPreferences'),
      t('Init.CheckingOCA'),
      t('Init.InitializingAgent'),
      t('Init.Finishing'),
    ],
    [t]
  )

  const setStep = useCallback(
    (stepIdx: number) => {
      setStepText(steps[stepIdx])
      setCurrentStep(stepIdx)
    },
    [steps]
  )

  useEffect(() => {
    setStep(1)
    if (initializing.current || !store.authentication.didAuthenticate) {
      return
    }

    if (!walletSecret) {
      setInitError(new BifoldError(t('Error.Title2031'), t('Error.Message2031'), 'Wallet secret is not found', 2031))
      return
    }

    const initAgentAsyncEffect = async (): Promise<void> => {
      try {
        initializing.current = true

        setStep(2)
        await (ocaBundleResolver as RemoteOCABundleResolver).checkForUpdates?.()

        setStep(3)
        await initializeAgent(walletSecret)

        setStep(4)
      } catch (e: unknown) {
        initializing.current = false

        setInitError(new BifoldError(t('Error.Title2031'), t('Error.Message2031'), (e as Error)?.message, 2031))
      }
    }

    initAgentAsyncEffect()
  }, [
    initializeAgent,
    setStep,
    ocaBundleResolver,
    initAgentCount,
    t,
    store.authentication.didAuthenticate,
    walletSecret,
  ])

  const handleErrorCallToActionPressed = useCallback(() => {
    setInitError(null)
    setInitAgentCount(initAgentCount + 1)
  }, [initAgentCount, setInitAgentCount])

  const secondaryCallToActionIcon = useMemo(
    () =>
      reported ? (
        <Icon style={{ marginRight: 8 }} name={'check-circle'} size={18} color={ColorPalette.semantic.success} />
      ) : undefined,
    [reported, ColorPalette.semantic.success]
  )

  const styles = StyleSheet.create({
    gradient: {
      flex: 1,
    },
    safeArea: {
      flex: 1,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    logoContainer: {
      alignItems: 'center',
      marginBottom: 48,
    },
    dotsContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 24,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      marginHorizontal: 6,
    },
    dotActive: {
      backgroundColor: ColorPalette.grayscale.white,
    },
    dotInactive: {
      backgroundColor: ColorPalette.brand.headerText,
      opacity: 0.2,
    },
    stepText: {
      fontFamily: TextTheme.normal.fontFamily,
      fontSize: 16,
      color: ColorPalette.brand.headerText,
      opacity: 0.7,
      textAlign: 'center',
    },
    errorScrollContent: {
      flexGrow: 1,
    },
    errorLogoSection: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    errorBoxContainer: {
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
  })

  return (
    <LinearGradient
      colors={gradientColors}
      locations={gradientLocations}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.safeArea}>
        {initError ? (
          <ScrollView contentContainerStyle={styles.errorScrollContent}>
            <View style={styles.errorLogoSection}>
              <KeyRingLogoWhite width={250} height={90} testID={testIdWithKey('LoadingActivityIndicatorImage')} />
            </View>
            <View style={styles.errorBoxContainer}>
              <InfoBox
                notificationType={InfoBoxType.Error}
                title={t('Error.Title2026')}
                description={t('Error.Message2026')}
                message={initError?.message || t('Error.Unknown')}
                onCallToActionLabel={t('Init.Retry')}
                onCallToActionPressed={handleErrorCallToActionPressed}
                secondaryCallToActionTitle={reported ? t('Error.Reported') : t('Error.ReportThisProblem')}
                secondaryCallToActionDisabled={reported}
                secondaryCallToActionIcon={secondaryCallToActionIcon}
                secondaryCallToActionPressed={initError ? report : undefined}
                showVersionFooter
              />
            </View>
          </ScrollView>
        ) : (
          <View style={styles.content} testID={testIdWithKey('LoadingActivityIndicator')}>
            <View style={styles.logoContainer}>
              <KeyRingLogoWhite width={250} height={90} testID={testIdWithKey('LoadingActivityIndicatorImage')} />
            </View>
            <View style={styles.dotsContainer}>
              {steps.map((_, index) => (
                <View key={index} style={[styles.dot, index <= currentStep ? styles.dotActive : styles.dotInactive]} />
              ))}
            </View>
            <Text style={styles.stepText}>{stepText}</Text>
          </View>
        )}
      </SafeAreaView>
    </LinearGradient>
  )
}

export default Splash
