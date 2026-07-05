import {
  Agent,
  ConnectionRecord,
  KeyType,
  PeerDidNumAlgo,
  CredentialEventTypes,
  CredentialRole,
  ConnectionEventTypes,
  DidExchangeState,
  OutOfBandRole,
  BasicMessageRecord,
  CredentialState,
} from '@credo-ts/core'
import type { ConnectionStateChangedEvent, CredentialStateChangedEvent } from '@credo-ts/core'
import { BasicMessageRole } from '@credo-ts/core/build/modules/basic-messages/BasicMessageRole'

import { domain, LocalStorageKeys } from '../../constants'
import { PersistentStorage } from '../../services/storage'
import { Preferences } from '../../types/state'
import { RelationshipDidRepository } from './repositories/RelationshipDidRepository'
import { DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL } from './types/relationshipContext'
import Toast from 'react-native-toast-message'
import { ToastType } from '../../components/toast/BaseToast'
import { createVrcLogger } from './vrc-logging'
import { loadRCardTemplate } from './services/rCardCredential'
import { extractFormInputFromJCard } from './types/rcard'
import { 
  requestBiometricWithHardwareSigning,
} from './vrc-biometric'
import { prepareHardwareKeyForSigning } from './vrc-hardware-signing'
import { createEvidenceBuilder } from './services/EvidenceBuilder'
import type { WitnessSession, WitnessConnectionState } from './context/WitnessConnectionProvider'
import { WitnessedVRCManager } from './witnessed-vrc-manager'
import { witnessStatusStore, vrcFlowStore, type VrcFlowErrorType } from './witnessStatusStore'

const WITNESS_BACKGROUND_TIMEOUT_MS = 15000 // 15 seconds — if no session-challenge arrives, counterparty is not on the witness

/**
 * Default expiration time for VRC credentials (in days)
 * Set via W3C VC v1 `expirationDate` field
 */
const DEFAULT_CREDENTIAL_EXPIRATION_DAYS = 7
const DEFAULT_CREDENTIAL_EXPIRATION_MS = DEFAULT_CREDENTIAL_EXPIRATION_DAYS * 24 * 60 * 60 * 1000

/**
 * Map to track pending session-challenge timeouts
 * Key: connectionId, Value: timeout handle
 */
const sessionChallengeTimeouts = new Map<string, NodeJS.Timeout>()

/**
 * Result of validating a RelationshipCredential against stored DIDs
 */
export interface RelationshipCredentialValidation {
  /** Whether the credential passes all validation checks */
  isValid: boolean
  /** Whether the issuer DID matches the stored counterparty relationship DID */
  issuerDidMatches: boolean
  /** Whether the subject DID matches our stored relationship DID */
  subjectDidMatches: boolean
  /** The expected issuer DID (from stored record) */
  expectedIssuerDid?: string
  /** The expected subject DID (our relationship DID from stored record) */
  expectedSubjectDid?: string
  /** The actual issuer DID from the credential */
  actualIssuerDid?: string
  /** The actual subject DID from the credential */
  actualSubjectDid?: string
  /** Validation error message (if any) */
  errorMessage?: string
}

/**
 * Validate a RelationshipCredential against the stored relationship DIDs
 *
 * This function checks that:
 * 1. The issuer DID in the credential matches the counterparty's relationship DID we received during connection
 * 2. The subject DID in the credential matches our relationship DID that we sent during connection
 *
 * If either doesn't match, it could indicate:
 * - A spoofing attack
 * - Data corruption
 * - A mismatch in the exchange flow
 *
 * @param agent The agent instance
 * @param connectionId The connection ID associated with this credential offer
 * @param credentialIssuerDid The issuer.id from the credential
 * @param credentialSubjectDid The credentialSubject.id from the credential
 * @returns Validation result with detailed information about any mismatches
 */
export async function validateRelationshipCredential(
  agent: Agent,
  connectionId: string,
  credentialIssuerDid: string,
  credentialSubjectDid: string
): Promise<RelationshipCredentialValidation> {
  const logger = createVrcLogger(agent, { module: 'vrc', side: 'RECEIVER', component: 'validateCredential' })

  try {
    // Get the connection to find theirDid
    const connection = await agent.connections.getById(connectionId)
    if (!connection.theirDid) {
      return {
        isValid: false,
        issuerDidMatches: false,
        subjectDidMatches: false,
        actualIssuerDid: credentialIssuerDid,
        actualSubjectDid: credentialSubjectDid,
        errorMessage: 'Connection has no theirDid - cannot validate relationship DIDs',
      }
    }

    // Get the stored relationship DID record
    const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
    const record = await repository.findByConnectionDid(agent.context, connection.theirDid)

    if (!record) {
      logger.warn(`No relationship DID record found for connection ${connectionId}`)
      return {
        isValid: false,
        issuerDidMatches: false,
        subjectDidMatches: false,
        actualIssuerDid: credentialIssuerDid,
        actualSubjectDid: credentialSubjectDid,
        errorMessage: 'No relationship DID record found for this connection',
      }
    }

    // Check issuer DID (should match counterparty's relationship DID)
    const expectedIssuerDid = record.counterpartyRelationshipDid
    const issuerDidMatches = !expectedIssuerDid || credentialIssuerDid === expectedIssuerDid

    // Check subject DID (should match our relationship DID)
    const expectedSubjectDid = record.myRelationshipDid
    const subjectDidMatches = !expectedSubjectDid || credentialSubjectDid === expectedSubjectDid

    const isValid = issuerDidMatches && subjectDidMatches

    if (!isValid) {
      const mismatches: string[] = []
      if (!issuerDidMatches) {
        mismatches.push(`Issuer DID mismatch: expected ${expectedIssuerDid}, got ${credentialIssuerDid}`)
      }
      if (!subjectDidMatches) {
        mismatches.push(`Subject DID mismatch: expected ${expectedSubjectDid}, got ${credentialSubjectDid}`)
      }
      logger.warn(`Relationship credential validation failed: ${mismatches.join('; ')}`)
    } else {
      logger.info('Relationship credential validation passed')
    }

    return {
      isValid,
      issuerDidMatches,
      subjectDidMatches,
      expectedIssuerDid,
      expectedSubjectDid,
      actualIssuerDid: credentialIssuerDid,
      actualSubjectDid: credentialSubjectDid,
      errorMessage: isValid ? undefined : 'Relationship DID mismatch detected',
    }
  } catch (error) {
    logger.error(`Failed to validate relationship credential: ${(error as Error).message}`, error)
    return {
      isValid: false,
      issuerDidMatches: false,
      subjectDidMatches: false,
      actualIssuerDid: credentialIssuerDid,
      actualSubjectDid: credentialSubjectDid,
      errorMessage: `Validation error: ${(error as Error).message}`,
    }
  }
}

/**
 * Track connections where we've already initiated credential offers
 * to prevent duplicate offers in bidirectional exchange.
 */
const connectionCredentialOffers = new Map<string, 'pending' | 'offered' | 'failed'>()

/**
 * Issuer information extracted from RCard template for VRC credentials
 */
interface VrcIssuerInfo {
  name: string
  email?: string
  organization?: string
}

/**
 * Build VRC credential with issuer information from RCard template.
 * Consolidates shared logic for credential construction.
 *
 * @param agent an Agent instance
 * @param myRelationshipDid my relationship DID to use as issuer.id
 * @param counterpartyRelationshipDid counterparty's relationship DID to use as credentialSubject.id
 * @returns The credential object and issuer info
 */
async function buildVrcCredential(
  agent: Agent,
  myRelationshipDid: string,
  counterpartyRelationshipDid: string
): Promise<{ credential: any; issuerInfo: VrcIssuerInfo }> {
  // Load RCard template to get issuer's info
  // TODO Providing name here is for demonstration purposes only. In the future a separate RCard should be issued.
  const issuerInfo: VrcIssuerInfo = { name: 'Unknown Contact' }

  try {
    const rCardTemplate = await loadRCardTemplate(agent)
    if (rCardTemplate?.jcard) {
      const formInput = extractFormInputFromJCard(rCardTemplate.jcard)

      // Extract name
      if (formInput.firstName || formInput.lastName) {
        const firstName = formInput.firstName?.trim() || ''
        const lastName = formInput.lastName?.trim() || ''
        issuerInfo.name = `${firstName} ${lastName}`.trim()
      }

      // Extract email (optional)
      if (formInput.email?.trim()) {
        issuerInfo.email = formInput.email.trim()
      }

      // Extract organization (optional)
      if (formInput.organization?.trim()) {
        issuerInfo.organization = formInput.organization.trim()
      }
    }
  } catch (error) {
    agent.config.logger.warn(`[VRC] Could not load RCard template: ${(error as Error).message}`)
  }

  // Build issuer object with all available properties
  const issuer: Record<string, string> = {
    id: myRelationshipDid,
    name: issuerInfo.name,
  }
  if (issuerInfo.email) {
    issuer.email = issuerInfo.email
  }
  if (issuerInfo.organization) {
    issuer.organization = issuerInfo.organization
  }

  const credential: any = {
    // W3cCredential validator requires the first context to be the VC v1 URL
    '@context': ['https://www.w3.org/2018/credentials/v1', DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL],
    type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
    issuer,
    // Use issuanceDate (RFC3339) to satisfy W3C VC 2.0 validation. validFrom is optional.
    issuanceDate: new Date().toISOString(),
    validFrom: new Date().toISOString(),
    // W3C VC v1 expirationDate and validUntil - set to current time + 7 days
    expirationDate: new Date(Date.now() + DEFAULT_CREDENTIAL_EXPIRATION_MS).toISOString(),
    validUntil: new Date(Date.now() + DEFAULT_CREDENTIAL_EXPIRATION_MS).toISOString(),
    credentialSubject: {
      id: counterpartyRelationshipDid,
    },
  }

  return { credential, issuerInfo }
}

