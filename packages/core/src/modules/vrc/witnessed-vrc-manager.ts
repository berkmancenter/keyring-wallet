/**
 * Witnessed VRC Manager
 *
 * Orchestrates the witnessed VRC exchange flow including:
 * - Session requests to witness
 * - Verifiable Presentation creation with session challenge
 * - Submission to witness for verification
 */

import type { Agent } from '@credo-ts/core'
import { ClaimFormat, W3cCredential, W3cPresentation, JsonTransformer } from '@credo-ts/core'
import type { WitnessConnectionState } from './context/WitnessConnectionProvider'
import { RelationshipDidRepository } from './repositories/RelationshipDidRepository'
import { getVrcJsonLdProofOptions } from './vrc-manager'
import { createVrcLogger } from './vrc-logging'
import { PersistentStorage } from '../../services/storage'
import { LocalStorageKeys } from '../../constants'
import { Preferences } from '../../types/state'

/**
 * Witnessed VRC Manager
 * Handles the coordination of witnessed credential exchanges
 */
export class WitnessedVRCManager {
  /**
   * Execute a witnessed VRC exchange
   *
   * This initiates the witnessed flow by requesting a session from the witness.
   * The witness will respond with a session-challenge message (handled by BasicMessage listener).
   *
   * @param agent Credo agent instance
   * @param peerConnectionId Connection ID of the peer to exchange with
   * @param witnessState Current witness connection state
   */
  async executeWitnessedExchange(
    agent: Agent,
    peerConnectionId: string,
    witnessState: WitnessConnectionState
  ): Promise<void> {
    const logger = createVrcLogger(agent, { module: 'witness', component: 'WitnessedVRCManager' })

    // Validate witness connection
    if (!witnessState.connectedWitness) {
      const error = 'Cannot execute witnessed exchange: No witness connected'
      logger.error(error)
      throw new Error(error)
    }

    logger.info(
      `Requesting witnessed session | Witness: ${witnessState.connectedWitness.name} | Peer: ${peerConnectionId}`
    )

    try {
      // Get the peer connection to find their connection DID
      const peerConnection = await agent.modules.didcomm.connections.getById(peerConnectionId)
      const peerConnectionDid = peerConnection.theirDid

      if (!peerConnectionDid) {
        const error = `Cannot request witnessed session: peer connection ${peerConnectionId} has no theirDid`
        logger.error(error)
        throw new Error(error)
      }

      // Look up relationship DIDs from repository
      const repository = agent.dependencyManager.resolve(RelationshipDidRepository)
      const relationshipRecord = await repository.findByConnectionDid(agent.context, peerConnectionDid)

      if (!relationshipRecord || !relationshipRecord.counterpartyRelationshipDid) {
        const error = `Cannot request witnessed session: no relationship DID found for peer ${peerConnectionId}`
        logger.error(error)
        logger.error(`This usually means the counterparty hasn't sent their relationship DID yet`)
        throw new Error(error)
      }

      const counterpartyRelationshipDid = relationshipRecord.counterpartyRelationshipDid
      const myRelationshipDid = relationshipRecord.myRelationshipDid

      logger.info(`Peer connection DID: ${peerConnectionDid}`)
      logger.info(`My relationship DID: ${myRelationshipDid}`)
      logger.info(`Counterparty relationship DID: ${counterpartyRelationshipDid}`)

      // Read useWitnessing preference from AsyncStorage
      const preferences = await PersistentStorage.fetchValueForKey<Preferences>(LocalStorageKeys.Preferences)
      const witnessSettings = await PersistentStorage.fetchValueForKey<any>(LocalStorageKeys.WitnessSettings)
      const useWitnessing = preferences?.useWitnessing ?? true
      const enableReporting = witnessSettings?.enableReporting ?? true
      
      logger.info(`UseWitnessing preference: ${useWitnessing}`)
      logger.info(`EnableReporting preference: ${enableReporting}`)

      // 1. Request session from witness with BOTH relationship DIDs
      // Pass useWitnessing preference - when false, the witness will skip VWC issuance
      // but still record the edge in the network graph (if both parties have reportingDids).
      // This allows reporting to work even when witnessing is disabled.
      const sessionRequest = {
        type: 'session-request',
        myRelationshipDid: myRelationshipDid,
        counterpartyDid: counterpartyRelationshipDid,
        witness: useWitnessing,
      }

      await agent.modules.didcomm.basicMessages.sendMessage(witnessState.connectedWitness.connectionId, JSON.stringify(sessionRequest))

      logger.info('✓ Session request sent to witness with both relationship DIDs')
      logger.debug('Waiting for session-challenge from witness (handled by BasicMessage listener)')

      // 2. Wait for session-challenge (handled by BasicMessage listener)
      // The session-challenge will be processed by the handler in vrc-manager.ts
      // and stored in WitnessConnectionProvider via the callback

      // 3. When session challenge is received, the app will call createAndSubmitVP
      // (This happens in response to the session-challenge message)
    } catch (error) {
      logger.error(`Failed to request witnessed session: ${(error as Error).message}`, error)
      throw error
    }
  }

