/**
 * @jest-environment node
 *
 * Wallet-to-wallet DIDComm v2 through one mailbox per phone (walletMailbox.ts), between real Credo agents on real
 * Askar stores (the setup is didcommMixedVersions.credo.test.ts's).
 *
 * The mediator is stood in for by an in-memory hub with the Affinidi mediator's routing rule: a forward is held for
 * the account its `next` names, and only a session signed in as that DID receives it. The hub opens each delivery
 * with the recipient mailbox's key, as VtiMediatorSession does, and hands the plaintext to the mailbox. Everything
 * Credo does is real: following contact DID → mailbox DID, wrapping for the mailbox key, the receiver, the
 * connections. The mediator's own login, socket and acknowledgements are VtiMediatorSession's, tested on their own;
 * against a real Affinidi mediator this design ran in the lab (three wallets, six directions, an offline phone).
 */
import '../../helpers/realAskar'

import { AskarModule } from '@credo-ts/askar'
import { Agent, getPublicJwkFromVerificationMethod } from '@credo-ts/core'
import {
  DidCommBasicMessageEventTypes,
  DidCommModule,
  DidCommV2EnvelopeService,
  type CreateOutOfBandInvitationConfig,
  type DidCommBasicMessageStateChangedEvent,
  type DidCommConnectionRecord,
  type DidCommV2PlaintextMessage,
} from '@credo-ts/didcomm'
import { agentDependencies } from '@credo-ts/node'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { createHash } from 'crypto'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { canMintV2Invitation } from '../../../src/modules/trust-tasks/ceremony'
import {
  closeWalletMailbox,
  mailboxNamedBy,
  mintContactDid,
  openWalletMailbox,
  walletMailboxOf,
  WALLET_MAILBOX_RECORD_TYPE,
  type MailboxSession,
} from '../../../src/modules/trust-tasks/module/walletMailbox'
import {
  createPeerDidNamingUri,
  type VtiClientIdentity,
} from '../../../src/modules/trust-tasks/module/VtiMediatorTransport'
import { acceptConfigForInvitation } from '../../../src/modules/trust-tasks/v2Routing'

const storeDir = mkdtempSync(join(tmpdir(), 'wallet-mailbox-'))
const running: Agent[] = []

/** The mediator stand-in: accounts by DID, each with the one session signed in as it. */
type Account = { agent: Agent; identity: VtiClientIdentity; onMessage: (p: DidCommV2PlaintextMessage) => Promise<void> }
const accounts = new Map<string, Account>()
const signIns: string[] = []
const held: { next: string; inner: unknown }[] = []

async function deliver(next: string, inner: unknown): Promise<void> {
  const account = accounts.get(next)
  if (!account) {
    held.push({ next, inner })
    return
  }
  // What VtiMediatorSession.unpack does with a frame: open it with the signed-in identity's key.
  const envelope = account.agent.dependencyManager.resolve(DidCommV2EnvelopeService)
  const encrypted = inner as { recipients?: { header?: { kid?: string } }[] }
  const { plaintext } = await envelope.unpack(account.agent.context, inner as never, {
    recipientKey: account.identity.senderKey as never,
    matchedKid: encrypted.recipients?.[0]?.header?.kid ?? account.identity.kid,
    resolveSenderKey: async (skid: string) => {
      const doc = await account.agent.dids.resolveDidDocument(skid.split('#')[0])
      const vm = doc.dereferenceKey(skid, ['keyAgreement'])
      return vm ? getPublicJwkFromVerificationMethod(vm) : null
    },
  })
  await account.onMessage(plaintext)
}

function hubSession(
  agent: Agent,
  identity: VtiClientIdentity,
  onMessage: (p: DidCommV2PlaintextMessage) => Promise<void>
): MailboxSession {
  return {
    start: async () => {
      signIns.push(identity.did)
      accounts.set(identity.did, { agent, identity, onMessage })
    },
    stop: async () => {
      accounts.delete(identity.did)
    },
    // As a network would: delivered after this send returns, with the id the mediator would store the bytes under.
    forwardForMailbox: async (next: string, innerJwe: unknown) => {
      setImmediate(() => void deliver(next, innerJwe).catch(() => undefined))
      return { id: createHash('sha256').update(JSON.stringify(innerJwe)).digest('hex') }
    },
    // The hub confirms the account's forwarding right as the mediator does (walletMailbox.ts, v0.53.0's answer shape).
    ask: async () =>
      ({
        type: 'ask',
        body: { payload: { account: { did: 'x', accountType: 'standard', acl: { sendForwarded: true } } } },
      }) as never,
  }
}

