/**
 * Vetting says nothing about the seat until it knows it (UI-smoothness plan, Phase 5). An identity not read yet
 * was the same undefined as none, so every open showed "Create identity", with a working button, to someone who
 * had one. The seat was marked read before what it holds, so a vetter mid-request saw Step 1 ("new ticket") and
 * then jumped to their step, and an applicant's apply step said "0 of N" before its checklist was read.
 *
 * Every committed frame's testIDs are kept in order (a Profiler's onRender runs once per commit). Each read the
 * screen waits on can be held open, so what it shows while waiting is seen.
 */
import { act, render } from '@testing-library/react-native'
import React, { Profiler } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import VtiVetting from '../screens/VtiVetting'
import { COMMUNITY_CHANGED_EVENT } from '../module/communityChanged'
import { vtaAgent } from '../module/vtaAgent'
import { vtiAgent } from '../module/vtiAgent'
import { VtiApplicant } from '../module/vtiVetting'
import { readManifest, type VtiManifest } from '../module/joinManifest'
import { registerHiddenVetting } from '../screens/hiddenVettingSeam'

import testVtcCapture from './fixtures/join-0.3/test-vtc-hidden-vetting-2026-10-15.json'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const mockUseAgent = useAgent as jest.Mock
const communityDid = 'did:webvh:example:community'
const personaDid = 'did:webvh:example:persona'
const config = { mediatorDid: 'did:peer:2:mediator', communityDid }

type Rec = { tags: Record<string, string>; content: Record<string, unknown> }
const persona: Rec = {
  tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: communityDid },
  content: {
    communityDid,
    vtaDid: 'did:webvh:example:linked-vta',
    did: personaDid,
    contextId: 'vta',
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { signing: 'ks', keyAgreement: 'kk' },
    createdAt: '2026-09-23T00:00:00Z',
  },
}
const grant: Rec = {
  tags: { recordType: 'keyring/vti-community', kind: 'credential', key: 'urn:uuid:grant' },
  content: {
    kind: 'vetter-grant',
    communityDid,
    subjectDid: personaDid,
    credential: { id: 'urn:uuid:grant', issuer: communityDid },
    receivedAt: '2026-09-23T00:00:00Z',
  },
}
/** A request on the desk whose card has arrived: the vetter's step is "check", never Step 1. */
const cardIn: Rec = {
  tags: { recordType: 'keyring/vti-vetting', kind: 'desk', key: 'r1' },
  content: {
    requestId: 'r1',
    applicantDid: 'did:key:z6MkApplicant',
    communityDid,
    status: 'cardReceived',
    receivedAt: '2026-09-26T09:00:00Z',
    matchConfirmedAt: '2026-09-26T09:01:00Z',
    session: {
      documentId: 'urn:uuid:session',
      challenge: 'c',
      domain: communityDid,
      requiredClaims: ['name.legal'],
      method: 'inPerson',
      expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
      matchCode: 'PBWW-HACW',
    },
    card: { claims: [{ type: 'name.legal', value: 'Gate Applicant' }] },
  },
}
const application: Rec = {
  tags: { recordType: 'keyring/vti-vetting', kind: 'application', key: communityDid },
  content: {
    communityDid,
    joinDid: personaDid,
    minStatements: 1,
    requiredClaims: ['name.legal'],
    acceptedMethods: ['inPerson'],
    commitmentSalt: 'salt',
    claims: { 'name.legal': 'Ada Lovelace' },
    requests: [],
    startedAt: '2026-09-25T00:00:00Z',
  },
}

/** A gate a read waits on until the test opens it. */
const gate = () => {
  let open: () => void = () => undefined
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { opened, open: () => act(async () => open()) }
}

/** The agent over `records`; a query for a held `kind` waits on its gate. */
let reads = 0
const agentWith = (records: Rec[], held: Record<string, Promise<void>> = {}) => ({
  agent: {
    genericRecords: {
      findAllByQuery: async (query: Record<string, string>) => {
        reads += 1
        if (query.kind && held[query.kind]) await held[query.kind]
        return records
          .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
          .map((r) => ({ ...r, id: 'x' }))
      },
      save: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
    },
    dids: { resolveDidDocument: async () => Promise.reject(new Error('offline')) },
    config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
  },
})

