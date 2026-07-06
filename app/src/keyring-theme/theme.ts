import {
  ImageAssets as BifoldImageAssets,
  ISpacing,
  IInputs,
  IInlineInputMessage,
  ITextTheme,
  IBrandColors,
  ISemanticColors,
  INotificationColors,
  IGrayscaleColors,
  IColorPalette,
  ITabTheme,
  IAssets,
  IGradientTheme,
  bifoldTheme,
  ThemeBuilder,
} from '@bifold/core'
import React from 'react'
import { StyleSheet, ViewStyle } from 'react-native'

import Logo from '@assets/img/Keyring_Logo.svg'
import SecurePIN from '@assets/img/secure-pin.svg'
import WalletIcon from '@assets/img/setup-wallet.svg'
import TabMessageIcon from '@assets/img/tab-message.svg'
import TabConnectionsIcon from '@assets/img/tab-connections.svg'
import TabWalletIcon from '@assets/img/tab-wallet.svg'
import TabQRCodeIcon from '@assets/img/tab-qrcode.svg'
import TabMenuIcon from '@assets/img/tab-menu.svg'
import WalletBack from '@assets/img/wallet-back.svg'
import WalletFront from '@assets/img/wallet-front.svg'
import CredentialCard from '@assets/img/credential-card.svg'
import WalletExportIcon from '@assets/img/wallet-export.svg'
import WalletImportIcon from '@assets/img/wallet-import.svg'
import { KeyRingThemeNames } from '@/constants'
import GradientHeaderBackground from './components/GradientHeaderBackground'

export const maxFontSizeMultiplier = 2
export const borderRadius = 4
export const heavyOpacity = 0.7
export const mediumOpacity = 0.5
export const lightOpacity = 0.35
export const zeroOpacity = 0.0
export const borderWidth = 2

export const Spacing: ISpacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
}

// Helper function to create color tints (lighter versions using opacity)
const lightenColor = (color: string, opacity: number): string => {
  return `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(
    color.slice(5, 7),
    16
  )}, ${opacity})`
}

// Helper function to add alpha/opacity to hex colors
const addAlphaToColor = (color: string, opacity: number): string => {
  return `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(
    color.slice(5, 7),
    16
  )}, ${opacity})`
}

// KeyRing Brand Colors (gradient palette: #2E4953 → #622C62 → #6E121D)
// Primary Palette
const BRAND_PURPLE = '#622C62' // Primary brand color (gradient purple)
const HARVARD_BLUE = '#4D7A8B' // Secondary brand color
const BKC_BLACK = '#010B13' // Primary black
const NEUTRAL_CHARCOAL_GRAY = '#4A4A4A' // Neutral gray
const NAVY_ANCHOR = '#09465B' // Dark blue variant
// Secondary Palette
const DEEP_BLUE = '#2B6073' // Deep blue
const MEDIUM_GRAY = '#666666' // Medium gray
// const CRIMSON_DEPTH = '#961A2C' // Crimson depth variant (reserved for future use)
// Interface and Extended Colors
const BRIGHT_CRIMSON = '#D21E30' // Bright crimson for errors/accents
const HARVARD_YELLOW = '#EFB243' // Yellow for highlights
// Extended colors (available for future use):
// DEEP_CRIMSON = '#7C101C' - Darker crimson variant
// ROYAL_PURPLE = '#6A0DAD'
// MUTED_PURPLE = '#7D3C98'
// ROYAL_PURPLE_SHADE = '#4A0979'

export const SemanticColors: ISemanticColors = {
  error: BRIGHT_CRIMSON, // #D21E30 - using Bright Crimson for errors
  success: '#2E8540', // Keeping green for success
  focus: HARVARD_BLUE, // #4D7A8B - using Harvard Blue for focus states
}