/**
 * Get or create a relationship DID for interacting with a specific counterparty
 * Uses Credo's storage to persist the mapping for reuse across reconnections
 *
 * Each party generates ONE relationshipDid per relationship that serves dual purposes:
 * - As credentialSubject when receiving VRC from counterparty
 * - As issuer when issuing VRC to counterparty
 *
 * SECURITY: Only uses theirDid (cryptographically verifiable) as counterparty identifier
 *
 * @param agent an Agent instance
 * @param counterpartyConnectionDid The DID of the counterparty (from connection.theirDid)
 * @param connectionId Optional connection ID to associate with this relationship
 * @returns My relationship DID for this counterparty
 */
export async function getOrCreateRelationshipDid(
  agent: Agent,
  counterpartyConnectionDid: string,
  connectionId?: string
): Promise<string> {
  // Get the repository
  const repository = agent.dependencyManager.resolve(RelationshipDidRepository)

  // Try to find existing relationship DID record
  const existingRecord = await repository.findByConnectionDid(agent.context, counterpartyConnectionDid)

  if (existingRecord) {
    agent.config.logger.info(`[VRC] Reusing existing relationshipDid for counterparty ${counterpartyConnectionDid}`)
    return existingRecord.myRelationshipDid
  }

  // Create new did:peer:0 for this relationship
  agent.config.logger.info(`[VRC] Creating new relationshipDid for counterparty ${counterpartyConnectionDid}`)
  const didResult = await agent.dids.create({
    method: 'peer',
    options: {
      numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc,
      keyType: KeyType.Ed25519,
    },
  })

  const relationshipDid = didResult.didState.did
  if (!relationshipDid) {
    throw new Error('Failed to create relationship DID')
  }

  // Store the mapping
  await repository.createOrUpdate(agent.context, counterpartyConnectionDid, relationshipDid, connectionId)
  agent.config.logger.info(
    `[VRC] Created and stored relationshipDid ${relationshipDid} for counterparty ${counterpartyConnectionDid}`
  )

  return relationshipDid
}

/**
 * Set relationship DID in connection metadata for bidirectional VRC exchange
 *
 * @param agent an Agent instance
 * @param connectionId The connection ID
 * @param relationshipDid My relationship DID to communicate to counterparty
 */
export async function setRelationshipDidOnConnection(
  agent: Agent,
  connectionId: string,
  relationshipDid: string
): Promise<void> {
  const connection = await agent.connections.getById(connectionId)
  await connection.metadata.set('relationshipDid', { did: relationshipDid })
  // Note: Credo auto-persists metadata changes, no explicit update needed
}

/**
 * Helper function to issue a VRC credential
 * Includes biometric confirmation before signing (when enabled via preferences)
 * Reads useHardwareAttestation preference directly from AsyncStorage since this
 * function is called from agent event handlers without access to React context.
 * 
 * @param preparedCredential - Optional pre-built credential (from witnessed exchange flow).
 *                             If provided, skips biometric confirmation since it was already done.
 */
async function issueVrcCredential(
  agent: Agent,
  connectionRecord: ConnectionRecord,
  myRelationshipDid: string,
  counterpartyRelationshipDid: string,
  preparedCredential?: any,
  biometricAlreadySkipped?: boolean
): Promise<{ biometricSkipped: boolean }> {
  const logger = createVrcLogger(agent, { module: 'vrc', side: 'INVITER', component: 'issueVrcCredential' })

  // Check connection offer lock to prevent duplicate credential offers
  // Allow retry when previous attempt failed — only block if pending or already offered
  const connectionId = connectionRecord.id
  const existingOfferStatus = connectionCredentialOffers.get(connectionId)
  if (existingOfferStatus === 'pending' || existingOfferStatus === 'offered') {
    logger.debug(`Skipping duplicate credential offer | Connection: ${connectionId} | Status: ${existingOfferStatus}`)
    return { biometricSkipped: false }
  }
  connectionCredentialOffers.set(connectionId, 'pending')

  let credential: any
  let issuerInfo: { name: string }
  let biometricSkipped = biometricAlreadySkipped ?? false

  // If preparedCredential is provided (from witnessed exchange), use it directly
  // This skips biometric confirmation since it was already done during witness flow
  if (preparedCredential) {
    logger.info(`Using prepared credential from witnessed exchange (biometrics already done)`)
    credential = preparedCredential
    issuerInfo = { name: preparedCredential.issuer?.name || 'Unknown' }
    logger.info(`Credential already has evidence: ${!!credential.evidence}`)
  } else {
    // Read useHardwareAttestation preference from AsyncStorage
    // This is necessary because this function is called from agent event handlers
    // that don't have access to React context/useStore()
    const preferences = await PersistentStorage.fetchValueForKey<Preferences>(LocalStorageKeys.Preferences)
    const useHardwareAttestation = preferences?.useHardwareAttestation ?? true
    
    logger.debug(`Hardware attestation preference: ${useHardwareAttestation}`)

    // Build the credential using shared helper
    const buildResult = await buildVrcCredential(agent, myRelationshipDid, counterpartyRelationshipDid)
    credential = buildResult.credential
    issuerInfo = buildResult.issuerInfo

    logger.debug(
      `W3C VC 2.0 credential: issuer=${myRelationshipDid}, subject=${counterpartyRelationshipDid}, name=${issuerInfo.name}`
    )

    // Serialize credential content for signing
    const vrcContentForSigning = JSON.stringify(credential)
    logger.info(`VRC content prepared for signing (${vrcContentForSigning.length} chars)`)

    // Conditionally perform biometric/attestation flow
    if (useHardwareAttestation) {
    logger.info(`Step 3: Requesting biometric signing for ${connectionRecord.theirLabel || 'Unknown Contact'}...`)
    
    const counterpartyName = connectionRecord.theirLabel || 'Unknown Contact'
    
    const biometricResult = await requestBiometricWithHardwareSigning(
      agent,
      counterpartyName,
      connectionRecord.id,
      vrcContentForSigning
    )
    
    logger.info(`Biometric result: ${biometricResult.reason}`)
    
    if (!biometricResult.success && biometricResult.reason !== 'not_available') {
      biometricSkipped = true
      logger.warn(`⚠️ Biometric ${biometricResult.reason} — proceeding without hardware attestation`)
      vrcFlowStore.setStatus(connectionRecord.id, 'biometric-fallback', false)
      await new Promise<void>((resolve) => setTimeout(resolve, 2000))
      vrcFlowStore.setStatus(connectionRecord.id, 'preparing-offer', false)
    }
    
    if (biometricResult.reason === 'confirmed') {
      logger.info(`✅ Biometric confirmed [${biometricResult.hardwareSignature?.platform}/${biometricResult.hardwareSignature?.keyStorage}]`)
      
      if (biometricResult.hardwareSignature) {
        const evidenceBuilder = createEvidenceBuilder(agent)
        const evidenceResult = await evidenceBuilder.buildEvidenceFromSignature({
          success: true,
          signature: biometricResult.hardwareSignature,
          reason: 'signed',
        }, biometricResult.hardwareSignature.clientDataHash)
        
        if (evidenceResult.success && evidenceResult.evidence) {
          credential.evidence = [evidenceResult.evidence]
          logger.info(`✅ Evidence block added [${evidenceResult.evidence.attestation.certificateChain.length} certs, source=${evidenceResult.attestationSource || 'none'}]`)
        } else {
          logger.warn(`⚠️ Could not build evidence block: ${evidenceResult.error || 'unknown error'}`)
          logger.warn(`VRC will be issued without hardware attestation evidence`)
        }
      } else {
        logger.info(`ℹ️ No hardware signature available`)
      }
    } else if (biometricResult.reason === 'not_available') {
      logger.info(`ℹ️ Biometrics not available - proceeding without biometric confirmation`)
    }
    } else {
      logger.info(`Hardware attestation disabled — skipping biometric evidence`)
    }
  } // End of else (no preparedCredential) block

  logger.info(`Step 4: Offering credential [connection=${connectionRecord.id}]`)

  try {
    await agent.credentials.offerCredential({
      connectionId: connectionRecord.id,
      protocolVersion: 'v2',
      credentialFormats: {
        jsonld: {
          credential,
          options: {
            proofType: 'Ed25519Signature2018',
            proofPurpose: 'assertionMethod',
          },
        },
      },
    } as any)

    connectionCredentialOffers.set(connectionId, 'offered')
    logger.info(`✓ Credential offer sent with name: ${issuerInfo.name} | Connection: ${connectionRecord.id}`)
  } catch (error) {
    connectionCredentialOffers.set(connectionId, 'failed')
    logger.error(`Failed to offer credential | Connection: ${connectionId}: ${(error as Error).message}`, error)
    throw error
  }

  if (biometricSkipped) {
    Toast.show({
      type: ToastType.Info,
      text1: 'Credential exchanged without attestation',
      text2: 'Biometric verification was skipped',
      visibilityTime: 4000,
    })
  }

  return { biometricSkipped }
}

/**
 * Callback for witness session updates
 * This will be set by the WitnessConnectionProvider
 */
let witnessSessionCallback: ((session: WitnessSession) => void) | undefined

/**
 * Register callback for witness session updates
 * Called by WitnessConnectionProvider to receive session-challenge messages
 *
 * @param callback Function to call when session-challenge is received
 */
export function registerWitnessSessionCallback(callback: (session: WitnessSession) => void): void {
  witnessSessionCallback = callback
}

/**
 * Callback for witness notifications
 * This will be set by the app to show toast notifications
 */
let witnessNotificationCallback: ((message: string, type: 'success' | 'error' | 'info') => void) | undefined

/**
 * Register callback for witness notifications
 * Called by app to show toast notifications for witness events
 *
 * @param callback Function to call when witness notification should be shown
 */
export function registerWitnessNotificationCallback(
  callback: (message: string, type: 'success' | 'error' | 'info') => void
): void {
  witnessNotificationCallback = callback
}

/**
 * Callback for witness connection detection from announcement message
 * This will be set by the WitnessConnectionProvider
 */
let witnessConnectionDetectedCallback:
  | ((connectionId: string, announcement: { name: string; did: string; eventName?: string | null }) => void)
  | undefined

/**
 * Register callback for witness connection detection
 * Called by WitnessConnectionProvider to be notified when a witness announces itself
 *
 * @param callback Function to call when witness-announcement is received
 */
