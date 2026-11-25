/** The scanner's fresh per-encounter peer DID and the encounter record (plan WP4), against a fake agent. */
import type { Agent } from '@credo-ts/core'

import {
  createEncounterDid,
  ENCOUNTER_DIDCOMM_SERVICE_ID,
  ENCOUNTER_TSP_SERVICE_ID,
  ENCOUNTER_TSP_SERVICE_TYPE,
  encounterKey,
  getEncounter,
  saveEncounter,
  type EncounterRecord,
} from '../module/sharedConnectEncounter'

const MEDIATOR = { did: 'did:peer:2.Vz6MkMediator.Ez6LSMediator', wsEndpoint: 'wss://m.example.org/ws' }
// RFC 8032 test vector 1: a real Ed25519 public key.
const ED25519_X = Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex').toString(
  'base64url'
)

const fakeAgent = () => {
  const create = jest.fn(async () => ({ didState: { did: 'did:peer:2.fresh', state: 'finished' } }))
  const createKey = jest.fn(async () => ({
    keyId: 'kms-1',
    publicJwk: { kty: 'OKP', crv: 'Ed25519', x: ED25519_X, kid: 'kms-1' },
  }))
  return { agent: { kms: { createKey }, dids: { create } } as unknown as Agent, create, createKey }
}

const createdDocument = (create: jest.Mock) =>
  (create.mock.calls[0] as unknown[])[0] as {
    method: string
    didDocument: { service: { id: string; type: string; serviceEndpoint: unknown }[] }
    options: { keys: unknown[] }
  }

describe('createEncounterDid', () => {
  it('mints a did:peer with one fresh key, a #didcomm service and a #tsp service, both naming the mediator by DID', async () => {
    const { agent, create, createKey } = fakeAgent()
    await expect(createEncounterDid(agent, MEDIATOR, { tsp: true })).resolves.toBe('did:peer:2.fresh')
    expect(createKey).toHaveBeenCalledTimes(1)
    const call = createdDocument(create)
    expect(call.method).toBe('peer')
    expect(call.options.keys.length).toBeGreaterThan(0)
    const [didcomm, tsp] = call.didDocument.service
    expect(didcomm).toMatchObject({ id: ENCOUNTER_DIDCOMM_SERVICE_ID, type: 'DIDCommMessaging' })
    expect(didcomm.serviceEndpoint).toMatchObject({ uri: MEDIATOR.did })
    expect(tsp).toMatchObject({
      id: ENCOUNTER_TSP_SERVICE_ID,
      type: ENCOUNTER_TSP_SERVICE_TYPE,
      serviceEndpoint: MEDIATOR.did,
    })
    expect(ENCOUNTER_TSP_SERVICE_TYPE).toBe('TSPTransport')
  })

  it('mints no #tsp service when TSP is not wanted', async () => {
    const { agent, create } = fakeAgent()
    await createEncounterDid(agent, MEDIATOR, { tsp: false })
    expect(createdDocument(create).didDocument.service.map((s) => s.id)).toEqual([ENCOUNTER_DIDCOMM_SERVICE_ID])
  })

  it('uses a new key for every encounter', async () => {
    const { agent, createKey } = fakeAgent()
    await createEncounterDid(agent, MEDIATOR, { tsp: true })
    await createEncounterDid(agent, MEDIATOR, { tsp: true })
    expect(createKey).toHaveBeenCalledTimes(2)
  })

  it('throws when the agent does not return a DID', async () => {
    const { agent, create } = fakeAgent()
    create.mockResolvedValueOnce({ didState: { state: 'failed' } } as never)
    await expect(createEncounterDid(agent, MEDIATOR, { tsp: true })).rejects.toThrow(
      /could not create an encounter DID/
    )
  })
})

describe('the encounter record', () => {
  const record: EncounterRecord = {
    enactment: 'XOcGXOQTCHb5iz4T2JD2RQ',
    myVid: 'did:peer:2.mine',
    theirVid: 'did:peer:2.theirs',
    carriage: 'tsp',
    relay: MEDIATOR.did,
    exp: 1_800_000_600,
    state: 'confirmed',
    createdAt: '2027-01-15T08:00:00.000Z',
  }

  const storeAgent = () => {
    const rows: { content: unknown; tags: Record<string, unknown> }[] = []
    const genericRecords = {
      findAllByQuery: jest.fn(async (query: Record<string, string>) =>
        rows.filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
      ),
      save: jest.fn(async (row: { content: unknown; tags: Record<string, unknown> }) => void rows.push(row)),
      update: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    }
    return { agent: { genericRecords } as unknown as Agent, rows }
  }

  it('is kept under its enactment and read back', async () => {
    const { agent } = storeAgent()
    await saveEncounter(agent, record)
    await expect(getEncounter(agent, record.enactment)).resolves.toEqual(record)
    await expect(getEncounter(agent, 'another')).resolves.toBeUndefined()
  })

  it('is one record per enactment: saving again replaces', async () => {
    const { agent, rows } = storeAgent()
    await saveEncounter(agent, record)
    await saveEncounter(agent, { ...record, state: 'completed' })
    expect(rows).toHaveLength(1)
  })

  it('keys the ceremony stores with the enactment, where a connection id went', () => {
    expect(encounterKey('abc')).toBe('enc:abc')
  })

  it('holds identifiers only: no link text and no label', () => {
    expect(Object.keys(record).sort()).toEqual(
      ['carriage', 'createdAt', 'enactment', 'exp', 'myVid', 'relay', 'state', 'theirVid'].sort()
    )
  })
})