export const NotificationColors: INotificationColors = {
  success: '#DFF0D8',
  successBorder: '#D6E9C6',
  successIcon: '#2D4821',
  successText: '#2D4821',
  info: '#F0E6F0', // Light purple tint matching brand
  infoBorder: BRAND_PURPLE, // #622C62
  infoIcon: BRAND_PURPLE, // #622C62
  infoText: '#333333', // Dark text for readability on light purple
  warn: lightenColor(HARVARD_YELLOW, lightOpacity), // Light tint of Harvard Yellow
  warnBorder: HARVARD_YELLOW, // #EFB243
  warnIcon: '#6C4A00', // Dark yellow for contrast
  warnText: '#6C4A00',
  error: '#FDF0F1', // Opaque light pink — readable on any background including dark gradients
  errorBorder: BRIGHT_CRIMSON, // #D21E30
  errorIcon: BRIGHT_CRIMSON, // #D21E30
  errorText: '#4A0D15', // Very dark crimson for high contrast on the light pink background
  popupOverlay: 'rgba(0, 0, 0, 0.85)',
}

export const GrayscaleColors: IGrayscaleColors = {
  black: BKC_BLACK, // #010B13
  darkGrey: NEUTRAL_CHARCOAL_GRAY, // #4A4A4A
  mediumGrey: MEDIUM_GRAY, // #666666
  lightGrey: '#D3D3D3',
  veryLightGrey: '#F5F5F5', // Light tint for backgrounds
  white: '#FFFFFF',
}

export const BrandColors: IBrandColors = {
  primary: BRAND_PURPLE, // #622C62
  primaryDisabled: lightenColor(BRAND_PURPLE, heavyOpacity),
  secondary: HARVARD_BLUE, // #4D7A8B
  secondaryDisabled: lightenColor(HARVARD_BLUE, heavyOpacity),
  tertiary: DEEP_BLUE, // #2B6073
  tertiaryDisabled: lightenColor(DEEP_BLUE, heavyOpacity),
  primaryLight: lightenColor(BRAND_PURPLE, lightOpacity),
  // Highlight color - Harvard Yellow for emphasis
  highlight: HARVARD_YELLOW, // #EFB243
  // Backgrounds - using light tints and brand colors
  primaryBackground: '#F5F5F5', // Light gray matching onboarding
  secondaryBackground: GrayscaleColors.veryLightGrey, // Very light gray for secondary backgrounds
  tertiaryBackground: NAVY_ANCHOR, // #09465B - Navy Anchor for dark backgrounds
  // Modal colors
  modalPrimary: BRAND_PURPLE, // #622C62
  modalSecondary: GrayscaleColors.white,
  modalTertiary: HARVARD_BLUE, // #4D7A8B
  modalPrimaryBackground: GrayscaleColors.white,
  modalSecondaryBackground: GrayscaleColors.veryLightGrey,
  modalTertiaryBackground: GrayscaleColors.white,
  modalIcon: NEUTRAL_CHARCOAL_GRAY, // #4A4A4A
  // Link color - using Harvard Blue
  link: HARVARD_BLUE, // #4D7A8B
  credentialLink: HARVARD_BLUE, // #4D7A8B
  // Text and icon colors
  unorderedList: NEUTRAL_CHARCOAL_GRAY, // #4A4A4A
  unorderedListModal: NEUTRAL_CHARCOAL_GRAY, // #4A4A4A
  text: BKC_BLACK, // #010B13 for dark text on light backgrounds
  icon: NEUTRAL_CHARCOAL_GRAY, // #4A4A4A
  headerIcon: GrayscaleColors.white, // White for headers on dark backgrounds
  headerText: GrayscaleColors.white, // White for headers on dark backgrounds
  buttonText: GrayscaleColors.white, // White text on colored buttons
  tabBarInactive: MEDIUM_GRAY, // #666666
  inlineError: SemanticColors.error,
  inlineWarning: NotificationColors.warnText,
  // New in bifold 3.x IBrandColors
  credentialCardPlaceholderBackground: GrayscaleColors.veryLightGrey,
  credentialCardStatusBadgeErrorBackground: '#FDECEA',
  credentialCardStatusBadgeErrorIcon: BKC_BLACK,
  credentialCardStatusBadgeWarningBackground: '#FFF8E1',
  credentialCardStatusBadgeWarningIcon: BKC_BLACK,
  loadingIcon: GrayscaleColors.white,
}

export const ColorPalette: IColorPalette = {
  brand: BrandColors,
  semantic: SemanticColors,
  notification: NotificationColors,
  grayscale: GrayscaleColors,
}