export function registerWitnessConnectionDetectedCallback(
  callback: (connectionId: string, announcement: { name: string; did: string; eventName?: string | null }) => void
): void {
  witnessConnectionDetectedCallback = callback
}

/**
 * Callback for getting witness state
 * This will be set by the WitnessConnectionProvider
 */
let witnessStateGetter: (() => WitnessConnectionState) | undefined

/**
 * Register callback for getting witness connection state
 * Called by WitnessConnectionProvider to allow vrc-manager to check witness availability
 *
 * @param callback Function to call to get current witness state
 */
export function registerWitnessStateGetter(callback: () => WitnessConnectionState): void {
  witnessStateGetter = callback
}

/**
 * Callback for validating witness connection
 * This will be set by the WitnessConnectionProvider
 */
let witnessValidationCallback: (() => Promise<boolean>) | undefined

/**
 * Register callback for validating witness connection
 * Called by WitnessConnectionProvider to allow vrc-manager to validate witness before use
 *
 * @param callback Function to call to validate witness connection
 */
export function registerWitnessValidationCallback(callback: () => Promise<boolean>): void {
  witnessValidationCallback = callback
}

/**
 * Singleton instance of WitnessedVRCManager
 */
const witnessedVRCManager = new WitnessedVRCManager()

/**
 * Storage for pending VRC credentials awaiting witnessed exchange
 * Maps connection ID to VRC credential data
 */
interface PendingVrcData {
  connectionId: string
  myRelationshipDid: string
  myVerificationMethodId: string
  counterpartyRelationshipDid: string
  credential: any
  storedAt: Date
}

const pendingWitnessedVrcs = new Map<string, PendingVrcData>()

/**
 * Storage for pending VRC issuance after witness completion
 * Maps connection ID to VRC issuance data
 * Used to defer VRC issuance until WitnessCredential is received
 * 
 * NOTE: The `credential` field stores the already-prepared VRC with evidence
 * so we can reuse it and avoid asking for biometric confirmation twice.
 */
interface PendingVrcIssuance {
  connectionId: string
  myRelationshipDid: string
  counterpartyRelationshipDid: string
  credential?: any // Pre-built credential with evidence (from storeVrcForWitnessedExchange)
  biometricSkipped?: boolean
  useWitnessing?: boolean // Whether the user had witnessing enabled for this exchange
  enableReporting?: boolean // Whether the user had reporting enabled for this exchange
  storedAt: Date
}

const pendingVrcIssuanceAfterWitness = new Map<string, PendingVrcIssuance>()

/**
 * Store VRC credential for witnessed exchange
 * This credential will be wrapped in a VP and submitted after session-challenge is received
 * 
 * HARDWARE ATTESTATION: When enabled, this function will:
 * 1. Request biometric confirmation with hardware-backed signing
 * 2. Build W3C evidence block with certificate chain
 * 3. Include evidence in the VRC so the witness can see it
 * 
 * The witness will check for the presence of evidence and include a
 * `hardwareAttestationIncluded` flag in the issued VWC.
 * 
 * @returns The prepared credential (with evidence if applicable) for reuse after witness completion
 */
async function storeVrcForWitnessedExchange(
  agent: Agent,
  connectionId: string,
  myRelationshipDid: string,
  counterpartyRelationshipDid: string,
  counterpartyName?: string
): Promise<{ credential: any; biometricSkipped: boolean }> {
  const logger = createVrcLogger(agent, { module: 'witness', component: 'storeVrcForWitnessedExchange' })
  let biometricSkipped = false

  // Read useHardwareAttestation preference from AsyncStorage
  const preferences = await PersistentStorage.fetchValueForKey<Preferences>(LocalStorageKeys.Preferences)
  const useHardwareAttestation = preferences?.useHardwareAttestation ?? true
  
  logger.debug(`Hardware attestation preference for witnessed exchange: ${useHardwareAttestation}`)

  // Build the VRC credential
  const { credential } = await buildVrcCredential(agent, myRelationshipDid, counterpartyRelationshipDid)

  // Serialize credential content for signing (if hardware attestation is enabled)
  const vrcContentForSigning = JSON.stringify(credential)

  // Conditionally perform biometric/attestation flow (same as direct issuance)
  if (useHardwareAttestation) {
    logger.info(`[Witnessed Exchange] Requesting biometric confirmation with hardware signing...`)
    
    const biometricResult = await requestBiometricWithHardwareSigning(
      agent,
      counterpartyName || 'Contact',
      connectionId,
      vrcContentForSigning
    )
    
    logger.info(`Biometric result: ${biometricResult.reason}`)
    
    if (!biometricResult.success && biometricResult.reason !== 'not_available') {
      biometricSkipped = true
      logger.warn(`⚠️ Witnessed biometric ${biometricResult.reason} — proceeding without hardware attestation`)
      vrcFlowStore.setStatus(connectionId, 'biometric-fallback', false)
      await new Promise<void>((resolve) => setTimeout(resolve, 2000))
      vrcFlowStore.setStatus(connectionId, 'preparing-offer', false)
    }
    
    if (biometricResult.reason === 'confirmed' && biometricResult.hardwareSignature) {
      logger.info(`✅ Building W3C evidence block for witnessed exchange...`)
      
      const evidenceBuilder = createEvidenceBuilder(agent)
      const evidenceResult = await evidenceBuilder.buildEvidenceFromSignature({
        success: true,
        signature: biometricResult.hardwareSignature,
        reason: 'signed',
      }, biometricResult.hardwareSignature.clientDataHash)
      
      if (evidenceResult.success && evidenceResult.evidence) {
        logger.info(`✅ Evidence block built successfully for witnessed exchange`)
        logger.info(`Has attestation: ${evidenceResult.hasAttestation}`)
        
        credential.evidence = [evidenceResult.evidence]
        logger.info(`Added evidence block to witnessed VRC`)
      } else {
        logger.warn(`⚠️ Could not build evidence block: ${evidenceResult.error || 'unknown error'}`)
      }
    } else if (biometricResult.reason === 'not_available') {
      logger.info(`ℹ️ Biometrics not available - witnessed VRC will not have hardware attestation evidence`)
    }
  } else {
    logger.info(`Hardware attestation disabled - witnessed VRC will not have evidence block`)
  }

  // Resolve the relationship DID to get verification method ID
  const resolved = await agent.dids.resolve(myRelationshipDid)
  if (!resolved.didDocument) {
    throw new Error(`Failed to resolve DID: ${myRelationshipDid}`)
  }

  const verificationMethod = resolved.didDocument.verificationMethod?.[0]
  if (!verificationMethod) {
    throw new Error(`No verification method found in DID document for ${myRelationshipDid}`)
  }

  const myVerificationMethodId = verificationMethod.id

  // Store for later submission (now with evidence if available)
  pendingWitnessedVrcs.set(connectionId, {
    connectionId,
    myRelationshipDid,
    myVerificationMethodId,
    counterpartyRelationshipDid,
    credential,
    storedAt: new Date(),
  })

  logger.info(`Stored VRC for witnessed exchange | Connection: ${connectionId}`)
  logger.info(`Evidence included: ${!!credential.evidence}`)
  logger.debug(`Verification Method ID: ${myVerificationMethodId}`)

  return { credential, biometricSkipped }
}

/**
 * Process session-challenge from witness
 * Creates VP, signs with challenge, and submits to witness
 */
