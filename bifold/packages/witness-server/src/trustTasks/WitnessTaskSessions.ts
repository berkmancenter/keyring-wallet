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

import { TaskLocalityProvider, LocalityObservationResult } from './BleLocalityProvider'
import { digestMultibase, signDocumentProof, taskDigestMultibase, verifyDocumentProof } from './documentProof'
import { consume, errorDocument, respondWith } from './framework'
import {
  LocalityAssertion,
  LocalityMethod,
  LocalityObservation,
  LocalityTranscript,
  LOCALITY_EXT_NAMESPACE,
  assertionFromObservation,
  transcriptDigestMultibase,
  transcriptKeyMatchesVrcSigner,
  verifyTranscript,
} from './locality'
import { TrustTaskMessage } from './TrustTaskMessage'

const SESSION_TYPE = 'https://trusttasks.org/spec/witness/session/0.1'
const SUBMIT_TYPE = 'https://trusttasks.org/spec/witness/session/submit/0.1'
const DISCOVERY_TYPE = 'https://trusttasks.org/spec/trust-task-discovery/0.1'
const SUBMIT_NOT_BOUND = 'witness/session/submit:challengeMismatch'
const LOCALITY_METHOD: LocalityMethod = 'ble-challenge-response/0.1'
const LOCALITY_WINDOW_SECONDS = 120
/**
 * Provisional — ref-06p4 measured a real bound's first-fully-caught point
 * at 100ms against a 224.7ms honest-p95 bound on ONE adapter/phone pairing
 * (docs/plans/locality-plan.md §11-Q1). Not yet calibrated against venue
 * hardware; recorded here as a single named constant so replacing it later
 * is a one-line change, not a search-and-replace.
 */
const PROVISIONAL_RTT_BOUND_MS = 400

/** off: no locality leg. offered: attempt it, annotate either way. required: refuse without a confirmed observation (plan §8.2). */
export type LocalityPolicy = 'off' | 'offered' | 'required'

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
  /** Kicked off in handleSession, awaited in handleSubmit — the radio phase runs concurrently with VP assembly (plan §5.1). */
  localityObservation?: Promise<LocalityObservationResult | null>
}

