import type BottomBar from 'inquirer/lib/ui/bottom-bar'

import {
  AutoAcceptCredential,
  BasicMessageEventTypes,
  ClaimFormat,
  ConnectionEventTypes,
  CredentialEventTypes,
  CredentialRole,
  CredentialState,
  JsonTransformer,
  KeyType,
  PeerDidNumAlgo,
  utils,
  W3cCredential,
  W3cCredentialRecord,
  W3cPresentation,
  type BasicMessageStateChangedEvent,
  type ConnectionRecord,
  type ConnectionStateChangedEvent,
  type CredentialExchangeRecord,
  type CredentialStateChangedEvent,
  type ProofExchangeRecord,
} from '@credo-ts/core'
import { BasicMessageRole } from '@credo-ts/core/build/modules/basic-messages/BasicMessageRole'
import { ui } from 'inquirer'

import { BaseAgent } from './BaseAgent'
import { buildCredentialSummaryFromCredential } from './credentialSummary'
import { Color, greenText, Output, purpleText, redText } from './OutputClass'
import { DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL } from './relationshipContext'

// Session challenge data received from Witness
interface SessionChallengeData {
  sessionId: string
  challenge: string
  domain: string
  witnessConnectionId: string
}

// Per-connection DID data (R-DID per relationship)
interface ConnectionDIDData {
  did: string
  verificationMethodId: string
}

/**
 * Participant represents any party in a VRC exchange (e.g., Alice or Bob).
 * Both participants have identical capabilities:
 * - Create or accept connections
 * - Issue credentials
 * - Accept credential offers
 * - Create and submit presentations to a Witness
 * - Send/request proofs
 * - Exchange R-DIDs
 *
 * Per the protocol, each participant creates a NEW R-DID for each relationship.
 */
export class Participant extends BaseAgent {
  public ui: BottomBar
  public outOfBandId?: string
  public connectionRecordId?: string
  public connected: boolean

  // Per-relationship R-DIDs (one R-DID per connection)
  private didByConnection: Map<string, ConnectionDIDData>
  private counterpartyRDidByConnection: Map<string, string>
  private sessionChallenge?: SessionChallengeData
  // Track in-progress DID creation to prevent race conditions
  private didCreationInProgress: Map<string, Promise<ConnectionDIDData>>

  public constructor(port: number, name: string, mediatorInvitationUrl?: string) {
    super({ port, name, mediatorInvitationUrl })
    this.ui = new ui.BottomBar()
    this.connected = false
    this.didByConnection = new Map()
    this.counterpartyRDidByConnection = new Map()
    this.didCreationInProgress = new Map()
  }

  public static async build(port: number, name: string, mediatorInvitationUrl?: string): Promise<Participant> {
    const participant = new Participant(port, name, mediatorInvitationUrl)
    await participant.initializeAgent()
    // DIDs are created per-relationship during acceptConnection() or setupConnection()
    participant.registerEventHandlers()
    return participant
  }

  /**
   * Register all event handlers for credential issuance, basic messages, and connections
   */
  private registerEventHandlers() {
    this.registerCredentialAutoIssuance()
    this.registerBasicMessageHandler()
    this.registerConnectionCompleteHandler()
  }

  /**
   * Create a new R-DID for a specific relationship (connection).
   * Per the protocol, each relationship gets its own unique R-DID.
   * Uses locking to prevent race conditions when multiple code paths try to create
   * the same DID simultaneously.
   */
  private async createDIDForConnection(connectionId: string): Promise<ConnectionDIDData> {
    // Check if already exists
    const existing = this.didByConnection.get(connectionId)
    if (existing) return existing

    // Check if creation is already in progress - wait for it
    const inProgress = this.didCreationInProgress.get(connectionId)
    if (inProgress) {
      return await inProgress
    }

    // Create the promise for this DID creation
    const creationPromise = this._createDIDForConnectionInternal(connectionId)
    this.didCreationInProgress.set(connectionId, creationPromise)

    try {
      const result = await creationPromise
      return result
    } finally {
      // Clean up the in-progress tracker
      this.didCreationInProgress.delete(connectionId)
    }
  }

