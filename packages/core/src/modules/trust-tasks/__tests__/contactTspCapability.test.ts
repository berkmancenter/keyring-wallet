/**
 * A phone sends a contact a TSP envelope only when that contact has said it reads one (contactTspCapability.ts).
 *
 * The reason, as a control row: a build with TSP carriage off registers no handler for the envelope (setupTrustTasksInbound
 * before TSP was on by default), so an envelope sent to it reaches no handler. With TSP now on by default, every build
 * from this one registers the handler and advertises the protocol, and older builds answer a Discover Features query
 * without it.
 */
import { DidCommConnectionRepository, DidCommFeatureRegistry, DidCommProtocol } from '@credo-ts/didcomm'

import {
  askPeerReadsTsp,
  advertiseTspCarriage,
  peerReadsTsp,
  recordPeerReadsTsp,
  resetTspCapabilityQuestions,
  TSP_CAPABILITY_METADATA_KEY,
  TSP_ENVELOPE_PROTOCOL_URI,
  TSP_YES_RECHECK_MS,
} from '../module/contactTspCapability'
import { TspEnvelopeMessage } from '../messages/TspEnvelopeMessage'

type Kept = { reads: boolean; at: number; from: string } | undefined

function fakeAgent(options: { kept?: Kept; queryFeatures?: jest.Mock; registry?: DidCommFeatureRegistry } = {}) {
  const state: { kept: Kept } = { kept: options.kept }
  const update = jest.fn(async () => undefined)
  const connection = {
    id: 'conn-1',
    metadata: {
      get: (key: string) => (key === TSP_CAPABILITY_METADATA_KEY ? (state.kept ?? null) : null),
      set: (key: string, value: Kept) => {
        if (key === TSP_CAPABILITY_METADATA_KEY) state.kept = value
      },
    },
  }
  const queryFeatures = options.queryFeatures ?? jest.fn(async () => ({ features: [] }))
  const registry = options.registry ?? new DidCommFeatureRegistry()
  const agent = {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: {
      container: {
        resolve: (token: unknown) => {
          if (token === DidCommFeatureRegistry) return registry
          if (token === DidCommConnectionRepository) return { update }
          throw new Error(`fake container cannot resolve ${String(token)}`)
        },
      },
    },
    modules: {
      didcomm: {
        connections: { findById: async (id: string) => (id === 'conn-1' ? connection : null) },
        discovery: { queryFeatures },
      },
    },
  }
  return { agent: agent as never, state, update, queryFeatures, registry }
}

afterEach(() => resetTspCapabilityQuestions())