export const TextTheme: ITextTheme = {
  headingOne: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 38,
    fontWeight: 'bold',
    color: ColorPalette.grayscale.darkGrey,
  },
  headingTwo: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 32,
    fontWeight: 'bold',
    color: ColorPalette.grayscale.darkGrey,
  },
  headingThree: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 26,
    fontWeight: 'bold',
    color: ColorPalette.grayscale.darkGrey,
  },
  headingFour: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 21,
    fontWeight: 'bold',
    color: ColorPalette.grayscale.darkGrey,
  },
  normal: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 18,
    fontWeight: 'normal',
    color: ColorPalette.grayscale.darkGrey,
  },
  bold: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 18,
    fontWeight: 'bold',
    color: ColorPalette.grayscale.darkGrey,
  },
  label: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 14,
    fontWeight: 'bold',
    color: ColorPalette.grayscale.darkGrey,
  },
  labelTitle: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 16,
    fontWeight: 'bold',
    color: ColorPalette.grayscale.darkGrey,
  },
  labelSubtitle: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 14,
    fontWeight: 'normal',
    color: ColorPalette.grayscale.darkGrey,
  },
  labelText: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 10,
    fontWeight: 'normal',
    fontStyle: 'italic',
    color: ColorPalette.grayscale.darkGrey,
  },
  caption: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 14,
    fontWeight: 'normal',
    color: ColorPalette.grayscale.darkGrey,
  },
  title: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 20,
    fontWeight: 'bold',
    color: ColorPalette.notification.infoText,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: ColorPalette.brand.headerText,
  },
  modalNormal: {
    fontSize: 18,
    fontWeight: 'normal',
    color: ColorPalette.grayscale.darkGrey,
  },
  modalTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: ColorPalette.grayscale.darkGrey,
  },
  modalHeadingOne: {
    fontSize: 38,
    color: ColorPalette.grayscale.darkGrey,
  },
  modalHeadingThree: {
    fontSize: 26,
    color: ColorPalette.grayscale.darkGrey,
  },
  popupModalText: {
    fontSize: 18,
    fontWeight: 'normal',
    color: ColorPalette.grayscale.darkGrey,
  },
  settingsText: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 21,
    fontWeight: 'normal',
    color: ColorPalette.grayscale.darkGrey,
  },
  inlineErrorText: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 16,
    fontWeight: 'normal',
    color: ColorPalette.notification.errorText,
  },
  inlineWarningText: {
    fontFamily: 'SourceSans3-Regular',
    fontSize: 16,
    fontWeight: 'normal',
    color: ColorPalette.notification.warnText,
  },
}

export const Inputs: IInputs = StyleSheet.create({
  label: {
    ...TextTheme.label,
  },
  textInput: {
    padding: 10,
    borderRadius,
    fontFamily: TextTheme.normal.fontFamily,
    fontSize: 16,
    backgroundColor: ColorPalette.grayscale.lightGrey,
    color: TextTheme.normal.color,
    borderWidth: 1,
    borderColor: ColorPalette.grayscale.lightGrey,
  },
  inputSelected: {
    borderColor: TextTheme.normal.color,
  },
  singleSelect: {
    padding: 12,
    borderRadius: borderRadius * 2,
    backgroundColor: ColorPalette.brand.secondaryBackground,
  },
  singleSelectText: {
    ...TextTheme.normal,
  },
  singleSelectIcon: {
    color: ColorPalette.brand.text,
  },
  checkBoxColor: {
    color: ColorPalette.brand.primary,
  },
  checkBoxText: {
    ...TextTheme.normal,
  },
})

