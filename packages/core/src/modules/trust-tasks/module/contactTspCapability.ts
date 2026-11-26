/**
 * Wallet-to-wallet only (upstream VTA/VTC services: tspCapability.ts, unchanged). Whether a contact's phone can read a TSP envelope (TspCarriage.ts), so this phone sends one only where it will be
 * read.
 *
 * Why: a build with TSP carriage off never registers the envelope's handler (ceremony.ts setupTrustTasksInbound before
 * TSP was on by default), so an envelope sent to it is a message it has no handler for, and the document is lost. Our
 * own switch says only that THIS phone may send TSP; the peer has to say it can read it.
 *
 * How a peer says so: every build that registers the envelope's handler also registers its protocol in Credo's
 * feature registry ({@link advertiseTspCarriage}), and Credo answers a Discover Features 2.0 query from that registry
 * (autoAcceptQueries defaults to true). A build that never registered it answers the same query with nothing. The
 * answer is kept on the connection record, so it is asked once per contact, not once per send.
 *
 * What a send does with it ({@link peerReadsTsp}): a recorded yes means TSP; a recorded no, or no answer yet, means the
 * connection's own DIDComm binding, and an unanswered contact is asked in the background so a later send can use TSP.
 * A send never waits on the question. A recorded no is asked again after {@link TSP_NO_RECHECK_MS}, because the
 * contact may update. An envelope that arrives from a contact is itself a yes ({@link recordPeerReadsTsp}).
 *
 * @module trust-tasks/module/contactTspCapability
 */
import type { Agent } from '@credo-ts/core'
import {
  DidCommConnectionRepository,
  DidCommFeatureRegistry,
  DidCommProtocol,
  type DidCommFeature,
} from '@credo-ts/didcomm'

const LOG_PREFIX = '[TrustTasks:ContactTsp]'

/**
 * The protocol a build that reads TSP envelopes discloses: the envelope message type's protocol URI. Written out, not
 * read from TspEnvelopeMessage at load: a suite that mocks @bifold/trust-tasks partially and reaches this module
 * through ceremony.ts would otherwise die at import (sharedSessionHolds.test.ts did). contactTspCapability.test.ts
 * pins it equal to TspEnvelopeMessage.type.protocolUri.
 */
export const TSP_ENVELOPE_PROTOCOL_URI = 'https://github.com/berkmancenter/keyring-bifold/tsp-envelope/0.1'

/** Where a contact's answer is kept on its connection record. */
export const TSP_CAPABILITY_METADATA_KEY = 'keyring:tspCarriage'

/** How long a contact's "no" stands before it is asked again (it may have updated). */
export const TSP_NO_RECHECK_MS = 24 * 60 * 60 * 1000

/**
 * How long a contact's "yes" stands. Not forever: a contact that rolls back to a build from before TSP was on by
 * default (an OTA rollback) registers no envelope handler again, and a yes kept forever would send it envelopes it
 * drops. Past this, a send takes the binding while the contact is asked again; an envelope from it renews the yes.
 */
export const TSP_YES_RECHECK_MS = 7 * 24 * 60 * 60 * 1000

/** How long a send's background question waits for the contact's answer. */
export const TSP_QUERY_TIMEOUT_MS = 10_000

interface TspCapability {
  reads: boolean
  /** When it was learnt (ms since epoch). */
  at: number
  /** How: a Discover Features answer, or an envelope received from the contact. */
  from: 'discovery' | 'envelope'
}

/**
 * Register the envelope's protocol, so a Discover Features query from a contact learns this phone reads TSP. Never
 * throws: without it, contacts keep sending this phone the binding, which it reads as before.
 */
export function advertiseTspCarriage(agent: Agent): boolean {
  try {
    agent.dependencyManager.container
      .resolve(DidCommFeatureRegistry)
      .register(new DidCommProtocol({ id: TSP_ENVELOPE_PROTOCOL_URI, roles: ['sender', 'receiver'] }))
    return true
  } catch (error) {
    agent.config.logger.warn(`${LOG_PREFIX} could not advertise TSP: ${(error as Error)?.message ?? error}`)
    return false
  }
}

