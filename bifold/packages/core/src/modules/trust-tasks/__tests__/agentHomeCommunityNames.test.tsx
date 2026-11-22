/**
 * My Agent's community list says what each community calls itself now, by
 * the rule sign-in already follows (IN-340, #451): a community this agent
 * belongs to whose name on record is missing or over a day old has its
 * published name read again — after the stored name is shown, never waited
 * on — and kept. Nothing is resolved for a community it does not belong to.
 * A screen that reloads on every focus, store change and timer asks each
 * community once at a time, and not again for ten minutes after a read that
 * found nothing.
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import {
  COMMUNITY_NAME_RETRY_MS,
  COMMUNITY_NAME_TTL_MS,
  forgetCommunityNameReads,
  refreshPublishedNameThrottled,
} from '../module/communityNameRefresh'
import { emitCommunityChanged } from '../module/communityChanged'
import { vtaAgent } from '../module/vtaAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import { communityCardKey } from '../screens/CommunityCard'
import VtaAgentHome, { forgetAgentHoldings } from '../screens/VtaAgentHome'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}))
jest.mock('../module/vtiGrantState', () => ({
  ownVetterGrantState: async () => ({ state: 'none' }),
}))
// The community's own service, at the network's edge: the rest is the real code.
const mockProfileName = jest.fn<Promise<string | undefined>, [string, string]>()
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  readPublicProfileName: (base: string, did: string) => mockProfileName(base, did),
}))
jest.mock('react-i18next', () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values && Object.keys(values).some((k) => k !== 'interpolation')
      ? `${key}(${Object.entries(values)
          .filter(([k]) => k !== 'interpolation')
          .map(([k, v]) => `${k}=${v}`)
          .join(',')})`
      : key
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', t, changeLanguage: () => new Promise(() => {}) } }),
    initReactI18next: { type: '3rdParty', init: jest.fn() },
    Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  }
})

type Rec = { tags: Record<string, string>; content: Record<string, unknown> }
const controller = vtaAgent as unknown as { set(next: Record<string, unknown>): void }

const VTA = 'did:webvh:example:vta'
const A = 'did:webvh:QmCommunityA:vtc.example.org:keyring-test-vtc'
const NOW = Date.parse('2026-10-21T18:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

const persona = (communityDid: string, vtaDid = VTA): Rec => ({
  tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: communityDid },
  content: {
    communityDid,
    vtaDid,
    did: `${communityDid}:p`,
    contextId: 'vta',
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { signing: 'ks', keyAgreement: 'kk' },
    createdAt: '2026-09-20T00:00:00Z',
  },
})
const membership = (communityDid: string, over: Record<string, unknown> = {}): Rec => ({
  tags: { recordType: 'keyring/vti-community', kind: 'membership', key: communityDid },
  content: {
    communityDid,
    personaDid: `${communityDid}:p`,
    role: 'member',
    vmc: {},
    grantedAt: '2026-09-22T00:00:00Z',
    via: 'vetting',
    ...over,
  },
})
const storedName = (communityDid: string, name: string, at?: string): Rec => ({
  tags: { recordType: 'keyring/vti-community', kind: 'community-name', key: communityDid },
  content: { communityDid, name, ...(at ? { at } : {}) },
})

function fakeAgent(records: Rec[]) {
  const resolveDidDocument = jest.fn(async (did: string) => ({
    service: [{ type: 'VTCRest', serviceEndpoint: `https://${did.split(':').pop()}.example/api` }],
  }))
  const matches = (r: Rec, query: Record<string, string>) => Object.entries(query).every(([k, v]) => r.tags[k] === v)
  const agent = {
    genericRecords: {
      findAllByQuery: async (query: Record<string, string>) =>
        records.filter((r) => matches(r, query)).map((r) => ({ ...r, id: r.tags.key })),
      update: async (rec: Rec) => {
        const kept = records.find((r) => matches(r, rec.tags))
        if (kept) kept.content = rec.content
      },
      save: async (rec: Rec) => void records.push({ tags: rec.tags, content: rec.content }),
      delete: async () => undefined,
    },
    dids: { resolveDidDocument },
    config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
  }
  return { agent, resolveDidDocument, records }
}

const settle = async (ms = 10) => {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

const renderHome = async (records: Rec[], { storageFails = false } = {}) => {
  const fake = fakeAgent(records)
  if (storageFails) {
    const failing = async () => Promise.reject(new Error('storage full'))
    Object.assign(fake.agent.genericRecords, { update: failing, save: failing })
  }
  ;(useAgent as jest.Mock).mockReturnValue({ agent: fake.agent })
  const tree = render(
    <BasicAppContext>
      <VtaAgentHome />
    </BasicAppContext>
  )
  await settle()
  const nameOf = (did: string) => tree.getByTestId(testIdWithKey(`AgentCommunityName_${communityCardKey(did)}`))
  return { tree, nameOf, ...fake }
}

describe("My Agent's community names, read again when old", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW })
    forgetAgentHoldings()
    forgetCommunityNameReads()
    communityTarget.clear()
    mockProfileName.mockReset()
    controller.set({
      introSeen: true,
      activity: [],
      approvals: [],
      link: {
        kind: 'linked',
        vtaDid: VTA,
        label: 'bob',
        linkedAt: '2026-09-22T12:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
  })
  afterEach(() => jest.useRealTimers())

  it('a name over a day old: shown at once, then the one the community publishes now, kept with today’s date', async () => {
    let answer: (name: string) => void = () => undefined
    mockProfileName.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    const { nameOf, resolveDidDocument, records } = await renderHome([
      persona(A),
      membership(A),
      storedName(A, 'Old name', hoursAgo(25)),
    ])
    // The stored name, while the read is still out.
    expect(nameOf(A)).toHaveTextContent(/Old name/)
    expect(resolveDidDocument).toHaveBeenCalledWith(A)
    await act(async () => answer('Renamed community'))
    await settle()
    expect(nameOf(A)).toHaveTextContent(/Renamed community/)
    const kept = records.find((r) => r.tags.kind === 'community-name' && r.tags.key === A)?.content
    expect(kept).toMatchObject({ communityDid: A, name: 'Renamed community' })
    // Dated now, so the day-old rule starts over from this read.
    expect(Date.parse(String(kept?.at))).toBeGreaterThanOrEqual(NOW)
  })

  it('no name on record: the published one is read, for a community this agent holds an identity in', async () => {
    mockProfileName.mockResolvedValue('Named after joining')
    const { nameOf, resolveDidDocument } = await renderHome([persona(A)])
    await settle()
    expect(resolveDidDocument).toHaveBeenCalledWith(A)
    expect(nameOf(A)).toHaveTextContent(/Named after joining/)
  })

  it('a name under a day old is taken as it is: nothing goes out', async () => {
    const { nameOf, resolveDidDocument } = await renderHome([
      persona(A),
      membership(A),
      storedName(A, 'Kept name', hoursAgo(23)),
    ])
    expect(nameOf(A)).toHaveTextContent(/Kept name/)
    expect(resolveDidDocument).not.toHaveBeenCalled()
    expect(mockProfileName).not.toHaveBeenCalled()
  })

  it('a read that never answers holds up nothing: the stored name stays on the card', async () => {
    mockProfileName.mockImplementation(() => new Promise(() => undefined))
    const { nameOf } = await renderHome([persona(A), membership(A), storedName(A, 'Old name', hoursAgo(48))])
    await settle(60_000)
    expect(nameOf(A)).toHaveTextContent(/Old name/)
  })

  describe('never a community this agent does not belong to', () => {
    const OTHER = 'did:webvh:QmOther:vtc.example.org:other-vtc'
    const LEFT = 'did:webvh:QmLeft:vtc.example.org:left-vtc'
    const ELSEWHERE = 'did:webvh:QmElse:vtc.example.org:another-agents-vtc'

    it('a stored name with no holding, a membership that ended, another agent’s identity: none is resolved', async () => {
      mockProfileName.mockResolvedValue('Should not be asked')
      const { resolveDidDocument } = await renderHome([
        // Belongs: the control, so the screen is known to have looked.
        persona(A),
        membership(A),
        storedName(A, 'Old name', hoursAgo(30)),
        // A name kept from a link once scanned, nothing held there.
        storedName(OTHER, 'Scanned once', hoursAgo(72)),
        // A membership that ended, and no identity there now.
        membership(LEFT, { personaDid: `${LEFT}:gone`, removal: { at: hoursAgo(100), reason: 'removed' } }),
        storedName(LEFT, 'Left long ago', hoursAgo(100)),
        // An identity another agent holds.
        persona(ELSEWHERE, 'did:webvh:example:another-vta'),
      ])
      await settle()
      expect(resolveDidDocument.mock.calls.map(([did]) => did)).toEqual([A])
    })
  })

  describe('a screen that reloads often', () => {
    it('one read at a time per community, however many reloads come while it is out', async () => {
      mockProfileName.mockImplementation(() => new Promise(() => undefined))
      const { resolveDidDocument } = await renderHome([persona(A), membership(A), storedName(A, 'Old', hoursAgo(30))])
      for (let i = 0; i < 3; i++) {
        await act(async () => emitCommunityChanged(A, 'membership'))
        await settle()
      }
      expect(resolveDidDocument).toHaveBeenCalledTimes(1)
    })

    it('after a read that found nothing, not again for ten minutes; then read again', async () => {
      mockProfileName.mockResolvedValue(undefined)
      const { resolveDidDocument } = await renderHome([persona(A), membership(A), storedName(A, 'Old', hoursAgo(30))])
      await settle()
      expect(resolveDidDocument).toHaveBeenCalledTimes(1)
      await act(async () => emitCommunityChanged(A, 'membership'))
      await settle()
      expect(resolveDidDocument).toHaveBeenCalledTimes(1)
      await settle(COMMUNITY_NAME_RETRY_MS)
      await act(async () => emitCommunityChanged(A, 'membership'))
      await settle()
      expect(resolveDidDocument).toHaveBeenCalledTimes(2)
    })
  })

  // 7a on #460: the brake held only for a read that found nothing.
  it('a name read but not stored (the record still reads old): not read again for ten minutes either', async () => {
    mockProfileName.mockResolvedValue('Renamed community')
    const home = await renderHome([persona(A), membership(A), storedName(A, 'Old', hoursAgo(30))], {
      storageFails: true,
    })
    await settle()
    expect(home.resolveDidDocument).toHaveBeenCalledTimes(1)
    // Shown, though not stored.
    expect(home.nameOf(A)).toHaveTextContent(/Renamed community/)
    for (let i = 0; i < 3; i++) {
      await act(async () => emitCommunityChanged(A, 'membership'))
      await settle()
    }
    expect(home.resolveDidDocument).toHaveBeenCalledTimes(1)
    await settle(COMMUNITY_NAME_RETRY_MS)
    await act(async () => emitCommunityChanged(A, 'membership'))
    await settle()
    expect(home.resolveDidDocument).toHaveBeenCalledTimes(2)
  })

  it('the day is the same one sign-in uses', () => {
    expect(COMMUNITY_NAME_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('the throttled read itself', () => {
  const agentFor = () => {
    const resolveDidDocument = jest.fn(async () => ({
      service: [{ type: 'VTCRest', serviceEndpoint: 'https://vtc.example/api' }],
    }))
    return {
      resolveDidDocument,
      agent: {
        dids: { resolveDidDocument },
        genericRecords: {
          findAllByQuery: async () => [],
          save: async () => undefined,
          update: async () => undefined,
          delete: async () => undefined,
        },
      } as never,
    }
  }
  beforeEach(() => {
    forgetCommunityNameReads()
    communityTarget.clear()
    mockProfileName.mockReset()
  })

  it("one agent's read holds back only its own: another agent reads the same community at once", async () => {
    mockProfileName.mockResolvedValue(undefined)
    const { agent, resolveDidDocument } = agentFor()
    await refreshPublishedNameThrottled(agent, A, { scope: 'did:webvh:vta-one', now: NOW })
    await refreshPublishedNameThrottled(agent, A, { scope: 'did:webvh:vta-one', now: NOW + 1000 })
    expect(resolveDidDocument).toHaveBeenCalledTimes(1)
    await refreshPublishedNameThrottled(agent, A, { scope: 'did:webvh:vta-two', now: NOW + 1000 })
    expect(resolveDidDocument).toHaveBeenCalledTimes(2)
  })

  it('never rejects: a read that throws counts as one that found nothing', async () => {
    mockProfileName.mockResolvedValue('A name')
    const spy = jest.spyOn(communityTarget, 'publishedName').mockImplementation(() => {
      throw new Error('a listener threw')
    })
    const { agent, resolveDidDocument } = agentFor()
    await expect(refreshPublishedNameThrottled(agent, A, { now: NOW })).resolves.toBeUndefined()
    // And it is braked like one.
    await refreshPublishedNameThrottled(agent, A, { now: NOW + 1000 })
    expect(resolveDidDocument).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
