/**
 * @jest-environment node
 *
 * The shared-connect rungs (keyring-wallet #853, WP13's in-process half): Keyring's real scanner path —
 * startSharedConnect, the encounter DID, SharedConnectSession and the TSP carriage, on a real Askar agent —
 * against an independent INVITER written from trust-tasks #1034 and dtgwg-vti-spec#86, which imports nothing
 * from Keyring: its own did:peer, its own eddsa-jcs-2022, the registry's schemas, and upstream's TSP 1.0
 * library with its relationship gate (src/modules/trust-tasks/__tests__/fixtures/shared-connect/inviter.ts).
 * The relay is a fake that hands frames across in process; nothing touches a network.
 *
 * Ported from the throwaway bifold test/shared-connect-rungs (697bf8bad), which ran the same inviter against
 * a test-only orchestrator; here it runs against the code that ships.
 */
import '../../helpers/realAskar'

// One @credo-ts/core copy for this suite, as in sharedConnectRealKms.test.ts. And one @credo-ts/askar: the TSP
// adapter (@bifold/credo-tsp-adapter) reads the encounter key through AskarStoreManager from the root copy, so
// the agent's AskarModule must be that copy too ("TypeInfo not known for AskarModuleConfig" otherwise).
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
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { Inviter } from '../../../src/modules/trust-tasks/__tests__/fixtures/shared-connect/inviter'
import {
  defaultSharedConnectDeps,
  SharedConnectSession,
  type SessionOutcome,
} from '../../../src/modules/trust-tasks/module/sharedConnect'
import {
  createTspEncounterCarriage,
  type EncounterRelaySession,
} from '../../../src/modules/trust-tasks/module/sharedConnectCarriage'
import {
  createEncounterDid,
  saveEncounter,
  type EncounterRecord,
} from '../../../src/modules/trust-tasks/module/sharedConnectEncounter'
import {
  setSharedConnectEnabled,
  setSharedConnectLabelEnabled,
} from '../../../src/modules/trust-tasks/module/sharedConnectFlag'
import {
  startSharedConnect,
  type SharedConnectStartResult,
} from '../../../src/modules/trust-tasks/module/sharedConnectStart'
import type { VtiMediatorEndpoints } from '../../../src/modules/trust-tasks/module/VtiMediatorTransport'
import { createVrcDocumentLoader } from '../../../src/modules/vrc/createVrcDocumentLoader'
import { RelationshipDidModule } from '../../../src/modules/vrc/module/RelationshipDidModule'

const RELAY = 'did:web:relay.example.org'
const MEDIATOR = { did: RELAY, wsEndpoint: 'wss://relay.example.org/ws' } as unknown as VtiMediatorEndpoints

/** One run of the scanner against the inviter: frames pass through a fake relay, in order, until quiet. */
type Run = {
  result: SharedConnectStartResult
  session?: SharedConnectSession
  /** Settle everything in flight: frames both ways until nothing is left to deliver. */
  pump: () => Promise<void>
  /** Deliver a frame to Keyring as if it came from the relay. */
  deliver: (bytes: Uint8Array) => Promise<void>
  sent: Uint8Array[]
}

