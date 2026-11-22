/**
 * @jest-environment node
 *
 * DIDComm v2 accepted by default, between real Credo agents on real Askar stores (the setup is
 * __tests__/modules/vrc/continuityCrypto.test.ts's; see its header), delivering to each other in memory.
 *
 * What this proves, each with its control:
 *  1. A phone on a build whose agent speaks v1 only (278/279: didcommVersions ['v1'], fixed in store code) cannot read
 *     an out-of-band/2.0 invitation; it reads a v1 one. Stated here as a fact, and it is why a phone mints v2 only
 *     through a v2 mailbox (canMintV2Invitation) and every other invitation stays v1.
 *  2. Both directions between old and new: a v1-only inviter and a v1+v2 invitee connect, and so do a v1+v2 inviter
 *     (minting v1, as a phone without a v2 mailbox does) and a v1-only invitee.
 *  3. The upgrade: a store written by a v1-only agent, opened by a v1+v2 agent, keeps its v1 connection, and messages
 *     go both ways on it. Credo uses the connection's own version outbound and always unpacks v1 inbound, so this
 *     holds by construction; the row guards it.
 *  4. Discover Features, for real: a contact that advertises the TSP envelope (every build from this one) answers yes;
 *     one that does not (an older build) answers no. And the older build has no handler for the envelope at all,
 *     which is why a send waits for the yes (contactTspCapability.ts).
 */
import '../../helpers/realAskar'

import { AskarModule } from '@credo-ts/askar'
import { Agent } from '@credo-ts/core'
import {
  DidCommBasicMessageRecord,
  DidCommConnectionRecord,
  DidCommMessageHandlerRegistry,
  DidCommMessageReceiver,
  DidCommModule,
  type DidCommInboundTransport,
  type DidCommOutboundPackage,
  type DidCommOutboundTransport,
} from '@credo-ts/didcomm'
import { agentDependencies } from '@credo-ts/node'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { TspEnvelopeMessage } from '../../../src/modules/trust-tasks/messages/TspEnvelopeMessage'
import {
  advertiseTspCarriage,
  askPeerReadsTsp,
  resetTspCapabilityQuestions,
  TSP_ENVELOPE_PROTOCOL_URI,
} from '../../../src/modules/trust-tasks/module/contactTspCapability'

type Versions = ('v1' | 'v2')[]

/** Agents by name; `memory://<name>` reaches the one registered under it. */
const hub = new Map<string, Agent>()

/** An agent's name, its label here (this Credo's agent config carries no label). */
const nameOf = (agent: Agent): string => [...hub].find(([, a]) => a === agent)?.[0] ?? 'agent'

class MemoryOutbound implements DidCommOutboundTransport {
  public supportedSchemes = ['memory']
  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}
  public async sendMessage(outboundPackage: DidCommOutboundPackage): Promise<void> {
    const name = (outboundPackage.endpoint ?? '').replace(/^memory:\/\//, '')
    const target = hub.get(name)
    if (!target) throw new Error(`memory transport: nobody at ${outboundPackage.endpoint}`)
    const receiver = target.dependencyManager.resolve(DidCommMessageReceiver)
    // As a network would: delivered after this send returns, and a failure there is the receiver's.
    setImmediate(() => void receiver.receiveMessage(outboundPackage.payload, {}).catch(() => undefined))
  }
}

class MemoryInbound implements DidCommInboundTransport {
  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}
}

const storeDir = mkdtempSync(join(tmpdir(), 'didcomm-versions-'))
const running: Agent[] = []

