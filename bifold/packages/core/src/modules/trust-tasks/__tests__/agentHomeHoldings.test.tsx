/**
 * "What your agent holds", read as a person reads it (2026-09-26): each card
 * names its community so two unnamed ones can be told apart, says when a
 * membership was joined and whether it predates this phone, offers the
 * vetting desk once, and says "your identity for X" once. The journey strip
 * wraps without an orphan '›', and its "Joined" never reads as unconfirmed.
 */
import { act, render, within } from '@testing-library/react-native'
import type { TFunction } from 'i18next'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import { communityCardKey } from '../screens/CommunityCard'
import { communityHeadingOf, didPathName } from '../screens/communityName'
import VtaAgentHome, { forgetAgentHoldings } from '../screens/VtaAgentHome'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: jest.fn(() => true),
}))
const mockGrantState = jest.fn()
jest.mock('../module/vtiGrantState', () => ({
  ownVetterGrantState: (...args: unknown[]) => mockGrantState(...args),
}))
// The key, and what was interpolated into it, so a name can be seen on screen.
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

type Setter = { set(next: Record<string, unknown>): void }
const controller = vtaAgent as unknown as Setter
type Rec = { tags: Record<string, string>; content: Record<string, unknown> }

const A = 'did:webvh:QmCommunityA:vtc.example.org:keyring-test-vtc'
const B = 'did:webvh:QmCommunityB:vtc.example.org:first-vtc'
const keyOf = communityCardKey

const persona = (communityDid: string): Rec => ({
  tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: communityDid },
  content: {
    communityDid,
    vtaDid: 'did:webvh:example:vta',
    did: `${communityDid}:p`,
    contextId: 'vta',
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { signing: 'ks', keyAgreement: 'kk' },
    createdAt: '2026-09-20T00:00:00Z',
  },
})
const membership = (communityDid: string, grantedAt: string): Rec => ({
  tags: { recordType: 'keyring/vti-community', kind: 'membership', key: communityDid },
  content: { communityDid, personaDid: `${communityDid}:p`, role: 'member', vmc: {}, grantedAt, via: 'vetting' },
})
const grant = (communityDid: string): Rec => ({
  tags: { recordType: 'keyring/vti-community', kind: 'credential', key: `g-${communityDid}` },
  content: {
    kind: 'vetter-grant',
    communityDid,
    subjectDid: `${communityDid}:p`,
    credential: {},
    receivedAt: '2026-09-22T00:00:00Z',
  },
})

function fakeAgent(records: Rec[]) {
  return {
    agent: {
      genericRecords: {
        findAllByQuery: async (query: Record<string, string>) =>
          records
            .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
            .map((r) => ({ ...r, id: 'r' })),
      },
      config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    },
  }
}

const linkedAt = '2026-09-22T12:00:00Z'