  /**
   * Create and submit a Verifiable Presentation with session challenge
   *
   * This wraps the VRC in a VP, signs it with the session challenge, and submits to the witness.
   *
   * @param agent Credo agent instance
   * @param vrcCredential The VRC credential (unsigned JSON) to wrap in VP
   * @param verificationMethodId The verification method ID for signing
   * @param sessionChallenge Session challenge from witness
   * @param witnessConnectionId Connection ID of witness
   * @param reportingDid Optional stable reporting DID to include in the VP submission.
   *   The witness records an exchange graph edge only when BOTH parties provide this field.
   */
  async createAndSubmitVP(
    agent: Agent,
    vrcCredential: any,
    verificationMethodId: string,
    sessionChallenge: { sessionId: string; challenge: string; domain: string },
    witnessConnectionId: string,
    reportingDid?: string
  ): Promise<void> {
    const logger = createVrcLogger(agent, { module: 'witness', component: 'WitnessedVRCManager' })

    logger.info(
      `Creating VP for witnessed exchange | Session: ${
        sessionChallenge.sessionId
      } | Challenge: ${sessionChallenge.challenge.substring(0, 8)}...`
    )

    try {
      // W3C credential classes are imported statically at module top — a
      // dynamic import() here made Metro serve them as an on-demand lazy chunk,
      // which fails on the dev build ("LoadBundleFromServerError: Could not
      // load bundle") mid-witnessed-exchange and drops the VP submission.

      // 1. Sign the VRC credential (required for witness Identity Check).
      // Capability-gated like the peer-to-peer offers: the VRC's subject IS
      // the counterparty relationship DID, so the same RCE v3 gate applies —
      // DI only when the counterparty announced it. The witness dual-verifies
      // both families, and its VWC issuance mirrors the proof family it
      // observes here (docs/CRYPTO_SUITE_FOLLOWUP.md, Decision 6 + witness
      // mirroring).
      logger.debug('Signing VRC credential')
      const counterpartyRelationshipDid = vrcCredential?.credentialSubject?.id as string
      const proofOptions = await getVrcJsonLdProofOptions(agent, counterpartyRelationshipDid)
      logger.info(`Signing witnessed VRC with proofType=${proofOptions.proofType}`)
      const vrcUnsigned = JsonTransformer.fromJSON(vrcCredential, W3cCredential)
      const signedVrc = await agent.w3cCredentials.signCredential({
        format: ClaimFormat.LdpVc,
        credential: vrcUnsigned,
        verificationMethod: verificationMethodId,
        proofType: proofOptions.proofType,
      })
      const vrcJson = JsonTransformer.toJSON(signedVrc)
      logger.debug('✓ VRC signed')

      // 2. Create VP wrapping the signed VRC
      logger.debug('Creating Verifiable Presentation')

      // Extract holder DID from verification method ID
      // Format: did:peer:0z6Mk...#z6Mk... → did:peer:0z6Mk...
      const holderDid = verificationMethodId.split('#')[0]

      // The VP @context must match the wrapped credential's data model: a v1
      // VP embedding a VCDM 2.0 credential fails JSON-LD expansion at signing
      // ("tried to redefine a protected term" — v1 and v2 both @protect the
      // core terms with different definitions).
      const vrcContexts: string[] = Array.isArray(vrcJson['@context']) ? vrcJson['@context'] : [vrcJson['@context']]
      const vpContext = vrcContexts.includes('https://www.w3.org/ns/credentials/v2')
        ? 'https://www.w3.org/ns/credentials/v2'
        : 'https://www.w3.org/2018/credentials/v1'
      const vpUnsignedJson = {
        '@context': [vpContext],
        type: ['VerifiablePresentation'],
        holder: holderDid,
        verifiableCredential: [vrcJson],
      }
      const vpUnsigned = JsonTransformer.fromJSON(vpUnsignedJson, W3cPresentation)

      // 3. Sign VP with session challenge
      logger.debug('Signing VP with session challenge')
      // Cast: credo 0.6 TYPES proofPurpose as a required string, but the
      // RUNTIME passes it straight to jsonld-signatures, which needs a
      // ProofPurpose instance — a string crashes with "purpose.update is not
      // a function". Omitting it is the correct runtime behavior (vc builds
      // an AuthenticationProofPurpose from challenge + domain).
      const signedVp = await agent.w3cCredentials.signPresentation({
        format: ClaimFormat.LdpVp,
        presentation: vpUnsigned,
        verificationMethod: verificationMethodId,
        // INTENTIONAL: stays Ed25519Signature2018 until the witness-server
        // dual-verifies Data Integrity proofs (see note on the VRC signing
        // above / docs/CRYPTO_SUITE_FOLLOWUP.md).
        proofType: 'Ed25519Signature2018',
        challenge: sessionChallenge.challenge,
        domain: sessionChallenge.domain,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      const vpJson = JsonTransformer.toJSON(signedVp)
      logger.debug('✓ VP signed with session challenge')

      // 4. Submit to witness
      // Include reportingDid when the user has opted into activity reporting.
      // The witness records an exchange graph edge only when BOTH parties include this field.
      const submitRequest: Record<string, unknown> = {
        type: 'submit-presentation',
        presentation: vpJson,
      }
      if (reportingDid) {
        submitRequest.reportingDid = reportingDid
        logger.info(`Including reportingDid in VP submission: ${reportingDid}`)
      } else {
        logger.debug('No reportingDid — exchange will not be recorded by witness')
      }

      await agent.modules.didcomm.basicMessages.sendMessage(witnessConnectionId, JSON.stringify(submitRequest))

      logger.info('✓ VP submitted to witness for verification')
      logger.debug('Waiting for witness to verify and issue VWC')
    } catch (error) {
      logger.error(`Failed to create and submit VP: ${(error as Error).message}`, error)
      throw error
    }
  }
}