export interface WitnessTaskHost {
  agent: Agent
  name: string
  domain: string
  eventName?: string
  /** off | offered | required (plan §8.2). Defaults to 'off' if omitted. */
  localityPolicy?: LocalityPolicy
  /** The witness's claim about itself — plan §7.1's `localityVenue`, unverified in v1 (§11-Q4). */
  venueClaim?: string
  localityProvider?: TaskLocalityProvider
  getIssuer(): Promise<{ did: string; verificationMethodId: string }>
  buildVwcJson(presentation: Record<string, unknown>, sessionId: string, localityAssertion?: LocalityAssertion): Record<string, unknown>
  /** The observed VRC's hardware-attestation public key (base64), if any — for the §7.3 step-6 key-match check. */
  vrcHardwareAttestationPublicKey(presentation: Record<string, unknown>): string | undefined
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
    } else if (type === DISCOVERY_TYPE) {
      reply = await this.handleDiscovery(document, theirDid)
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

  /**
   * trust-task-discovery → this witness's supportedTypes. Plan §8.2: the
   * witness publishes its locality policy here rather than a wallet
   * discovering it from a refusal. `required` carries the framework's own
   * `requiredExt` entry, which is what makes `handleSession`'s
   * `requiredExtNamespaces` check (SPEC.md §7.2) meaningful — a wallet that
   * ignores this and proposes without the namespace gets `malformedRequest`
   * from the framework rule itself, not from locality-specific logic.
   */
  private async handleDiscovery(document: Record<string, unknown>, theirDid: string): Promise<Record<string, unknown>> {
    return consume({
      document,
      senderDid: theirDid,
      proofRequired: false,
      handler: async (doc) => {
        const policy = this.host.localityPolicy ?? 'off'
        const supportedTypes: unknown[] =
          policy === 'required'
            ? [{ type: SESSION_TYPE, requiredExt: [LOCALITY_EXT_NAMESPACE] }, SUBMIT_TYPE]
            : [SESSION_TYPE, SUBMIT_TYPE]
        return respondWith(doc, { supportedTypes })
      },
    })
  }

  /** witness/session → per-party session with a fresh single-use challenge. */
  private async handleSession(
    document: Record<string, unknown>,
    connectionId: string,
    theirDid: string
  ): Promise<Record<string, unknown>> {
    const policy = this.host.localityPolicy ?? 'off'
    return consume({
      document,
      senderDid: theirDid,
      proofRequired: false,
      // SPEC.md §7.2's own enforcement, per plan §8.2: a `required` policy
      // publishes the expanded supportedTypes entry with `requiredExt`
      // (handled by the discovery responder), and the framework's OWN rule
      // rejects a document missing that namespace — locality writes no
      // gating logic of its own.
      requiredExtNamespaces: policy === 'required' ? [LOCALITY_EXT_NAMESPACE] : undefined,
      handler: async (doc) => {
        const parties = (doc.payload as { parties?: [string, string] } | undefined)?.parties
        if (!parties || parties.length !== 2) {
          return errorDocument(doc, 'malformedRequest', 'session payload must name exactly two parties')
        }
        const challenge = randomBytes(16).toString('hex')
        const sessionDigest = taskDigestMultibase(document)
        const localityOffer = (
          (doc.payload as { ext?: Record<string, { locality?: { offered?: boolean } }> } | undefined)?.ext ?? {}
        )[LOCALITY_EXT_NAMESPACE]?.locality

        const session: TaskSession = {
          sessionId: String(doc.id),
          sessionDoc: document,
          connectionId,
          parties,
          challenge,
          domain: this.host.domain,
          createdAt: new Date(),
        }

        let responseExt: Record<string, unknown> | undefined
        if (policy !== 'off' && localityOffer?.offered && this.host.localityProvider) {
          // §4.2: the sensor DID equals the witness DID in phase 1 — a
          // single sensor-DID field from the first implementation, so a
          // second sensor later is a deployment change, not a schema one.
          const sensorDid = (await this.host.getIssuer()).did
          session.localityObservation = this.host.localityProvider.observeSession({
            sessionTaskDigestMultibase: sessionDigest,
            challenge,
            sensorDid,
            windowSeconds: LOCALITY_WINDOW_SECONDS,
          })
          responseExt = {
            [LOCALITY_EXT_NAMESPACE]: {
              locality: {
                policy,
                method: LOCALITY_METHOD,
                sensorDid,
                windowSeconds: LOCALITY_WINDOW_SECONDS,
              },
            },
          }
        }

        this.sessions.set(session.sessionId, session)
        this.expireSessionsOlderThan(SESSION_TTL_MS)
        console.log(`[${this.host.name}] Task session ${doc.id} opened for parties [${parties.join(', ')}]`)
        return respondWith(doc, { challenge, domain: this.host.domain, ...(responseExt ? { ext: responseExt } : {}) })
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

        // ---- locality: resolve the observation, if this session has one ----
        const policy = this.host.localityPolicy ?? 'off'
        let observation: LocalityObservation | undefined
        let keyMatches: boolean | undefined
        let observedTranscript: LocalityTranscript | undefined
        if (policy !== 'off') {
          const sensorDid = (await this.host.getIssuer()).did
          if (!session.localityObservation) {
            // The party's own session request didn't offer locality (or
            // offered it with no provider configured) — §7.1's second
            // explicit state, a choice, not a failure.
            observation = {
              method: 'none', sensorDid, observedAt: new Date().toISOString(), confirmed: false, reason: 'declinedByHolder',
            }
          } else {
            const result = await session.localityObservation
            if (!result) {
              // §5.5: the sensor's own window elapsed with no matching
              // advert — the app backgrounded, locked, or the ceremony
              // moved on before the radio phase completed.
              observation = {
                method: 'none', sensorDid, observedAt: new Date().toISOString(), confirmed: false, reason: 'windowLost',
              }
            } else {
              observedTranscript = result.transcript
              const verdict = verifyTranscript(result.transcript, {
                taskDigestMultibase: taskDigestMultibase(session.sessionDoc),
                challenge: session.challenge,
                sensorNonce: result.sensorNonce,
                sensorDid,
              })
              if (!verdict.ok) {
                return errorDocument(doc, 'malformedRequest', `locality transcript failed verification: ${verdict.reason}`)
              }
              keyMatches = transcriptKeyMatchesVrcSigner(result.transcript, this.host.vrcHardwareAttestationPublicKey(vpJson))
              observation = {
                method: LOCALITY_METHOD,
                sensorDid,
                venueClaim: this.host.venueClaim,
                observedAt: new Date().toISOString(),
                windowSeconds: LOCALITY_WINDOW_SECONDS,
                confirmed: true,
                deviceKeyId: result.transcript.devicePublicKey, // artifact side only — never enters the assertion (rule 3)
                transcriptDigestMultibase: transcriptDigestMultibase(result.transcript),
                corroboration: { rttMs: result.rttMs, rssiDbm: result.rssiDbm, rttBoundMs: PROVISIONAL_RTT_BOUND_MS },
              }
            }
          }
        }

        // Build the VWC and bind it to THIS session (§4.9.1 + §4.9.3).
        const localityAssertion = observation
          ? assertionFromObservation(observation, keyMatches, observedTranscript?.hardwareAttestation)
          : undefined
        const vwcJson = this.host.buildVwcJson(vpJson, session.sessionId, localityAssertion)
        const subject = (vwcJson.credentialSubject ?? {}) as Record<string, unknown>
        subject.parties = session.parties
        subject.taskContext = session.sessionId
        subject.taskDigestMultibase = taskDigestMultibase(session.sessionDoc)
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

        const responseExt = observation
          ? { [LOCALITY_EXT_NAMESPACE]: { locality: { observation } } }
          : undefined
        return respondWith(doc, {
          vwc: signedVwcJson,
          vwcDigestMultibase: digestMultibase(signedVwcJson),
          ...(responseExt ? { ext: responseExt } : {}),
        })
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
