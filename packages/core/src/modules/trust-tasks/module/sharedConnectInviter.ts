/**
 * sharedConnectInviter — what a shared-connect link's `_from` says about how to
 * reach the inviter (plan WP2).
 *
 * `_from` is a `did:peer:2` or a long-form `did:peer:4`: self-certifying, so
 * the agent's own resolver expands it offline and the document it returns is
 * the DID itself, not something a server vouches for. From that document the
 * carriage is chosen by the services it lists — TSP first, then DIDComm
 * (`SHARED_CONNECT_CARRIAGE_PREFERENCE`) — and nothing in the link is used to
 * decide where to send anything.
 *
 * Reads and writes nothing: no network beyond what resolving a peer DID needs
 * (none), no storage, and no DID document, label or endpoint is logged beyond a
 * DID prefix.
 *
 * @module trust-tasks/module/sharedConnectInviter
 */

import type { Agent } from '@credo-ts/core'

import { didPrefix } from './didPrefix'
import { endpointHost, selectService, SHARED_CONNECT_SELECTION, type SelectionDocument } from './triggerLink'

export type InviterCarriage = 'tsp' | 'didcomm'

export type InviterResolution =
  | {
      outcome: 'select'
      /** The inviter's DID, as the link gave it. */
      did: string
      carriage: InviterCarriage
      /** The service endpoint chosen: a mediator DID, or an https URL. */
      endpoint: string
      /** The endpoint's host when it is an https URL; absent when a mediator is named by DID (nothing to show). */
      relayHost?: string
    }
  /** The document lists no service this build can use. */
  | { outcome: 'no-common-transport'; did: string }
  /** The DID could not be expanded. */
  | { outcome: 'unresolved'; did: string }

/** The shape of a resolved document's service this module reads (Credo's classes satisfy it). */
type ResolvedService = { id?: string; type: unknown; serviceEndpoint?: unknown }

/**
 * The services of a resolved peer DID document in the form `selectService`
 * reads. A peer DID is its own verification, so the document is marked
 * verified; a document that is not from `did:peer` never reaches here.
 */
export function selectionDocumentOf(didDocument: { service?: ResolvedService[] }): SelectionDocument {
  return {
    verified: true,
    services: (didDocument.service ?? []).map((service) => ({
      id: service.id,
      type: Array.isArray(service.type) ? service.type.map(String) : String(service.type),
      serviceEndpoint: service.serviceEndpoint,
    })),
  }
}

/** Choose the carriage and relay from a resolved document. Pure. */
export function chooseInviterService(did: string, didDocument: { service?: ResolvedService[] }): InviterResolution {
  const selection = selectService(selectionDocumentOf(didDocument), SHARED_CONNECT_SELECTION)
  if (selection.outcome !== 'select') return { outcome: 'no-common-transport', did }
  return {
    outcome: 'select',
    did,
    carriage: selection.binding as InviterCarriage,
    endpoint: selection.endpoint,
    ...(endpointHost(selection.endpoint) ? { relayHost: endpointHost(selection.endpoint) } : {}),
  }
}

/** Resolve the inviter's `did:peer` offline and choose how to reach it. */
export async function resolveInviter(agent: Agent, did: string): Promise<InviterResolution> {
  if (!did.startsWith('did:peer:')) return { outcome: 'unresolved', did }
  let didDocument
  try {
    didDocument = await agent.dids.resolveDidDocument(did)
  } catch (error) {
    agent.config.logger.debug(
      `[TrustTasks:SharedConnect] could not resolve ${didPrefix(did)}: ${error instanceof Error ? error.name : 'error'}`
    )
    return { outcome: 'unresolved', did }
  }
  return chooseInviterService(did, didDocument as { service?: ResolvedService[] })
}
