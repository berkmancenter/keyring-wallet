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
 */

import type { Agent } from '@credo-ts/core'
import { JsonTransformer, W3cCredential, W3cJsonLdVerifiablePresentation, ClaimFormat, utils } from '@credo-ts/core'
import { DidCommMessageHandlerRegistry, DidCommMessageSender, DidCommOutboundMessageContext } from '@credo-ts/didcomm'
import type { DidCommInboundMessageContext } from '@credo-ts/didcomm'
import { consumeInbound, respondWith, rejectWith, extendedCode, StaticTransport } from '@openvtc/trust-tasks'
import { randomBytes } from 'node:crypto'

import { getMirroredJsonLdProofOptions } from '@bifold/vrc-shared'

import { digestMultibase, signDocumentProof, verifyDocumentProof } from './documentProof'
import { TrustTaskMessage, TRUST_TASK_BINDING_URI } from './TrustTaskMessage'

// Type URIs and §7.2 policies for the two witness legs, declared locally:
// this package's classic module resolution cannot see the generated payload
// modules behind @openvtc/trust-tasks' subpath exports. Values mirror the
// published specs (witness/session 0.1, witness/session/submit 0.1) —
// responses proof REQUIRED, submit request proof REQUIRED.
const witnessSession = {
  TYPE_URI: 'https://trusttasks.org/spec/witness/session/0.1',
  SPEC: {
    typeUri: 'https://trusttasks.org/spec/witness/session/0.1',
    isBearer: false,
    isProofRequired: false,
    isRecipientRequired: true,
  },
} as const
const witnessSubmit = {
  TYPE_URI: 'https://trusttasks.org/spec/witness/session/submit/0.1',
  SPEC: {
    typeUri: 'https://trusttasks.org/spec/witness/session/submit/0.1',
    isBearer: false,
    isProofRequired: true,
    isRecipientRequired: true,
  },
} as const

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