async function handleSessionChallenge(
  agent: Agent,
  session: WitnessSession,
  witnessConnectionId: string
): Promise<void> {
  const logger = createVrcLogger(agent, { module: 'witness', component: 'handleSessionChallenge' })

  logger.info(`Processing session-challenge: ${session.sessionId}`)

  // Find all pending VRCs (there may be multiple if both parties requested session)
  const pendingVrcs = Array.from(pendingWitnessedVrcs.values())

  if (pendingVrcs.length === 0) {
    logger.warn('Received session-challenge but no pending VRCs found')
    return
  }

  // Process each pending VRC
  for (const vrcData of pendingVrcs) {
    try {
      logger.info(`Creating VP for VRC | Connection: ${vrcData.connectionId}`)

      const witnessState = witnessStateGetter ? witnessStateGetter() : {}
      witnessStatusStore.addStatus(vrcData.connectionId, {
        connectionId: vrcData.connectionId,
        status: 'vp-submitted',
        witnessName: witnessState.connectedWitness?.name || 'Witness',
      })

      // Create and submit VP with session challenge
      // Determine reportingDid based on both global setting AND stored settings for this exchange
      const witnessStateForVp = witnessStateGetter ? witnessStateGetter() : {}
      
      // Get global reporting setting from PersistentStorage
      const witnessSettings = await PersistentStorage.fetchValueForKey<any>(LocalStorageKeys.WitnessSettings)
      const globalReportingEnabled = witnessSettings?.enableReporting ?? true
      
      // Get the stored pending issuance to check this exchange's settings
      const pendingIssuance = pendingVrcIssuanceAfterWitness.get(vrcData.connectionId)
      const exchangeReportingEnabled = pendingIssuance?.enableReporting ?? globalReportingEnabled
      const exchangeUseWitnessing = pendingIssuance?.useWitnessing ?? true
      
      // Only include reportingDid if:
      // 1. Global reporting is enabled AND
      // 2. Either useWitnessing is true OR this exchange has reporting enabled
      // (reporting is included even when witness is off, to record the edge)
      const includeReporting = exchangeReportingEnabled && (exchangeUseWitnessing || exchangeReportingEnabled)
      const reportingDid = includeReporting ? witnessStateForVp.reportingDid : undefined
      
      if (includeReporting && reportingDid) {
        logger.info(`Reporting enabled - including reportingDid in VP submission (useWitnessing=${exchangeUseWitnessing})`)
      } else {
        logger.info(`Reporting disabled or no reportingDid - NOT including in VP submission (useWitnessing=${exchangeUseWitnessing}, enableReporting=${exchangeReportingEnabled})`)
      }
      
      await witnessedVRCManager.createAndSubmitVP(
        agent,
        vrcData.credential,
        vrcData.myVerificationMethodId,
        session,
        witnessConnectionId,
        reportingDid
      )

      logger.info(`✓ VP submitted for connection ${vrcData.connectionId}`)

      // Remove from pending VP tracking (VP done)
      // Note: DON'T clear the flow here — VRC issuance happens after VWC arrives
      // (via pendingVrcIssuanceAfterWitness in the VWC routing handler)
      pendingWitnessedVrcs.delete(vrcData.connectionId)

      // Show notification
      if (witnessNotificationCallback) {
        witnessNotificationCallback('✅ Credential submitted to witness', 'success')
      }
    } catch (error) {
      logger.error(`Failed to create/submit VP for ${vrcData.connectionId}: ${(error as Error).message}`, error)

      const witnessState = witnessStateGetter ? witnessStateGetter() : {}
      
      // Check if VRC was already issued (Option A flow) — if so, just log and move on
      const vrcOfferStatus = connectionCredentialOffers.get(vrcData.connectionId)
      if (vrcOfferStatus === 'pending' || vrcOfferStatus === 'offered') {
        logger.warn(`VP submission failed but VRC already issued for ${vrcData.connectionId} — skipping witness silently`)
        pendingWitnessedVrcs.delete(vrcData.connectionId)
        vrcFlowStore.clearFlow(vrcData.connectionId)

        witnessStatusStore.addStatus(vrcData.connectionId, {
          connectionId: vrcData.connectionId,
          status: 'witness-skipped',
          witnessName: witnessState.connectedWitness?.name || 'Witness',
          errorMessage: 'Witness verification could not complete',
        })
      } else {
        // VRC not yet issued — show error dialog so user can retry or proceed
        vrcFlowStore.setError(vrcData.connectionId, {
          type: 'vp-submission-failed',
          witnessName: witnessState.connectedWitness?.name,
          message: (error as Error).message,
          onRetry: async () => {
            vrcFlowStore.clearError(vrcData.connectionId)
            try {
              await witnessedVRCManager.createAndSubmitVP(
                agent,
                vrcData.credential,
                vrcData.myVerificationMethodId,
                session,
                witnessConnectionId
              )
              pendingWitnessedVrcs.delete(vrcData.connectionId)
              if (witnessNotificationCallback) {
                witnessNotificationCallback('Credential submitted to witness', 'success')
              }
            } catch (retryError) {
              logger.error(`Retry failed: ${(retryError as Error).message}`)
              vrcFlowStore.setError(vrcData.connectionId, {
                type: 'vp-submission-failed',
                witnessName: witnessState.connectedWitness?.name,
                message: (retryError as Error).message,
              })
            }
          },
          onProceedWithout: async () => {
            // Clear the error so the dialog dismisses — but do NOT call clearFlow() here.
            // clearFlow() wipes the hasReceivedOffer flag, which means the overlay
            // won't know the counterparty's credential was already received and will
            // stay visible until the 60 s safety timeout.  Instead, preserve
            // hasReceivedOffer so that when our own offer-sent fires the overlay
            // evaluates (offer-sent && hasReceivedOffer) and clears immediately.
            vrcFlowStore.clearError(vrcData.connectionId)
            pendingWitnessedVrcs.delete(vrcData.connectionId)
            
            logger.info(`User chose to proceed without witness for ${vrcData.connectionId}`)
            
            try {
              const connection = await agent.connections.getById(vrcData.connectionId)
              const pendingIssuance = pendingVrcIssuanceAfterWitness.get(vrcData.connectionId)
              pendingVrcIssuanceAfterWitness.delete(vrcData.connectionId)
              
              await issueVrcCredential(
                agent, 
                connection, 
                vrcData.myRelationshipDid, 
                vrcData.counterpartyRelationshipDid,
                pendingIssuance?.credential,
                pendingIssuance?.biometricSkipped
              )
            } catch (issueError) {
              logger.error(`Failed to issue VRC directly: ${(issueError as Error).message}`)
            } finally {
              // Clean up any residual flow state after issuance attempt.
              // By this point the overlay has already cleared via offer-sent +
              // hasReceivedOffer (if the counterparty's credential was received),
              // or will clear via the normal offer-received path when it arrives.
              vrcFlowStore.clearFlow(vrcData.connectionId)
            }
          },
        })

        witnessStatusStore.addStatus(vrcData.connectionId, {
          connectionId: vrcData.connectionId,
          status: 'error',
          witnessName: witnessState.connectedWitness?.name || 'Witness',
          errorMessage: `Failed to submit to witness: ${(error as Error).message}`,
        })
      }
    }
  }
}

/**
 * Set up automatic relationship DID creation and communication for VRC connections
 * This should be called during wallet initialization
 *
 * SECURITY: Only responds to connections with theirDid set (cryptographically verifiable)
 *
 * @param agent an Agent instance
 */
