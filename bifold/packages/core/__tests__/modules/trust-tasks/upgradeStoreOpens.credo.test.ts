/**
 * @jest-environment node
 *
 * Own-phone upgrades stay safe: a wallet store written by a v1-era agent opens after the DIDComm v2 changes, with its
 * contacts, communities and records exactly as they were, and the v2 start-up path (opening the wallet mailbox) adds
 * one record and touches none.
 *
 * The fixture is GENERATED here, by a v1-only agent writing through the app's own stores, not captured from a
 * tester's phone. It proves the code paths on a store of the same shape; it is not evidence about any particular
 * real store.
 *
 * What a community is on disk (and what the snapshot below therefore has to cover): Credo generic records under
 * `keyring/vti-community` (memberships, invitations, held credentials, names, brands), `keyring/vti-identity`
 * (personas) and `keyring.vta-link` (linked agents); Wallet cards are copies rebuilt from those. None of the
 * readers consults a DIDComm setting.
 */
import '../../helpers/realAskar'

import { AskarModule } from '@credo-ts/askar'
import { Agent } from '@credo-ts/core'
import {
  DidCommBasicMessageRecord,
  DidCommMessageReceiver,
  DidCommModule,
  type DidCommConnectionRecord,
  type DidCommInboundTransport,
  type DidCommOutboundPackage,
  type DidCommOutboundTransport,
} from '@credo-ts/didcomm'
import { agentDependencies } from '@credo-ts/node'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { setDidCommV2Enabled, DIDCOMM_V2_ON_BY_DEFAULT } from '../../../src/modules/trust-tasks/ceremony'
import { GenericRecordsCommunityStore } from '../../../src/modules/trust-tasks/module/VtiCommunityStore'
import { GenericRecordsIdentityStore } from '../../../src/modules/trust-tasks/module/VtiIdentityStore'
import { GenericRecordsVtaLinkStore } from '../../../src/modules/trust-tasks/module/VtaLinkStore'
import { createPeerDidNamingUri } from '../../../src/modules/trust-tasks/module/VtiMediatorTransport'
import {
  closeWalletMailbox,
  openWalletMailbox,
  WALLET_MAILBOX_RECORD_TYPE,
} from '../../../src/modules/trust-tasks/module/walletMailbox'

type Versions = ('v1' | 'v2')[]
const hub = new Map<string, Agent>()

class MemoryOutbound implements DidCommOutboundTransport {
  public supportedSchemes = ['memory']
  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}
  public async sendMessage(outboundPackage: DidCommOutboundPackage): Promise<void> {
    const target = hub.get((outboundPackage.endpoint ?? '').replace(/^memory:\/\//, ''))
    if (!target) throw new Error(`memory transport: nobody at ${outboundPackage.endpoint}`)
    const receiver = target.dependencyManager.resolve(DidCommMessageReceiver)
    setImmediate(() => void receiver.receiveMessage(outboundPackage.payload, {}).catch(() => undefined))
  }
}
class MemoryInbound implements DidCommInboundTransport {
  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}
}

const storeDir = mkdtempSync(join(tmpdir(), 'upgrade-store-'))
const running: Agent[] = []

async function makeAgent(name: string, didcommVersions: Versions, storeId: string): Promise<Agent> {
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
        connections: { autoAcceptConnections: true, autoCreateConnectionOnFirstMessage: true },
      } as never),
    },
  })
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

async function connect(inviter: Agent, invitee: Agent, label: string) {
  const oob = await inviter.modules.didcomm.oob.createInvitation({ didCommVersion: 'v1', label } as never)
  const url = oob.outOfBandInvitation.toUrl({ domain: 'https://example.test' })
  const { connectionRecord } = await invitee.modules.didcomm.oob.receiveInvitationFromUrl(url, { label: 'invitee' })
  if (!connectionRecord) throw new Error('test setup: no connection record')
  const inviteeSide = await invitee.modules.didcomm.connections.returnWhenIsConnected(connectionRecord.id, {
    timeoutMs: 20000,
  })
  const [inviterSide] = await inviter.modules.didcomm.connections.findAllByOutOfBandId(oob.id)
  return {
    inviteeSide,
    inviterSide: await inviter.modules.didcomm.connections.returnWhenIsConnected(inviterSide.id, { timeoutMs: 20000 }),
  }
}