describe('shared-connect rungs: Keyring as shipped vs an independent spec inviter', () => {
  let agent: Agent
  const storeDir = mkdtempSync(join(tmpdir(), 'shared-connect-rungs-'))

  beforeAll(async () => {
    jest.spyOn(Date, 'now').mockRestore()
    agent = new Agent({
      config: {},
      dependencies: agentDependencies,
      modules: {
        // As the app's agent declares them (app/src/utils/bc-agent-modules.ts). The Trust Task store is not
        // declared there: the session registers it on first use, which these rungs prove.
        w3cCredentials: new W3cCredentialsModule({ documentLoader: createVrcDocumentLoader }),
        relationshipDid: new RelationshipDidModule(),
        askar: new AskarModule({
          askar,
          store: {
            id: `shared-connect-rungs-${process.pid}-${Math.random().toString(36).slice(2)}`,
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
    setSharedConnectLabelEnabled(true)
  })
  afterEach(() => {
    setSharedConnectEnabled(false)
    setSharedConnectLabelEnabled(false)
  })
  afterAll(async () => {
    await agent?.shutdown()
    rmSync(storeDir, { recursive: true, force: true })
  })

  /** Scan the inviter's code and tap Connect, through the real start path with a fake relay. */
  async function connect(inviter: Inviter, link = inviter.link({ label: 'Sam' })): Promise<Run> {
    const queue: Uint8Array[] = []
    const sent: Uint8Array[] = []
    const live: { session?: SharedConnectSession; onTspFrame?: (b: Uint8Array) => Promise<void> } = {}
    const relay: EncounterRelaySession = {
      start: async () => undefined,
      stop: async () => undefined,
      sendTspFrame: async (bytes) => {
        sent.push(bytes)
        queue.push(...(await inviter.onFrame(bytes)))
      },
      sendTo: async () => undefined,
    }
    const run = async (a: Agent, encounter: EncounterRecord, mediator: VtiMediatorEndpoints) => {
      const carriage = createTspEncounterCarriage({
        agent: a,
        encounter,
        mediator,
        onDocument: (document) => live.session?.handle(document),
        openSession: async (handlers) => ((live.onTspFrame = handlers.onTspFrame), relay),
      })
      // Timers never fire here: the rungs drive time by what arrives, not by waiting.
      live.session = new SharedConnectSession(a, encounter, carriage, {
        ...defaultSharedConnectDeps(a),
        setTimer: () => 0,
        clearTimer: () => undefined,
      })
      await carriage.start()
      await live.session.start()
    }
    // startSharedConnect reports any failure as `failed` and logs only an error name: keep the error itself, so a
    // rung that fails to start says why.
    const errors: unknown[] = []
    const kept =
      <A extends unknown[], R>(step: string, f: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        try {
          return await f(...args)
        } catch (error) {
          errors.push(`${step}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
          throw error
        }
      }
    const result = await startSharedConnect(agent, link, {
      deps: {
        resolveMediator: async () => MEDIATOR,
        createDid: kept('createDid', createEncounterDid),
        save: kept('save', saveEncounter),
        run: kept('run', run),
      },
    })
    if (result.kind === 'failed') throw new Error(`the start failed:\n${errors.join('\n')}`)
    const deliver = async (bytes: Uint8Array) => {
      await live.onTspFrame?.(bytes)
    }
    const pump = async () => {
      for (let guard = 0; queue.length && guard < 50; guard += 1) await deliver(queue.shift() as Uint8Array)
    }
    return { result, session: live.session, pump, deliver, sent }
  }

  const outcome = (run: Run): SessionOutcome | undefined => run.session?.outcome

  describe('basic', () => {
    test('the whole exchange completes: both sides hold a VRC, and both receipts match', async () => {
      const inviter = new Inviter(RELAY)
      const before = (await agent.w3cCredentials.getAll()).length
      const run = await connect(inviter)
      await run.pump()
      expect(run.result).toMatchObject({ kind: 'started' })
      expect(inviter.events).toEqual(
        expect.arrayContaining(['xrfi:accepted', 'propose:accepted', 'issue:stored', 'receipt:matched'])
      )
      expect(inviter.events.filter((e) => e.startsWith('dropped'))).toEqual([])
      expect(outcome(run)).toBe('completed')
      expect((await agent.w3cCredentials.getAll()).length).toBe(before + 1)
    })

    test("every frame Keyring sends is TSP 1.0 and every document passes the registry's schemas", async () => {
      const inviter = new Inviter(RELAY)
      const run = await connect(inviter)
      await run.pump()
      // The inviter is upstream's 1.0 library: a Rev 3 frame is `dropped:revision`; a document that fails the
      // envelope or payload schema is `dropped:schema:…`.
      expect(inviter.events.some((e) => e.startsWith('dropped:revision'))).toBe(false)
      expect(inviter.events.some((e) => e.startsWith('dropped:schema'))).toBe(false)
      // An XRFI, the propose, the receipt for the inviter's issue, and Keyring's own issue.
      expect(run.sent.length).toBeGreaterThanOrEqual(4)
    })

    test('the VRC Keyring issues, as the inviter receives it: VC 2.0, eddsa-jcs-2022, no validUntil, about the inviter', async () => {
      const inviter = new Inviter(RELAY)
      const run = await connect(inviter)
      await run.pump()
      const enactment = (run.result as { encounter: EncounterRecord }).encounter.enactment
      const vc = inviter.enactments.get(enactment)?.theirVrc as Record<string, unknown>
      // The inviter already verified its JCS proof under the issuer ('vc-proof' would have dropped it).
      expect(vc['@context']).toEqual(expect.arrayContaining(['https://www.w3.org/ns/credentials/v2']))
      expect((vc.proof as { cryptosuite?: string }).cryptosuite).toBe('eddsa-jcs-2022')
      expect(vc).not.toHaveProperty('validUntil')
      expect((vc.credentialSubject as { id?: string }).id).toBe(inviter.relDid)
    })
  })

  describe('negative', () => {
    test('a propose#response signed by a key that is not the inviter VID is not accepted', async () => {
      const inviter = new Inviter(RELAY, undefined, { wrongKeyResponse: true })
      const run = await connect(inviter)
      await run.pump()
      // Reached the step under test: the inviter took Keyring's propose and answered it.
      expect(inviter.events).toContain('propose:accepted')
      expect(outcome(run)).not.toBe('completed')
      expect(inviter.events).not.toContain('issue:stored')
    })

    test('documents carrying another enactment are dropped', async () => {
      const inviter = new Inviter(RELAY, undefined, { wrongEnactment: true })
      const run = await connect(inviter)
      await run.pump()
      expect(inviter.events).toContain('propose:accepted')
      expect(outcome(run)).not.toBe('completed')
      expect(inviter.events).not.toContain('issue:stored')
    })

    test('a VRC about someone else is refused and not stored', async () => {
      const inviter = new Inviter(RELAY, undefined, { vcSubjectWrong: true })
      const before = (await agent.w3cCredentials.getAll()).length
      const run = await connect(inviter)
      await run.pump()
      expect(inviter.events).toContain('propose:accepted')
      expect(outcome(run)).not.toBe('completed')
      expect((await agent.w3cCredentials.getAll()).length).toBe(before)
    })

    test('a receipt for nothing Keyring sent does not complete the exchange', async () => {
      const inviter = new Inviter(RELAY, undefined, { receiptWrongDigest: true })
      const run = await connect(inviter)
      await run.pump()
      // Reached the step under test: Keyring's own VRC got to the inviter, whose receipt is the wrong one.
      expect(inviter.events).toContain('issue:stored')
      expect(inviter.events).toContain('receipt:matched')
      expect(outcome(run)).not.toBe('completed')
    })

    test('a frame from another VID, claiming to answer the propose, is dropped; the real answer still completes', async () => {
      const inviter = new Inviter(RELAY)
      const stranger = new Inviter(RELAY)
      const run = await connect(inviter)
      const myVid = (run.result as { encounter: EncounterRecord }).encounter.myVid
      // Before the inviter's answer is delivered: a forged acceptance from a VID Keyring never met.
      await run.deliver(
        await stranger.strangerFrame(myVid, {
          id: 'forged-response',
          type: 'https://trusttasks.org/spec/vrc/relationships/propose/0.1#response',
          issuer: stranger.vid,
          recipient: myVid,
          payload: { accept: true, relationshipDid: stranger.relDid },
        })
      )
      expect(outcome(run)).toBeUndefined()
      await run.pump()
      expect(outcome(run)).toBe('completed')
    })
  })

  describe('complex', () => {
    test('an issue that arrives before the propose#response is held and the exchange still completes', async () => {
      const inviter = new Inviter(RELAY, undefined, { issueBeforeResponse: true })
      const run = await connect(inviter)
      await run.pump()
      expect(outcome(run)).toBe('completed')
      expect(inviter.events).toContain('receipt:matched')
    })

    test('GAP: an inviter ceremony member the registry rejects (definition without definitionDigest) is accepted', async () => {
      // Keyring is lenient inbound: the envelope schema is not checked on what arrives (#853). Pinned so that
      // tightening it shows here on purpose.
      const inviter = new Inviter(RELAY, undefined, { definitionWithoutDigest: true })
      const run = await connect(inviter)
      await run.pump()
      expect(outcome(run)).toBe('completed')
    })

    test('two Connects on one code send one propose: the inviter never sees the code spent twice', async () => {
      const inviter = new Inviter(RELAY)
      const link = inviter.link()
      const [first, second] = await Promise.all([connect(inviter, link), connect(inviter, link)])
      await first.pump()
      await second.pump()
      expect(second.result).toBe(first.result)
      expect(inviter.events.filter((e) => e === 'propose:accepted')).toHaveLength(1)
      expect(inviter.events).not.toContain('dropped:spent')
    })
  })
})
