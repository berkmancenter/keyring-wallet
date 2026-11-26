/**
 * @jest-environment node
 *
 * The shared-connect INVITER rungs (relationship-over-tsp plan WP9): Keyring as it ships when it shows a code
 * (createSharedConnectInvite, the encounter DID, the choke point, the inverse ceremony, the consent answer through
 * respondToRelationshipProposal, on a real Askar agent) against an independent SCANNER written from trust-tasks
 * #1034 and dtgwg-vti-spec#86, which imports nothing from Keyring: its own did:peer, eddsa-jcs-2022, the registry's
 * schemas, and upstream's TSP 1.0 library with its relationship gate
 * (src/modules/trust-tasks/__tests__/fixtures/shared-connect/scanner.ts). The relay is a fake that hands frames
 * across in process; nothing touches a network.
 */
import '../../helpers/realAskar'

// One @credo-ts/core and one @credo-ts/askar copy for this suite, as in sharedConnectSpecRungs.test.ts.
jest.mock('@credo-ts/core', () =>
  jest.requireActual(
    require.resolve('@credo-ts/core', { paths: [require('path').resolve(__dirname, '../../../../..')] })
  )
)
jest.mock('@credo-ts/askar', () =>
  jest.requireActual(
    require.resolve('@credo-ts/askar', { paths: [require('path').resolve(__dirname, '../../../../..')] })
  )
)

import { AskarModule } from '@credo-ts/askar'
import { Agent, W3cCredentialsModule } from '@credo-ts/core'
import { agentDependencies } from '@credo-ts/node'
import { askarNodeJS as askar } from '@openwallet-foundation/askar-nodejs'
import { decodeEnvelope } from '@openvtc/vti-tsp-js-v1'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { Scanner, type ScannerFaults } from '../../../src/modules/trust-tasks/__tests__/fixtures/shared-connect/scanner'
import { respondToRelationshipProposal } from '../../../src/modules/trust-tasks/ceremony'
import { SHARED_CONNECT_INVITE_MAX_INVITES } from '../../../src/modules/trust-tasks/module/sharedConnectDecisions'
import { encounterKey } from '../../../src/modules/trust-tasks/module/sharedConnectEncounter'
import {
  setSharedConnectEnabled,
  setSharedConnectInviteEnabled,
} from '../../../src/modules/trust-tasks/module/sharedConnectFlag'
import {
  createSharedConnectInvite,
  type InviterRelay,
  type SharedConnectInviter,
} from '../../../src/modules/trust-tasks/module/sharedConnectInvite'
import type { VtiMediatorEndpoints } from '../../../src/modules/trust-tasks/module/VtiMediatorTransport'
import { createVrcDocumentLoader } from '../../../src/modules/vrc/createVrcDocumentLoader'
import { RelationshipDidModule } from '../../../src/modules/vrc/module/RelationshipDidModule'
import { vrcFlowStore } from '../../../src/modules/vrc/witnessStatusStore'

const RELAY = 'did:web:relay.example.org'
const MEDIATOR = { did: RELAY, wsEndpoint: 'wss://relay.example.org/ws' } as unknown as VtiMediatorEndpoints

/** One code shown by Keyring, and the in-process relay between it and any number of scanners. */
type Shown = {
  inviter: SharedConnectInviter
  link: string
  key: string
  /** Frames Keyring sent, by recipient VID. */
  outbox: Map<string, Uint8Array[]>
  /** Hand Keyring a frame as the relay would. */
  deliver: (bytes: Uint8Array) => Promise<void>
  /** Run a scanner against the code until nothing is left in flight between them. */
  pump: (scanner: Scanner) => Promise<void>
  relay: InviterRelay & { stopped: number }
}