export function setupVrcConnectionHandler(agent: Agent) {
  agent.config.logger.info('[VRC] Setting up automatic VRC connection handler')

  // Set up basic message handler to receive relationshipDid from counterparty AND witness protocol messages
  agent.events.on('BasicMessageStateChanged' as any, async ({ payload }: any) => {
    const record = payload.basicMessageRecord as BasicMessageRecord

    // Only process received messages
    if (record.role !== BasicMessageRole.Receiver) return

    const content = record.content

    // First, check if this is a witness protocol message (JSON format)
    // This takes priority to intercept before chat display
    try {
      const parsed = JSON.parse(content)

      // Handle witness protocol messages
      if (parsed.type) {
        const witnessLogger = createVrcLogger(agent, {
          module: 'witness',
          component: 'BasicMessageHandler',
        })

        if (parsed.type === 'witness-announcement') {
          // Handle witness announcement message
          witnessLogger.info(`Received witness-announcement from connection ${record.connectionId}`)

          const announcement = parsed.witness
          if (!announcement || !announcement.name || !announcement.did) {
            witnessLogger.warn('Invalid witness-announcement: missing required fields')
            return
          }

          witnessLogger.info(`Witness announced: ${announcement.name} (${announcement.did})`)
          witnessLogger.info(`  Event: ${announcement.eventName || '(none)'}`)
          witnessLogger.info(`  Capabilities: ${announcement.capabilities?.join(', ') || '(none)'}`)
          witnessLogger.info('  Authentication: DIDComm authenticated encryption (no signature needed)')

          // Call registered callback to mark this connection as a witness
          if (witnessConnectionDetectedCallback) {
            witnessConnectionDetectedCallback(record.connectionId, {
              name: announcement.name,
              did: announcement.did,
              eventName: announcement.eventName,
            })
          } else {
            witnessLogger.warn('No witness connection detected callback registered')
          }

          // Show toast notification
          if (witnessNotificationCallback) {
            witnessNotificationCallback(`🔐 Connected to witness: ${announcement.name}`, 'success')
          }

          witnessLogger.debug('Witness-announcement handled - not showing in chat')
          return // Don't show in chat
        }

        if (parsed.type === 'session-challenge') {
          // Store session challenge in WitnessConnectionProvider via callback
          const session: WitnessSession = {
            sessionId: parsed.sessionId,
            challenge: parsed.challenge,
            domain: parsed.domain,
            createdAt: new Date(),
          }

          witnessLogger.info(`Received session-challenge: ${session.sessionId}`)

          // Clear any pending session-challenge timeouts for connections with pending VRCs
          // This prevents the timeout error dialog from showing since we got the challenge
          const pendingVrcs = Array.from(pendingWitnessedVrcs.values())
          pendingVrcs.forEach((vrcData) => {
            const timeoutHandle = sessionChallengeTimeouts.get(vrcData.connectionId)
            if (timeoutHandle) {
              clearTimeout(timeoutHandle)
              sessionChallengeTimeouts.delete(vrcData.connectionId)
              witnessLogger.info(`Cleared session-challenge timeout for ${vrcData.connectionId}`)
            }
          })

          // Call registered callback to update WitnessConnectionProvider
          if (witnessSessionCallback) {
            witnessSessionCallback(session)
          } else {
            witnessLogger.warn('No witness session callback registered - session will not be stored')
          }

          // Show toast notification
          if (witnessNotificationCallback) {
            witnessNotificationCallback('✅ Joined witness session', 'success')
          }

          // Get witness connection ID from state
          const witnessState = witnessStateGetter ? witnessStateGetter() : {}
          if (witnessState.connectedWitness) {
            // Emit status for pending VRCs
            pendingVrcs.forEach((vrcData) => {
              witnessStatusStore.addStatus(vrcData.connectionId, {
                connectionId: vrcData.connectionId,
                status: 'session-joined',
                witnessName: witnessState.connectedWitness?.name || 'Witness',
                sessionId: session.sessionId,
              })
            })

            // Process the session-challenge: create VP and submit to witness
            witnessLogger.info(`Processing session-challenge with witness ${witnessState.connectedWitness.name}`)
            await handleSessionChallenge(agent, session, witnessState.connectedWitness.connectionId)
          } else {
            witnessLogger.warn('Received session-challenge but no witness connection found')
          }

          witnessLogger.debug('Session-challenge handled - not showing in chat')
          return // Don't show in chat
        }

        if (parsed.type === 'error') {
          // Handle witness error messages
          const errorCode = parsed.code as string | undefined
          const errorMessage: string = parsed.message || parsed.error || 'An error occurred'
          witnessLogger.warn(`Received witness error | code=${errorCode ?? 'none'} | message=${errorMessage}`)

          // Event time-window errors get a structured error dialog with an option
          // to proceed without witness verification.
          if (errorCode === 'event-not-started' || errorCode === 'event-ended') {
            const witnessState = witnessStateGetter ? witnessStateGetter() : {}
            const errorType: VrcFlowErrorType = errorCode === 'event-not-started' ? 'event-not-started' : 'event-ended'

            const pendingVrcs = Array.from(pendingWitnessedVrcs.values())
            const pendingVrc = pendingVrcs[0]

            if (pendingVrc) {
              const timeoutHandle = sessionChallengeTimeouts.get(pendingVrc.connectionId)
              if (timeoutHandle) {
                clearTimeout(timeoutHandle)
                sessionChallengeTimeouts.delete(pendingVrc.connectionId)
                witnessLogger.info(`Cleared session-challenge timeout for ${pendingVrc.connectionId} (${errorCode})`)
              }
              pendingWitnessedVrcs.delete(pendingVrc.connectionId)

              vrcFlowStore.setError(pendingVrc.connectionId, {
                type: errorType,
                message: errorMessage,
                witnessName: witnessState.connectedWitness?.name,
                onProceedWithout: async () => {
                  vrcFlowStore.clearError(pendingVrc.connectionId)
                  const pendingIssuance = pendingVrcIssuanceAfterWitness.get(pendingVrc.connectionId)
                  pendingVrcIssuanceAfterWitness.delete(pendingVrc.connectionId)
                  witnessLogger.info(`User chose to proceed without witness (${errorCode}) for ${pendingVrc.connectionId}`)
                  try {
                    const connection = await agent.connections.getById(pendingVrc.connectionId)
                    vrcFlowStore.setStatus(pendingVrc.connectionId, 'preparing-offer', false)
                    await issueVrcCredential(
                      agent,
                      connection,
                      pendingVrc.myRelationshipDid,
                      pendingVrc.counterpartyRelationshipDid,
                      pendingIssuance?.credential,
                      pendingIssuance?.biometricSkipped
                    )
                  } catch (issueError) {
                    witnessLogger.error(`Failed to issue VRC without witness: ${(issueError as Error).message}`)
                  } finally {
                    vrcFlowStore.clearFlow(pendingVrc.connectionId)
                  }
                },
              })
            } else {
              witnessLogger.warn(`Received ${errorCode} but no pending VRC found — showing notification only`)
              if (witnessNotificationCallback) {
                witnessNotificationCallback(`⚠️ Witness: ${errorMessage}`, 'error')
              }
            }

            witnessLogger.debug(`Event time window error (${errorCode}) handled - not showing in chat`)
            return // Don't show in chat
          }

          // Generic witness error — auto-fallback to regular exchange
          const witnessState = witnessStateGetter ? witnessStateGetter() : {}
          const wName = witnessState.connectedWitness?.name || 'Witness'

          const pendingEntries = Array.from(pendingVrcIssuanceAfterWitness.entries())
          for (const [connId, pendingIssuance] of pendingEntries) {
            witnessLogger.info(`Witness rejected VP for ${connId} — auto-fallback to regular exchange`)

            pendingWitnessedVrcs.delete(connId)
            pendingVrcIssuanceAfterWitness.delete(connId)

            const timeoutHandle = sessionChallengeTimeouts.get(connId)
            if (timeoutHandle) {
              clearTimeout(timeoutHandle)
              sessionChallengeTimeouts.delete(connId)
            }

            Toast.show({
              type: ToastType.Info,
              text1: 'Credential exchanged without witness',
              text2: 'Witness verification could not complete',
              visibilityTime: 4000,
            })

            vrcFlowStore.setStatus(connId, 'witness-fallback', false)
            await new Promise<void>((resolve) => setTimeout(resolve, 2000))

            vrcFlowStore.setStatus(connId, 'preparing-offer', false)
            try {
              const connection = await agent.connections.getById(connId)
              await issueVrcCredential(
                agent, connection,
                pendingIssuance.myRelationshipDid,
                pendingIssuance.counterpartyRelationshipDid,
                pendingIssuance.credential,
                pendingIssuance.biometricSkipped
              )
              witnessLogger.info(`✓ VRC issued (witness-error fallback) for ${connId}`)
            } catch (issueError) {
              witnessLogger.error(`Failed to issue VRC after witness error fallback: ${(issueError as Error).message}`)
            }

            witnessStatusStore.addStatus(connId, {
              connectionId: connId,
              status: 'witness-skipped',
              witnessName: wName,
              errorMessage: `Witness verification failed — credential exchanged directly`,
            })
          }

          if (pendingEntries.length === 0) {
            if (witnessNotificationCallback) {
              witnessNotificationCallback(`⚠️ Witness: ${parsed.error}`, 'error')
            }
          }

          witnessLogger.debug('Witness error handled - not showing in chat')
          return // Don't show in chat
        }

        if (parsed.type === 'session-request' || parsed.type === 'submit-presentation') {
          // These are messages we send, not receive - log but don't process
          witnessLogger.debug(`Ignoring outbound witness message type: ${parsed.type}`)
          return
        }

        if (parsed.type === 'reporting-did-registration') {
          // Sent by the app to register its reporting DID with the witness.
          // Silently suppress — this is a protocol message, not chat content.
          witnessLogger.debug(
            `Suppressing reporting-did-registration message for connection ${record.connectionId}`
          )
          return
        }

        // Unknown witness message type - log and continue to normal processing
        witnessLogger.debug(`Unknown witness message type: ${parsed.type} - allowing normal processing`)
      }
    } catch (error) {
      // Not a JSON message, continue to VRC relationshipDid handling
    }

    // Check if this is a VRC relationshipDid message (with or without prefix)
    if (!content.includes('vrc:relationshipDid:')) return

    const logger = createVrcLogger(agent, { module: 'vrc', side: 'INVITER', component: 'BasicMessageHandler' })

    // Extract the DID from the message (handles both with and without prefix)
    const match = content.match(/vrc:relationshipDid:(did:peer:[a-zA-Z0-9]+)/)
    if (!match || !match[1]) {
      logger.warn(`Received malformed relationshipDid message: ${content}`)
      return
    }

    const counterpartyRelationshipDid = match[1]

    logger.info(`Received relationshipDid via message: ${counterpartyRelationshipDid}`)

    // Store in persistent repository using counterpartyConnectionDid as key
    if (record.connectionId) {
      try {
        const connection = await agent.connections.getById(record.connectionId)
        const counterpartyConnectionDid = connection.theirDid

        if (!counterpartyConnectionDid) {
          logger.warn(`Connection ${record.connectionId} has no theirDid - cannot store relationshipDid`)
          return
        }

        const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
        await repository.updateCounterpartyRelationshipDid(
          agent.context,
          counterpartyConnectionDid,
          counterpartyRelationshipDid
        )

        logger.info(
          `Stored counterparty relationshipDid persistently for counterpartyConnectionDid ${counterpartyConnectionDid}`
        )

        // Check if we should trigger credential issuance
        // This handles the case where the message arrives after the connection handler has already timed out
        const outOfBandId = connection.outOfBandId
        if (outOfBandId) {
          const outOfBandRecord = await agent.oob.findById(outOfBandId)
          if (!outOfBandRecord) return

          const goalCode = outOfBandRecord.outOfBandInvitation?.goalCode
          const isBidirectional = goalCode === 'relationship.credential.bidirectional'
          const isUnidirectional = goalCode === 'relationship.credential'
          const side = outOfBandRecord.role === OutOfBandRole.Sender ? 'INVITER' : 'RECEIVER'

          // Respect mode flag:
          // - Bidirectional: Both sides issue in parallel
          // - Unidirectional: Only INVITER issues (serial)
          const shouldIssue = isBidirectional || (isUnidirectional && side === 'INVITER')

          if (shouldIssue) {
            const mode = isBidirectional ? 'bidirectional/parallel' : 'unidirectional/serial'
            const issueLogger = createVrcLogger(agent, { module: 'vrc', side, component: 'MessageHandler' })
            issueLogger.info(
              `Triggering ${mode} credential issuance from message handler for connection ${record.connectionId}`
            )

            // Get my relationshipDid
            const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
            const myRecord = await repository.findByConnectionDid(agent.context, counterpartyConnectionDid)
            const myRelationshipDid = myRecord?.myRelationshipDid

            if (!myRelationshipDid) {
              issueLogger.error(`No myRelationshipDid found for counterpartyConnectionDid ${counterpartyConnectionDid}`)
              return
            }

            // Check if witness is available for witnessed exchange
            const witnessState = witnessStateGetter ? witnessStateGetter() : {}

            // CRITICAL: Validate witness connection before using it
            // This prevents using stale connection IDs from a previous witness session
            let isWitnessValid = false
            if (witnessState.connectedWitness && witnessValidationCallback) {
              issueLogger.info(`Validating witness connection: ${witnessState.connectedWitness.name}`)
              isWitnessValid = await witnessValidationCallback()
              if (!isWitnessValid) {
                issueLogger.warn(`Witness connection is stale - showing error dialog (no silent fallback)`)
                
                // Show error dialog instead of silent fallback
                // User must explicitly choose to proceed without witness or reconnect
                vrcFlowStore.setError(connection.id, {
                  type: 'stale-witness',
                  witnessName: witnessState.connectedWitness.name,
                  contactName: connection.theirLabel,
                  message: 'Your witness connection has expired',
                  // No retry for stale witness - user needs to reconnect via UI
                  onProceedWithout: async () => {
                    // User chose to proceed without witness
                    vrcFlowStore.clearError(connection.id)
                    issueLogger.info(`User chose to proceed without witness (stale) for ${connection.id}`)
                    
                    // Set flow status for overlay (non-witnessed)
                    vrcFlowStore.setStatus(connection.id, 'preparing-offer', false)
                    await issueVrcCredential(agent, connection, myRelationshipDid, counterpartyRelationshipDid)
                    issueLogger.info(`✓ Direct credential issuance complete (stale witness)`)
                  },
                })
                
                // Add status to chat
                witnessStatusStore.addStatus(connection.id, {
                  connectionId: connection.id,
                  status: 'error',
                  witnessName: witnessState.connectedWitness.name,
                  errorMessage: 'Witness connection expired - please reconnect',
                })
                
                return // Don't proceed - wait for user action
              }
            }

            // Auto-fallback: issue VRC directly when the counterparty is not on the witness.
            // No error dialog — the overlay transitions smoothly and a toast explains what happened.
            const autoFallbackWithoutWitness = async (
              connId: string,
              wName: string,
            ) => {
              pendingWitnessedVrcs.delete(connId)
              const pendingIssuance = pendingVrcIssuanceAfterWitness.get(connId)
              pendingVrcIssuanceAfterWitness.delete(connId)

              issueLogger.info(`Witness unavailable for ${connId} — auto-fallback to direct issuance`)

              Toast.show({
                type: ToastType.Info,
                text1: 'Credential exchanged without witness',
                text2: `${connection.theirLabel || 'Contact'} was not on the witness`,
                visibilityTime: 4000,
              })

              vrcFlowStore.setStatus(connId, 'witness-fallback', false)
              await new Promise<void>((resolve) => setTimeout(resolve, 2000))

              vrcFlowStore.setStatus(connId, 'preparing-offer', false)
              try {
                await issueVrcCredential(
                  agent, connection, myRelationshipDid, counterpartyRelationshipDid,
                  pendingIssuance?.credential,
                  pendingIssuance?.biometricSkipped
                )
                issueLogger.info(`✓ VRC issued (auto-fallback) for ${connId}`)
              } catch (issueError) {
                issueLogger.error(`Failed to issue VRC after witness fallback: ${(issueError as Error).message}`)
              }

              witnessStatusStore.addStatus(connId, {
                connectionId: connId,
                status: 'witness-skipped',
                witnessName: wName,
                errorMessage: `Witness verification skipped — ${connection.theirLabel || 'contact'} was not connected to "${wName}"`,
              })
            }

            // Helper: fire witness session-request with a timeout that shows the dialog
            const startWitnessExchangeWithTimeout = (connId: string, wName: string) => {
              vrcFlowStore.setStatus(connId, 'witness-active', true)

              const existingTimeout = sessionChallengeTimeouts.get(connId)
              if (existingTimeout) {
                clearTimeout(existingTimeout)
              }

              const timeoutHandle = setTimeout(async () => {
                const pendingVrc = pendingWitnessedVrcs.get(connId)
                if (pendingVrc) {
                  issueLogger.warn(`Session-challenge timeout for ${connId} — auto-fallback without witness`)
                  await autoFallbackWithoutWitness(connId, wName)
                }
                sessionChallengeTimeouts.delete(connId)
              }, WITNESS_BACKGROUND_TIMEOUT_MS)

              sessionChallengeTimeouts.set(connId, timeoutHandle)
              issueLogger.info(`Set ${WITNESS_BACKGROUND_TIMEOUT_MS / 1000}s timeout for session-challenge`)

              witnessedVRCManager.executeWitnessedExchange(agent, connId, witnessState)
                .then(() => {
                  issueLogger.info(`✓ Witness session-request sent for ${connId}`)
                })
                .catch(async (witnessError: Error) => {
                  issueLogger.warn(`Witness session-request failed: ${witnessError.message}`)

                  const t = sessionChallengeTimeouts.get(connId)
                  if (t) {
                    clearTimeout(t)
                    sessionChallengeTimeouts.delete(connId)
                  }

                  pendingWitnessedVrcs.delete(connId)
                  const pendingIssuance = pendingVrcIssuanceAfterWitness.get(connId)
                  pendingVrcIssuanceAfterWitness.delete(connId)

                  try {
                    vrcFlowStore.setStatus(connId, 'preparing-offer', false)
                    await issueVrcCredential(
                      agent, connection, myRelationshipDid, counterpartyRelationshipDid,
                      pendingIssuance?.credential,
                      pendingIssuance?.biometricSkipped
                    )
                    issueLogger.info(`✓ VRC issued after witness failure for ${connId}`)
                  } catch (issueError) {
                    issueLogger.error(`Failed to issue VRC after witness failure: ${(issueError as Error).message}`)
                  }

                  witnessStatusStore.addStatus(connId, {
                    connectionId: connId,
                    status: 'witness-skipped',
                    witnessName: wName,
                    errorMessage: 'Witness verification skipped — could not reach witness',
                  })
                })
            }

            // Read both useWitnessing and enableReporting preferences
            const preferences = await PersistentStorage.fetchValueForKey<any>(LocalStorageKeys.Preferences)
            const witnessSettings = await PersistentStorage.fetchValueForKey<any>(LocalStorageKeys.WitnessSettings)
            const useWitnessing = preferences?.useWitnessing ?? true
            const enableReporting = witnessSettings?.enableReporting ?? true
            const witnessConnected = witnessState.connectedWitness && isWitnessValid
            
            // Three-way flow decision:
            // 1. Full witness flow: useWitnessing=true → wait for VWC
            // 2. Reporting-only: useWitnessing=false, enableReporting=true → submit VP, issue VRC directly
            // 3. No witness: everything else → regular VRC directly
            const shouldUseWitness = useWitnessing && witnessConnected
            const shouldUseReporting = !useWitnessing && enableReporting && witnessConnected
            
            issueLogger.info(`Flow decision | useWitnessing=${useWitnessing} | enableReporting=${enableReporting} | witnessConnected=${witnessConnected} | shouldUseWitness=${shouldUseWitness} | shouldUseReporting=${shouldUseReporting}`)
            
            if (shouldUseWitness) {
              // Witnessed flow: attempt witness first, VRC issued AFTER witness completes.
              // If the counterparty is not on the witness, a timeout shows a dialog
              // giving the user agency to retry or proceed without witness.
              issueLogger.info(
                `Witness connected: ${witnessState.connectedWitness?.name ?? 'Unknown'} — starting witness flow (useWitnessing=${useWitnessing}, enableReporting=${enableReporting}), VRC issued after completion`
              )

              try {
                const { credential: preparedCredential, biometricSkipped: bioSkipped } = await storeVrcForWitnessedExchange(
                  agent, 
                  connection.id, 
                  myRelationshipDid, 
                  counterpartyRelationshipDid,
                  connection.theirLabel || 'Contact'
                )

                pendingVrcIssuanceAfterWitness.set(connection.id, {
                  connectionId: connection.id,
                  myRelationshipDid,
                  counterpartyRelationshipDid,
                  credential: preparedCredential,
                  biometricSkipped: bioSkipped,
                  useWitnessing,
                  enableReporting,
                  storedAt: new Date(),
                })

                const witnessName = witnessState.connectedWitness?.name || 'Witness'

                witnessStatusStore.addStatus(connection.id, {
                  connectionId: connection.id,
                  status: 'session-requested',
                  witnessName,
                })

                startWitnessExchangeWithTimeout(connection.id, witnessName)

              } catch (error) {
                const errorMessage = (error as Error).message
                issueLogger.error(`Failed during witnessed flow: ${errorMessage}`, error)
                
                // Clear any pending timeout
                const timeoutHandle = sessionChallengeTimeouts.get(connection.id)
                if (timeoutHandle) {
                  clearTimeout(timeoutHandle)
                  sessionChallengeTimeouts.delete(connection.id)
                }
                
                // Fall back to direct issuance on any error (network, credential build, etc.)
                issueLogger.info(`Falling back to direct issuance: ${errorMessage}`)
                vrcFlowStore.setStatus(connection.id, 'preparing-offer', false)
                try {
                  await issueVrcCredential(agent, connection, myRelationshipDid, counterpartyRelationshipDid)
                  issueLogger.info(`✓ Direct credential issuance complete (fallback)`)
                } catch (directError) {
                  const directMessage = (directError as Error).message
                  issueLogger.error(`Direct fallback also failed: ${directMessage}`, directError)
                  vrcFlowStore.setError(connection.id, {
                    type: 'network-error',
                    contactName: connection.theirLabel,
                    message: directMessage,
                  })
                }
              }
            } else if (shouldUseReporting) {
              // Reporting-only flow: contact witness to record edge, but do NOT wait for VWC.
              // Issue VRC directly after VP submission (no pending issuance waiting for VWC).
              issueLogger.info(
                `Witness connected: ${witnessState.connectedWitness?.name ?? 'Unknown'} — starting reporting-only flow (useWitnessing=${useWitnessing}, enableReporting=${enableReporting}), VRC issued directly after VP submission`
              )

              try {
                const { credential: preparedCredential, biometricSkipped: bioSkipped } = await storeVrcForWitnessedExchange(
                  agent, 
                  connection.id, 
                  myRelationshipDid, 
                  counterpartyRelationshipDid,
                  connection.theirLabel || 'Contact'
                )

                // Set flow status for overlay (reporting mode)
                vrcFlowStore.setStatus(connection.id, 'witness-active', true)

                const witnessName = witnessState.connectedWitness?.name || 'Witness'

                witnessStatusStore.addStatus(connection.id, {
                  connectionId: connection.id,
                  status: 'session-requested',
                  witnessName,
                })

                // Submit VP without storing pending issuance (don't wait for VWC)
                // The session-request will be sent via witnessedVRCManager.executeWitnessedExchange
                // which passes witness:false and reportsDid to the witness
                witnessedVRCManager.executeWitnessedExchange(agent, connection.id, witnessState)
                  .then(() => {
                    issueLogger.info(`✓ Reporting VP submitted for ${connection.id}`)
                  })
                  .catch(async (reportError: Error) => {
                    issueLogger.warn(`Reporting VP submission failed for ${connection.id}: ${reportError.message}`)
                  })

                // Issue VRC directly without waiting for VWC
                // Use a short delay to allow VP submission to complete
                issueLogger.info(`Issuing VRC directly (reporting-only mode) for ${connection.id}`)
                vrcFlowStore.setStatus(connection.id, 'preparing-offer', false)
                await issueVrcCredential(agent, connection, myRelationshipDid, counterpartyRelationshipDid, preparedCredential, bioSkipped)
                issueLogger.info(`✓ Direct credential issuance complete (reporting-only)`)

              } catch (error) {
                const errorMessage = (error as Error).message
                issueLogger.error(`Failed during reporting-only flow: ${errorMessage}`, error)
                
                // Fall back to direct issuance on any error (network, credential build, etc.)
                issueLogger.info(`Falling back to direct issuance: ${errorMessage}`)
                vrcFlowStore.setStatus(connection.id, 'preparing-offer', false)
                try {
                  await issueVrcCredential(agent, connection, myRelationshipDid, counterpartyRelationshipDid)
                  issueLogger.info(`✓ Direct credential issuance complete (fallback)`)
                } catch (directError) {
                  const directMessage = (directError as Error).message
                  issueLogger.error(`Direct fallback also failed: ${directMessage}`, directError)
                  vrcFlowStore.setError(connection.id, {
                    type: 'network-error',
                    contactName: connection.theirLabel,
                    message: directMessage,
                  })
                }
              }
            } else {
              // NO WITNESS: Issue VRC directly (standard flow)
              issueLogger.info(`No witness connected - issuing VRC directly`)
              // Set flow status for overlay (non-witnessed)
              const currentStatus = vrcFlowStore.getStatus(connection.id)
              issueLogger.info(`[VRC Flow] Setting 'preparing-offer' (non-witnessed) | Previous status: ${currentStatus}`)
              vrcFlowStore.setStatus(connection.id, 'preparing-offer', false)
              try {
                await issueVrcCredential(agent, connection, myRelationshipDid, counterpartyRelationshipDid)
                issueLogger.info(`✓ Direct credential issuance complete`)
              } catch (directError) {
                const errorMessage = (directError as Error).message
                issueLogger.error(`Direct VRC issuance failed: ${errorMessage}`, directError)

                vrcFlowStore.setError(connection.id, {
                  type: 'network-error',
                  contactName: connection.theirLabel,
                  message: errorMessage,
                })
              }
            }
          }
        }
      } catch (error) {
        logger.error(`Failed to store counterparty relationshipDid: ${(error as Error).message}`, error)
      }
    }
  })

  // Set up global credential state change listener for both logging and request handling
  agent.events.on(CredentialEventTypes.CredentialStateChanged, async ({ payload }: CredentialStateChangedEvent) => {
    const record = payload.credentialRecord

    // Auto-accept WitnessCredentials (user already initiated witness flow)
    // RelationshipCredentials remain manual (user should consciously accept contact)
    if (record.state === CredentialState.OfferReceived && record.role === CredentialRole.Holder) {
      try {
        const vwcAutoLogger = createVrcLogger(agent, { module: 'vrc', component: 'VWCAutoAccept' })

        const formatData = await agent.credentials.getFormatData(record.id)

        // Check for JSON-LD credential (includes WitnessCredentials)
        const offer = formatData?.offer as any
        const jsonldOffer = offer?.jsonld || offer?.ldProof || offer?.dataIntegrity

        if (jsonldOffer) {
          const credential = jsonldOffer.credential

          if (credential?.type) {
            const types = Array.isArray(credential.type) ? credential.type : [credential.type]

            // Auto-accept WitnessCredentials only
            if (types.includes('WitnessCredential')) {
              vwcAutoLogger.info(`✓ Auto-accepting WitnessCredential offer: ${record.id}`)

              await agent.credentials.acceptOffer({
                credentialRecordId: record.id,
              })

              vwcAutoLogger.info(`✓ WitnessCredential offer accepted automatically`)
            }
          }
        }
        // RelationshipCredentials remain manual - user must accept
      } catch (error) {
        // Log but don't fail - this is auto-accept logic
        agent.config.logger.error(`[VRC] VWC auto-accept failed: ${(error as Error).message}`)
      }
    }

    // Route WitnessCredentials to display in counterparty's chat
    if (record.state === CredentialState.Done && record.role === CredentialRole.Holder) {
      try {
        const vwcLogger = createVrcLogger(agent, { module: 'vrc', component: 'VWCRouting' })
        vwcLogger.debug(`Credential done | Exchange: ${record.id} | Credentials: ${record.credentials.length}`)

        // Find the W3C credential reference in the exchange record
        const w3cCredRef = record.credentials.find((c) => c.credentialRecordType === 'w3c')

        if (!w3cCredRef) {
          vwcLogger.debug(`Not a W3C credential, skipping routing check`)
          return
        }

        vwcLogger.debug(`Found W3C credential reference: ${w3cCredRef.credentialRecordId}`)

        // Get the actual W3C credential record using the credentialRecordId
        const w3cRecords = await agent.w3cCredentials.getAllCredentialRecords()
        const w3cRecord = w3cRecords.find((r) => r.id === w3cCredRef.credentialRecordId)

        if (!w3cRecord?.credential) {
          vwcLogger.warn(`W3C credential record not found: ${w3cCredRef.credentialRecordId}`)
          return
        }

        const credential = w3cRecord.credential as any
        const types = credential.type || []
        vwcLogger.debug(`Credential types: ${types.join(', ')}`)

        // Check if this is a WitnessCredential
        if (types.includes('WitnessCredential')) {
          vwcLogger.info(`✓ Detected WitnessCredential received: ${w3cRecord.id}`)

          // Extract counterparty's relationship DID from credentialSubject.id
          const counterpartyRelationshipDid = credential.credentialSubject?.id

          if (counterpartyRelationshipDid) {
            vwcLogger.info(`VWC about counterparty: ${counterpartyRelationshipDid}`)

            // Look up connection by counterparty's relationship DID
            const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
            const records = await repository.findByQuery(agent.context, {
              counterpartyRelationshipDid,
            })

            const relationshipRecord = records[0]
            if (relationshipRecord?.connectionId) {
              vwcLogger.info(`Routing VWC to connection: ${relationshipRecord.connectionId}`)

              // Get witness info
              const witnessState = witnessStateGetter ? witnessStateGetter() : {}

              // Store routing metadata on the W3C credential record
              w3cRecord.metadata.set('witnessCredentialRouting', {
                displayInConnectionId: relationshipRecord.connectionId,
                witnessName: witnessState.connectedWitness?.name,
                witnessedAt: new Date().toISOString(),
              })

              // Persist the metadata update
              const { W3cCredentialRepository } = await import('@credo-ts/core')
              const w3cCredentialRepository = agent.dependencyManager.resolve(W3cCredentialRepository)
              await w3cCredentialRepository.update(agent.context, w3cRecord)

              vwcLogger.info(`✓ VWC routing metadata stored for connection ${relationshipRecord.connectionId}`)

              witnessStatusStore.addStatus(relationshipRecord.connectionId, {
                connectionId: relationshipRecord.connectionId,
                status: 'witness-complete',
                witnessName: witnessState.connectedWitness?.name || 'Witness',
              })

              vwcLogger.info(`✓ Witness completion status emitted for connection ${relationshipRecord.connectionId}`)

              // NOW issue the pending VRC after witness attestation is complete
              // This ensures the VRC credential offer appears at the END of the chat
              const pendingIssuance = pendingVrcIssuanceAfterWitness.get(relationshipRecord.connectionId)
              if (pendingIssuance) {
                // Only set 'preparing-offer' status on the Inviter side (who has pending VRC to issue)
                // The Holder does not have a pending issuance, so they shouldn't see this overlay
                const currentStatus = vrcFlowStore.getStatus(relationshipRecord.connectionId)
                vwcLogger.info(`[VRC Flow] Setting 'preparing-offer' (after witness) | Previous status: ${currentStatus}`)
                vrcFlowStore.setStatus(relationshipRecord.connectionId, 'preparing-offer', true)
                
                vwcLogger.info(`Found pending VRC issuance for connection ${relationshipRecord.connectionId} - issuing now`)
                vwcLogger.info(`  Has prepared credential: ${!!pendingIssuance.credential}`)
                try {
                  // Get the connection record
                  const connection = await agent.connections.getById(relationshipRecord.connectionId)
                  
                  // Issue the VRC now that witness is complete
                  // Pass the prepared credential (with evidence) to avoid asking for biometrics twice
                  await issueVrcCredential(
                    agent,
                    connection,
                    pendingIssuance.myRelationshipDid,
                    pendingIssuance.counterpartyRelationshipDid,
                    pendingIssuance.credential,
                    pendingIssuance.biometricSkipped
                  )
                  
                  vwcLogger.info(`✓ VRC issued after witness completion for connection ${relationshipRecord.connectionId}`)
                  
                  // Clean up the pending issuance
                  pendingVrcIssuanceAfterWitness.delete(relationshipRecord.connectionId)
                } catch (issuanceError) {
                  vwcLogger.error(`Failed to issue pending VRC: ${(issuanceError as Error).message}`, issuanceError)
                  // Keep the pending data for potential retry
                }
              } else {
                vwcLogger.debug(`No pending VRC issuance for connection ${relationshipRecord.connectionId}`)
              }
            } else {
              vwcLogger.warn(`No connection found for counterparty relationship DID: ${counterpartyRelationshipDid}`)
            }
          } else {
            vwcLogger.warn(`VWC has no credentialSubject.id - cannot route`)
          }
        }
      } catch (error) {
        // Log but don't fail - this is routing logic
        agent.config.logger.warn(`[VRC] VWC routing failed: ${(error as Error).message}`)
      }
    }

    // Only handle VRC-related credentials (check connection's OOB record for VRC goalCode)
    if (!record.connectionId) return

    try {
      const connection = await agent.connections.getById(record.connectionId)
      if (!connection.outOfBandId) return

      const outOfBandRecord = await agent.oob.findById(connection.outOfBandId)
      if (!outOfBandRecord) return

      const goalCode = outOfBandRecord.outOfBandInvitation?.goalCode
      const isVrcConnection =
        goalCode === 'relationship.credential' || goalCode === 'relationship.credential.bidirectional'

      if (!isVrcConnection) return

      // Determine side based on role
      const side = record.role === CredentialRole.Holder ? 'RECEIVER' : 'INVITER'
      const credLogger = createVrcLogger(agent, { module: 'vrc', side, component: 'CredentialStateHandler' })

      credLogger.info(
        `Credential state: ${record.state} | Role: ${record.role} | Connection: ${record.connectionId} | Exchange: ${record.id}`
      )

      // NOTE: We do NOT manually call acceptRequest() here because Credo's auto-accept
      // (autoAcceptCredentials: ContentApproved) handles it automatically.
      // Manual acceptance would cause duplicate issue-credential messages.

      // Log specific state transitions and track exchange progress for overlay
      if (record.state === CredentialState.OfferReceived && record.role === CredentialRole.Holder) {
        credLogger.info(`Credential offer received for connection ${record.connectionId}`)
        credLogger.debug(`Credential exchange record ID: ${record.id}`)
        if (record.connectionId) {
          const currentStatus = vrcFlowStore.getStatus(record.connectionId)

          // Don't clear the overlay if we're still in a witness flow.
          // The other party's offer arriving early shouldn't interrupt our
          // witness verification / fallback sequence.
          const inWitnessFlow = currentStatus === 'witness-active' || currentStatus === 'witness-fallback'
          if (inWitnessFlow) {
            credLogger.info(`[VRC Flow] Received offer but witness flow active (${currentStatus}) — keeping overlay, marking received`)
            vrcFlowStore.markOfferReceived(record.connectionId)
          } else {
            credLogger.info(`[VRC Flow] Setting 'offer-received' | Previous status: ${currentStatus}`)
            vrcFlowStore.setStatus(record.connectionId, 'offer-received', vrcFlowStore.isWitnessedFlow(record.connectionId))
          }
        }
      } else if (record.state === CredentialState.OfferSent && record.role === CredentialRole.Issuer) {
        credLogger.info(`Credential offer sent for connection ${record.connectionId}`)
        credLogger.debug(`Credential exchange record ID: ${record.id}`)
        if (record.connectionId) {
          const currentStatus = vrcFlowStore.getStatus(record.connectionId)
          credLogger.info(`[VRC Flow] Setting 'offer-sent' | Previous status: ${currentStatus}`)
          vrcFlowStore.setStatus(record.connectionId, 'offer-sent', vrcFlowStore.isWitnessedFlow(record.connectionId))
        }
      } else if (record.state === CredentialState.RequestSent && record.role === CredentialRole.Holder) {
        credLogger.info(`Credential request sent for exchange ${record.id}`)
      } else if (record.state === CredentialState.CredentialReceived && record.role === CredentialRole.Holder) {
        credLogger.info(`Credential received for exchange ${record.id}`)
      } else if (record.state === CredentialState.Done && record.role === CredentialRole.Holder) {
        credLogger.info(`✓ Credential exchange completed successfully for exchange ${record.id}`)
      }
    } catch (error) {
      // Silently ignore - this is just logging
    }
  })

  agent.events.on(ConnectionEventTypes.ConnectionStateChanged, async ({ payload }: ConnectionStateChangedEvent) => {
    const { connectionRecord } = payload

    // Set 'connecting' status at early DID exchange states for VRC connections
    // This enables the overlay to show "Establishing connection..." from the very beginning
    const earlyStates = [
      DidExchangeState.InvitationReceived,
      DidExchangeState.RequestSent,
      DidExchangeState.RequestReceived,
      DidExchangeState.ResponseSent,
      DidExchangeState.ResponseReceived,
    ]
    
    if (earlyStates.includes(connectionRecord.state as DidExchangeState)) {
      // Check if this is a VRC connection (not a witness connection)
      if (connectionRecord.outOfBandId) {
        try {
          const outOfBandRecord = await agent.oob.findById(connectionRecord.outOfBandId)
          if (outOfBandRecord) {
            const goalCode = outOfBandRecord.outOfBandInvitation?.goalCode
            const isVrcConnection =
              goalCode === 'relationship.credential' || goalCode === 'relationship.credential.bidirectional'
            
            // Only set 'connecting' for VRC peer connections, not witness connections
            const isWitnessConnection = connectionRecord.metadata?.get('witnessConnection') != null
            
            if (isVrcConnection && !isWitnessConnection) {
              // Check if we haven't already set a more advanced status
              const currentStatus = vrcFlowStore.getStatus(connectionRecord.id)
              if (currentStatus === 'idle') {
                agent.config.logger.info(`[VRC] Setting 'connecting' status for early DID exchange state: ${connectionRecord.state}`)
                vrcFlowStore.setStatus(connectionRecord.id, 'connecting', false)
              }
            }
          }
        } catch (error) {
          // Silently ignore - this is just for overlay status
          agent.config.logger.debug(`[VRC] Could not check OOB record for early state: ${(error as Error).message}`)
        }
      }
    }

    // Only handle completed connections for the main VRC flow
    const isCompleted = connectionRecord.state === DidExchangeState.Completed
    if (!isCompleted) return

    // Check if this is a VRC connection by fetching the OOB record
    if (!connectionRecord.outOfBandId) return

    try {
      const outOfBandRecord = await agent.oob.findById(connectionRecord.outOfBandId)
      if (!outOfBandRecord) return

      const goalCode = outOfBandRecord.outOfBandInvitation?.goalCode
      const isVrcConnection =
        goalCode === 'relationship.credential' || goalCode === 'relationship.credential.bidirectional'

      if (!isVrcConnection) return

      // Determine side: If we created the OOB invitation, we're INVITER; otherwise RECEIVER
      const side = outOfBandRecord.role === OutOfBandRole.Sender ? 'INVITER' : 'RECEIVER'
      const logger = createVrcLogger(agent, { module: 'vrc', side, component: 'ConnectionHandler' })

      logger.info(`Connection completed: ${connectionRecord.id}`)
      logger.debug(`Connection OOB ID: ${connectionRecord.outOfBandId}, goalCode: ${goalCode}`)

      // Ensure flow status is set for overlay - connection is complete, now exchanging DIDs
      // This maintains the overlay during the DID exchange phase before credential issuance
      const currentStatus = vrcFlowStore.getStatus(connectionRecord.id)
      if (currentStatus === 'idle' || currentStatus === 'connecting') {
        logger.info(`Setting 'connecting' status for completed connection (DID exchange phase)`)
        vrcFlowStore.setStatus(connectionRecord.id, 'connecting', false)
      }

      // Pre-warm hardware key and attestation cache while connection completes.
      // This front-loads the heavy Apple/Google server calls so that when VRC
      // signing happens, only the biometric prompt is needed (~2-5s vs 20-45s).
      prepareHardwareKeyForSigning(agent).catch(err => {
        logger.warn(`Hardware key pre-warm failed (non-blocking): ${(err as Error).message}`)
      })

      // SECURITY: Only use theirDid as counterparty identifier - must be present
      if (!connectionRecord.theirDid) {
        logger.warn(
          `Connection ${connectionRecord.id} has no theirDid - cannot create relationship DID. This is a security requirement.`
        )
        return
      }

      const counterpartyConnectionDid = connectionRecord.theirDid
      logger.debug(`Counterparty DID: ${counterpartyConnectionDid}`)

      // Get or create relationship DID for this counterparty
      const relationshipDid = await getOrCreateRelationshipDid(
        agent,
        counterpartyConnectionDid,
        connectionRecord.id || undefined
      )

      // Store in local metadata for our own reference
      await setRelationshipDidOnConnection(agent, connectionRecord.id, relationshipDid)

      // Send relationshipDid to counterparty via basic message with retry.
      // The HTTP outbound transport can be temporarily inactive (especially on
      // slow devices or during dev hot-reload), so we retry with backoff.
      const maxRetries = 3
      const message = `This is my relationship DID: vrc:relationshipDid:${relationshipDid}`
      let sent = false

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await agent.basicMessages.sendMessage(connectionRecord.id, message)
          sent = true
          break
        } catch (sendError) {
          logger.warn(
            `Relationship DID send attempt ${attempt}/${maxRetries} failed: ${(sendError as Error).message}`
          )
          if (attempt < maxRetries) {
            await new Promise<void>((resolve) => setTimeout(resolve, 2000 * attempt))
          }
        }
      }

      if (sent) {
        logger.info(`✓ RelationshipDid set and sent: ${relationshipDid} | Connection: ${connectionRecord.id}`)
      } else {
        logger.error(`✗ RelationshipDid stored locally but failed to send after ${maxRetries} attempts`)
      }

      logger.debug(`RelationshipDid stored for counterparty: ${counterpartyConnectionDid}`)
      logger.debug(`Connection handler complete - credential issuance will be triggered by message handler`)
    } catch (error) {
      const side = 'RECEIVER'
      const errorLogger = createVrcLogger(agent, { module: 'vrc', side, component: 'ConnectionHandler' })
      errorLogger.error(`Failed to auto-set relationship DID: ${(error as Error).message}`, error)
    }
  })

  agent.config.logger.info('[VRC] VRC connection handler setup complete (includes global credential state listener)')
}

