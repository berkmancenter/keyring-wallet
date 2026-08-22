import { BannerMessage } from '../components/views/Banner'
import { RCardTemplate } from '../modules/vrc/types/rcard'

export interface Onboarding {
  didSeePreface: boolean
  didCompleteTutorial: boolean
  didAgreeToTerms: boolean | string
  didCreatePIN: boolean
  didConsiderBiometry: boolean
  didConsiderPushNotifications: boolean
  didNameWallet: boolean
  didSetupRCard: boolean
  onboardingVersion: number
  didCompleteOnboarding: boolean
}

export interface Migration {
  didMigrateToAskar: boolean
}

export interface Preferences {
  useBiometry: boolean
  usePushNotifications: boolean
  biometryPreferencesUpdated: boolean
  developerModeEnabled: boolean
  useVerifierCapability?: boolean
  useConnectionInviterCapability?: boolean
  useDevVerifierTemplates?: boolean
  enableWalletNaming: boolean
  walletName: string
  acceptDevCredentials: boolean
  useDataRetention: boolean
  useHardwareAttestation: boolean
  disableDataRetentionOption?: boolean
  preventAutoLock: boolean
  enableShareableLink: boolean
  alternateContactNames: Record<string, string>
  autoLockTime?: number
  theme?: string
  selectedMediator: string
  availableMediators: string[]
  bannerMessages: BannerMessage[]
  genericErrorMessages: boolean
  useWitnessing: boolean
  /**
   * Locality confirmation (docs/plans/locality-plan.md §8.1) — default TRUE,
   * in the store default below AND everywhere this is read from
   * AsyncStorage (vrc-manager.ts's `useHardwareAttestation` reads it with
   * `?? true` while the store here defaults it to `false` — two different
   * defaults for the same flag, reported as keyring-bifold#38. Do not repeat
   * that pattern for this flag.)
   */
  useLocalityConfirmation: boolean
  /**
   * Whether the witness-connect pre-flight sheet (docs/plans/locality-plan.md
   * §8.4 row 2, §10.3 item 8) has already been shown once this install.
   * Default false everywhere — no split-default risk here, unlike
   * `useLocalityConfirmation` above, because both the store default and
   * every read of this flag agree it starts false.
   */
  hasSeenLocalityPreflight: boolean
}

export interface Tours {
  seenToursPrompt: boolean
  enableTours: boolean
  seenHomeTour: boolean
  seenCredentialsTour: boolean
  seenCredentialOfferTour: boolean
  seenContactOfferTour: boolean
  seenProofRequestTour: boolean
  seenContactsTour: boolean
  [key: `seen${string}Tour`]: boolean
}

export interface Lockout {
  displayNotification: boolean
}

export interface LoginAttempt {
  lockoutDate?: number
  servedPenalty: boolean
  loginAttempts: number
}

export interface Authentication {
  didAuthenticate: boolean
}

export interface Attestation {
  isAttestationComplete: boolean
}

/**
 * Represents information about latest the
 * available version of the application.
 */
export type VersionInfo = {
  needsUpdate: boolean
  lastChecked?: Date
  version?: string
  dismissed?: boolean
}

export interface State {
  stateLoaded: boolean
  onboarding: Onboarding
  authentication: Authentication
  lockout: Lockout
  loginAttempt: LoginAttempt
  preferences: Preferences
  tours: Tours
  deepLink?: string
  migration: Migration
  versionInfo: VersionInfo
  attestation: Attestation
  rCard: RCardState
  witness: WitnessSettings
}

export interface RCardState {
  template?: RCardTemplate
  lastSyncedAt?: string
}

export interface WitnessSettings {
  activeWitnessConnectionId?: string
  /**
   * Whether the user has opted in to reporting witnessed exchange activity.
   * When true, the app sends a stable per-witness reportingDid to the witness
   * server, and includes it in VP submissions. Defaults to true.
   */
  enableReporting: boolean
  /**
   * Map of witnessConnectionId → reportingDid.
   * One unique did:peer is generated per witness to limit cross-witness
   * correlation (privacy-by-design). Persisted so that reconnecting to the
   * same witness reuses the same reportingDid.
   */
  reportingDids: Record<string, string>
}

export type PersistentState = {
  MigrationState: Migration
  OnboardingState: Onboarding
  PreferencesState: Preferences
  historySettingsOption: boolean // TODO: Migrate to proper name (Caps)
  language: string // TODO: Migrate to proper name (Caps)
  Lockout: string
}