let errorSequence = 0
const newErrorId = () => `err-${Date.now()}-${++errorSequence}`

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
    if (type === witnessSession.TYPE_URI) {
      await this.handleSession(document, connectionId, myDid, theirDid)
    } else if (type === witnessSubmit.TYPE_URI) {
      await this.handleSubmit(document, connectionId, myDid, theirDid)
    }
    // other trust-task types are the wallets' business, not the witness's
  }

  /** witness/session → per-party session with a fresh single-use challenge. */
  private async handleSession(
    document: Record<string, unknown>,
    connectionId: string,
    myDid: string,
    theirDid: string
  ): Promise<void> {
    const outcome = await consumeInbound({
      transport: new StaticTransport({ issuer: theirDid, recipient: myDid }, TRUST_TASK_BINDING_URI),
      spec: witnessSession.SPEC as never,
      proofPolicy: { kind: 'acceptUnverified' },
      payloadPolicy: { kind: 'acceptUnvalidated' },
      doc: document as never,
      myVid: myDid,
      now: Date.now(),
      newErrorId,
      handler: (async (doc: { id: string; payload: { parties: [string, string] } }) => {
        const challenge = randomBytes(16).toString('hex')
        const session: TaskSession = {
          sessionId: doc.id,
          sessionDoc: document,
          connectionId,
          parties: doc.payload.parties,
          challenge,
          domain: this.host.domain,
          createdAt: new Date(),
        }
        this.sessions.set(doc.id, session)
        this.expireSessionsOlderThan(SESSION_TTL_MS)
        console.log(
          `[${this.host.name}] Task session ${doc.id} opened for parties [${doc.payload.parties.join(', ')}]`
        )
        const response = respondWith(doc as never, utils.uuid(), { challenge, domain: this.host.domain }, () =>
          new Date().toISOString()
        ) as Record<string, unknown>
        if (document.parentThreadId) response.parentThreadId = document.parentThreadId
        return response
      }) as never,
    })
    await this.reply(outcome as never, connectionId, myDid, /* signResponse */ true)
  }

  /** witness/session/submit → verify the VP against this session, issue the VWC. */
  private async handleSubmit(
    document: Record<string, unknown>,
    connectionId: string,
    myDid: string,
    theirDid: string
  ): Promise<void> {
    const outcome = await consumeInbound({
      transport: new StaticTransport({ issuer: theirDid, recipient: myDid }, TRUST_TASK_BINDING_URI),
      spec: witnessSubmit.SPEC as never,
      proofPolicy: {
        kind: 'verify',
        verify: {
          verify: async (doc: unknown) => {
            // The submit's proof must verify under one of the session's
            // parties — the submitting wallet's relationship DID.
            const threadId = String((doc as { threadId?: string }).threadId ?? '')
            const session = this.sessions.get(threadId)
            if (!session) return false
            for (const party of session.parties) {
              if (await verifyDocumentProof(this.host.agent, doc as Record<string, unknown>, party)) return true
            }
            return false
          },
        },
      },
      payloadPolicy: { kind: 'acceptUnvalidated' },
      doc: document as never,
      myVid: myDid,
      now: Date.now(),
      newErrorId,
      handler: (async (doc: { id: string; threadId?: string; payload: { vp: Record<string, unknown> } }) => {
        const sessionId = String(doc.threadId ?? '')
        const session = this.sessions.get(sessionId)
        if (!session || session.connectionId !== connectionId) {
          return rejectWith(doc as never, utils.uuid(), {
            code: extendedCode(witnessSubmit.TYPE_URI, 'challengeMismatch'),
            message: 'no session on this thread for this connection',
            retryable: false,
          })
        }

        // Verify the presentation cryptographically against THIS session's
        // challenge and domain.
        const vpJson = doc.payload.vp
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
          return rejectWith(doc as never, utils.uuid(), {
            code: extendedCode(witnessSubmit.TYPE_URI, 'challengeMismatch'),
            message: 'presentation not bound to this session',
            retryable: false,
          })
        }

        // The VP holder must be one of the witnessed parties.
        const holder = String((vpJson as { holder?: string }).holder ?? '')
        if (!session.parties.includes(holder as never)) {
          return rejectWith(doc as never, utils.uuid(), {
            code: extendedCode(witnessSubmit.TYPE_URI, 'challengeMismatch'),
            message: 'presentation holder is not a party to this session',
            retryable: false,
          })
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

        const response = respondWith(
          doc as never,
          utils.uuid(),
          { vwc: signedVwcJson, vwcDigestMultibase: digestMultibase(signedVwcJson) },
          () => new Date().toISOString()
        ) as Record<string, unknown>
        if (document.parentThreadId) response.parentThreadId = document.parentThreadId
        return response
      }) as never,
    })
    await this.reply(outcome as never, connectionId, myDid, /* signResponse */ true)
  }

  /** Send a handler outcome back on the connection, signing success responses
   * with the witness's connection DID (both witness responses declare proof
   * REQUIRED — the wallet verifies under our connection DID). */
  private async reply(
    outcome: { kind: string; response?: unknown; error?: unknown },
    connectionId: string,
    myDid: string,
    signResponse: boolean
  ): Promise<void> {
    let payload: Record<string, unknown> | undefined
    if (outcome.kind === 'handled' && outcome.response) {
      payload = outcome.response as Record<string, unknown>
      const isError = String(payload.type ?? '').includes('/trust-task-error/')
      if (signResponse && !isError) {
        payload = await signDocumentProof(this.host.agent, payload, myDid)
      }
    } else if (outcome.kind === 'rejected' && outcome.error) {
      payload = outcome.error as Record<string, unknown>
    }
    if (!payload) return
    const connection = await this.host.agent.modules.didcomm.connections.getById(connectionId)
    const sender = this.host.agent.dependencyManager.container.resolve(DidCommMessageSender)
    await sender.sendMessage(
      new DidCommOutboundMessageContext(new TrustTaskMessage({ document: payload }), {
        agentContext: this.host.agent.context,
        connection,
      })
    )
  }

  private expireSessionsOlderThan(ttlMs: number): void {
    const cutoff = Date.now() - ttlMs
    for (const [id, session] of this.sessions) {
      if (session.createdAt.getTime() < cutoff) this.sessions.delete(id)
    }
  }
}