async function deliver(from: Agent, connection: DidCommConnectionRecord, to: Agent, text: string): Promise<void> {
  await from.modules.didcomm.basicMessages.sendMessage(connection.id, text)
  for (let i = 0; i < 100; i++) {
    const got = await to.modules.didcomm.basicMessages.findAllByQuery({})
    if (got.some((record: DidCommBasicMessageRecord) => record.content === text)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`"${text}" never arrived`)
}

/** Everything the phone holds that the upgrade could reach, as plain data. */
async function snapshot(agent: Agent) {
  const generic = (await agent.genericRecords.getAll())
    .map((r) => ({ id: r.id, content: r.content, tags: r.getTags() }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const createdDids = (await agent.dids.getCreatedDids({})).map((d) => d.did).sort()
  // Typed here: on an Agent built without its module map, getAll() is `any`, and so is everything chained on it.
  const connectionRecords: DidCommConnectionRecord[] = await agent.modules.didcomm.connections.getAll()
  const connections = connectionRecords
    .map((c) => ({
      id: c.id,
      state: c.state,
      did: c.did,
      theirDid: c.theirDid,
      didcommVersion: c.didcommVersion ?? 'v1',
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const communities = new GenericRecordsCommunityStore(agent)
  const identities = new GenericRecordsIdentityStore(agent)
  const links = new GenericRecordsVtaLinkStore(agent)
  return {
    generic,
    createdDids,
    connections,
    readBack: {
      memberships: await communities.listMemberships(),
      invitations: await communities.listInvitations(),
      names: await communities.listCommunityNames(),
      brands: await communities.listCommunityBrands(),
      personas: await identities.listPersonas(),
      links: await links.list(),
      currentLink: await links.current(),
    },
  }
}

beforeAll(() => {
  jest.spyOn(Date, 'now').mockRestore()
})

afterAll(async () => {
  for (const agent of [...running]) await stop(agent)
  rmSync(storeDir, { recursive: true, force: true })
  setDidCommV2Enabled(DIDCOMM_V2_ON_BY_DEFAULT)
})

const COMMUNITY = 'did:webvh:QmCommunity:community.example'
const PERSONA = 'did:webvh:QmPersona:agent.example:persona'
const VTA = 'did:webvh:QmAgent:agent.example'

test('a v1-era store (GENERATED fixture, not a captured tester store) opens after the v2 changes: contacts, communities and records unchanged, the mailbox adds one record', async () => {
  const storeId = `phone-${process.pid}-${Date.now()}`
  const v1Phone = await makeAgent('phone', ['v1'], storeId)
  const friend = await makeAgent('friend', ['v1'], `friend-${process.pid}-${Date.now()}`)

  // ---- the phone as a 278/279 build leaves it -------------------------------------------------------------------
  const { inviterSide: phoneToFriend, inviteeSide: friendToPhone } = await connect(v1Phone, friend, 'phone')
  await deliver(v1Phone, phoneToFriend, friend, 'before the update')

  const links = new GenericRecordsVtaLinkStore(v1Phone)
  await links.set({ vtaDid: VTA, label: 'My agent', linkedAt: '2026-11-01T10:00:00.000Z', owner: true })
  const identities = new GenericRecordsIdentityStore(v1Phone)
  await identities.setPersona({
    communityDid: COMMUNITY,
    vtaDid: VTA,
    did: PERSONA,
    contextId: 'keyring',
    vtaKeyIds: { signing: `${PERSONA}#key-0`, keyAgreement: `${PERSONA}#key-1` },
    label: 'Me at the community',
    createdAt: '2026-11-01T10:05:00.000Z',
  })
  const communities = new GenericRecordsCommunityStore(v1Phone)
  await communities.saveMembership({
    communityDid: COMMUNITY,
    personaDid: PERSONA,
    role: 'member',
    vmc: { type: ['VerifiableCredential', 'VerifiableMembershipCredential'], id: 'urn:uuid:vmc-1' },
    grantedAt: '2026-11-02T09:00:00.000Z',
    via: 'invitation',
  })
  await communities.saveCommunityName(COMMUNITY, 'The Example Community')
  await communities.saveCommunityBrand(COMMUNITY, { accentColor: '#2f5fd0' })
  // The DID a VTA-leg sign-in leaves behind (a Credo DID record).
  await createPeerDidNamingUri(v1Phone, 'did:peer:2.some-vti-mediator')

  const before = await snapshot(v1Phone)
  // CONTROL: the fixture really holds what the row is about.
  expect(before.readBack.memberships).toHaveLength(1)
  expect(before.readBack.personas).toHaveLength(1)
  expect(before.readBack.links).toHaveLength(1)
  expect(before.connections).toHaveLength(1)
  expect(before.connections[0].didcommVersion).toBe('v1')

  // ---- the update: same store, the agent now v1+v2, v2 as shipped, the mailbox opened at start ----------------------
  await stop(v1Phone)
  hub.delete('phone')
  setDidCommV2Enabled(DIDCOMM_V2_ON_BY_DEFAULT)
  const phone = await makeAgent('phone', ['v1', 'v2'], storeId)
  const mailbox = await openWalletMailbox(phone, 'did:peer:2.the-mailbox-mediator', {
    resolveMediator: async (_a, did) => ({ did, wsEndpoint: 'wss://mediator.example/ws' }) as never,
    makeSession: () => ({
      start: async () => undefined,
      stop: async () => undefined,
      forwardForMailbox: async () => ({ id: 'unused' }),
      // The mediator confirming the account's forwarding right, as v0.53.0 answers (walletMailbox.ts).
      ask: async () =>
        ({
          type: 'ask',
          body: { payload: { account: { did: 'x', accountType: 'standard', acl: { sendForwarded: true } } } },
        }) as never,
    }),
  })

  const after = await snapshot(phone)

  // Every record that was there is there, unchanged, and the only new one is the mailbox's.
  const added = after.generic.filter((r) => !before.generic.some((b) => b.id === r.id))
  expect(added).toHaveLength(1)
  expect(added[0].tags).toEqual(expect.objectContaining({ type: WALLET_MAILBOX_RECORD_TYPE }))
  expect(after.generic.filter((r) => before.generic.some((b) => b.id === r.id))).toEqual(before.generic)

  // Every DID it had is kept; the only new one is the mailbox DID.
  expect(after.createdDids.filter((d) => before.createdDids.includes(d))).toEqual(before.createdDids)
  expect(after.createdDids.filter((d) => !before.createdDids.includes(d))).toEqual([mailbox.did])

  // Contacts and communities read back exactly as before.
  expect(after.connections).toEqual(before.connections)
  expect(after.readBack).toEqual(before.readBack)

  // And the old contact still works both ways, still on v1, with a friend who has not updated.
  const kept = await phone.modules.didcomm.connections.getById(phoneToFriend.id)
  await deliver(phone, kept, friend, 'after the update, out')
  await deliver(friend, friendToPhone, phone, 'after the update, in')

  await closeWalletMailbox(phone)
}, 120000)