describe('shared-connect inviter rungs: Keyring as shipped vs an independent spec scanner', () => {
  let agent: Agent
  const storeDir = mkdtempSync(join(tmpdir(), 'shared-connect-inviter-rungs-'))
  const shown: Shown[] = []

  beforeAll(async () => {
    jest.spyOn(Date, 'now').mockRestore()
    agent = new Agent({
      config: {},
      dependencies: agentDependencies,
      modules: {
        w3cCredentials: new W3cCredentialsModule({ documentLoader: createVrcDocumentLoader }),
        relationshipDid: new RelationshipDidModule(),
        askar: new AskarModule({
          askar,
          store: {
            id: `shared-connect-inviter-rungs-${process.pid}-${Math.random().toString(36).slice(2)}`,
            key: 'test-key',
            database: { type: 'sqlite', config: { path: join(storeDir, 'sqlite.db') } },
          },
        }),
      },
    })
    await agent.initialize()
  }, 60000)

  beforeEach(() => {
    setSharedConnectEnabled(true)
    setSharedConnectInviteEnabled(true)
  })
  afterEach(async () => {
    for (const s of shown.splice(0)) await s.inviter.cancel()
    setSharedConnectInviteEnabled(false)
    setSharedConnectEnabled(false)
  })
  afterAll(async () => {
    await agent?.shutdown()
    rmSync(storeDir, { recursive: true, force: true })
  })

  /** Keyring shows a code, on a fake relay that routes each frame by the receiver its envelope names. */
  async function show(options: { now?: () => number; ttlSeconds?: number } = {}): Promise<Shown> {
    const outbox = new Map<string, Uint8Array[]>()
    const handlers: { onTspFrame?: (b: Uint8Array) => Promise<void> } = {}
    const relay = {
      stopped: 0,
      start: async () => undefined,
      stop: async () => void (relay.stopped += 1),
      sendTspFrame: async (bytes: Uint8Array) => {
        // Every frame Keyring sends is TSP 1.0 here: upstream's 1.0 decoder throws on anything else.
        const to = decodeEnvelope(bytes).envelope.receiver
        outbox.set(to, [...(outbox.get(to) ?? []), bytes])
      },
    }
    const made = await createSharedConnectInvite(agent, {
      now: options.now,
      ttlSeconds: options.ttlSeconds,
      deps: {
        resolveMediator: async () => MEDIATOR,
        openRelay: async (_a, _vid, _m, h) => ((handlers.onTspFrame = h.onTspFrame), relay),
      },
    })
    if (made.kind !== 'showing') throw new Error(`the code did not show: ${JSON.stringify(made)}`)
    const deliver = async (bytes: Uint8Array) => {
      await handlers.onTspFrame?.(bytes)
    }
    const pump = async (scanner: Scanner) => {
      for (let guard = 0; guard < 50; guard += 1) {
        const mine = outbox.get(scanner.vid) ?? []
        outbox.set(scanner.vid, [])
        if (!mine.length) return
        for (const frame of mine) for (const reply of await scanner.onFrame(frame)) await deliver(reply)
      }
    }
    const s: Shown = {
      inviter: made.inviter,
      link: made.link,
      key: encounterKey(made.inviter.enactment),
      outbox,
      deliver,
      pump,
      relay,
    }
    shown.push(s)
    return s
  }
  const sendFrom = (s: Shown, _scanner: Scanner, bytes: Uint8Array) => s.deliver(bytes)

  /** A scanner reads the code, forms the relationship, and proposes. */
  async function scanAndPropose(s: Shown, faults: ScannerFaults = {}): Promise<Scanner> {
    const scanner = new Scanner(RELAY, faults)
    scanner.read(s.link)
    if (!faults.noInvite) {
      await sendFrom(s, scanner, await scanner.greet())
      await s.pump(scanner)
    }
    await sendFrom(s, scanner, await scanner.propose())
    await s.pump(scanner)
    return scanner
  }

  /** The person answers the consent sheet, through the call the sheet makes. */
  async function answer(s: Shown, scanner: Scanner, accept: boolean) {
    await respondToRelationshipProposal(agent, s.key, accept)
    await s.pump(scanner)
  }

  describe('basic', () => {
    test('the whole exchange: consent, six documents, a VRC on both sides, both receipts matched, connected', async () => {
      const before = (await agent.w3cCredentials.getAll()).length
      const s = await show()
      const scanner = await scanAndPropose(s)
      expect(scanner.events).toContain('xrfa:adopted')
      expect(s.inviter.state).toBe('proposed')
      // The sheet is asked with no name, only the scanner's DID prefix.
      const prompt = vrcFlowStore.getProposalPrompt(s.key)
      expect(prompt).toMatchObject({
        connectionId: s.key,
        counterpartyLabel: '',
        sharedConnect: { didShort: expect.any(String) },
      })
      expect(scanner.vid.startsWith(prompt?.sharedConnect?.didShort.replace(/…$/, '') ?? '∅')).toBe(true)

      await answer(s, scanner, true)
      expect(scanner.events).toEqual(['xrfa:adopted', 'response:accepted', 'issue:stored', 'receipt:matched'])
      expect(s.inviter.state).toBe('connected')
      expect(await agent.w3cCredentials.getAll()).toHaveLength(before + 1)
      expect(vrcFlowStore.getProposalPrompt(s.key)).toBeUndefined()
      expect(s.relay.stopped).toBe(1)
    })

    test("every frame Keyring sends is TSP 1.0 and every document passes the registry's schemas and proof checks", async () => {
      const s = await show()
      const scanner = await scanAndPropose(s)
      await answer(s, scanner, true)
      expect(scanner.events.filter((e) => e.startsWith('dropped'))).toEqual([])
    })

    test('the VRC Keyring issues as the scanner receives it: VC 2.0, eddsa-jcs-2022, no validUntil, about the scanner', async () => {
      const s = await show()
      const scanner = await scanAndPropose(s)
      await answer(s, scanner, true)
      const vc = scanner.theirVrc as Record<string, unknown>
      expect(vc['@context']).toEqual(expect.arrayContaining(['https://www.w3.org/ns/credentials/v2']))
      expect((vc.proof as { cryptosuite?: string }).cryptosuite).toBe('eddsa-jcs-2022')
      expect(vc).not.toHaveProperty('validUntil')
      expect((vc.credentialSubject as { id?: string }).id).toBe(scanner.relDid)
    })

    test('a decline answers with a signed declined error, and nothing is issued', async () => {
      const before = (await agent.w3cCredentials.getAll()).length
      const s = await show()
      const scanner = await scanAndPropose(s)
      await answer(s, scanner, false)
      expect(scanner.events).toEqual(['xrfa:adopted', 'error:declined'])
      expect(s.inviter.state).toBe('failed')
      expect(s.inviter.failure).toBe('declined')
      expect(await agent.w3cCredentials.getAll()).toHaveLength(before)
    })

    test('the scanner re-sends its propose after the answer: the same answer comes again, nothing is acted on twice', async () => {
      const before = (await agent.w3cCredentials.getAll()).length
      const s = await show()
      const scanner = await scanAndPropose(s)
      await respondToRelationshipProposal(agent, s.key, true)
      s.outbox.set(scanner.vid, []) // the answer was lost on the way
      await sendFrom(s, scanner, scanner.proposeAgain())
      await s.pump(scanner)
      expect(scanner.events).toEqual(['xrfa:adopted', 'response:accepted', 'issue:stored', 'receipt:matched'])
      expect(s.inviter.state).toBe('connected')
      expect(await agent.w3cCredentials.getAll()).toHaveLength(before + 1)
    })
  })

  describe('decision 3: where Keyring binds its document proofs', () => {
    test('every document Keyring sends is signed under its encounter VID, and a scanner accepting only that key completes', async () => {
      const s = await show()
      const scanner = await scanAndPropose(s, { strictVidProofs: true })
      await answer(s, scanner, true)
      expect(scanner.events).toEqual(['xrfa:adopted', 'response:accepted', 'issue:stored', 'receipt:matched'])
      expect(scanner.received.length).toBeGreaterThanOrEqual(3) // #response, issue, receipt
      for (const doc of scanner.received) {
        const vm = String((doc.proof as { verificationMethod?: string }).verificationMethod)
        expect(vm.startsWith(`${s.inviter.myVid}#`)).toBe(true)
      }
    })
  })

  describe('a proposal that cannot be used', () => {
    test('an accepted propose with no relationship DID ends the code `rejected`: nobody is asked, nothing is sent', async () => {
      const s = await show()
      const scanner = await scanAndPropose(s, { proposeWithoutRelationshipDid: true })
      await s.inviter.cancel() // the ending the ceremony started: wait for it
      expect([s.inviter.state, s.inviter.failure]).toEqual(['failed', 'rejected'])
      expect(vrcFlowStore.getProposalPrompt(s.key)).toBeUndefined()
      expect(scanner.events).toEqual(['xrfa:adopted'])
    })
  })

  describe('§2.8: everything else is dropped without a word', () => {
    test('a propose with no relationship first: nothing comes back, nobody is asked', async () => {
      const s = await show()
      const scanner = await scanAndPropose(s, { noInvite: true })
      expect(s.outbox.get(scanner.vid) ?? []).toEqual([])
      expect(scanner.events).toEqual([])
      expect(vrcFlowStore.getProposalPrompt(s.key)).toBeUndefined()
      expect(s.inviter.state).toBe('waiting')
    })

    test('a propose for another code: nothing comes back after the XRFA, nobody is asked', async () => {
      const s = await show()
      const scanner = await scanAndPropose(s, { wrongEnactment: true })
      expect(scanner.events).toEqual(['xrfa:adopted'])
      expect(vrcFlowStore.getProposalPrompt(s.key)).toBeUndefined()
    })

    test("a propose signed by a key that is not the scanner's VID: nothing comes back, nobody is asked", async () => {
      const s = await show()
      const scanner = await scanAndPropose(s, { badProof: true })
      expect(scanner.events).toEqual(['xrfa:adopted'])
      expect(s.inviter.state).toBe('waiting')
    })

    test('an expired code: the propose is dropped', async () => {
      let now = Date.now()
      const s = await show({ now: () => now, ttlSeconds: 60 })
      const scanner = new Scanner(RELAY)
      scanner.read(s.link)
      await sendFrom(s, scanner, await scanner.greet())
      await s.pump(scanner)
      now += 61_000
      await sendFrom(s, scanner, await scanner.propose())
      await s.pump(scanner)
      expect(scanner.events).toEqual(['xrfa:adopted'])
      expect(vrcFlowStore.getProposalPrompt(s.key)).toBeUndefined()
    })

    test('a second scanner after the first was accepted: its invite is not answered, its propose not seen', async () => {
      const s = await show()
      await scanAndPropose(s)
      const second = await scanAndPropose(s)
      expect(second.events).toEqual([])
      expect(s.inviter.snapshot().accepted?.theirVid).not.toBe(second.vid)
    })

    test(`the ${SHARED_CONNECT_INVITE_MAX_INVITES + 1}th scanner's invite is not answered`, async () => {
      const s = await show()
      const scanners: Scanner[] = []
      for (let n = 0; n <= SHARED_CONNECT_INVITE_MAX_INVITES; n++) {
        const scanner = new Scanner(RELAY)
        scanner.read(s.link)
        await sendFrom(s, scanner, await scanner.greet())
        await s.pump(scanner)
        scanners.push(scanner)
      }
      expect(scanners.map((sc) => sc.events.includes('xrfa:adopted'))).toEqual([
        ...Array(SHARED_CONNECT_INVITE_MAX_INVITES).fill(true),
        false,
      ])
    })

    test('the switch turned off while the person is being asked: the code ends, the question goes, and nothing more is answered', async () => {
      const s = await show()
      const scanner = await scanAndPropose(s)
      expect(vrcFlowStore.getProposalPrompt(s.key)).toBeDefined()
      setSharedConnectInviteEnabled(false)
      await s.inviter.cancel() // the same ending the switch started: wait for it to finish
      expect(s.inviter.state).toBe('cancelled')
      expect(vrcFlowStore.getProposalPrompt(s.key)).toBeUndefined()
      await sendFrom(s, scanner, scanner.proposeAgain())
      await s.pump(scanner)
      expect(scanner.events).toEqual(['xrfa:adopted'])
    })
  })

  describe('the scanner side refused', () => {
    test('a scanner VRC whose own proof fails is refused, and Keyring stores nothing', async () => {
      const before = (await agent.w3cCredentials.getAll()).length
      const s = await show()
      const scanner = await scanAndPropose(s, { vcBadProof: true })
      await answer(s, scanner, true)
      expect(scanner.events).toEqual(['xrfa:adopted', 'response:accepted', 'issue:stored', 'error:notAccepted'])
      expect(await agent.w3cCredentials.getAll()).toHaveLength(before)
      expect(s.inviter.state).toBe('failed')
    })

    test('a receipt naming something Keyring never sent does not complete the exchange', async () => {
      const s = await show()
      const scanner = await scanAndPropose(s, { receiptWrongDigest: true })
      await answer(s, scanner, true)
      // The scanner's own VRC was good, so Keyring stored it and receipted it; its receipt for ours was not ours.
      expect(scanner.events).toEqual(['xrfa:adopted', 'response:accepted', 'issue:stored', 'receipt:matched'])
      expect(s.inviter.state).toBe('connecting')
    })

    test("a scanner's receipt and issue signed by a key that is not its VID are dropped: no receipt back, nothing stored", async () => {
      const before = (await agent.w3cCredentials.getAll()).length
      const s = await show()
      const scanner = await scanAndPropose(s, { badProofLater: true })
      await answer(s, scanner, true)
      expect(scanner.events).toEqual(['xrfa:adopted', 'response:accepted', 'issue:stored'])
      expect(await agent.w3cCredentials.getAll()).toHaveLength(before)
      expect(s.inviter.state).toBe('connecting')
    })

    test('a scanner VRC about someone else is refused in words the scanner can read, and Keyring stores nothing', async () => {
      const before = (await agent.w3cCredentials.getAll()).length
      const s = await show()
      const scanner = await scanAndPropose(s, { vcSubjectWrong: true })
      await answer(s, scanner, true)
      expect(scanner.events).toEqual(['xrfa:adopted', 'response:accepted', 'issue:stored', 'error:notAccepted'])
      // Keyring's own VRC reached the scanner; the scanner's did not reach Keyring's store.
      expect(await agent.w3cCredentials.getAll()).toHaveLength(before)
      expect(s.inviter.state).toBe('failed')
    })
  })
})