const PREFIX = /^com\.ariesbifold:id\//
/** Every testID in the committed tree. */
const idsIn = (node: unknown, into: string[] = []): string[] => {
  if (!node || typeof node !== 'object') return into
  if (Array.isArray(node)) {
    node.forEach((n) => idsIn(n, into))
    return into
  }
  const { props, children } = node as { props?: { testID?: string }; children?: unknown }
  if (props?.testID) into.push(String(props.testID).replace(PREFIX, ''))
  idsIn(children, into)
  return into
}
/** A frame's step: the identity step, a seat's step, or the placeholder. */
const stepOf = (ids: string[]) =>
  ids.find((i) => i === 'VettingSeatLoading' || /^Vetting(Applicant|Vetter)Step_/.test(i)) ?? 'none'

const open = async () => {
  const frames: string[] = []
  const tree = render(<BasicAppContext>{null}</BasicAppContext>)
  tree.rerender(
    <BasicAppContext>
      <Profiler
        id="vetting"
        onRender={() => {
          const ids = idsIn(tree.toJSON())
          frames.push(stepOf(ids) + (ids.includes('VettingPrivate') ? '+private' : ''))
        }}
      >
        <VtiVetting config={config} />
      </Profiler>
    </BasicAppContext>
  )
  await settle()
  return { tree, frames }
}
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
/** The frames' steps, each run of one step said once. */
const steps = (frames: string[]) => frames.filter((f, i) => f !== 'none' && f !== frames[i - 1])

beforeEach(() => {
  const controller = vtaAgent as unknown as { set(next: Record<string, unknown>): void }
  controller.set({
    link: {
      kind: 'linked',
      vtaDid: 'did:webvh:example:linked-vta',
      label: 'alice',
      linkedAt: '2026-09-22T00:00:00Z',
      connection: { kind: 'online', since: 0 },
    },
  })
  jest.spyOn(vtiAgent, 'connect').mockResolvedValue(undefined as never)
  jest.spyOn(vtiAgent, 'fetchManifest').mockResolvedValue({ wire: '0.3', criteria: [] } as never)
})
afterEach(() => jest.restoreAllMocks())

describe('the identity, before it is read', () => {
  test('someone with an identity is never offered "Create identity", not even for a frame', async () => {
    const reading = gate()
    mockUseAgent.mockReturnValue(agentWith([persona], { persona: reading.opened }))
    const { tree, frames } = await open()
    expect(steps(frames)).toEqual(['VettingSeatLoading'])
    await reading.open()
    await settle()
    expect(frames).not.toContain('VettingApplicantStep_identity')
    expect(steps(frames)).toEqual(['VettingSeatLoading', 'VettingApplicantStep_name'])
    tree.unmount()
  })

  test('someone with none is offered it once it is known (the control)', async () => {
    mockUseAgent.mockReturnValue(agentWith([]))
    const { tree, frames } = await open()
    expect(steps(frames)).toEqual(['VettingSeatLoading', 'VettingApplicantStep_identity'])
    expect(tree.getByTestId('com.ariesbifold:id/VettingCreateIdentityButton')).toBeTruthy()
    tree.unmount()
  })
})

describe('a seat, before what it holds is read', () => {
  test("a vetter mid-request goes from the placeholder to their step, never through Step 1's new ticket", async () => {
    const desk = gate()
    mockUseAgent.mockReturnValue(agentWith([persona, grant, cardIn], { desk: desk.opened }))
    const { tree, frames } = await open()
    expect(steps(frames)).toEqual(['VettingSeatLoading'])
    await desk.open()
    await settle()
    expect(steps(frames)).toEqual(['VettingSeatLoading', 'VettingVetterStep_check'])
    tree.unmount()
  })

  test('an applicant with an application waits for its checklist, never shows a count of nothing first', async () => {
    const checklist = gate()
    const real = VtiApplicant.prototype.checklist
    jest.spyOn(VtiApplicant.prototype, 'checklist').mockImplementation(async function (this: VtiApplicant) {
      await checklist.opened
      return real.call(this)
    })
    mockUseAgent.mockReturnValue(agentWith([persona, application]))
    const { tree, frames } = await open()
    expect(steps(frames)).toEqual(['VettingSeatLoading'])
    await checklist.open()
    await settle()
    const shown = steps(frames)
    expect(shown[0]).toBe('VettingSeatLoading')
    expect(shown).toHaveLength(2)
    expect(shown[1]).toMatch(/^VettingApplicantStep_/)
    tree.unmount()
  })

  // The seat's holdings are its own: an applicant's having been read says nothing of a desk's. A grant that
  // arrives while the screen is open (the next 3 s read) seats a vetter, and the desk waits for its requests.
  test('a grant arriving mid-visit: the placeholder, then the desk at its step, never an empty Step 1', async () => {
    const desk = gate()
    const records = [persona]
    mockUseAgent.mockReturnValue(agentWith(records, { desk: desk.opened }))
    const { tree, frames } = await open()
    expect(steps(frames)).toEqual(['VettingSeatLoading', 'VettingApplicantStep_name'])
    records.push(grant, cardIn)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3200))
    })
    await desk.open()
    await settle()
    expect(steps(frames)).toEqual([
      'VettingSeatLoading',
      'VettingApplicantStep_name',
      'VettingSeatLoading',
      'VettingVetterStep_check',
    ])
    tree.unmount()
  }, 15000)
})