export const Buttons = StyleSheet.create({
  critical: {
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#D8292F',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 4,
    shadowOpacity: 0.15,
    elevation: 4,
  },
  primary: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: ColorPalette.brand.primary,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 4,
    shadowOpacity: 0.15,
    elevation: 4,
  },
  primaryDisabled: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: ColorPalette.brand.primaryDisabled,
  },
  primaryText: {
    ...TextTheme.normal,
    fontWeight: 'bold',
    color: ColorPalette.brand.buttonText,
    textAlign: 'center',
    lineHeight: 24,
  },
  primaryTextDisabled: {
    ...TextTheme.normal,
    fontWeight: 'bold',
    color: ColorPalette.brand.buttonText,
    textAlign: 'center',
    lineHeight: 24,
  },
  secondary: {
    padding: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: ColorPalette.brand.primary,
  },
  secondaryDisabled: {
    padding: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: ColorPalette.brand.secondaryDisabled,
  },
  secondaryText: {
    ...TextTheme.normal,
    fontWeight: 'bold',
    color: ColorPalette.brand.primary,
    textAlign: 'center',
    lineHeight: 24,
  },
  secondaryTextDisabled: {
    ...TextTheme.normal,
    fontWeight: 'bold',
    color: ColorPalette.brand.secondaryDisabled,
    textAlign: 'center',
    lineHeight: 24,
  },
  modalCritical: {
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#D8292F',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 4,
    shadowOpacity: 0.15,
    elevation: 4,
  },
  modalPrimary: {
    padding: 16,
    borderRadius: 10,
    backgroundColor: ColorPalette.brand.primary,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 4,
    shadowOpacity: 0.15,
    elevation: 4,
  },
  modalPrimaryText: {
    ...TextTheme.normal,
    fontWeight: 'bold',
    textAlign: 'center',
    color: ColorPalette.brand.buttonText,
    lineHeight: 24,
  },
  modalSecondary: {
    padding: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: ColorPalette.brand.primary,
  },
  modalSecondaryText: {
    ...TextTheme.normal,
    fontWeight: 'bold',
    color: ColorPalette.brand.primary,
    textAlign: 'center',
    lineHeight: 24,
  },
  modalTertiary: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: HARVARD_BLUE,
    backgroundColor: addAlphaToColor(HARVARD_BLUE, 0.2),
    minHeight: 55,
    justifyContent: 'center' as ViewStyle['justifyContent'],
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 4,
    shadowOpacity: 0.15,
    elevation: 4,
  },
  modalTertiaryDisabled: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: addAlphaToColor(HARVARD_BLUE, 0.5),
    backgroundColor: addAlphaToColor(HARVARD_BLUE, 0.1),
    minHeight: 55,
    justifyContent: 'center' as ViewStyle['justifyContent'],
  },
  modalTertiaryText: {
    ...TextTheme.normal,
    fontWeight: 'bold',
    color: HARVARD_BLUE,
    textAlign: 'center',
    lineHeight: 24,
  },
  modalTertiaryTextDisabled: {
    ...TextTheme.normal,
    fontWeight: 'bold',
    color: addAlphaToColor(HARVARD_BLUE, 0.5),
    textAlign: 'center',
    lineHeight: 24,
  },
})

