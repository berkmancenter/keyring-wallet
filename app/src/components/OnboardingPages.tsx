import { ITheme, createStyles, GenericFn, Link } from '@bifold/core'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'

import OnboardingIcon from '../assets/img/onboarding-handshake.svg'
import PassIcon from '../assets/img/onboarding-pass.svg'
import NetworkIcon from '../assets/img/onboarding-network.svg'
import AccessControlIcon from '../assets/img/onboarding-access-control.svg'

const KEYRING_PROJECT_URL = 'https://asml.cyber.harvard.edu/advanced-digital-identity/'

const ICON_SIZE = 88
const CIRCLE_SIZE = 180
const CIRCLE_COLOR = 'rgba(163, 73, 164, 0.18)'

const slideStyles = StyleSheet.create({
  scrollView: {
    paddingTop: 24,
    paddingBottom: 36,
    paddingHorizontal: 36,
    flexGrow: 1,
    justifyContent: 'center',
  },
  imageContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: CIRCLE_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    marginBottom: 20,
  },
})

const CreatePage = (
  titleKey: string,
  bodyKey: string,
  theme: ITheme['OnboardingTheme'],
  IconComponent: React.FC<any> = OnboardingIcon,
  iconProps?: Record<string, any>,
  extra?: React.ReactNode
) => {
  const { t } = useTranslation()
  const defaultStyle = createStyles(theme)
  const imageDisplayOptions = {
    fill: theme.imageDisplayOptions.fill,
    height: ICON_SIZE,
    width: ICON_SIZE,
    ...iconProps,
  }

  return (
    <ScrollView contentContainerStyle={slideStyles.scrollView}>
      <View style={slideStyles.imageContainer}>
        <View style={slideStyles.iconCircle}>
          <IconComponent {...imageDisplayOptions} />
        </View>
      </View>
      <View style={slideStyles.textContainer}>
        <Text style={[defaultStyle.headerText, { fontSize: 24, textAlign: 'center' }]}>{t(titleKey)}</Text>
        <Text style={[defaultStyle.bodyText, { marginTop: 14, textAlign: 'center' }]}>{t(bodyKey)}</Text>
        {extra}
      </View>
    </ScrollView>
  )
}

const WelcomePage = (theme: ITheme['OnboardingTheme'], iconStrokeProps?: Record<string, any>) => {
  const { t } = useTranslation()
  const onPressProjectLink = () => {
    Linking.openURL(KEYRING_PROJECT_URL)
  }

  return CreatePage(
    'Onboarding.WelcomeHeading',
    'Onboarding.WelcomeParagraph',
    theme,
    OnboardingIcon,
    iconStrokeProps,
    <Link
      style={{ marginTop: 20, alignSelf: 'center' }}
      onPress={onPressProjectLink}
      linkText={t('Onboarding.LearnMoreLink')}
    />
  )
}

const strokeProps = (viewBoxSize: number, fill: string) => ({
  stroke: fill,
  strokeWidth: 0.8 * (viewBoxSize / ICON_SIZE),
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
})

export const pages = (_onTutorialCompleted: GenericFn, theme: ITheme['OnboardingTheme']): Array<Element> => {
  const fill = theme.imageDisplayOptions.fill
  return [
    WelcomePage(theme, strokeProps(512, fill)),
    CreatePage(
      'Onboarding.CredentialsHeading',
      'Onboarding.CredentialsParagraph',
      theme,
      PassIcon,
      strokeProps(24, fill)
    ),
    CreatePage(
      'Onboarding.ConnectionsHeading',
      'Onboarding.ConnectionsParagraph',
      theme,
      NetworkIcon,
      strokeProps(536, fill)
    ),
    CreatePage(
      'Onboarding.SecurityHeading',
      'Onboarding.SecurityParagraph',
      theme,
      AccessControlIcon,
      strokeProps(64, fill)
    ),
  ]
}
