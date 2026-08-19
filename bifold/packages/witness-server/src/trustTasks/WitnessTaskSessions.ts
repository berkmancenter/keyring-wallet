/**
 * The witness ceremony on Trust Tasks — §9 step 5, witness side.
 *
 * Handles the two witness legs of a witnessed relationship exchange, spoken
 * over the binding-0.2 carriage beside the legacy JSON-over-basicmessage
 * dialect (dual-dialect: old wallets keep working):
 *
 *   wallet → witness   witness/session { parties }            → challenge (signed)
 *   wallet → witness   witness/session/submit { vp }          → { vwc, digest } (signed)
 *
 * Task-dialect sessions are PER PARTY with a unique challenge each — the
 * published spec forbids the legacy design's shared challenge ("a shared
 * value would let either party's presentation satisfy the other's session").
 * The issued VWC carries `taskContext` = the session document's id (§4.9.1)
 * and `taskDigestMultibase` binding that document by digest (§4.9.3).
 *
 * Consume runs through the local minimal pipeline (./framework.ts — the
 * runtime package is ESM-only and this service is CommonJS); the wallet side
 * uses the real framework runtime.
 */

import type { Agent } from '@credo-ts/core'
import { JsonTransformer, W3cCredential, W3cJsonLdVerifiablePresentation, ClaimFormat } from '@credo-ts/core'
import { DidCommMessageHandlerRegistry, DidCommMessageSender, DidCommOutboundMessageContext } from '@credo-ts/didcomm'
import type { DidCommInboundMessageContext } from '@credo-ts/didcomm'
import { randomBytes } from 'node:crypto'

import { getMirroredJsonLdProofOptions } from '@bifold/vrc-shared'

import { digestMultibase, signDocumentProof, verifyDocumentProof } from './documentProof'
import { consume, errorDocument, respondWith } from './framework'
import { TrustTaskMessage } from './TrustTaskMessage'

const SESSION_TYPE = 'https://trusttasks.org/spec/witness/session/0.1'
const SUBMIT_TYPE = 'https://trusttasks.org/spec/witness/session/submit/0.1'
const SUBMIT_NOT_BOUND = 'witness/session/submit:challengeMismatch'

interface TaskSession {
  /** The session document's id — the VWC's taskContext. */
  sessionId: string
  /** The session document AS RECEIVED — what taskDigestMultibase binds. */
  sessionDoc: Record<string, unknown>
  connectionId: string
  parties: [string, string]
  challenge: string
  domain: string
  createdAt: Date
}

export interface WitnessTaskHost {
  agent: Agent
  name: string
  domain: string
  eventName?: string
  getIssuer(): Promise<{ did: string; verificationMethodId: string }>
  buildVwcJson(presentation: Record<string, unknown>, sessionId: string): Record<string, unknown>
}

const SESSION_TTL_MS = 10 * 60 * 1000

export class WitnessTaskSessions {
  private readonly sessions = new Map<string, TaskSession>()

  public constructor(private readonly host: WitnessTaskHost) {}

  /** Register the binding-0.2 inbound handler on the witness agent. */
  public register(): void {
    const registry = this.host.agent.dependencyManager.container.resolve(DidCommMessageHandlerRegistry)
    registry.registerMessageHandler({
      supportedMessages: [TrustTaskMessage],
      handle: async (context: DidCommInboundMessageContext<TrustTaskMessage>) => {
        const document = context.message.document
        const connection = context.connection
        if (!document || !connection?.did || !connection.theirDid) return undefined
        try {
          await this.handleDocument(document, connection.id, connection.did, connection.theirDid)
        } catch (error) {
          console.error(`[${this.host.name}] trust-task handling failed: ${(error as Error).message}`)
        }
        return undefined
      },
    })
    console.log(`[${this.host.name}] Trust Task witness handler registered (binding 0.2)`)
  }

  private async handleDocument(
    document: Record<string, unknown>,
    connectionId: string,
    myDid: string,
    theirDid: string
  ): Promise<void> {
    const type = String(document.type ?? '')
    let reply: Record<string, unknown> | undefined
    if (type === SESSION_TYPE) {
      reply = await this.handleSession(document, connectionId, theirDid)
    } else if (type === SUBMIT_TYPE) {
      reply = await this.handleSubmit(document, connectionId, theirDid)
    }
    // other trust-task types are the wallets' business, not the witness's
    if (!reply) return

    // Both witness responses declare proof REQUIRED — sign success replies
    // with the witness's connection DID (what the wallet verifies under).
    if (String(reply.type ?? '').endsWith('#response')) {
      reply = await signDocumentProof(this.host.agent, reply, myDid)
    }
    const connection = await this.host.agent.modules.didcomm.connections.getById(connectionId)
    const sender = this.host.agent.dependencyManager.container.resolve(DidCommMessageSender)
    await sender.sendMessage(
      new DidCommOutboundMessageContext(new TrustTaskMessage({ document: reply }), {
        agentContext: this.host.agent.context,
        connection,
      })
    )
  }

