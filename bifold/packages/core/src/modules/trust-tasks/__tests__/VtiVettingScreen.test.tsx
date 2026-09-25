/**
 * Vetting — which agent the screen works with. Store builds name no VTA, so
 * testers link their own; the screen must take the linked one, or it stops at
 * "No agent is configured for this build" before a person can do anything.
 */
import { useNavigation } from '@react-navigation/native'
import { render, act, fireEvent, within } from '@testing-library/react-native'
import React from 'react'
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import VtiVetting, { requestRef, requestTestKey, whenShown } from '../screens/VtiVetting'
import { vtaAgent } from '../module/vtaAgent'
import { resolveVtaDid } from '../module/vtaLinkMachine'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Setter = { set(next: Record<string, unknown>): void }
const mockUseAgent = useAgent as jest.Mock
const setVta = (next: Record<string, unknown>) => (vtaAgent as unknown as Setter).set(next)

const linkedVtaDid = 'did:webvh:example:linked-vta'
// What a store build carries: a mediator and a community, no VTA.
const storeConfig = { mediatorDid: 'did:peer:2:mediator', communityDid: 'did:webvh:example:community' }

const linked = {
  kind: 'linked',
  vtaDid: linkedVtaDid,
  label: 'alice',
  linkedAt: '2026-09-22T00:00:00Z',
  connection: { kind: 'online', since: 0 },
}

function fakeAgent() {
  return {
    agent: {
      genericRecords: {
        findAllByQuery: async () => [],
        save: async () => undefined,
        update: async () => undefined,
        delete: async () => undefined,
      },
      dids: { resolveDidDocument: async () => Promise.reject(new Error('offline')) },
      config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    },
  }
}

describe('requestRef', () => {
  test('a request card time: the time today, the date with it on another day', () => {
    const now = new Date('2026-09-25T18:59:00')
    const today = whenShown(new Date('2026-09-25T16:21:00').toISOString(), now)
    const earlier = whenShown(new Date('2026-09-24T16:21:00').toISOString(), now)
    expect(today).not.toMatch(/Sep/)
    expect(earlier).toMatch(/Sep 24/)
    expect(earlier.endsWith(today)).toBe(true)
  })

  test('names a request by the tail of its document id', () => {
    expect(requestRef('urn:uuid:0f8e2a4c-9b1d-4e7a-8c3f-5d6b7a9e1c2f')).toBe('7a9e1c2f')
  })
  test('two requests to the same vetter get different names, and one request keeps its name', () => {
    const first = 'urn:uuid:0f8e2a4c-9b1d-4e7a-8c3f-5d6b7a9e1c2f'
    const second = 'urn:uuid:3c1d9e7f-2a4b-4c6d-9e8f-1a2b3c4d5e6f'
    expect(requestRef(first)).not.toBe(requestRef(second))
    expect(requestRef(first)).toBe(requestRef(first))
  })
  test('the reference rides in the testID, after a fixed key a reader can match by prefix', () => {
    expect(requestTestKey('urn:uuid:0f8e2a4c-9b1d-4e7a-8c3f-5d6b7a9e1c2f')).toBe('VettingRequestId.7a9e1c2f')
  })
})

describe('resolveVtaDid', () => {
  test('the linked agent wins over the one a build names', () => {
    expect(resolveVtaDid(linked as never, 'did:webvh:example:built-in')).toBe(linkedVtaDid)
  })
  test('with no link, the build’s agent', () => {
    expect(resolveVtaDid({ kind: 'notLinked' }, 'did:webvh:example:built-in')).toBe('did:webvh:example:built-in')
  })
  test('with neither, none', () => {
    expect(resolveVtaDid({ kind: 'notLinked' })).toBeUndefined()
  })
})

