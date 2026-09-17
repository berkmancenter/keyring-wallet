import { Locales } from '../localization'
import { AttemptLockoutConfig } from './attempt-lockout-config'
import { ContactDetailsOptionsParams } from './contact-details'
import { PINSecurityParams } from './security'
import { SettingSection } from './settings'
import { Agent } from '@credo-ts/core'
import { StackNavigationOptions } from '@react-navigation/stack'
interface PushNotificationConfiguration {
  // function to get the current push notification permission status
  status: () => Promise<'denied' | 'granted' | 'unknown'>
  // function to request permission for push notifications
  setup: () => Promise<'denied' | 'granted' | 'unknown'>
  //function to call when the user changes the push notification setting
  toggle: (state: boolean, agent: Agent<any>) => Promise<void>
}

interface AppUpdateConfig {
  appleAppStoreUrl: string
  googlePlayStoreUrl: string
}

export interface Config {
  PINSecurity: PINSecurityParams
  proofTemplateBaseUrl?: string
  settings: SettingSection[]
  supportedLanguages: Locales[]
  connectionTimerDelay?: number
  autoRedirectConnectionToHome?: boolean
  enableChat?: boolean
  enableTours?: boolean
  enableImplicitInvitations?: boolean
  enableReuseConnections?: boolean
  enableHiddenDevModeTrigger?: boolean
  showPreface?: boolean
  showPINExplainer?: boolean
  disableOnboardingSkip?: boolean
  enablePushNotifications?: PushNotificationConfiguration
  whereToUseWalletUrl?: string
  showScanHelp?: boolean
  showScanButton?: boolean
  showScanErrorButton?: boolean
  globalScreenOptions?: StackNavigationOptions
  showDetailsInfo?: boolean
  contactHideList?: string[]
  contactDetailsOptions?: ContactDetailsOptionsParams
  credentialHideList?: string[]
  disableContactsInSettings?: boolean
  internetReachabilityUrls: string[]
  attemptLockoutConfig?: AttemptLockoutConfig
  appUpdateConfig?: AppUpdateConfig
  preventScreenCapture?: boolean
  PINScreensConfig: PINScreensConfig
  showGenericErrors?: boolean
  enableFullScreenErrorModal?: boolean
  enableHardwareBackedHolderBinding?: boolean
  customAutoLockTimes?: {
    default: AutoLockTimer
    values: [AutoLockTimer, ...AutoLockTimer[]]
  }
  enableAttestation: boolean
  /**
   * The VTI agent this wallet connects to: the mediator a VTA or a VTC
   * advertises, and a community to offer. Both are DIDs bound to whatever host
   * the stack runs behind, so they are deployment configuration rather than
   * anything the wallet can discover.
   */
  vti?: {
    mediatorDid?: string
    communityDid?: string
    /** The personal VTA this phone manages (§2.4 B). Enrolment binds a phone to it. */
    vtaDid?: string
    /** Where a persona minted serverlessly is served from — the VTA's own host. */
    personaBaseUrl?: string
  }
}

export interface AutoLockTimer {
  time: number
  title: string
}

export interface PINScreensConfig {
  useNewPINDesign: boolean
}

export interface HistoryEventsLoggerConfig {
  logAttestationAccepted: boolean
  logAttestationRefused: boolean
  logAttestationRemoved: boolean
  logInformationSent: boolean
  logInformationNotSent: boolean
  logConnection: boolean
  logConnectionRemoved: boolean
  logAttestationRevoked: boolean
  logPinChanged: boolean
  logToggleBiometry: boolean
}