  /** witness/session → per-party session with a fresh single-use challenge. */
  private async handleSession(
    document: Record<string, unknown>,
    connectionId: string,
    theirDid: string
  ): Promise<Record<string, unknown>> {
    return consume({
      document,
      senderDid: theirDid,
      proofRequired: false,
      handler: async (doc) => {
        const parties = (doc.payload as { parties?: [string, string] } | undefined)?.parties
        if (!parties || parties.length !== 2) {
          return errorDocument(doc, 'malformedRequest', 'session payload must name exactly two parties')
        }
        const challenge = randomBytes(16).toString('hex')
        this.sessions.set(String(doc.id), {
          sessionId: String(doc.id),
          sessionDoc: document,
          connectionId,
          parties,
          challenge,
          domain: this.host.domain,
          createdAt: new Date(),
        })
        this.expireSessionsOlderThan(SESSION_TTL_MS)
        console.log(`[${this.host.name}] Task session ${doc.id} opened for parties [${parties.join(', ')}]`)
        return respondWith(doc, { challenge, domain: this.host.domain })
      },
    })
  }

  /** witness/session/submit → verify the VP against this session, issue the VWC. */
  private async handleSubmit(
    document: Record<string, unknown>,
    connectionId: string,
    theirDid: string
  ): Promise<Record<string, unknown>> {
    return consume({
      document,
      senderDid: theirDid,
      proofRequired: true,
      verifyProof: async (doc) => {
        // The submit's proof must verify under one of the session's parties —
        // the submitting wallet's relationship DID.
        const session = this.sessions.get(String(doc.threadId ?? ''))
        if (!session) return false
        for (const party of session.parties) {
          if (await verifyDocumentProof(this.host.agent, doc, party)) return true
        }
        return false
      },
      handler: async (doc) => {
        const sessionId = String(doc.threadId ?? '')
        const session = this.sessions.get(sessionId)
        if (!session || session.connectionId !== connectionId) {
          return errorDocument(doc, SUBMIT_NOT_BOUND, 'no session on this thread for this connection')
        }

        const vpJson = (doc.payload as { vp?: Record<string, unknown> } | undefined)?.vp
        if (!vpJson) return errorDocument(doc, 'malformedRequest', 'submit payload carries no vp')

        // Verify the presentation cryptographically against THIS session's
        // challenge and domain.
        let vpValid = false
        try {
          const vp = JsonTransformer.fromJSON(vpJson, W3cJsonLdVerifiablePresentation)
          const result = await this.host.agent.w3cCredentials.verifyPresentation({
            presentation: vp as never,
            challenge: session.challenge,
            domain: session.domain,
          })
          vpValid = result.isValid
        } catch {
          vpValid = false
        }
        if (!vpValid) {
          return errorDocument(doc, SUBMIT_NOT_BOUND, 'presentation not bound to this session')
        }

        // The VP holder must be one of the witnessed parties.
        const holder = String((vpJson as { holder?: string }).holder ?? '')
        if (!session.parties.includes(holder as (typeof session.parties)[number])) {
          return errorDocument(doc, SUBMIT_NOT_BOUND, 'presentation holder is not a party to this session')
        }

        // Build the VWC and bind it to THIS session (§4.9.1 + §4.9.3).
        const vwcJson = this.host.buildVwcJson(vpJson, session.sessionId)
        const subject = (vwcJson.credentialSubject ?? {}) as Record<string, unknown>
        subject.parties = session.parties
        subject.taskContext = session.sessionId
        subject.taskDigestMultibase = digestMultibase(session.sessionDoc)
        vwcJson.credentialSubject = subject

        // Sign it, mirroring the observed VRC's proof family.
        const issuer = await this.host.getIssuer()
        const observedVrc = ((vpJson as { verifiableCredential?: unknown[] }).verifiableCredential ?? [])[0] as
          | { proof?: unknown }
          | undefined
        const proofOptions = getMirroredJsonLdProofOptions(observedVrc?.proof)
        const signedVwc = await this.host.agent.w3cCredentials.signCredential({
          format: ClaimFormat.LdpVc,
          credential: JsonTransformer.fromJSON(vwcJson, W3cCredential),
          proofType: proofOptions.proofType,
          verificationMethod: issuer.verificationMethodId,
        })
        const signedVwcJson = JsonTransformer.toJSON(signedVwc) as Record<string, unknown>

        this.sessions.delete(sessionId)
        console.log(`[${this.host.name}] Task session ${sessionId}: VWC issued (taskContext bound)`)

        return respondWith(doc, { vwc: signedVwcJson, vwcDigestMultibase: digestMultibase(signedVwcJson) })
      },
    })
  }

  private expireSessionsOlderThan(ttlMs: number): void {
    const cutoff = Date.now() - ttlMs
    for (const [id, session] of this.sessions) {
      if (session.createdAt.getTime() < cutoff) this.sessions.delete(id)
    }
  }
}