// Every write the vetting and community stores make is announced (communityChanged); the screen read the seat
// again only on its next 3 s read, so a grant, a request or a statement kept here showed up to 3 s late.
describe('a change the stores announce', () => {
  test('a grant kept while the screen is open seats the vetter at once, not on the next 3 s read', async () => {
    const records = [persona]
    mockUseAgent.mockReturnValue(agentWith(records))
    const { tree, frames } = await open()
    expect(steps(frames)).toEqual(['VettingSeatLoading', 'VettingApplicantStep_name'])
    records.push(grant, cardIn)
    await act(async () => {
      DeviceEventEmitter.emit(COMMUNITY_CHANGED_EVENT, { communityDid, what: 'grant' })
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    // Within 300 ms, far short of the next 3 s read: at the vetter's step, never an empty Step 1 on the way.
    expect(steps(frames).slice(-1)).toEqual(['VettingVetterStep_check'])
    expect(frames).not.toContain('VettingVetterStep_ticket')
    tree.unmount()
  })

  test("another community's change is not this screen's", async () => {
    mockUseAgent.mockReturnValue(agentWith([persona, grant, cardIn]))
    const { tree } = await open()
    const before = reads
    // No 3 s read falls in this second: any read in it is the other community's announcement.
    await act(async () => {
      DeviceEventEmitter.emit(COMMUNITY_CHANGED_EVENT, { communityDid: 'did:webvh:example:other', what: 'desk' })
      await new Promise((resolve) => setTimeout(resolve, 1000))
    })
    expect(reads - before).toBe(0)
    tree.unmount()
  })

  test('reading the seat again announces nothing, so one change is one read (no loop)', async () => {
    mockUseAgent.mockReturnValue(agentWith([persona, grant, cardIn]))
    const { tree } = await open()
    const before = reads
    await act(async () => {
      DeviceEventEmitter.emit(COMMUNITY_CHANGED_EVENT, { communityDid, what: 'desk' })
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    const once = reads - before
    expect(once).toBeGreaterThan(0)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700))
    })
    expect(reads - before).toBe(once)
    tree.unmount()
  })
})

// Join read the community's manifest a moment ago; Vetting read it again before saying the way in is private, so
// the Private badge was missing from its first frames and then popped in.
describe('a community whose way in is private, its manifest already read', () => {
  const testVtc = readManifest(testVtcCapture.manifest03.payload as Partial<VtiManifest>, '0.3')
  afterEach(() => registerHiddenVetting(undefined))

  test('the Private badge is on the first frame of the step, before this screen reads the manifest again', async () => {
    registerHiddenVetting({} as never)
    jest.spyOn(vtiAgent, 'lastManifest').mockReturnValue(testVtc)
    // The screen's own read never comes back.
    jest.spyOn(vtiAgent, 'fetchManifest').mockImplementation(() => new Promise(() => undefined))
    mockUseAgent.mockReturnValue(agentWith([persona]))
    const { tree, frames } = await open()
    expect(steps(frames)).toEqual(['VettingSeatLoading', 'VettingApplicantStep_name+private'])
    tree.unmount()
  })

  test("the community's answer now wins over the one read before", async () => {
    registerHiddenVetting({} as never)
    jest.spyOn(vtiAgent, 'lastManifest').mockReturnValue(testVtc)
    // Since the earlier read, the community dropped its private way.
    jest.spyOn(vtiAgent, 'fetchManifest').mockResolvedValue({ wire: '0.3', criteria: [] } as never)
    mockUseAgent.mockReturnValue(agentWith([persona]))
    const { tree, frames } = await open()
    expect(frames[frames.length - 1]).toBe('VettingApplicantStep_name')
    tree.unmount()
  })
})