export const ListItems = StyleSheet.create({
  credentialBackground: {
    backgroundColor: ColorPalette.brand.secondaryBackground,
  },
  credentialTitle: {
    ...TextTheme.headingFour,
  },
  credentialDetails: {
    ...TextTheme.caption,
  },
  credentialOfferBackground: {
    backgroundColor: ColorPalette.brand.modalPrimaryBackground,
  },
  credentialOfferTitle: {
    ...TextTheme.modalHeadingThree,
  },
  credentialOfferDetails: {
    ...TextTheme.normal,
  },
  revoked: {
    backgroundColor: ColorPalette.notification.error,
    borderColor: ColorPalette.notification.errorBorder,
  },
  contactBackground: {
    backgroundColor: ColorPalette.brand.secondaryBackground,
  },
  credentialIconColor: {
    color: ColorPalette.notification.infoText,
  },
  contactTitle: {
    fontFamily: TextTheme.title.fontFamily,
    color: ColorPalette.grayscale.darkGrey,
  },
  contactDate: {
    fontFamily: TextTheme.normal.fontFamily,
    color: ColorPalette.grayscale.darkGrey,
    marginTop: 10,
  },
  contactIconBackground: {
    backgroundColor: ColorPalette.brand.primary,
  },
  contactIcon: {
    color: ColorPalette.brand.text,
  },
  recordAttributeLabel: {
    ...TextTheme.bold,
  },
  recordContainer: {
    backgroundColor: ColorPalette.brand.secondaryBackground,
  },
  recordBorder: {
    borderBottomColor: ColorPalette.brand.primaryBackground,
  },
  recordLink: {
    color: ColorPalette.brand.link,
  },
  recordAttributeText: {
    ...TextTheme.normal,
  },
  proofIcon: {
    ...TextTheme.headingOne,
  },
  proofError: {
    color: ColorPalette.semantic.error,
  },
  proofListItem: {
    paddingHorizontal: 25,
    paddingTop: 16,
    backgroundColor: ColorPalette.brand.primaryBackground,
    borderTopColor: ColorPalette.brand.secondaryBackground,
    borderBottomColor: ColorPalette.brand.secondaryBackground,
    borderTopWidth: 2,
    borderBottomWidth: 2,
  },
  avatarText: {
    ...TextTheme.headingTwo,
    fontWeight: 'normal',
  },
  avatarCircle: {
    borderRadius: TextTheme.headingTwo.fontSize,
    borderColor: ColorPalette.grayscale.lightGrey,
    width: TextTheme.headingTwo.fontSize * 2,
    height: TextTheme.headingTwo.fontSize * 2,
  },
  emptyList: {
    ...TextTheme.normal,
  },
  requestTemplateBackground: {
    backgroundColor: ColorPalette.grayscale.white,
  },
  requestTemplateIconColor: {
    color: ColorPalette.notification.infoText,
  },
  requestTemplateTitle: {
    color: ColorPalette.grayscale.black,
    fontWeight: 'bold',
  },
  requestTemplateDetails: {
    color: ColorPalette.grayscale.black,
    fontWeight: 'normal',
  },
  requestTemplateZkpLabel: {
    color: ColorPalette.grayscale.mediumGrey,
  },
  requestTemplateIcon: {
    color: ColorPalette.grayscale.black,
  },
  requestTemplateDate: {
    color: ColorPalette.grayscale.mediumGrey,
  },
})