describe('what your agent holds, card by card', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    forgetAgentHoldings()
    communityTarget.clear()
    mockGrantState.mockReset()
    mockGrantState.mockResolvedValue({ state: 'none' })
    controller.set({
      introSeen: true,
      activity: [],
      approvals: [],
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:example:vta',
        label: 'bob',
        linkedAt,
        connection: { kind: 'online', since: 0 },
      },
    })
  })
  afterEach(() => jest.useRealTimers())

  const renderHome = async (records: Rec[]) => {
    const mockUseAgent = useAgent as jest.Mock
    mockUseAgent.mockReturnValue(fakeAgent(records))
    const tree = render(
      <BasicAppContext>
        <VtaAgentHome />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    return tree
  }

  it('names each community, so two unnamed ones are told apart — and never by their host', async () => {
    const tree = await renderHome([persona(A), membership(A, linkedAt), persona(B), membership(B, linkedAt)])
    const a = tree.getByTestId(testIdWithKey(`AgentCommunityName_${keyOf(A)}`))
    const b = tree.getByTestId(testIdWithKey(`AgentCommunityName_${keyOf(B)}`))
    expect(a).toHaveTextContent('keyring-test-vtc')
    expect(b).toHaveTextContent('first-vtc')
    expect(tree.getByTestId(testIdWithKey('AgentHolds'))).not.toHaveTextContent(/vtc\.example\.org/)
  })

  it('says when each membership was joined, and marks one from before this phone was linked', async () => {
    const tree = await renderHome([
      persona(A),
      membership(A, '2026-09-01T00:00:00Z'),
      persona(B),
      membership(B, '2026-09-23T00:00:00Z'),
    ])
    expect(tree.getByTestId(testIdWithKey(`AgentMemberSince_${keyOf(A)}`))).toHaveTextContent(
      'MyAgent.MemberSince(date=2026-09-01)'
    )
    expect(tree.getByTestId(testIdWithKey(`AgentMemberSince_${keyOf(B)}`))).toHaveTextContent(
      'MyAgent.MemberSince(date=2026-09-23)'
    )
    expect(tree.getByTestId(testIdWithKey(`AgentMemberBeforeLink_${keyOf(A)}`))).toHaveTextContent(
      'MyAgent.MemberBeforeLink'
    )
    expect(tree.queryByTestId(testIdWithKey(`AgentMemberBeforeLink_${keyOf(B)}`))).toBeNull()
  })

  it("a vetter's page offers the vetting desk once, on the community's card", async () => {
    mockGrantState.mockResolvedValue({ state: 'active', statusChecked: true })
    const tree = await renderHome([persona(A), membership(A, linkedAt), grant(A)])
    expect(tree.getByTestId(testIdWithKey('AgentVetterCard'))).toHaveTextContent(/VtaLink\.YouCanVet/)
    expect(tree.queryByTestId(testIdWithKey('AgentVetOthers'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey(`AgentCommunityPrimary_${keyOf(A)}`))).toHaveTextContent('VtaLink.OpenDesk')
    expect(tree.getAllByText('VtaLink.OpenDesk')).toHaveLength(1)
  })

  it("a vetter who holds no membership yet still has the desk on the card, not 'continue vetting'", async () => {
    mockGrantState.mockResolvedValue({ state: 'active', statusChecked: true })
    const tree = await renderHome([persona(A), grant(A)])
    expect(tree.getByTestId(testIdWithKey(`AgentCommunityPrimary_${keyOf(A)}`))).toHaveTextContent('VtaLink.OpenDesk')
  })

  it('an applicant\'s card says "your identity for" the community once', async () => {
    const tree = await renderHome([persona(A)])
    const card = tree.getByTestId(testIdWithKey(`AgentCommunityCard_${keyOf(A)}`))
    expect(within(card).getAllByText(/VtaLink\.IdentityFor/)).toHaveLength(1)
    // The share button stays, with a line saying what it is for.
    expect(within(card).getByTestId(testIdWithKey('AgentShareIdentity'))).toBeTruthy()
    expect(card).toHaveTextContent(/VtaLink\.IdentityShareRow/)
  })

  it("the journey's chevrons travel with the stop after them, so none is left alone at a line's end", async () => {
    const tree = await renderHome([persona(A), membership(A, linkedAt)])
    const row = tree.getByTestId(testIdWithKey('AgentJourneyRow'))
    // Every child of the strip is a stop group; no bare chevron between them.
    for (const child of row.children as { props: { testID?: string } }[]) {
      expect(child.props.testID).toMatch(/AgentJourneyStop_/)
    }
    for (const key of ['Joined', 'Member']) {
      const group = tree.getByTestId(testIdWithKey(`AgentJourneyStop_${key}`))
      expect(within(group).UNSAFE_getByProps({ name: 'chevron-right' })).toBeTruthy()
      expect(within(group).getByTestId(testIdWithKey(`AgentJourney${key}`))).toBeTruthy()
    }
  })

  it('"Joined" names a community known only from a link without "(not confirmed …)"', async () => {
    communityTarget.set({ communityDid: A, name: 'Lab Community' })
    const tree = await renderHome([persona(A), membership(A, linkedAt)])
    const joined = tree.getByTestId(testIdWithKey('AgentJourneyJoined'))
    expect(joined).toHaveTextContent(/VtaLink\.JourneyJoined\(community=Lab Community\)/)
    expect(joined).not.toHaveTextContent(/ClaimedName/)
    // The member's status line is about the membership too, so it is plain as well;
    // the card's heading still says where the name came from.
    expect(tree.getByTestId(testIdWithKey(`AgentCommunityStatus_${keyOf(A)}`))).not.toHaveTextContent(/ClaimedName/)
    expect(tree.getByTestId(testIdWithKey(`AgentCommunityName_${keyOf(A)}`))).toHaveTextContent(
      'Community.ClaimedName(name=Lab Community)'
    )
  })
})

describe('a community heading, where several stand side by side', () => {
  const t = ((key: string, values?: Record<string, unknown>) =>
    values
      ? `${key}(${Object.entries(values)
          .filter(([k]) => k !== 'interpolation')
          .map(([k, v]) => `${k}=${v}`)
          .join(',')})`
      : key) as unknown as TFunction
  beforeEach(() => communityTarget.clear())

  it("reads a did:webvh's path segment, never its host", () => {
    expect(didPathName(A)).toBe('keyring-test-vtc')
    expect(didPathName('did:webvh:QmNoPath:vtc.example.org')).toBeUndefined()
    expect(didPathName('did:peer:2.Ez6LSabc')).toBeUndefined()
  })

  it('prefers a published name, then a claimed one, then the path', () => {
    expect(communityHeadingOf(A, t)).toBe('keyring-test-vtc')
    communityTarget.set({ communityDid: A, name: 'Claimed' })
    expect(communityHeadingOf(A, t)).toBe('Community.ClaimedName(name=Claimed)')
    expect(communityHeadingOf(A, t, { claim: 'plain' })).toBe('Claimed')
    communityTarget.publishedName(A, 'Published')
    expect(communityHeadingOf(A, t)).toBe('Published')
  })

  it('with no path, tells communities apart by the end of the SCID — not the host', () => {
    const one = communityHeadingOf('did:webvh:QmFirstOne111:vtc.example.org', t)
    const two = communityHeadingOf('did:webvh:QmSecondTwo222:vtc.example.org', t)
    expect(one).toBe('Community.UnnamedRef(ref=One111)')
    expect(two).toBe('Community.UnnamedRef(ref=Two222)')
    expect(one).not.toContain('example')
  })
})
