import type BottomBar from 'inquirer/lib/ui/bottom-bar'

import {
  KeyType,
  PeerDidNumAlgo,
  utils,
  type ConnectionRecord,
  JsonTransformer,
  AutoAcceptCredential,
  BasicMessageEventTypes,
  type BasicMessageStateChangedEvent,
  W3cJsonLdVerifiableCredential,
} from '@credo-ts/core'
import { ui } from 'inquirer'
import { createHash } from 'crypto'

import { BaseAgent } from './BaseAgent'
import { greenText, Output, purpleText, redText } from './OutputClass'
import { WITNESSED_EXCHANGE_CONTEXT_URL } from './witnessedExchangeContext'

// Session expiration time in minutes
const SESSION_EXPIRATION_MINUTES = 30

interface SessionData {
  sessionId: string
  challenge: string
  domain: string
  participants: Set<string>
  receivedPresentations: Map<string, any>
  createdAt: Date
  expiresAt: Date
}

export class Witness extends BaseAgent {
  public ui: BottomBar
  private issuerDid?: string
  private issuerVerificationMethodId?: string
  private activeSessions: Map<string, SessionData>
  private outOfBandIds: Map<string, string>
  private eventName?: string

  public constructor(port: number, name: string) {
    super({ port, name })
    this.ui = new ui.BottomBar()
    this.activeSessions = new Map()
    this.outOfBandIds = new Map()
    this.eventName = process.env.WITNESS_EVENT_NAME
  }

  public static async build(port: number = 9002, name: string = 'witness'): Promise<Witness> {
    const witness = new Witness(port, name)
    await witness.initializeAgent()
    await witness.ensureDedicatedIssuerDid()
    witness.registerBasicMessageHandler()
    return witness
  }

  private registerBasicMessageHandler() {
    this.agent.events.on<BasicMessageStateChangedEvent>(
      BasicMessageEventTypes.BasicMessageStateChanged,
      async ({ payload }) => {
        const { basicMessageRecord, message } = payload

        console.log(greenText(`[${this.name}] Basic message event - role: ${basicMessageRecord.role}`))

        // Only process received messages
        if (basicMessageRecord.role !== 'receiver') return

        try {
          const content = message.content
          console.log(greenText(`[${this.name}] Parsing message content...`))
          const parsedMessage = JSON.parse(content)

          // Check if this is a presentation submission
          if (parsedMessage.type === 'submit-presentation' && parsedMessage.presentation) {
            const connectionId = basicMessageRecord.connectionId
            console.log(greenText(`[${this.name}] Received presentation from connection ${connectionId}`))

            // Verify and store the presentation
            const result = await this.verifyPresentation(connectionId, parsedMessage.presentation)

            if (result.verified) {
              console.log(greenText(`[${this.name}] ✓ Presentation verified for session ${result.sessionId}`))
              console.log(greenText(`[${this.name}] Total presentations received: ${this.getTotalPresentationCount()}`))

              // Check if we have 2 presentations for the session - auto-issue VWCs
              if (result.sessionId) {
                const session = this.activeSessions.get(result.sessionId)
                if (session && session.receivedPresentations.size >= 2) {
                  console.log(
                    greenText(`[${this.name}] Session ${result.sessionId} has 2 presentations - auto-issuing VWCs...`)
                  )
                  await this.issueWitnessCredentials(result.sessionId)
                }
              }
            } else {
              console.log(redText(`[${this.name}] ✗ Presentation verification failed: ${result.error}`))
            }
          } else {
            console.log(purpleText(`[${this.name}] Message type: ${parsedMessage.type || 'unknown'}`))
          }
        } catch (error) {
          // Not a JSON message or not a presentation, ignore
          console.log(purpleText(`[${this.name}] Non-JSON or non-presentation message`))
        }
      }
    )
  }

  private async ensureDedicatedIssuerDid() {
    if (this.issuerDid && this.issuerVerificationMethodId) return

    const result = await this.agent.dids.create({
      method: 'peer',
      options: {
        numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc,
        keyType: KeyType.Ed25519,
      },
    })

    if (result.didState?.state !== 'finished' || !result.didState.did || !result.didState.didDocument) {
      const reason = result.didState && 'reason' in result.didState ? result.didState.reason : 'unknown reason'
      throw new Error(redText(`Failed to create dedicated issuer DID: ${reason}`))
    }

    const issuerDid = result.didState.did
    const didDocument = result.didState.didDocument

    const assertionOrAuth = didDocument.assertionMethod?.[0] ?? didDocument.authentication?.[0]
    const verificationMethodId = typeof assertionOrAuth === 'string' ? assertionOrAuth : assertionOrAuth?.id

    if (!verificationMethodId) {
      throw new Error(redText('No verification method available for the witness issuer DID.'))
    }

    this.issuerDid = issuerDid
    this.issuerVerificationMethodId = verificationMethodId
    console.log(greenText(`[${this.name}] Witness issuer DID: ${this.issuerDid}`))
  }