const readRecorded = async (agent: Agent, connectionId: string): Promise<TspCapability | undefined> => {
  const connection = await agent.modules.didcomm.connections.findById(connectionId)
  const kept = connection?.metadata.get(TSP_CAPABILITY_METADATA_KEY) as TspCapability | null | undefined
  return kept && typeof kept.reads === 'boolean' ? kept : undefined
}

const record = async (agent: Agent, connectionId: string, capability: TspCapability): Promise<void> => {
  const connection = await agent.modules.didcomm.connections.findById(connectionId)
  if (!connection) return
  connection.metadata.set(TSP_CAPABILITY_METADATA_KEY, capability as unknown as Record<string, unknown>)
  // Through the repository: metadata.set changes the record in memory only, and this Credo's connections API has no
  // update (measured on a real agent: the answer was lost).
  await agent.dependencyManager.container.resolve(DidCommConnectionRepository).update(agent.context, connection)
}

/** One question per contact at a time, in this run. */
const asking = new Map<string, Promise<boolean | undefined>>()

/**
 * Ask a contact whether it reads TSP envelopes, and record a yes or a no. Resolves undefined when no answer came
 * (the contact is offline or slow): nothing is recorded, and a later send asks again. Never throws.
 */
export function askPeerReadsTsp(
  agent: Agent,
  connectionId: string,
  timeoutMs: number = TSP_QUERY_TIMEOUT_MS
): Promise<boolean | undefined> {
  const pending = asking.get(connectionId)
  if (pending) return pending
  const ask = (async () => {
    try {
      const { features } = await agent.modules.didcomm.discovery.queryFeatures({
        connectionId,
        protocolVersion: 'v2',
        queries: [{ featureType: 'protocol', match: TSP_ENVELOPE_PROTOCOL_URI }],
        awaitDisclosures: true,
        awaitDisclosuresTimeoutMs: timeoutMs,
      })
      if (!features) {
        agent.config.logger.info(`${LOG_PREFIX} no answer from connection ${connectionId} yet; the binding is used`)
        return undefined
      }
      const reads = features.some((feature: DidCommFeature) => feature.id === TSP_ENVELOPE_PROTOCOL_URI)
      await record(agent, connectionId, { reads, at: Date.now(), from: 'discovery' })
      agent.config.logger.info(`${LOG_PREFIX} connection ${connectionId} ${reads ? 'reads' : 'does not read'} TSP`)
      return reads
    } catch (error) {
      agent.config.logger.info(
        `${LOG_PREFIX} could not ask connection ${connectionId}: ${(error as Error)?.message ?? error}; the binding is used`
      )
      return undefined
    } finally {
      asking.delete(connectionId)
    }
  })()
  asking.set(connectionId, ask)
  return ask
}

/**
 * Whether a send to this contact may use TSP, from what is recorded. Never waits on the network: a contact with no
 * answer recorded, or a "no" older than {@link TSP_NO_RECHECK_MS}, is asked in the background, and this send uses the
 * binding.
 */
export async function peerReadsTsp(agent: Agent, connectionId: string, now: number = Date.now()): Promise<boolean> {
  let kept: TspCapability | undefined
  try {
    kept = await readRecorded(agent, connectionId)
  } catch (error) {
    // Unreadable is unknown: the binding, which every build reads.
    agent.config.logger.info(`${LOG_PREFIX} could not read what ${connectionId} said: ${(error as Error)?.message}`)
    return false
  }
  if (kept?.reads && now - kept.at < TSP_YES_RECHECK_MS) return true
  if (!kept || now - kept.at >= (kept.reads ? TSP_YES_RECHECK_MS : TSP_NO_RECHECK_MS)) {
    void askPeerReadsTsp(agent, connectionId)
  }
  return false
}

/** An envelope arrived from this contact, so it reads TSP: record the yes. Never throws. */
export async function recordPeerReadsTsp(agent: Agent, connectionId: string): Promise<void> {
  try {
    // Recorded every time, so the yes is as fresh as the last envelope (TSP_YES_RECHECK_MS).
    await record(agent, connectionId, { reads: true, at: Date.now(), from: 'envelope' })
  } catch (error) {
    agent.config.logger.info(`${LOG_PREFIX} could not record a yes for ${connectionId}: ${(error as Error)?.message}`)
  }
}

/** Tests only: forget the questions in flight. */
export function resetTspCapabilityQuestions(): void {
  asking.clear()
}
