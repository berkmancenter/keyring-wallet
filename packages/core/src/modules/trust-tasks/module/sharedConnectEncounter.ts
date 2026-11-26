/**
 * sharedConnectEncounter — the scanner's side of one shared-connect encounter:
 * a fresh peer DID minted for this encounter only, and the record that ties it
 * to the link's challenge (plan WP4).
 *
 * A new DID per encounter keeps two people who scanned different codes from
 * being linked by one identifier. It carries the services the chosen carriage
 * needs: `DIDCommMessaging` (as `createVtiClientDid` mints) and, for TSP, a
 * `TSPTransport` service naming the same mediator. Both name the mediator by
 * its DID, which is the form the VTA and Keyring read (companion §2.1); no
 * single `TSP` spelling is read by every stack, so the spelling is the one
 * constant {@link ENCOUNTER_TSP_SERVICE_TYPE}.
 *
 * The relay session itself (`VtiMediatorSession` as this DID) is opened by the
 * carriage (WP5), not here.
 *
 * @module trust-tasks/module/sharedConnectEncounter
 */

import {
  createPeerDidDocumentFromServices,
  DidDocumentService,
  Kms,
  NewDidCommV2Service,
  NewDidCommV2ServiceEndpoint,
  PeerDidNumAlgo,
} from '@credo-ts/core'
import type { Agent } from '@credo-ts/core'

import { getKeyed, putKeyed } from './keyedRecords'
import type { VtiMediatorEndpoints } from './VtiMediatorTransport'

export const ENCOUNTER_LOG_PREFIX = '[TrustTasks:SharedConnect]'

/**
 * The type the encounter DID's TSP service is written with. Assumption for
 * Alberto (plan Q3 / companion §2.1): `TSPTransport` with a mediator DID, the
 * spelling Keyring and the VTA read. The TSP reference reads `tsp` with a
 * `{uri}` endpoint instead; a counterpart vector decides, and this is the one
 * place to change.
 */
export const ENCOUNTER_TSP_SERVICE_TYPE = 'TSPTransport'

/** The id fragments of the two services. */
export const ENCOUNTER_DIDCOMM_SERVICE_ID = '#didcomm'
export const ENCOUNTER_TSP_SERVICE_ID = '#tsp'

/**
 * Mint a `did:peer:2` for one encounter: an Ed25519 key in the KMS (the
 * X25519 key-agreement key is derived from it), a `#didcomm` service and,
 * with `tsp`, a `#tsp` service, each naming the mediator by DID.
 */
export async function createEncounterDid(
  agent: Agent,
  mediator: Pick<VtiMediatorEndpoints, 'did' | 'wsEndpoint'>,
  options: { tsp: boolean }
): Promise<string> {
  const key = await agent.kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' } })
  const publicJwk = Kms.PublicJwk.fromPublicJwk(key.publicJwk) as Kms.PublicJwk<Kms.Ed25519PublicJwk>
  const { didDocument, keys } = createPeerDidDocumentFromServices(
    [{ id: 'encounter', serviceEndpoint: mediator.wsEndpoint, recipientKeys: [publicJwk], routingKeys: [] }],
    true
  )
  // As in `createVtiClientDid`: the builder supplies the keys, and the
  // services are replaced before the DID is encoded, since the string is the document.
  didDocument.service = [
    new NewDidCommV2Service({
      id: ENCOUNTER_DIDCOMM_SERVICE_ID,
      serviceEndpoint: new NewDidCommV2ServiceEndpoint({ uri: mediator.did, accept: ['didcomm/v2'] }),
    }),
    ...(options.tsp
      ? [
          new DidDocumentService({
            id: ENCOUNTER_TSP_SERVICE_ID,
            type: ENCOUNTER_TSP_SERVICE_TYPE,
            serviceEndpoint: mediator.did,
          }),
        ]
      : []),
  ]
  const created = await agent.dids.create({
    method: 'peer',
    didDocument,
    options: { numAlgo: PeerDidNumAlgo.MultipleInceptionKeyWithoutDoc, keys },
  })
  const did = created.didState.did
  if (!did) throw new Error(`${ENCOUNTER_LOG_PREFIX} could not create an encounter DID: ${created.didState.state}`)
  return did
}

export type EncounterState =
  | 'confirmed'
  | 'proposing'
  | 'accepted'
  | 'unanswered'
  | 'declined'
  | 'completed'
  | 'expired'
  | 'failed'

/**
 * One encounter, persisted so it outlives the screen. Holds identifiers only:
 * never the link text, and never the inviter's `_label` (WP12).
 */
export interface EncounterRecord {
  /** The link's `_id`: the ceremony enactment and the record's key. */
  enactment: string
  /** The scanner's fresh DID for this encounter. */
  myVid: string
  /** The inviter's DID (`_from`). */
  theirVid: string
  carriage: 'tsp' | 'didcomm'
  /** The service endpoint chosen from the inviter's document. */
  relay: string
  /** `_exp`, seconds since the epoch. */
  exp: number
  state: EncounterState
  createdAt: string
}

const ENCOUNTER_RECORD_TYPE = 'sharedConnect'
const ENCOUNTER_KIND = 'encounter'

/** The key the ceremony stores use for an encounter: wherever a connection id went, this goes (plan WP6). */
export const encounterKey = (enactment: string): string => `enc:${enactment}`

export async function saveEncounter(agent: Agent, record: EncounterRecord): Promise<void> {
  await putKeyed(
    agent,
    ENCOUNTER_RECORD_TYPE,
    ENCOUNTER_KIND,
    record.enactment,
    record as unknown as Record<string, unknown>
  )
}

export function getEncounter(agent: Agent, enactment: string): Promise<EncounterRecord | undefined> {
  return getKeyed<EncounterRecord>(agent, ENCOUNTER_RECORD_TYPE, ENCOUNTER_KIND, enactment)
}