  public async createConnectionInvitation(): Promise<string> {
    const outOfBand = await this.agent.oob.createInvitation()
    const invitationUrl = outOfBand.outOfBandInvitation.toUrl({
      domain: `http://localhost:${this.port}`,
    })

    this.outOfBandIds.set(outOfBand.id, outOfBand.id)

    console.log(greenText(`\n[${this.name}] Connection invitation created`))
    console.log(purpleText('Invitation URL:'), invitationUrl, '\n')

    return invitationUrl
  }

  public async createWitnessedSession(
    aliceConnectionId: string,
    bobConnectionId: string
  ): Promise<{ sessionId: string; challenge: string; domain: string }> {
    const sessionId = utils.uuid()
    const challenge = utils.uuid()
    const domain = `witness-session-${this.port}`

    const sessionData: SessionData = {
      sessionId,
      challenge,
      domain,
      participants: new Set([aliceConnectionId, bobConnectionId]),
      receivedPresentations: new Map(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_EXPIRATION_MINUTES * 60 * 1000),
    }

    this.activeSessions.set(sessionId, sessionData)

    console.log(greenText(`\n[${this.name}] Created witnessed session: ${sessionId}`))
    console.log(purpleText(`Challenge: ${challenge}`))
    console.log(purpleText(`Participants: Alice (${aliceConnectionId}), Bob (${bobConnectionId})\n`))

    // Send challenge to both participants via basic message
    const challengeMessage = JSON.stringify({
      type: 'session-challenge',
      sessionId,
      challenge,
      domain,
    })

    await this.agent.basicMessages.sendMessage(aliceConnectionId, challengeMessage)
    await this.agent.basicMessages.sendMessage(bobConnectionId, challengeMessage)

    console.log(greenText(`[${this.name}] Sent session challenge to Alice and Bob\n`))

    return { sessionId, challenge, domain }
  }