/**
 * Create a connection invitation that will automatically issue a Verifiable Relationship Credential (VRC)
 * when the connection is established. Supports both unidirectional and bidirectional modes.
 *
 * @param agent an Agent instance
 * @param walletName the name of the wallet issuing the credential
 * @param mode 'unidirectional' or 'bidirectional' - default is bidirectional
 * @returns a connection record with invitation URL
 */
export const createRelationshipInvitation = async (
  agent: Agent | undefined,
  walletName: string,
  mode: 'unidirectional' | 'bidirectional' = 'bidirectional'
) => {
  if (!agent) {
    throw new Error('Agent not initialized')
  }

  agent.config.logger.info(`[VRC] createRelationshipInvitation called (${mode} mode)`, { walletName })

  // Create the OOB invitation with appropriate goal code
  const goalCode = mode === 'bidirectional' ? 'relationship.credential.bidirectional' : 'relationship.credential'
  agent.config.logger.info(`[VRC] Creating out-of-band invitation with goalCode: ${goalCode}`)

  const record = await agent.oob.createInvitation({
    label: walletName,
    goalCode,
    goal:
      mode === 'bidirectional'
        ? 'Establish connection and exchange relationship credentials'
        : 'Establish connection and issue relationship credential',
  })

  if (!record) {
    throw new Error('Could not create relationship invitation')
  }

  agent.config.logger.info(`[VRC] OOB invitation created successfully - Record ID: ${record.id}`)

  const invitationUrl = record.outOfBandInvitation.toUrl({ domain })
  agent.config.logger.info(`[VRC] Invitation URL generated`)
  agent.config.logger.info('[VRC] createRelationshipInvitation completed successfully')

  return {
    record,
    invitation: record.outOfBandInvitation,
    invitationUrl,
  }
}