describe('Vetting — the agent it works with', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockUseAgent.mockReturnValue(fakeAgent())
    setVta({ link: { kind: 'notLinked' } })
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  const renderVetting = async () => {
    const tree = render(
      <BasicAppContext>
        <VtiVetting config={storeConfig} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    return tree
  }

  test('a linked agent and no build VTA: the first step, not "not configured"', async () => {
    setVta({ link: linked })
    const tree = await renderVetting()
    expect(tree.queryByText('MyAgent.NotConfigured')).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('VettingCreateIdentityButton'))).toBeTruthy()
  })

  test('a linked agent and no community: says to join one, and offers Join', async () => {
    setVta({ link: linked })
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const tree = render(
      <BasicAppContext>
        <VtiVetting config={{}} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(testIdWithKey('VettingNeedsCommunity'))).toBeTruthy()
    expect(tree.queryByText('MyAgent.NotConfigured')).toBeNull()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('VettingJoinCommunity'))))
    expect(navigate).toHaveBeenCalledWith(Screens.VtiJoin)
    expect(tree.getByTestId(testIdWithKey('VettingApplicantStep_noCommunity'))).toBeTruthy()
  })

  test('no linked agent and no build VTA: says so', async () => {
    const tree = await renderVetting()
    expect(tree.getByTestId(testIdWithKey('VettingNeedsAgent'))).toHaveTextContent('Join.NeedsAgent')
  })
})

/**
 * Admitted: the line says so, never "already" — which read as an error to an
 * applicant admitted seconds before (Farm vetting run, 2026-09-23).
 */
describe('Vetting — a member', () => {
  const communityDid = storeConfig.communityDid
  const personaDid = 'did:webvh:example:persona'
  type Rec = { tags: Record<string, string>; content: Record<string, unknown> }
  const persona: Rec = {
    tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: communityDid },
    content: {
      communityDid,
      vtaDid: linkedVtaDid,
      did: personaDid,
      contextId: 'vta',
      vtaKeyIds: { signing: 's', keyAgreement: 'k' },
      kmsKeyIds: { signing: 'ks', keyAgreement: 'kk' },
      createdAt: '2026-09-23T00:00:00Z',
    },
  }
  const membership = (role: string): Rec => ({
    tags: { recordType: 'keyring/vti-community', kind: 'membership', key: communityDid },
    content: { communityDid, personaDid, role, vmc: {}, grantedAt: '2026-09-23T20:04:44Z', via: 'vetting' },
  })
  const withRecords = (records: Rec[]) => ({
    agent: {
      ...fakeAgent().agent,
      genericRecords: {
        findAllByQuery: async (query: Record<string, string>) =>
          records
            .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
            .map((r) => ({ ...r, id: 'r' })),
        save: async () => undefined,
        update: async () => undefined,
        delete: async () => undefined,
      },
    },
  })

  beforeEach(() => {
    jest.useFakeTimers()
    setVta({ link: linked })
  })
  afterEach(() => jest.useRealTimers())

  const renderAs = async (role: string) => {
    mockUseAgent.mockReturnValue(withRecords([persona, membership(role)]))
    const tree = render(
      <BasicAppContext>
        <VtiVetting config={storeConfig} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(50)
    })
    return tree
  }

  test('a plain member: "You\'re a member of …", with no "already" and no "(member)"', async () => {
    const tree = await renderAs('member')
    const line = await tree.findByTestId(testIdWithKey('VettingAlreadyMember'))
    expect(line).toHaveTextContent(/Vetting\.Member\b/)
    expect(line).not.toHaveTextContent(/Already/i)
  })

  test('the page makes room for the keyboard: the scroll moves a focused field up with room below it', async () => {
    // The ticket field, its "can't read this" line and "Use this link" were all
    // behind the keyboard on both platforms (221 gate): the app draws under the
    // system bars, so neither resizes the page by itself.
    const tree = await renderAs('member')
    await tree.findByTestId(testIdWithKey('VettingAlreadyMember'))
    const avoiding = tree.UNSAFE_getByType(KeyboardAvoidingView)
    expect(avoiding.props.behavior).toBe('padding')
    const scroll = within(avoiding).UNSAFE_getByType(KeyboardAwareScrollView)
    expect(scroll.props.bottomOffset).toBeGreaterThanOrEqual(150)
    expect(within(scroll).getByTestId(testIdWithKey('VettingAlreadyMember'))).toBeTruthy()
  })

  test('the page names its step for a driver: a member is on "member"', async () => {
    const tree = await renderAs('member')
    await tree.findByTestId(testIdWithKey('VettingAlreadyMember'))
    expect(tree.getByTestId(testIdWithKey('VettingApplicantStep_member'))).toBeTruthy()
  })

  test('a role that says more than member is named', async () => {
    const tree = await renderAs('vetter')
    expect(await tree.findByTestId(testIdWithKey('VettingAlreadyMember'))).toHaveTextContent('Vetting.MemberAs')
  })
})
