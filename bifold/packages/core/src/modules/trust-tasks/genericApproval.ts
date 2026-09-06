/**
 * Generic approve/deny scaffolding for a registered Trust Task type whose
 * request leg needs a PERSON'S decision rather than an automatic protocol
 * reply — the piece 2026-09-01-al.md §1 and the plan's Idea 1 ("The
 * Approver") both call out as missing: "there is no UI anywhere... that
 * renders an arbitrary incoming Trust Task's payload and lets a person
 * approve/deny it with a signed response."
 *
 * A registration wanting this shape builds its `handleRequest` from
 * {@link createApprovalRequestHandler} instead of writing
 * consume/prompt/respond plumbing itself (mirroring how
 * `handleInboundPropose` defers to the user via `pendingProposals` /
 * `respondToRelationshipProposal` in `ceremony.ts` — this is that same
 * pattern, generalized). The Approver demo profile
 * (`app/src/demo-profiles/approver/`) is the first, but not the only,
 * consumer: any future Approver-shaped registration (More Factors, Human
 * Factor Authentication — see the plan's Idea 3 and 9) rides the same
 * scaffold.
 *
 * Deliberately imports `sendTrustTaskDocument` / `getTrustTasksService` from
 * `./ceremony` rather than reimplementing carriage selection — those two
 * functions are already Carriage-shaped (binding-0.2 today, TSP when
 * `setTspCarriageEnabled` opts in), so this module inherits that transport
 * neutrality for free rather than re-deciding it.
 *
 * @module trust-tasks/genericApproval
 */

import type { Agent } from '@credo-ts/core'
import { utils } from '@credo-ts/core'

import { getTrustTasksService, sendTrustTaskDocument } from './ceremony'
import { signDocumentProof } from './documentProof'
import type { InboundContext, TrustTaskDocumentHandler } from './registry'
import type { ConsumeOptions, TrustTaskSpecPolicy } from './services/TrustTasksService'
import { respondWith } from './services/TrustTasksService'
import { trustTaskPromptStore } from './trustTaskPromptStore'

const LOG_PREFIX = '[TrustTasks:Approval]'

export interface CreateApprovalRequestHandlerOptions {
  /** The request-leg spec (SPEC) governing this task type — schema validation, proof requirement, recipient requirement, same as every other `consume` call site. */
  spec: TrustTaskSpecPolicy
  /** Reduce the payload to a one-line summary for a chrome with no registered renderer for this type. */
  summarize: (payload: Record<string, unknown>) => string
  /**
   * Same proof-policy shape `TrustTasksService.consume` takes, or a resolver
   * called with the agent and the inbound context to build one per-sender —
   * the common case, since "verify under whichever identity this specific
   * contact already established" (an existing relationship DID) is a
   * per-sender lookup, not a fixed value known at registration time. Omit
   * for the service default (`acceptUnverified`).
   */
  proofPolicy?:
    | ConsumeOptions['proofPolicy']
    | ((agent: Agent, context: InboundContext) => Promise<ConsumeOptions['proofPolicy']>)
}

/**
 * Build a `handleRequest` that runs the document through the framework
 * pipeline, then — on acceptance — surfaces it in
 * {@link trustTaskPromptStore} instead of auto-replying. Nothing is sent on
 * the wire until {@link respondToPendingTrustTask} is called with the
 * person's decision.
 */
export function createApprovalRequestHandler(options: CreateApprovalRequestHandlerOptions): TrustTaskDocumentHandler {
  return async (agent: Agent, service, document, context: InboundContext) => {
    const proofPolicy =
      typeof options.proofPolicy === 'function' ? await options.proofPolicy(agent, context) : options.proofPolicy
    const outcome = await service.consume(agent.context, {
      spec: options.spec,
      document,
      myDid: context.recipientDid,
      senderDid: context.senderDid,
      connectionId: context.connectionId,
      proofPolicy,
      // Deferred to the user, exactly like handleInboundPropose: a handler
      // returning nothing is an 'accepted' outcome with no reply on the wire
      // yet — the reply leaves only when respondToPendingTrustTask runs.
      handler: async () => undefined,
    })

    if (outcome.kind === 'rejected') {
      agent.config.logger.warn(
        `${LOG_PREFIX} request rejected by the framework pipeline: ${JSON.stringify((outcome as { error?: { payload?: unknown } }).error?.payload)}`
      )
      return
    }

    const connection = await agent.modules.didcomm.connections.getById(context.connectionId)
    const payload = (document as { payload?: Record<string, unknown> }).payload ?? {}
    trustTaskPromptStore.setPending({
      connectionId: context.connectionId,
      typeUri: String(document.type),
      document,
      counterpartyLabel: connection.theirLabel ?? 'Unknown Contact',
      summary: options.summarize(payload),
    })
    agent.config.logger.info(
      `${LOG_PREFIX} request received — awaiting user decision (type ${document.type}, id ${document.id})`
    )
  }
}

/**
 * The person's answer to a pending approval request: build the `#response`
 * document via {@link respondWith} (so its `id`/`threadId`/party bindings
 * follow the framework's own rules for a reply, the same helper
 * `handleInboundIssue` etc. use), optionally sign it under a relationship DID
 * (the Approver demo's own registration passes one — see its ceremony
 * module), retain it, and send it.
 *
 * `buildResponsePayload` is supplied by the registration rather than fixed
 * here, because what a decision payload looks like is task-type-specific —
 * the Approver demo's is `{ decision, respondedAt }`; a future factor-check
 * task might carry evidence alongside the decision.
 */
export async function respondToPendingTrustTask(
  agent: Agent,
  connectionId: string,
  typeUri: string,
  decision: 'approved' | 'denied',
  buildResponsePayload: (decision: 'approved' | 'denied') => Record<string, unknown>,
  signUnderRelationshipDid?: string
): Promise<void> {
  const logger = agent.config.logger
  const pending = trustTaskPromptStore.takePending(connectionId, typeUri)
  if (!pending) {
    logger.warn(`${LOG_PREFIX} no pending request for connection ${connectionId}, type ${typeUri}`)
    return
  }

  const service = getTrustTasksService(agent)
  const response = respondWith(pending.document as never, utils.uuid(), buildResponsePayload(decision), () =>
    new Date().toISOString()
  ) as unknown as Record<string, unknown>
  const signed = signUnderRelationshipDid
    ? await signDocumentProof(agent, response, signUnderRelationshipDid)
    : response

  await service.retain(agent.context, signed, 'response', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)
  logger.info(`${LOG_PREFIX} decision (${decision}) sent for type ${typeUri} on connection ${connectionId}`)
}