async function makeAgent(name: string, didcommVersions: Versions, storeId = `${name}-${process.pid}`): Promise<Agent> {
  const agent = new Agent({
    config: {},
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: storeId,
          key: 'test-key',
          database: { type: 'sqlite', config: { path: join(storeDir, `${storeId}.db`) } },
        },
      }),
      didcomm: new DidCommModule({
        endpoints: [`memory://${name}`],
        didcommVersions,
        connections: { autoAcceptConnections: true },
      } as never),
    },
  })
  // Registered the way the app registers its transports (useBCAgentSetup.ts createNewAgent), before initialize.
  agent.modules.didcomm.registerOutboundTransport(new MemoryOutbound())
  agent.modules.didcomm.registerInboundTransport(new MemoryInbound())
  await agent.initialize()
  hub.set(name, agent)
  running.push(agent)
  return agent
}

async function stop(agent: Agent): Promise<void> {
  await agent.shutdown()
  running.splice(running.indexOf(agent), 1)
}

/** Inviter mints (v1 unless told), invitee accepts; both sides' completed connection records. */
async function connect(inviter: Agent, invitee: Agent, didCommVersion: 'v1' | 'v2' = 'v1') {
  const oob = await inviter.modules.didcomm.oob.createInvitation({
    didCommVersion,
    label: nameOf(inviter),
  } as never)
  const url = oob.outOfBandInvitation.toUrl({ domain: 'https://example.test' })
  // A label, as the app passes one: the DID Exchange request is refused without it.
  const { connectionRecord } = await invitee.modules.didcomm.oob.receiveInvitationFromUrl(url, {
    label: nameOf(invitee),
  })
  if (!connectionRecord) throw new Error('test setup: no connection record from the invitation')
  const inviteeSide = await invitee.modules.didcomm.connections.returnWhenIsConnected(connectionRecord.id, {
    timeoutMs: 20000,
  })
  const [inviterSide] = await inviter.modules.didcomm.connections.findAllByOutOfBandId(oob.id)
  const inviterReady = await inviter.modules.didcomm.connections.returnWhenIsConnected(inviterSide.id, {
    timeoutMs: 20000,
  })
  return { inviteeSide, inviterSide: inviterReady }
}

