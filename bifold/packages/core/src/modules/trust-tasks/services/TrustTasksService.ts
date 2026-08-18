/**
 * TrustTasksService
 *
 * The wallet's seam onto the Trust Tasks framework: consume an inbound
 * document through the official §7.2 pipeline (`@openvtc/trust-tasks`, the
 * 0.9 Cypress lock — schema validation is REAL and mandatory here), and build
 * outbound carriages on the binding-0.2 dedicated message type.
 *
 * Identity mapping (binding §4.8.1): the transport-authenticated sender is
 * the Credo connection's `theirDid`. A document arriving with no connection
 * is consumed under the unauthenticated transport — never trust its in-band
 * `issuer` (the carriage delivers such messages to the handler; measured in
 * ref-06v1c act 5).
 *
 * @module trust-tasks/services/TrustTasksService
 */

import type { AgentContext } from '@credo-ts/core'
import {
  consumeInbound,
  respondWith,
  refuse,
  extendedCode,
  StaticTransport,
  UnauthenticatedTransport,
} from '@openvtc/trust-tasks'

import { TrustTaskMessage, TRUST_TASK_BINDING_URI } from '../messages/TrustTaskMessage'
import { trustTaskPayloadValidator } from '../validator'
import { TrustTaskDocumentRecord, TrustTaskDocumentRole } from './TrustTaskDocumentRecord'
import { TrustTaskDocumentRepository } from './TrustTaskDocumentRepository'

/** The subset of a generated spec module the pipeline needs (SPEC/RESPONSE_SPEC). */
export interface TrustTaskSpecPolicy {
  typeUri: string
  isBearer: boolean
  isProofRequired: boolean
  isRecipientRequired: boolean
  payloadSchema?: unknown
}

export interface ConsumeOptions {
  /** The generated spec (SPEC or RESPONSE_SPEC) governing this document. */
  spec: TrustTaskSpecPolicy
  /** The inbound Trust Task document. */
  document: Record<string, unknown>
  /** This agent's DID on the connection the document arrived on. */
  myDid: string
  /** The connection's theirDid — undefined for a connection-less arrival (case 2). */
  senderDid?: string
  /** Credo connection id, recorded on the retained document. */
  connectionId?: string
  /**
   * Proof policy. The module ships `acceptUnverified` as the placeholder the
   * reference rungs used; milestone 3 replaces it with the eddsa-jcs-2022
   * verifier. Passing a real verifier here already works.
   */
  proofPolicy?: Parameters<typeof consumeInbound>[0]['proofPolicy']
  /** Handler invoked for an accepted document; its return is the reply (or undefined). */
  handler: (document: Record<string, unknown>, parties: unknown) => unknown | Promise<unknown>
}

let errorSequence = 0

export class TrustTasksService {
  public constructor(private readonly documentRepository: TrustTaskDocumentRepository) {}

  /**
   * Run one inbound document through the framework pipeline (§7.2: schema
   * validation, identity cross-check, proof policy, oracle suppression),
   * retaining the document and any reply for outcome evidence.
   */
  public async consume(agentContext: AgentContext, options: ConsumeOptions) {
    const transport = options.senderDid
      ? new StaticTransport({ issuer: options.senderDid, recipient: options.myDid }, TRUST_TASK_BINDING_URI)
      : new UnauthenticatedTransport(TRUST_TASK_BINDING_URI)

    const outcome = await consumeInbound({
      transport,
      spec: options.spec,
      proofPolicy: options.proofPolicy ?? { kind: 'acceptUnverified' },
      payloadPolicy: { kind: 'validate', validate: trustTaskPayloadValidator },
      // The framework types documents as TrustTaskDocument<P>; this module
      // deals in retained JSON verbatim, so the boundary is a cast, not a copy.
      doc: options.document as never,
      myVid: options.myDid,
      now: Date.now(),
      newErrorId: () => `err-${Date.now()}-${++errorSequence}`,
      handler: options.handler as never,
    })

    // Retain the document regardless of outcome — rejected documents are
    // diagnostic state; accepted ones are (half of) outcome evidence.
    await this.retain(agentContext, options.document, roleOf(options.document), options.connectionId)
    if (outcome.kind === 'handled' && outcome.response) {
      await this.retain(agentContext, outcome.response as Record<string, unknown>, 'response', options.connectionId)
    }
    return outcome
  }

  /** Build the binding-0.2 carriage message for an outbound document. */
  public buildMessage(document: Record<string, unknown>): TrustTaskMessage {
    return new TrustTaskMessage({ document })
  }

  /** Persist a document verbatim. */
  public async retain(
    agentContext: AgentContext,
    document: Record<string, unknown>,
    role: TrustTaskDocumentRole,
    connectionId?: string
  ): Promise<TrustTaskDocumentRecord> {
    const record = new TrustTaskDocumentRecord({ document, role, connectionId })
    await this.documentRepository.save(agentContext, record)
    return record
  }

  /** The outcome-evidence pair for an exchange (see the repository's contract). */
  public async getOutcomeEvidencePair(agentContext: AgentContext, exchangeId: string) {
    return this.documentRepository.findOutcomeEvidencePair(agentContext, exchangeId)
  }
}

/** Re-exported reply helpers so ceremony code needs one import site. */
export { respondWith, refuse, extendedCode }

function roleOf(document: Record<string, unknown>): TrustTaskDocumentRole {
  const type = String(document.type ?? '')
  if (type.includes('/trust-task-error/')) return 'error'
  return type.includes('#response') ? 'response' : 'request'
}