  /**
   * Internal method that performs the actual DID creation
   */
  private async _createDIDForConnectionInternal(connectionId: string): Promise<ConnectionDIDData> {
    const key = await this.agent.wallet.createKey({ keyType: KeyType.Ed25519 })
    const didResult = await this.agent.dids.create({
      method: 'peer',
      options: { numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc, key },
    })

    if (didResult.didState?.state !== 'finished' || !didResult.didState.did || !didResult.didState.didDocument) {
      const reason = didResult.didState && 'reason' in didResult.didState ? didResult.didState.reason : 'unknown reason'
      throw new Error(redText(`Failed to create R-DID for connection ${connectionId}: ${reason}`))
    }

    const did = didResult.didState.did
    const didDocument = didResult.didState.didDocument

    // Get the verification method from the created DID document
    const verificationMethod = didDocument.verificationMethod?.[0]
    if (!verificationMethod) {
      throw new Error(redText('No verification method in the R-DID document.'))
    }

    const verificationMethodId = verificationMethod.id

    // IMPORTANT: For did:peer:0 (InceptionKeyWithoutDoc), Credo stores the DID record WITHOUT
    // a DID document. When resolved later, the document is generated on-the-fly but may not
    // have authentication. We MUST re-import with a proper DID document that includes
    // authentication (required for proof presentation signing).
    const didDocumentJson = JsonTransformer.toJSON(didDocument)

    // Ensure authentication is set (required by DifPresentationExchangeService)
    if (!didDocumentJson.authentication || didDocumentJson.authentication.length === 0) {
      didDocumentJson.authentication = [verificationMethodId]
    }

    // Ensure assertionMethod is set (required for credential issuance)
    if (!didDocumentJson.assertionMethod || didDocumentJson.assertionMethod.length === 0) {
      didDocumentJson.assertionMethod = [verificationMethodId]
    }

    const { DidDocument } = await import('@credo-ts/core')
    const enrichedDidDocument = JsonTransformer.fromJSON(didDocumentJson, DidDocument)

    // Always re-import to ensure the DID document is stored (not just the DID)
    await this.agent.dids.import({
      did: did,
      didDocument: enrichedDidDocument,
      overwrite: true,
    })

    const didData: ConnectionDIDData = { did, verificationMethodId }
    this.didByConnection.set(connectionId, didData)
    return didData
  }

  /**
   * Get the R-DID for a specific connection
   */
  private getDIDForConnection(connectionId: string): ConnectionDIDData | undefined {
    return this.didByConnection.get(connectionId)
  }

  /**
   * Get the R-DID for the current/primary connection
   */
  private getCurrentDID(): ConnectionDIDData | undefined {
    if (this.connectionRecordId) {
      return this.didByConnection.get(this.connectionRecordId)
    }
    // Fall back to first DID if we have any
    const values = Array.from(this.didByConnection.values())
    return values.length > 0 ? values[0] : undefined
  }

  // ============================================
  // Connection Management
  // ============================================

  /**
   * Create an out-of-band connection invitation
   */
  public async createConnectionInvitation(): Promise<string> {
    const outOfBand = await this.agent.oob.createInvitation()
    this.outOfBandId = outOfBand.id

    const invitationUrl = outOfBand.outOfBandInvitation.toUrl({
      domain: `http://localhost:${this.port}`,
    })

    console.log(greenText(`\n[${this.name}] Connection invitation created`))
    console.log(Output.ConnectionLink, invitationUrl, '\n')

    return invitationUrl
  }

  /**
   * Accept an incoming connection invitation and create an R-DID for this relationship
   */
  public async acceptConnection(invitationUrl: string): Promise<string> {
    const { connectionRecord } = await this.agent.oob.receiveInvitationFromUrl(invitationUrl)
    if (!connectionRecord) {
      throw new Error(redText(Output.NoConnectionRecordFromOutOfBand))
    }

    const connectedRecord = await this.agent.connections.returnWhenIsConnected(connectionRecord.id)
    this.connected = true
    this.connectionRecordId = connectionRecord.id

    // Store the outOfBandId if not already set
    if (!this.outOfBandId && connectionRecord.outOfBandId) {
      this.outOfBandId = connectionRecord.outOfBandId
    }

    const peerName = connectedRecord.theirLabel || 'peer'
    const peerNameLower = peerName.toLowerCase()

    // Create a new R-DID specifically for this relationship
    const didData = await this.createDIDForConnection(connectionRecord.id)

    // Store our R-DID in connection metadata for the peer
    connectedRecord.metadata.set('counterpartyRDid', { did: didData.did })

    // Only send R-DID to potential credential issuers (not to Witness agent)
    // Witness agents have names that start with 'witness' (e.g., 'witness', 'witness-w0-...')
    const isWitnessAgent = peerNameLower === 'witness' || peerNameLower.startsWith('witness-')
    if (!isWitnessAgent) {
      try {
        await this.agent.basicMessages.sendMessage(connectionRecord.id, JSON.stringify({ rDid: didData.did }))
        console.log(greenText(`[${this.name}] ✓ Shared R-DID with ${peerName}`))
        console.log(purpleText(`    ${didData.did}`))
      } catch (error) {
        console.log(
          redText(`[${this.name}] Connected to ${peerName} but failed to share R-DID: ${(error as Error).message}`)
        )
      }
    } else {
      console.log(greenText(`[${this.name}] ✓ Connected to ${peerName}`))
    }

    console.log(greenText(Output.ConnectionEstablished))
    return connectionRecord.id
  }