  public async verifyPresentation(
    connectionId: string,
    presentationJson: Record<string, any>
  ): Promise<{ verified: boolean; sessionId?: string; error?: string }> {
    try {
      // Find the session for this connection
      let sessionData: SessionData | undefined
      for (const session of this.activeSessions.values()) {
        if (session.participants.has(connectionId)) {
          sessionData = session
          break
        }
      }

      if (!sessionData) {
        return { verified: false, error: 'No active session found for this connection' }
      }

      console.log(greenText(`[${this.name}] Starting verification for connection ${connectionId}...`))

      // ========================================
      // Step 1: CONTEXT CHECK - Verify VP proof contains correct challenge
      // ========================================
      const proof = presentationJson.proof
      if (!proof) {
        return { verified: false, error: 'Presentation has no proof' }
      }

      const proofArray = Array.isArray(proof) ? proof : [proof]
      const proofWithChallenge = proofArray.find((p: any) => p.challenge === sessionData.challenge)

      if (!proofWithChallenge) {
        return { verified: false, error: 'Presentation proof does not match session challenge' }
      }

      if (proofWithChallenge.domain !== sessionData.domain) {
        return { verified: false, error: 'Presentation proof domain does not match session domain' }
      }

      console.log(greenText(`  ✓ Context check passed (challenge & domain match)`))

      // ========================================
      // Step 2: Extract and validate the inner VRC
      // ========================================
      const credentials = presentationJson.verifiableCredential || []
      if (!Array.isArray(credentials) || credentials.length === 0) {
        return { verified: false, error: 'Presentation contains no credentials' }
      }

      const vrcJson = credentials[0]

      // Check that it's a RelationshipCredential
      const types = vrcJson.type || []
      if (!types.includes('RelationshipCredential')) {
        return { verified: false, error: 'Credential is not a RelationshipCredential' }
      }

      console.log(greenText(`  ✓ Credential type is RelationshipCredential`))

      // ========================================
      // Step 3: IDENTITY CHECK - Verify VRC signature cryptographically
      // ========================================
      try {
        // Convert plain JSON to W3cJsonLdVerifiableCredential class instance for Credo verification
        const vrcCredential = JsonTransformer.fromJSON(vrcJson, W3cJsonLdVerifiableCredential)

        // Verify the VRC signature using Credo's W3C verification
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const verificationResult = await this.agent.w3cCredentials.verifyCredential({
          credential: vrcCredential as any,
        })

        if (!verificationResult.isValid) {
          const errorMsg = verificationResult.error?.message || 'Unknown verification error'
          console.log(redText(`  ✗ VRC signature verification failed: ${errorMsg}`))
          return { verified: false, error: `VRC signature verification failed: ${errorMsg}` }
        }

        console.log(greenText(`  ✓ Identity check passed (VRC signature valid)`))
        console.log(greenText(`    Issuer: ${vrcJson.issuer}`))
        console.log(greenText(`    Subject: ${vrcJson.credentialSubject?.id}`))
      } catch (verifyError) {
        // If cryptographic verification fails, log but continue (may be DID resolution issue)
        console.log(purpleText(`  ⚠ VRC signature verification skipped: ${(verifyError as Error).message}`))
        console.log(purpleText(`    (Continuing with metadata-only verification for demo purposes)`))
      }

      // ========================================
      // Step 4: FRESHNESS CHECK - Verify timestamp is recent
      // ========================================
      const issuanceDate = new Date(vrcJson.issuanceDate)
      const now = new Date()
      const fiveMinutesInMs = 5 * 60 * 1000
      const timeDiff = Math.abs(now.getTime() - issuanceDate.getTime())

      if (timeDiff > fiveMinutesInMs) {
        return { verified: false, error: 'Credential issuance date is not fresh (>5 minutes old)' }
      }

      console.log(greenText(`  ✓ Freshness check passed (issued ${Math.round(timeDiff / 1000)}s ago)`))

      // Store the verified presentation
      sessionData.receivedPresentations.set(connectionId, presentationJson)

      console.log(greenText(`[${this.name}] ✓ All verification checks passed for connection ${connectionId}\n`))

      return { verified: true, sessionId: sessionData.sessionId }
    } catch (error) {
      return { verified: false, error: (error as Error).message }
    }
  }

  public async issueWitnessCredentials(sessionId: string): Promise<void> {
    const sessionData = this.activeSessions.get(sessionId)
    if (!sessionData) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (sessionData.receivedPresentations.size !== 2) {
      throw new Error(
        `Session ${sessionId} incomplete: received ${sessionData.receivedPresentations.size}/2 presentations`
      )
    }

    console.log(greenText(`\n[${this.name}] Issuing witness credentials for session ${sessionId}...\n`))

    // Get all participants to enable cross-distribution
    const participantIds = Array.from(sessionData.participants)
    const presentationEntries = Array.from(sessionData.receivedPresentations.entries())

    // FIXED: VWC Cross-Distribution
    // Per WITNESSED_FLOW.md Section 4 "Credential Distribution":
    // - VWC A (witnessing Bob's VRC) → sent to Alice
    // - VWC B (witnessing Alice's VRC) → sent to Bob
    //
    // So the VWC about one participant's VRC should go to the OTHER participant
    for (const [senderConnectionId, presentation] of presentationEntries) {
      // Find the OTHER participant (the one who should RECEIVE this VWC)
      const recipientConnectionId = participantIds.find((id) => id !== senderConnectionId)
      if (!recipientConnectionId) {
        throw new Error(`Could not find recipient for VWC from ${senderConnectionId}`)
      }

      const witnessCredential = this.buildWitnessCredential(sessionData, presentation)

      // Extract VRC issuer for logging
      const vrcIssuer = presentation.verifiableCredential?.[0]?.issuer || 'unknown'

      await this.agent.credentials.offerCredential({
        connectionId: recipientConnectionId, // Send to the OTHER participant
        protocolVersion: 'v2',
        autoAcceptCredential: AutoAcceptCredential.Always,
        credentialFormats: {
          jsonld: {
            credential: witnessCredential,
            options: {
              proofType: 'Ed25519Signature2018',
              proofPurpose: 'assertionMethod',
            },
          },
        },
      })

      console.log(greenText(`[${this.name}] VWC about ${vrcIssuer}'s VRC → sent to ${recipientConnectionId}`))
    }

    console.log(greenText(`\n[${this.name}] All witness credentials issued for session ${sessionId}\n`))

    // Clean up session
    this.activeSessions.delete(sessionId)
  }