let MEDIATOR_DID = ''
const deps = {
  resolveMediator: async () => ({ did: MEDIATOR_DID, wsEndpoint: 'wss://mediator.example/ws' }) as never,
  makeSession: (agent: Agent, identity: VtiClientIdentity, _m: unknown, onMessage: Account['onMessage']) =>
    hubSession(agent, identity, onMessage),
}

async function makeAgent(name: string): Promise<Agent> {
  const storeId = `${name}-${process.pid}-${Date.now()}`
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
      // The app's v2 shape (bc-agent-modules.ts): v1+v2, auto-create the inviter's connection on the first message.
      didcomm: new DidCommModule({
        didcommVersions: ['v1', 'v2'],
        connections: { autoAcceptConnections: true, autoCreateConnectionOnFirstMessage: true },
      } as never),
    },
  })
  await agent.initialize()
  running.push(agent)
  return agent
}

/** Every basic message an agent receives, and a wait for one. */
function inbox(agent: Agent) {
  const got: { content: string; connectionId: string }[] = []
  agent.events.on<DidCommBasicMessageStateChangedEvent>(
    DidCommBasicMessageEventTypes.DidCommBasicMessageV2StateChanged as never,
    (event) => {
      const record = (event.payload as { basicMessageRecord: { role: string; content: string; connectionId: string } })
        .basicMessageRecord
      if (record.role === 'receiver') got.push({ content: record.content, connectionId: record.connectionId })
    }
  )
  return {
    got,
    async waitFor(content: string): Promise<{ content: string; connectionId: string }> {
      for (let i = 0; i < 200; i++) {
        const hit = got.find((m) => m.content === content)
        if (hit) return hit
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error(`"${content}" never arrived`)
    },
  }
}

/** inviter mints a v2 invitation through its mailbox; invitee accepts as the app does; both sides' connections. */
async function connect(
  inviter: Agent,
  invitee: Agent,
  inviterInbox: ReturnType<typeof inbox>
): Promise<{ inviterSide: DidCommConnectionRecord; inviteeSide: DidCommConnectionRecord }> {
  const mailbox = walletMailboxOf(inviter)
  if (!mailbox) throw new Error('test setup: the inviter has no open mailbox')
  const ourDid = await mintContactDid(inviter, mailbox)
  const config: CreateOutOfBandInvitationConfig & { ourDid?: string } = {
    didCommVersion: 'v2',
    ourDid,
  }
  const oob = await inviter.modules.didcomm.oob.createInvitation(config)
  const invitation = await invitee.modules.didcomm.oob.parseInvitation(
    oob.outOfBandInvitation.toUrl({ domain: 'https://example.test' })
  )
  const accept = await acceptConfigForInvitation(invitee, invitation)
  const { connectionRecord } = await invitee.modules.didcomm.oob.receiveInvitation(invitation, {
    label: 'invitee',
    ...accept,
  })
  if (!connectionRecord) throw new Error('test setup: no connection record from the invitation')
  const inviteeSide = await invitee.modules.didcomm.connections.returnWhenIsConnected(connectionRecord.id, {
    timeoutMs: 20000,
  })
  // The inviter's side exists once the first message lands (v2 has no handshake).
  const hello = `hello from ${inviteeSide.did.slice(-8)}`
  await invitee.modules.didcomm.basicMessages.sendMessage(inviteeSide.id, hello)
  const first = await inviterInbox.waitFor(hello)
  const inviterSide = await inviter.modules.didcomm.connections.getById(first.connectionId)
  return { inviterSide, inviteeSide }
}

beforeAll(async () => {
  // jestSetup.js freezes Date.now for screen tests; a real Askar store needs the real clock.
  jest.spyOn(Date, 'now').mockRestore()
  const mediator = await makeAgent('mediator')
  MEDIATOR_DID = await createPeerDidNamingUri(mediator, 'https://mediator.example')
})

afterEach(async () => {
  for (const agent of [...running]) {
    if (walletMailboxOf(agent)) await closeWalletMailbox(agent)
  }
  accounts.clear()
  signIns.length = 0
  held.length = 0
})

afterAll(async () => {
  for (const agent of running) await agent.shutdown()
  rmSync(storeDir, { recursive: true, force: true })
})

describe('one mailbox per phone, between real agents', () => {
  test('CONTROL: without an open mailbox a v2 invitation is not minted through one, and is accepted with routing', async () => {
    const phone = await makeAgent('no-mailbox')
    const mint = await canMintV2Invitation(phone)
    expect(mint.via).not.toBe('mailbox')
    const other = await makeAgent('inviter-without')
    const oob = await other.modules.didcomm.oob.createInvitation({ didCommVersion: 'v2' } as never)
    const invitation = await phone.modules.didcomm.oob.parseInvitation(
      oob.outOfBandInvitation.toUrl({ domain: 'https://example.test' })
    )
    const accept = await acceptConfigForInvitation(phone, invitation)
    expect(accept.ourDid).toBeUndefined()
    expect(accept.routing).toBeDefined()
  }, 60000)

  test('the mailbox DID is minted once and kept: a phone signs in as the same DID after it closes and opens again', async () => {
    const phone = await makeAgent('keeper')
    const first = await openWalletMailbox(phone, MEDIATOR_DID, deps)
    await closeWalletMailbox(phone)
    const again = await openWalletMailbox(phone, MEDIATOR_DID, deps)
    expect(again.did).toBe(first.did)
    expect(await mailboxNamedBy(phone, first.did)).toBe(MEDIATOR_DID)
    expect(await phone.genericRecords.findAllByQuery({ type: WALLET_MAILBOX_RECORD_TYPE })).toHaveLength(1)
    expect(signIns).toEqual([first.did, first.did])
  }, 60000)

  test('two phones connect through their mailboxes, both directions deliver on the right connection, and only mailbox DIDs ever sign in', async () => {
    const alice = await makeAgent('alice')
    const bob = await makeAgent('bob')
    const aliceIn = inbox(alice)
    const bobIn = inbox(bob)
    const aliceBox = await openWalletMailbox(alice, MEDIATOR_DID, deps)
    const bobBox = await openWalletMailbox(bob, MEDIATOR_DID, deps)
    expect(await canMintV2Invitation(alice)).toEqual(expect.objectContaining({ v2: true, via: 'mailbox' }))

    const { inviterSide, inviteeSide } = await connect(alice, bob, aliceIn)
    expect(inviteeSide.didcommVersion).toBe('v2')
    // Each side's own DID names its own mailbox; each holds the other's.
    expect(await mailboxNamedBy(alice, inviterSide.did as string)).toBe(aliceBox.did)
    expect(await mailboxNamedBy(bob, inviteeSide.did as string)).toBe(bobBox.did)
    expect(inviterSide.theirDid).toBe(inviteeSide.did)

    await alice.modules.didcomm.basicMessages.sendMessage(inviterSide.id, 'alice to bob')
    expect((await bobIn.waitFor('alice to bob')).connectionId).toBe(inviteeSide.id)
    await bob.modules.didcomm.basicMessages.sendMessage(inviteeSide.id, 'bob to alice')
    expect((await aliceIn.waitFor('bob to alice')).connectionId).toBe(inviterSide.id)

    expect(signIns.sort()).toEqual([aliceBox.did, bobBox.did].sort())
    expect(held).toEqual([])
  }, 90000)

  test('LINKABILITY (accepted 2026-11-20): two contacts of one phone see different contact DIDs that name the same mailbox DID', async () => {
    const alice = await makeAgent('alice-l')
    const bob = await makeAgent('bob-l')
    const carol = await makeAgent('carol-l')
    const aliceIn = inbox(alice)
    const aliceBox = await openWalletMailbox(alice, MEDIATOR_DID, deps)
    await openWalletMailbox(bob, MEDIATOR_DID, deps)
    await openWalletMailbox(carol, MEDIATOR_DID, deps)

    const withBob = await connect(alice, bob, aliceIn)
    const withCarol = await connect(alice, carol, aliceIn)
    const aliceAsBobSeesHer = withBob.inviteeSide.theirDid as string
    const aliceAsCarolSeesHer = withCarol.inviteeSide.theirDid as string

    // Pairwise: a different DID for each contact...
    expect(aliceAsBobSeesHer).not.toBe(aliceAsCarolSeesHer)
    // ...that both name the one mailbox: what bob and carol could compare.
    expect(await mailboxNamedBy(bob, aliceAsBobSeesHer)).toBe(aliceBox.did)
    expect(await mailboxNamedBy(carol, aliceAsCarolSeesHer)).toBe(aliceBox.did)
    // And the mediator only ever sees mailboxes signed in, never a contact DID.
    expect(signIns).not.toContain(aliceAsBobSeesHer)
    expect(signIns).not.toContain(aliceAsCarolSeesHer)
  }, 120000)
})