  /**
   * Print connection invitation and wait for peer to connect
   */
  public async setupConnection(): Promise<void> {
    await this.createConnectionInvitation()
    await this.waitForConnection()
  }

  /**
   * Wait for a connection to be established
   */
  private async waitForConnection(): Promise<void> {
    if (!this.outOfBandId) {
      throw new Error(redText(Output.MissingConnectionRecord))
    }

    console.log(`[${this.name}] Waiting for peer to connect...`)

    const getConnectionRecord = (outOfBandId: string) =>
      new Promise<ConnectionRecord>((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error(redText(Output.MissingConnectionRecord))), 60000)

        this.agent.events.on<ConnectionStateChangedEvent>(ConnectionEventTypes.ConnectionStateChanged, (e) => {
          if (e.payload.connectionRecord.outOfBandId !== outOfBandId) return

          clearTimeout(timeoutId)
          resolve(e.payload.connectionRecord)
        })

        void this.agent.connections.findAllByOutOfBandId(outOfBandId).then(([connectionRecord]) => {
          if (connectionRecord) {
            clearTimeout(timeoutId)
            resolve(connectionRecord)
          }
        })
      })

    const connectionRecord = await getConnectionRecord(this.outOfBandId)

    try {
      const connectedRecord = await this.agent.connections.returnWhenIsConnected(connectionRecord.id)
      this.connected = true
      this.connectionRecordId = connectionRecord.id

      // Create R-DID for this relationship (if not already created by event handler)
      let didData = this.getDIDForConnection(connectionRecord.id)
      if (!didData) {
        didData = await this.createDIDForConnection(connectionRecord.id)
        console.log(greenText(`[${this.name}] ✓ Created R-DID for relationship`))
        console.log(purpleText(`    ${didData.did}`))
      }

      // Store R-DID in connection metadata
      connectedRecord.metadata.set('counterpartyRDid', { did: didData.did })

      // Send R-DID to peer (unless it's a Witness)
      const peerName = connectedRecord.theirLabel?.toLowerCase() || ''
      if (!peerName.includes('witness')) {
        try {
          await this.agent.basicMessages.sendMessage(connectionRecord.id, JSON.stringify({ rDid: didData.did }))
          console.log(greenText(`[${this.name}] ✓ Shared R-DID with ${connectedRecord.theirLabel || 'peer'}`))
        } catch {
          // Message sending might fail, continue anyway
        }
      }
    } catch (_e) {
      console.log(redText('\nTimeout of 60 seconds reached.. Returning to home screen.\n'))
      return
    }
    console.log(greenText(Output.ConnectionEstablished))
  }

  /**
   * Get the current connection record
   */
  private async getConnectionRecord(): Promise<ConnectionRecord> {
    // First try by connectionRecordId
    if (this.connectionRecordId) {
      return await this.agent.connections.getById(this.connectionRecordId)
    }

    // Fall back to outOfBandId
    if (!this.outOfBandId) {
      throw Error(redText(Output.MissingConnectionRecord))
    }

    const [connection] = await this.agent.connections.findAllByOutOfBandId(this.outOfBandId)
    if (!connection) {
      throw Error(redText(Output.MissingConnectionRecord))
    }

    return connection
  }

  /**
   * Connection event handler.
   * 
   * Ensures that an R-DID is created for any completed connection, regardless of
   * whether the connection was initiated via acceptConnection(), setupConnection(),
   * or through other means (e.g., tests manually waiting for connections).
   */
  private registerConnectionCompleteHandler() {
    this.agent.events.on<ConnectionStateChangedEvent>(
      ConnectionEventTypes.ConnectionStateChanged,
      async ({ payload }) => {
        const record = payload.connectionRecord
        
        // Only handle completed connections
        if (record.state !== 'completed') return
        
        // Ensure we have an R-DID for this connection
        let didData = this.getDIDForConnection(record.id)
        if (!didData) {
          try {
            didData = await this.createDIDForConnection(record.id)
            console.log(greenText(`[${this.name}] ✓ Auto-created R-DID for connection ${record.id}`))
            console.log(purpleText(`    ${didData.did}`))
            
            // Update connection metadata
            record.metadata.set('counterpartyRDid', { did: didData.did })
            
            // Share R-DID with peer (unless it's a Witness)
            const peerName = record.theirLabel?.toLowerCase() || ''
            const isWitnessAgent = peerName === 'witness' || peerName.startsWith('witness-')
            if (!isWitnessAgent) {
              try {
                await this.agent.basicMessages.sendMessage(record.id, JSON.stringify({ rDid: didData.did }))
                console.log(greenText(`[${this.name}] ✓ Shared R-DID with ${record.theirLabel || 'peer'}`))
              } catch (error) {
                console.log(redText(`[${this.name}] Failed to share R-DID: ${(error as Error).message}`))
              }
            }
          } catch (error) {
            console.log(redText(`[${this.name}] Failed to create R-DID for connection: ${(error as Error).message}`))
          }
        }
      }
    )
  }

  // ============================================
  // R-DID Exchange
  // ============================================

  /**
   * Register handler to receive counterparty DIDs and session challenges via basic messages
   */
  private registerBasicMessageHandler() {
    this.agent.events.on<BasicMessageStateChangedEvent>(
      BasicMessageEventTypes.BasicMessageStateChanged,
      async ({ payload }) => {
        const record = payload.basicMessageRecord

        // Only process received messages
        if (record.role !== BasicMessageRole.Receiver) return

        try {
          const parsed = JSON.parse(record.content)

          // Handle counterparty's R-DID
          if (parsed.rDid && record.connectionId) {
            this.counterpartyRDidByConnection.set(record.connectionId, parsed.rDid)
            const connection = await this.agent.connections.findById(record.connectionId)
            const peerName = connection?.theirLabel || 'peer'
            console.log(greenText(`[${this.name}] ✓ Received R-DID from ${peerName}`))
            console.log(purpleText(`    ${parsed.rDid}`))
          }

          // Handle session challenge from Witness
          if (parsed.type === 'session-challenge' && record.connectionId) {
            this.sessionChallenge = {
              sessionId: parsed.sessionId,
              challenge: parsed.challenge,
              domain: parsed.domain,
              witnessConnectionId: record.connectionId,
            }
            console.log(greenText(`[${this.name}] received session challenge from Witness!`))
            console.log(purpleText(`  Session ID: ${parsed.sessionId}`))
            console.log(purpleText(`  Challenge: ${parsed.challenge}`))
            console.log(purpleText(`  Domain: ${parsed.domain}`))
            console.log(
              greenText(`[${this.name}] Use "Submit VP to Witness" to participate in the witnessed session.\n`)
            )
          }
        } catch {
          // Not a JSON message we care about, ignore
        }
      }
    )
  }

  /**
   * Get the counterparty's R-DID for a given connection
   */
  public getCounterpartyRDid(connectionId: string): string | undefined {
    return this.counterpartyRDidByConnection.get(connectionId)
  }

  /**
   * Get any counterparty R-DID (returns the first one found)
   */
  public getAnyCounterpartyRDid(): string | undefined {
    const values = Array.from(this.counterpartyRDidByConnection.values())
    return values.length > 0 ? values[0] : undefined
  }

  /**
   * Check if we have received any counterparty R-DIDs
   */
  public hasCounterpartyRDid(): boolean {
    return this.counterpartyRDidByConnection.size > 0
  }

  /**
   * Set counterparty R-DID (for manual setting in demos)
   */
  public setCounterpartyRDid(connectionId: string, did: string): void {
    this.counterpartyRDidByConnection.set(connectionId, did)
  }

  // ============================================
  // Session Challenge Management
  // ============================================

  /**
   * Check if we have an active session challenge from a Witness
   */
  public hasSessionChallenge(): boolean {
    return this.sessionChallenge !== undefined
  }

  /**
   * Get the active session challenge data
   */
  public getSessionChallenge(): SessionChallengeData | undefined {
    return this.sessionChallenge
  }

  /**
   * Clear the session challenge (after submitting or canceling)
   */
  public clearSessionChallenge(): void {
    this.sessionChallenge = undefined
  }

  // ============================================
  // Credential Issuance
  // ============================================

  /**
   * Build a VRC (Relationship Credential) per DTG minimal spec
   * - type: MUST include "RelationshipCredential"
   * - issuer: The R-DID of the issuer
   * - credentialSubject.id: The R-DID of the subject
   */
  private buildRelationshipCredential(issuerDid: string, subjectDid: string) {
    return {
      '@context': ['https://www.w3.org/2018/credentials/v1', DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL],
      type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
      issuer: issuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: subjectDid,
      },
    }
  }

  /**
   * Issue a VRC credential to the connected peer
   */
  public async issueCredential(): Promise<void> {
    const connectionRecord = await this.getConnectionRecord()

    // Get or create R-DID for this connection
    let didData = this.getDIDForConnection(connectionRecord.id)
    if (!didData) {
      didData = await this.createDIDForConnection(connectionRecord.id)
    }

    // Get the counterparty's R-DID
    const counterpartyRDidMetadata = connectionRecord.metadata?.get?.('counterpartyRDid') as
      | { did?: string }
      | undefined
    const subjectId =
      this.counterpartyRDidByConnection.get(connectionRecord.id) ??
      counterpartyRDidMetadata?.did ??
      connectionRecord.theirDid ??
      'did:example:holder'

    const credential = this.buildRelationshipCredential(didData.did, subjectId)

    this.printCredentialPreview(credential)
    this.ui.updateBottomBar('\nSending credential offer...\n')

    await this.agent.credentials.offerCredential({
      connectionId: connectionRecord.id,
      protocolVersion: 'v2',
      autoAcceptCredential: AutoAcceptCredential.Never,
      credentialFormats: {
        jsonld: {
          credential,
          options: {
            proofType: 'Ed25519Signature2018',
            proofPurpose: 'assertionMethod',
          },
        },
      },
    })
    this.ui.updateBottomBar(
      `\nCredential offer sent!\n\nGo to the peer agent to accept the credential offer\n\n${Color.Reset}`
    )
  }

  private printCredentialPreview(credential: { type: string[]; credentialSubject: Record<string, unknown> }) {
    console.log('\n\nThe credential will look like this:\n')
    console.log(purpleText(`Type: ${Color.Reset}${credential.type.join(', ')}`))
    console.log(purpleText(`Subject: ${Color.Reset}${JSON.stringify(credential.credentialSubject, null, 2)}\n`))
  }

  /**
   * Auto-issue credentials when we receive a request (as issuer)
   */
  private registerCredentialAutoIssuance() {
    this.agent.events.on<CredentialStateChangedEvent>(
      CredentialEventTypes.CredentialStateChanged,
      async ({ payload }) => {
        const record = payload.credentialRecord as CredentialExchangeRecord

        // Auto-issue when we receive a credential request (as issuer)
        if (record.state !== CredentialState.RequestReceived) return
        if (record.role !== CredentialRole.Issuer) return

        try {
          // Get DID for this connection
          const connectionId = record.connectionId
          if (!connectionId) {
            throw new Error('No connection ID on credential record')
          }

          let didData = this.getDIDForConnection(connectionId)
          if (!didData) {
            didData = await this.createDIDForConnection(connectionId)
          }

          await this.agent.credentials.acceptRequest({
            credentialRecordId: record.id,
            credentialFormats: {
              jsonld: {
                verificationMethod: didData.verificationMethodId,
              },
            },
          })
          console.log(greenText(`[${this.name}] credential exchange ${record.id} -> credential-sent`))
        } catch (error) {
          console.log(
            redText(`[${this.name}] Failed to issue credential for exchange ${record.id}: ${(error as Error).message}`)
          )
        }
      }
    )
  }

  // ============================================
  // Credential Acceptance
  // ============================================

  /**
   * Accept a specific credential offer
   */
  public async acceptCredentialOffer(credentialRecord: CredentialExchangeRecord): Promise<void> {
    await this.agent.credentials.acceptOffer({
      credentialRecordId: credentialRecord.id,
    })
    console.log(greenText(`[${this.name}] ✓ Credential offer accepted`))
  }

  /**
   * Accept all pending credential offers (e.g., VWCs from the Witness)
   * Returns the number of credentials accepted
   */
  public async acceptPendingCredentialOffers(): Promise<number> {
    const allCredentials = await this.agent.credentials.getAll()
    const pendingOffers = allCredentials.filter((record) => record.state === CredentialState.OfferReceived)

    if (pendingOffers.length === 0) {
      console.log(greenText(`[${this.name}] No pending credential offers to accept`))
      return 0
    }

    console.log(greenText(`[${this.name}] Found ${pendingOffers.length} pending credential offer(s), accepting...`))

    for (const offer of pendingOffers) {
      try {
        await this.agent.credentials.acceptOffer({
          credentialRecordId: offer.id,
        })
        console.log(greenText(`[${this.name}] ✓ Accepted credential offer ${offer.id}`))
      } catch (error) {
        console.log(redText(`[${this.name}] ✗ Failed to accept offer ${offer.id}: ${(error as Error).message}`))
      }
    }

    return pendingOffers.length
  }

  // ============================================
  // Proof Exchange
  // ============================================

  /**
   * Build a presentation definition for a RelationshipCredential
   */
  private buildPresentationDefinition() {
    return {
      id: utils.uuid(),
      input_descriptors: [
        {
          id: 'relationship_credential',
          name: 'Relationship Credential',
          schema: [{ uri: RELATIONSHIP_CONTEXT_URL }],
          constraints: {
            fields: [
              {
                path: ['$.type[*]'],
                filter: {
                  type: 'string',
                  const: 'RelationshipCredential',
                },
              },
            ],
          },
        },
      ],
    }
  }

  /**
   * Send a proof request to the connected peer
   */
  public async sendProofRequest(): Promise<void> {
    const connectionRecord = await this.getConnectionRecord()
    this.ui.updateBottomBar('\nRequesting proof...\n')

    await this.agent.proofs.requestProof({
      protocolVersion: 'v2',
      connectionId: connectionRecord.id,
      proofFormats: {
        presentationExchange: {
          presentationDefinition: this.buildPresentationDefinition(),
        },
      },
    })
    this.ui.updateBottomBar(
      `\nProof request sent!\n\nGo to the peer agent to accept the proof request\n\n${Color.Reset}`
    )
  }

  /**
   * Accept a proof request
   */
  public async acceptProofRequest(proofRecord: ProofExchangeRecord): Promise<void> {
    const requestedCredentials = await this.agent.proofs.selectCredentialsForRequest({
      proofRecordId: proofRecord.id,
    })

    await this.agent.proofs.acceptRequest({
      proofRecordId: proofRecord.id,
      proofFormats: requestedCredentials.proofFormats,
    })
    console.log(greenText('\nProof request accepted!\n'))
  }

  // ============================================
  // Witnessed Flow - VP Creation & Submission
  // ============================================

  /**
   * Create a VRC, wrap it in a VP with challenge/domain, and submit to Witness
   *
   * This is used in the witnessed flow:
   * 1. Creates a VRC targeting the counterparty (issuer=self, subject=counterparty)
   * 2. Signs the VRC
   * 3. Wraps the VRC in a Verifiable Presentation
   * 4. Signs the VP with the session challenge
   * 5. Submits the VP to the Witness via basic message
   */
  public async createAndSubmitPresentation(
    witnessConnectionId: string,
    counterpartyDid: string,
    counterpartyName: string,
    challenge: string,
    domain: string
  ): Promise<{ vrc: any; vp: any }> {
    // Get DID for the counterparty connection (not the witness connection)
    // We need the DID we use for our relationship with the counterparty
    const currentDid = this.getCurrentDID()
    if (!currentDid) {
      throw new Error(redText('No R-DID available for presentation. Establish a connection first.'))
    }

    console.log(greenText(`\n[${this.name}] Creating VRC for witnessed session...`))
    console.log(purpleText(`  → From R-DID: ${this.name}`))
    console.log(purpleText(`  → To R-DID: ${counterpartyName}`))

    // Step 1: Build the unsigned VRC as plain JSON
    const vrcUnsignedJson = this.buildRelationshipCredential(currentDid.did, counterpartyDid)

    // Step 2: Convert to W3cCredential instance and sign
    const vrcUnsigned = JsonTransformer.fromJSON(vrcUnsignedJson, W3cCredential)
    const signedVrc = await this.agent.w3cCredentials.signCredential({
      format: ClaimFormat.LdpVc,
      credential: vrcUnsigned,
      verificationMethod: currentDid.verificationMethodId,
      proofType: 'Ed25519Signature2018',
    })

    const vrcJson = JsonTransformer.toJSON(signedVrc)
    console.log(greenText(`[${this.name}] ✓ VRC signed`))

    // Step 3: Build the VP wrapper containing the VRC
    const vpUnsignedJson = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      holder: currentDid.did,
      verifiableCredential: [vrcJson],
    }

    // Step 4: Convert to W3cPresentation instance and sign with challenge/domain
    const vpUnsigned = JsonTransformer.fromJSON(vpUnsignedJson, W3cPresentation)
    const signedVp = await this.agent.w3cCredentials.signPresentation({
      format: ClaimFormat.LdpVp,
      presentation: vpUnsigned,
      verificationMethod: currentDid.verificationMethodId,
      proofType: 'Ed25519Signature2018',
      proofPurpose: 'authentication',
      challenge: challenge,
      domain: domain,
    })

    const vpJson = JsonTransformer.toJSON(signedVp)
    console.log(greenText(`[${this.name}] ✓ VP signed with session challenge`))

    // Step 5: Submit to Witness via basic message
    const submissionMessage = JSON.stringify({
      type: 'submit-presentation',
      presentation: vpJson,
    })

    await this.agent.basicMessages.sendMessage(witnessConnectionId, submissionMessage)
    console.log(greenText(`\n[${this.name}] ✓ Submitted VP to Witness\n`))

    return { vrc: vrcJson, vp: vpJson }
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get this participant's R-DID for the current connection
   */
  public getDid(): string | undefined {
    return this.getCurrentDID()?.did
  }

  /**
   * Get this participant's verification method ID for signing
   */
  public getVerificationMethodId(): string | undefined {
    return this.getCurrentDID()?.verificationMethodId
  }

  /**
   * Alias for getDid() for backwards compatibility
   */
  public getIssuerDid(): string | undefined {
    return this.getDid()
  }

  /**
   * Send a basic message to the connected peer
   */
  public async sendMessage(message: string): Promise<void> {
    const connectionRecord = await this.getConnectionRecord()
    await this.agent.basicMessages.sendMessage(connectionRecord.id, message)
  }

  /**
   * List all stored credentials
   */
  public async listStoredCredentials(): Promise<void> {
    const allRecords = await this.agent.w3cCredentials.getAllCredentialRecords()

    // Filter out records that don't contain an in-memory credential
    const credentialRecords = allRecords.filter((record) => Boolean(record.credential))

    if (credentialRecords.length === 0) {
      console.log(redText('\nNo stored JSON-LD credentials yet.\n'))
      return
    }

    const sortedRecords = [...credentialRecords].sort((a, b) => {
      const aTime = a.createdAt?.getTime() ?? 0
      const bTime = b.createdAt?.getTime() ?? 0
      return aTime - bTime
    })

    console.log(greenText(`\nStored credentials (${sortedRecords.length}):\n`))

    sortedRecords.forEach((record: W3cCredentialRecord, index: number) => {
      if (!record.credential) return

      const credentialJson = JsonTransformer.toJSON(record.credential) as Record<string, unknown>
      const summary = buildCredentialSummaryFromCredential(credentialJson)

      const details = [
        `types: ${summary.types.join(', ')}`,
        summary.issuer ? `issuer: ${summary.issuer}` : undefined,
        summary.subjectIds.length ? `subject: ${summary.subjectIds[0]}` : undefined,
      ]
        .filter(Boolean)
        .join(' | ')

      console.log(purpleText(`[${index + 1}] ${Color.Reset}recordId=${record.id} | ${details}`))
      console.log(JSON.stringify(credentialJson, null, 2))
    })
    console.log('')
  }

  public async exit(): Promise<void> {
    console.log(Output.Exit)
    await this.agent.shutdown()
    process.exit(0)
  }

  public async restart(): Promise<void> {
    await this.agent.shutdown()
  }
}

/**
 * Factory function to create a Participant
 */
export async function createParticipant(port: number, name: string): Promise<Participant> {
  return Participant.build(port, name)
}