describe('what a contact says about TSP', () => {
  test('the advertised protocol is the envelope message type’s own protocol', () => {
    expect(TSP_ENVELOPE_PROTOCOL_URI).toBe(TspEnvelopeMessage.type.protocolUri)
    expect(TspEnvelopeMessage.type.messageTypeUri.startsWith(`${TSP_ENVELOPE_PROTOCOL_URI}/`)).toBe(true)
  })

  test('advertising registers it, so the feature registry answers a query for it (what Credo discloses)', () => {
    const { agent, registry } = fakeAgent()
    expect(registry.query({ featureType: 'protocol', match: TSP_ENVELOPE_PROTOCOL_URI } as never)).toHaveLength(0)
    expect(advertiseTspCarriage(agent)).toBe(true)
    const found = registry.query({ featureType: 'protocol', match: TSP_ENVELOPE_PROTOCOL_URI } as never)
    expect(found.map((f) => f.id)).toEqual([TSP_ENVELOPE_PROTOCOL_URI])
  })

  test('advertising never throws, even where the registry cannot be resolved', () => {
    const agent = {
      config: { logger: { warn: jest.fn() } },
      dependencyManager: {
        container: {
          resolve: () => {
            throw new Error('no registry')
          },
        },
      },
    }
    expect(advertiseTspCarriage(agent as never)).toBe(false)
  })

  test('a contact that discloses the protocol: yes, recorded', async () => {
    const queryFeatures = jest.fn(async () => ({
      features: [new DidCommProtocol({ id: TSP_ENVELOPE_PROTOCOL_URI, roles: ['sender', 'receiver'] })],
    }))
    const { agent, state } = fakeAgent({ queryFeatures })
    await expect(askPeerReadsTsp(agent, 'conn-1')).resolves.toBe(true)
    expect(state.kept).toEqual(expect.objectContaining({ reads: true, from: 'discovery' }))
  })

  test('CONTROL: a contact that answers without it (an older build): no, recorded', async () => {
    const queryFeatures = jest.fn(async () => ({
      features: [new DidCommProtocol({ id: 'https://didcomm.org/basicmessage/1.0', roles: ['sender'] })],
    }))
    const { agent, state } = fakeAgent({ queryFeatures })
    await expect(askPeerReadsTsp(agent, 'conn-1')).resolves.toBe(false)
    expect(state.kept).toEqual(expect.objectContaining({ reads: false, from: 'discovery' }))
  })

  test('no answer in time (the contact is offline): nothing recorded, so a later send asks again', async () => {
    const queryFeatures = jest.fn(async () => ({ features: undefined }))
    const { agent, state, update } = fakeAgent({ queryFeatures })
    await expect(askPeerReadsTsp(agent, 'conn-1')).resolves.toBeUndefined()
    expect(state.kept).toBeUndefined()
    expect(update).not.toHaveBeenCalled()
  })

  test('a query that throws: nothing recorded, and the caller never sees the error', async () => {
    const queryFeatures = jest.fn(async () => {
      throw new Error('no route to the contact')
    })
    const { agent, state } = fakeAgent({ queryFeatures })
    await expect(askPeerReadsTsp(agent, 'conn-1')).resolves.toBeUndefined()
    expect(state.kept).toBeUndefined()
  })

  test('two sends at once ask the contact once', async () => {
    let answer: (value: { features: [] }) => void = () => undefined
    const queryFeatures = jest.fn(() => new Promise((resolve) => (answer = resolve)))
    const { agent } = fakeAgent({ queryFeatures })
    const first = askPeerReadsTsp(agent, 'conn-1')
    const second = askPeerReadsTsp(agent, 'conn-1')
    answer({ features: [] })
    await Promise.all([first, second])
    expect(queryFeatures).toHaveBeenCalledTimes(1)
  })

  test('peerReadsTsp never waits on the network: unknown is false now, and the question runs behind it', async () => {
    let answer: (value: { features: DidCommProtocol[] }) => void = () => undefined
    const queryFeatures = jest.fn(() => new Promise((resolve) => (answer = resolve)))
    const { agent, state } = fakeAgent({ queryFeatures })
    await expect(peerReadsTsp(agent, 'conn-1')).resolves.toBe(false)
    expect(queryFeatures).toHaveBeenCalledTimes(1)
    answer({ features: [new DidCommProtocol({ id: TSP_ENVELOPE_PROTOCOL_URI, roles: ['receiver'] })] })
    await new Promise((resolve) => setImmediate(resolve))
    expect(state.kept?.reads).toBe(true)
    await expect(peerReadsTsp(agent, 'conn-1')).resolves.toBe(true)
  })

  test('an envelope received from a contact records a yes, without asking', async () => {
    const { agent, state, queryFeatures } = fakeAgent()
    await recordPeerReadsTsp(agent, 'conn-1')
    expect(state.kept).toEqual(expect.objectContaining({ reads: true, from: 'envelope' }))
    expect(queryFeatures).not.toHaveBeenCalled()
  })

  test('an envelope after an earlier no turns it into a yes', async () => {
    const { agent, state } = fakeAgent({ kept: { reads: false, at: Date.now(), from: 'discovery' } })
    await recordPeerReadsTsp(agent, 'conn-1')
    expect(state.kept?.reads).toBe(true)
  })
})

test('a recorded answer is saved through the connection repository (metadata.set alone is in memory only)', async () => {
  const queryFeatures = jest.fn(async () => ({ features: [] }))
  const { agent, update } = fakeAgent({ queryFeatures })
  await askPeerReadsTsp(agent, 'conn-1')
  expect(update).toHaveBeenCalledWith({}, expect.objectContaining({ id: 'conn-1' }))
})

describe('a yes does not stand forever (a contact can roll back to a build with no envelope handler)', () => {
  test('CONTROL: a yes within the week: TSP, and nobody is asked', async () => {
    const queryFeatures = jest.fn(async () => ({ features: [] }))
    const { agent } = fakeAgent({ kept: { reads: true, at: Date.now() - 1000, from: 'discovery' }, queryFeatures })
    await expect(peerReadsTsp(agent, 'conn-1')).resolves.toBe(true)
    expect(queryFeatures).not.toHaveBeenCalled()
  })

  test('a yes older than a week: the binding for this send, and the contact is asked again', async () => {
    const queryFeatures = jest.fn(async () => ({ features: [] }))
    const old = { reads: true, at: Date.now() - TSP_YES_RECHECK_MS - 1, from: 'discovery' }
    const { agent, state } = fakeAgent({ kept: old, queryFeatures })
    await expect(peerReadsTsp(agent, 'conn-1')).resolves.toBe(false)
    expect(queryFeatures).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setImmediate(resolve))
    // A rolled-back contact answers without the protocol: now a no.
    expect(state.kept?.reads).toBe(false)
  })

  test('an envelope from the contact renews the yes', async () => {
    const old = { reads: true, at: Date.now() - TSP_YES_RECHECK_MS - 1, from: 'discovery' }
    const { agent, state } = fakeAgent({ kept: old })
    await recordPeerReadsTsp(agent, 'conn-1')
    expect(Date.now() - (state.kept?.at ?? 0)).toBeLessThan(TSP_YES_RECHECK_MS)
    await expect(peerReadsTsp(agent, 'conn-1')).resolves.toBe(true)
  })
})