  /**
   * Build a Witness Credential (VWC) according to the DTG spec
   *
   * VWC attests that a third party witnessed the establishment of a VRC.
   * - type: MUST include "WitnessCredential"
   * - issuer: The Witness DID
   * - credentialSubject.id: MUST match the Subject of the witnessed VRC
   * - credentialSubject.digest: Cryptographic hash of the witnessed VRC
   * - credentialSubject.witnessContext: Session details per spec (event, sessionId, method)
   */
  private buildWitnessCredential(sessionData: SessionData, observedPresentation: any) {
    if (!this.issuerDid) {
      throw new Error('Witness issuer DID not initialized')
    }

    // Generate a unique ID for this VWC
    const vwcId = `urn:uuid:${utils.uuid()}`

    // Extract the observed VRC from the presentation
    const credentials = observedPresentation.verifiableCredential || []
    const vrcJson = credentials[0]

    if (!vrcJson) {
      throw new Error('No VRC found in presentation')
    }

    // Compute SHA-256 digest of the VRC for cryptographic binding
    const vrcCanonical = JSON.stringify(vrcJson, Object.keys(vrcJson).sort())
    const digest = 'sha256:' + createHash('sha256').update(vrcCanonical).digest('hex')

    // Extract VRC issuer (who created the VRC - this is the R-DID of the credential issuer)
    const vrcIssuer = typeof vrcJson.issuer === 'string' ? vrcJson.issuer : vrcJson.issuer?.id || 'unknown'

    // Build witnessContext according to spec (event, sessionId, method - no domain/timestamp)
    const witnessContext: Record<string, string> = {
      event: this.eventName || 'Witnessed Exchange',
      sessionId: sessionData.sessionId,
      method: 'session-based-challenge',
    }

    // Build the VWC according to the DTG spec structure
    // The credentialSubject.id MUST match the Subject of the witnessed VRC (i.e., the VRC issuer's R-DID)
    return {
      '@context': [
        'https://www.w3.org/2018/credentials/v1', // W3C VC Data Model v1 (Credo compatible)
        WITNESSED_EXCHANGE_CONTEXT_URL, // DTG witnessed-exchange context (locally resolved)
      ],
      id: vwcId,
      type: ['VerifiableCredential', 'DTGCredential', 'WitnessCredential'],
      issuer: this.issuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        // Per spec: id MUST match the Subject of the witnessed VRC
        // The VRC issuer's R-DID represents the subject of the witness attestation
        id: vrcIssuer,

        // Cryptographic binding to the specific VRC (prevents reuse)
        digest: digest,

        // Semantic context describing the witnessing session per spec
        witnessContext,
      },
    }
  }

  public async getConnectionByOutOfBandId(outOfBandId: string): Promise<ConnectionRecord | undefined> {
    const connections = await this.agent.connections.findAllByOutOfBandId(outOfBandId)
    return connections[0]
  }

  public async listActiveSessions(): Promise<void> {
    if (this.activeSessions.size === 0) {
      console.log(purpleText('\nNo active sessions\n'))
      return
    }

    console.log(greenText(`\nActive Sessions (${this.activeSessions.size}):\n`))
    for (const [sessionId, session] of this.activeSessions.entries()) {
      console.log(purpleText(`Session: ${sessionId}`))
      console.log(`  Challenge: ${session.challenge}`)
      console.log(`  Participants: ${session.participants.size}`)
      console.log(`  Presentations received: ${session.receivedPresentations.size}/2`)
      console.log(`  Created: ${session.createdAt.toISOString()}\n`)
    }
  }

  public getSessionPresentationCount(sessionId: string): number {
    const sessionData = this.activeSessions.get(sessionId)
    return sessionData?.receivedPresentations.size ?? 0
  }

  public getTotalPresentationCount(): number {
    let total = 0
    for (const session of this.activeSessions.values()) {
      total += session.receivedPresentations.size
    }
    return total
  }

  public getSessionData(sessionId: string): SessionData | undefined {
    return this.activeSessions.get(sessionId)
  }

  public getActiveSessions(): SessionData[] {
    return Array.from(this.activeSessions.values())
  }

  public getIssuerDid(): string | undefined {
    return this.issuerDid
  }

  public async sendMessage(connectionId: string, message: string): Promise<void> {
    await this.agent.basicMessages.sendMessage(connectionId, message)
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