/** Send a basic message and wait until the other side has stored it. */
async function deliver(from: Agent, fromConnection: DidCommConnectionRecord, to: Agent, text: string): Promise<void> {
  await from.modules.didcomm.basicMessages.sendMessage(fromConnection.id, text)
  for (let i = 0; i < 100; i++) {
    const got = await to.modules.didcomm.basicMessages.findAllByQuery({})
    if (got.some((record: DidCommBasicMessageRecord) => record.content === text)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`"${text}" never arrived`)
}

beforeAll(() => {
  // jestSetup.js freezes Date.now for screen tests; a real Askar store needs the real clock.
  jest.spyOn(Date, 'now').mockRestore()
})

afterEach(async () => {
  resetTspCapabilityQuestions()
  for (const agent of [...running]) await stop(agent)
  hub.clear()
})

afterAll(() => rmSync(storeDir, { recursive: true, force: true }))

describe('mixed DIDComm versions between real agents', () => {
  test('1. a v1-only agent (278/279) refuses an out-of-band/2.0 invitation', async () => {
    const newPhone = await makeAgent('new-phone', ['v1', 'v2'])
    const oldPhone = await makeAgent('old-phone', ['v1'])
    const v2 = await newPhone.modules.didcomm.oob.createInvitation({
      didCommVersion: 'v2',
      label: 'new-phone',
    } as never)
    const url = v2.outOfBandInvitation.toUrl({ domain: 'https://example.test' })

    let refusal: Error | undefined
    try {
      // A config object, as the app always passes: this Credo's receiveInvitation throws without one, which must not
      // pass for the refusal this row is about.
      const { connectionRecord } = await oldPhone.modules.didcomm.oob.receiveInvitationFromUrl(url, {
        label: 'old-phone',
      })
      if (connectionRecord) {
        await oldPhone.modules.didcomm.connections.returnWhenIsConnected(connectionRecord.id, { timeoutMs: 5000 })
      }
    } catch (error) {
      refusal = error as Error
    }
    expect(refusal).toBeDefined()
    // The reason, exactly: the version, not some other failure (the config-less TypeError included).
    expect(refusal?.message).toContain('DIDComm v2 is not enabled for this agent')
    expect(refusal?.message).toContain('Configured didcommVersions: [v1]')
    expect(await oldPhone.modules.didcomm.connections.getAll()).toHaveLength(0)
  }, 60000)

  test('1. CONTROL: the same v1-only agent reads a v1 invitation from the same new agent, and connects', async () => {
    const newPhone = await makeAgent('new-phone', ['v1', 'v2'])
    const oldPhone = await makeAgent('old-phone', ['v1'])
    const { inviteeSide, inviterSide } = await connect(newPhone, oldPhone, 'v1')
    expect(inviteeSide.isReady).toBe(true)
    expect(inviterSide.isReady).toBe(true)
    await deliver(oldPhone, inviteeSide, newPhone, 'old to new')
    await deliver(newPhone, inviterSide, oldPhone, 'new to old')
  }, 60000)

  test('2. the other direction: a v1-only inviter and a v1+v2 invitee connect, and messages go both ways', async () => {
    const oldPhone = await makeAgent('old-phone', ['v1'])
    const newPhone = await makeAgent('new-phone', ['v1', 'v2'])
    const { inviteeSide, inviterSide } = await connect(oldPhone, newPhone)
    expect(inviteeSide.didcommVersion ?? 'v1').toBe('v1')
    await deliver(newPhone, inviteeSide, oldPhone, 'new to old')
    await deliver(oldPhone, inviterSide, newPhone, 'old to new')
  }, 60000)

  test('3. the upgrade: a v1 connection made under a v1-only agent still works once the agent speaks v1+v2', async () => {
    const before = await makeAgent('upgrading', ['v1'], `upgrading-${process.pid}`)
    const peer = await makeAgent('peer', ['v1'])
    const { inviterSide } = await connect(before, peer)
    // CONTROL: the connection works before the upgrade.
    const [peerSide] = await peer.modules.didcomm.connections.getAll()
    await deliver(before, inviterSide, peer, 'before the upgrade')

    await stop(before)
    hub.delete('upgrading')
    const after = await makeAgent('upgrading', ['v1', 'v2'], `upgrading-${process.pid}`)
    const kept = await after.modules.didcomm.connections.getById(inviterSide.id)
    expect(kept.isReady).toBe(true)
    expect(kept.didcommVersion ?? 'v1').toBe('v1')

    await deliver(after, kept, peer, 'after the upgrade, out')
    await deliver(peer, peerSide, after, 'after the upgrade, in')
  }, 90000)

  test('4. Discover Features: a contact that advertises TSP answers yes; an older build answers no', async () => {
    const reader = await makeAgent('reader', ['v1', 'v2'])
    const older = await makeAgent('older', ['v1'])
    advertiseTspCarriage(reader)
    const { inviterSide: readerToOlder, inviteeSide: olderToReader } = await connect(reader, older)

    await expect(askPeerReadsTsp(older, olderToReader.id)).resolves.toBe(true)
    await expect(askPeerReadsTsp(reader, readerToOlder.id)).resolves.toBe(false)

    const recorded = await older.modules.didcomm.connections.getById(olderToReader.id)
    expect(recorded.metadata.get('keyring:tspCarriage')).toEqual(expect.objectContaining({ reads: true }))
  }, 60000)

  test('4. the reason: an agent that never registered the envelope has no handler for it', async () => {
    const older = await makeAgent('older', ['v1'])
    const registry = older.dependencyManager.resolve(DidCommMessageHandlerRegistry)
    expect(registry.getHandlerForMessageType(TspEnvelopeMessage.type.messageTypeUri)).toBeUndefined()
    expect(TSP_ENVELOPE_PROTOCOL_URI).toBe(TspEnvelopeMessage.type.protocolUri)
  }, 60000)
})