export const TabTheme: ITabTheme = {
  tabBarStyle: {
    height: 55,
    backgroundColor: BKC_BLACK,
    shadowOffset: { width: 0, height: -3 },
    shadowRadius: 6,
    shadowColor: ColorPalette.grayscale.black,
    shadowOpacity: 0.1,
    borderTopWidth: 0,
    paddingBottom: 0,
  },
  tabBarContainerStyle: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBarActiveTintColor: ColorPalette.grayscale.white,
  tabBarInactiveTintColor: ColorPalette.grayscale.mediumGrey,
  tabBarTextStyle: {
    ...TextTheme.label,
    fontWeight: 'normal',
    paddingBottom: 5,
    color: ColorPalette.grayscale.white,
  },
  tabBarButtonIconStyle: {
    color: ColorPalette.grayscale.white,
  },
  focusTabIconStyle: {
    height: 60,
    width: 60,
    backgroundColor: ColorPalette.brand.primary,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  focusTabActiveTintColor: {
    backgroundColor: ColorPalette.brand.secondary,
  },
  tabBarSecondaryBackgroundColor: BKC_BLACK,
}

export const NavigationTheme = {
  dark: true,
  colors: {
    primary: ColorPalette.brand.primary,
    background: ColorPalette.brand.primaryBackground,
    card: ColorPalette.brand.primary,
    text: ColorPalette.brand.text,
    border: ColorPalette.grayscale.white,
    notification: ColorPalette.grayscale.white,
  },
}

export const HomeTheme = StyleSheet.create({
  welcomeHeader: {
    ...TextTheme.headingOne,
  },
  credentialMsg: {
    ...TextTheme.normal,
  },
  notificationsHeader: {
    ...TextTheme.headingThree,
  },
  noNewUpdatesText: {
    ...TextTheme.normal,
    color: ColorPalette.notification.infoText,
  },
  link: {
    ...TextTheme.normal,
    color: ColorPalette.brand.link,
  },
})

export const SettingsTheme = {
  groupHeader: {
    ...TextTheme.normal,
    marginBottom: 8,
  },
  groupBackground: '#F5F5F5',
  iconColor: ColorPalette.grayscale.darkGrey,
  text: {
    ...TextTheme.caption,
    color: ColorPalette.grayscale.darkGrey,
  },
}

export const ChatTheme = {
  containerStyle: {
    marginBottom: 16,
    marginLeft: 16,
    marginRight: 16,
    flexDirection: 'column' as const,
    alignItems: 'flex-start' as const,
    alignSelf: 'flex-end' as const,
  },
  // Left bubble (incoming messages from them) - light gray with tail on top-left
  leftBubble: {
    backgroundColor: '#D9D9D9', // Light gray
    borderTopLeftRadius: 0, // Square corner = tail pointing to sender (top-left)
    borderTopRightRadius: 12,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  // Right bubble (outgoing messages from me) - brand purple with tail on top-right
  rightBubble: {
    backgroundColor: '#622C62', // Brand purple
    borderTopLeftRadius: 12,
    borderTopRightRadius: 0, // Square corner = tail pointing to sender (top-right)
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  timeStyleLeft: {
    color: '#888888', // Design specified color for timestamps
    fontSize: 12,
    marginTop: 4,
    marginBottom: 0,
    paddingBottom: 0,
  },
  timeStyleRight: {
    color: '#888888', // Design specified color for timestamps
    fontSize: 12,
    marginTop: 4,
    marginBottom: 0,
    paddingBottom: 0,
  },
  // Left text (incoming) - black text on light gray background
  leftText: {
    color: '#000000',
    fontSize: TextTheme.normal.fontSize,
  },
  leftTextHighlighted: {
    color: '#000000',
    fontSize: TextTheme.normal.fontSize,
    fontWeight: 'bold' as const,
  },
  // Right text (outgoing) - white text on purple background
  rightText: {
    color: ColorPalette.grayscale.white,
    fontSize: TextTheme.normal.fontSize,
  },
  rightTextHighlighted: {
    color: ColorPalette.grayscale.white,
    fontSize: TextTheme.normal.fontSize,
    fontWeight: 'bold' as const,
  },
  inputToolbar: {
    backgroundColor: ColorPalette.brand.secondary,
    shadowColor: ColorPalette.brand.primaryDisabled,
    borderRadius: 10,
  },
  inputText: {
    lineHeight: undefined,
    fontWeight: '500' as const,
    fontSize: TextTheme.normal.fontSize,
    color: 'black',
  },
  placeholderText: ColorPalette.grayscale.lightGrey,
  sendContainer: {
    marginBottom: 4,
    paddingHorizontal: 4,
    justifyContent: 'center' as const,
  },
  sendEnabled: ColorPalette.brand.primary,
  sendDisabled: ColorPalette.brand.primaryDisabled,
  options: ColorPalette.brand.primary,
  optionsText: ColorPalette.grayscale.black,
  openButtonStyle: {
    borderRadius: 32,
    backgroundColor: ColorPalette.brand.primary,
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 16,
    paddingRight: 16,
    marginTop: 16,
  },
  openButtonTextStyle: {
    color: ColorPalette.grayscale.white, // White text on crimson button
    fontSize: TextTheme.normal.fontSize,
    fontWeight: 'bold' as const,
    textAlign: 'center' as const,
  },
  documentIconContainer: {
    alignSelf: 'flex-start' as const,
    marginBottom: 8,
  },
  documentIcon: {
    color: ColorPalette.grayscale.white,
  },
}

export const OnboardingTheme = {
  container: {
    backgroundColor: '#F5F5F5',
  },
  carouselContainer: {
    backgroundColor: 'transparent',
  },
  pagerDot: {
    borderWidth: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  pagerDotActive: {
    color: '#A349A4',
  },
  pagerDotInactive: {
    color: '#D9D9D9',
  },
  pagerNavigationButton: {
    color: ColorPalette.brand.primary,
    fontWeight: 'bold' as const,
    fontSize: 18,
  },
  headerTintColor: ColorPalette.grayscale.white,
  headerText: {
    ...TextTheme.headingTwo,
    color: ColorPalette.notification.infoText,
  },
  bodyText: {
    ...TextTheme.normal,
    color: ColorPalette.notification.infoText,
  },
  imageDisplayOptions: {
    fill: '#000000',
  },
}

export const DialogTheme = {
  modalView: {
    backgroundColor: ColorPalette.brand.secondaryBackground,
  },
  titleText: {
    color: ColorPalette.grayscale.white,
  },
  description: {
    color: ColorPalette.grayscale.white,
  },
  closeButtonIcon: {
    color: ColorPalette.grayscale.white,
  },
  carouselButtonText: {
    color: ColorPalette.grayscale.white,
  },
}

export const LoadingTheme = {
  backgroundColor: ColorPalette.brand.primary,
}

export const PINEnterTheme = {
  image: {
    alignSelf: 'center',
    marginBottom: 20,
  },
}
export const PINInputTheme = {
  cell: {
    backgroundColor: ColorPalette.grayscale.lightGrey,
    borderColor: ColorPalette.grayscale.lightGrey,
  },
  focussedCell: {
    borderColor: '#3399FF',
  },
  cellText: {
    color: ColorPalette.grayscale.darkGrey,
  },
  icon: {
    color: ColorPalette.grayscale.darkGrey,
  },
  codeFieldRoot: {
    justifyContent: 'flex-start' as const,
    alignItems: 'center' as const,
  },
  labelAndFieldContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: ColorPalette.grayscale.lightGrey,
    borderColor: ColorPalette.grayscale.lightGrey,
  },
}

export const Assets: IAssets = {
  ...BifoldImageAssets,
  img: {
    logoPrimary: {
      src: require('@assets/img/Keyring_Logo.png'),
      aspectRatio: 1,
      height: '33%',
      width: '33%',
      resizeMode: 'contain',
    },
    logoSecondary: {
      src: require('@assets/img/Keyring_Logo.png'),
      aspectRatio: 1,
      height: 120,
      width: 120,
      resizeMode: 'contain',
    },
  },
  svg: {
    ...BifoldImageAssets.svg,
    logo: Logo as React.FC,
    secureCheck: SecurePIN as React.FC,
    contactBook: WalletIcon as React.FC,
    tabFourFocusedIcon: TabMessageIcon as React.FC,
    tabFourIcon: TabMessageIcon as React.FC,
    contactsIconFocused: TabConnectionsIcon as React.FC,
    contactsIconOutline: TabConnectionsIcon as React.FC,
    tabThreeFocusedIcon: TabWalletIcon as React.FC,
    tabThreeIcon: TabWalletIcon as React.FC,
    tabTwoIcon: TabQRCodeIcon as React.FC,
    tabMenuIcon: TabMenuIcon as React.FC,
    walletBack: WalletBack as React.FC,
    walletFront: WalletFront as React.FC,
    credentialCard: CredentialCard as React.FC,
    walletExport: WalletExportIcon as React.FC,
    walletImport: WalletImportIcon as React.FC,
  },
}

export const InputInlineMessage: IInlineInputMessage = {
  inlineErrorText: { ...TextTheme.inlineErrorText },
  InlineErrorIcon: Assets.svg.iconError,
  inlineWarningText: { ...TextTheme.inlineWarningText },
  InlineWarningIcon: Assets.svg.iconWarning,
}

export const GradientTheme: IGradientTheme = {
  headerGradient: {
    colors: ['#2E4953', '#622C62', '#6E121D'],
    locations: [0.00962, 0.50962, 1],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
  },
  HeaderBackground: GradientHeaderBackground,
}

export const CredentialCardShadowTheme: ViewStyle = {
  shadowColor: ColorPalette.grayscale.black,
  shadowOffset: {
    width: 1,
    height: 1,
  },
  shadowOpacity: 0.3,
}

export const SelectedCredTheme: ViewStyle = {
  borderWidth: 5,
  borderRadius: 15,
  borderColor: ColorPalette.semantic.focus,
}

export const KeyRingTheme = new ThemeBuilder(bifoldTheme)
  .setColorPalette(ColorPalette)
  .withOverrides({
    themeName: KeyRingThemeNames.KeyRing,
    Spacing,
    TextTheme,
    Buttons,
    heavyOpacity,
    borderRadius,
    borderWidth,
    Inputs,
    ListItems,
    TabTheme,
    NavigationTheme,
    HomeTheme,
    SettingsTheme,
    ChatTheme,
    OnboardingTheme,
    DialogTheme,
    LoadingTheme,
    PINEnterTheme,
    PINInputTheme,
    Assets,
    InputInlineMessage,
    CredentialCardShadowTheme,
    SelectedCredTheme,
    maxFontSizeMultiplier,
    GradientTheme,
  })
  .build()
