/**
 * Verifiable Relationship Credential (VRC) Module
 *
 * This module provides functionality for creating and managing
 * relationship credentials between wallet connections.
 */

// Export types
export { RelationshipDidRecord } from './types/RelationshipDidRecord'
export type {
  RelationshipDidRecordProps,
  CustomTags,
  DefaultRelationshipDidRecordTags,
} from './types/RelationshipDidRecord'
export {
  DTG_CONTEXT_URL,
  RELATIONSHIP_CONTEXT_URL,
  DTG_CONTEXT_DOCUMENT,
  RELATIONSHIP_CONTEXT_DOCUMENT,
} from './types/relationshipContext'
export { WITNESSED_EXCHANGE_CONTEXT_URL, WITNESSED_EXCHANGE_CONTEXT_DOCUMENT } from './types/witnessedExchangeContext'

// Export evidence types
export type {
  BiometricMethod,
  HardwareBinding,
  AttestationCertificateChain,
  HardwareSignature,
  HardwareAttestationEvidence,
  BuildEvidenceInput,
  VrcCredentialWithEvidence,
} from './types/evidence'

// Export repository
export { RelationshipDidRepository } from './repositories/RelationshipDidRepository'

// Export modules
export { RelationshipDidModule } from './module/RelationshipDidModule'
export { AttestationStorageModule } from './module/AttestationStorageModule'

// Export VRC management functions
export {
  createRelationshipInvitation,
  getOrCreateRelationshipDid,
  setRelationshipDidOnConnection,
  setupVrcConnectionHandler,
  validateRelationshipCredential,
  type RelationshipCredentialValidation,
  registerWitnessSessionCallback,
  registerWitnessNotificationCallback,
  registerWitnessStateGetter,
} from './vrc-manager'

// Export VRC name helper utilities
export {
  extractIssuerFromCredential,
  isVrcCredential,
  getVrcNameForConnection,
  getVrcNameFromConnectionMetadata,
  cacheVrcNameInConnection,
} from './utils/vrcNameHelper'

// Export document loader for W3C credentials
export { createVrcDocumentLoader } from './createVrcDocumentLoader'

// Export JSON-LD context data (convenience exports for document loading)
export { DTG_CONTEXT, RELATIONSHIP_CONTEXT, WITNESSED_EXCHANGE_CONTEXT, CUSTOM_CONTEXTS } from './jsonLdDocumentLoader'

// Export logging utilities
export { createVrcLogger, VrcLogger } from './vrc-logging'
export type { VrcLoggerContext } from './vrc-logging'

// Export VRC module registration
export {
  initializeVrcModule,
  registerVrcDisplayHandlers,
  registerVrcWithContainer,
  loadVrcLocalization,
  getCredentialDisplayRegistry,
} from './register'
export type { VrcRegistrationOptions } from './register'

// Export RCard components
export { useRCardCredential } from './hooks/useRCardCredential'
export { default as RCardOnboarding } from './screens/RCardOnboarding'

// Export VRC Name Cache Context
export { VrcNameCacheProvider, useVrcNameCache } from './context/VrcNameCacheProvider'

// Export VRC contact screens and components
export { default as ListContacts } from './screens/ListContacts'
export { default as ContactDetails } from './screens/ContactDetails'
export { default as WhatAreContacts } from './screens/WhatAreContacts'
export { default as WhatAreConnections } from './screens/WhatAreConnections'
export { default as EmptyContactsList } from './components/EmptyContactsList'
export { default as EmptyListConnections } from './components/EmptyListConnections'
export { default as InfoIcon } from './components/InfoIcon'
export { default as QRCodeExchangeSlider } from './components/QRCodeExchangeSlider'

// Export witness connection
export { WitnessConnectionProvider, useWitnessConnection } from './context/WitnessConnectionProvider'
export type {
  ConnectedWitness,
  WitnessSession,
  WitnessConnectionState,
  WitnessConnectionContextValue,
} from './context/WitnessConnectionProvider'

// Export witness UI components
export { default as WitnessConnections } from './screens/WitnessConnections'
export { default as WitnessStatusBanner } from './components/WitnessStatusBanner'
export type { WitnessStatusBannerProps } from './components/WitnessStatusBanner'
export { default as WitnessVerifiedBanner } from './components/WitnessVerifiedBanner'
export type { WitnessVerifiedBannerProps } from './components/WitnessVerifiedBanner'
export { default as WitnessErrorDialog } from './components/WitnessErrorDialog'
export type { WitnessErrorDialogProps, WitnessErrorType } from './components/WitnessErrorDialog'
export { default as WitnessErrorDialogContainer } from './components/WitnessErrorDialogContainer'

// Export witness error state management
export { vrcFlowStore } from './witnessStatusStore'
export type { VrcFlowErrorType, VrcFlowError } from './witnessStatusStore'

// Export witness error dialog hook
export { useWitnessErrorDialog } from './hooks/useWitnessErrorDialog'
export type { UseWitnessErrorDialogResult } from './hooks/useWitnessErrorDialog'

// Export witness display handler
export { witnessCredentialHandler } from './display/handlers/WitnessCredentialHandler'

// Export witnessed VRC manager
export { WitnessedVRCManager } from './witnessed-vrc-manager'

// Export VRC test fixtures
export {
  type CreateDTGCredentialParams,
  generateTestDid,
  TEST_CONTACTS,
  createDTGCredential,
  createMultipleDTGCredentials,
  createTestCredentialsForHolder,
  createCredentialsFromSameIssuer,
} from './fixtures/testContacts'

// Export RCard types and utilities
export type {
  RCardFormInput,
  RCardValidationErrors,
  JCardProperty,
  JCard,
  RCardTemplate,
  RCardCredentialBuilderOptions,
} from './types/rcard'
export {
  validateRCardForm,
  buildJCardFromFormInput,
  extractFormInputFromJCard,
  buildRCardTemplate,
} from './types/rcard'

// =============================================================================
// Attestation and Evidence Services
// =============================================================================

// Export attestation storage
export { AttestationStorageRecord } from './services/AttestationStorageRecord'
export type { AttestationStorageRecordProps, AttestationStorageRecordTags } from './services/AttestationStorageRecord'
export { AttestationStorageRepository } from './services/AttestationStorageRepository'

// Export evidence builder
export { EvidenceBuilder, createEvidenceBuilder } from './services/EvidenceBuilder'
export type { BuildEvidenceResult } from './services/EvidenceBuilder'

// Export verification services
export {
  HardwareSignatureVerifier,
  verifyVrcHardwareEvidence,
} from './services/BiometricSignatureVerifier'
export type { SignatureVerificationResult, VerificationLevel } from './services/BiometricSignatureVerifier'
