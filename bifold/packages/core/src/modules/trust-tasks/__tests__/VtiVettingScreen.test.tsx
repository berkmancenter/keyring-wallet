/**
 * Vetting — which agent the screen works with. Store builds name no VTA, so
 * testers link their own; the screen must take the linked one, or it stops at
 * "No agent is configured for this build" before a person can do anything.
 */
import { useNavigation } from '@react-navigation/native'
import { render, act, fireEvent, within } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet } from 'react-native'
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller'

import { useAgent } from '@bifold/react-hooks'
import { encodeTicketUri } from '@bifold/trust-tasks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import VtiVetting, { requestRef, requestTestKey, whenShown } from '../screens/VtiVetting'
import { vtaAgent } from '../module/vtaAgent'
import { vtiAgent } from '../module/vtiAgent'
import { resolveVtaDid } from '../module/vtaLinkMachine'
import * as grantState from '../module/vtiGrantState'
import { VtiVetterDesk } from '../module/vtiVetting'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
// The desk's attest asks for a face or fingerprint first; here it is given.
jest.mock('../../vrc/vrc-biometric', () => ({
  requestBiometricConfirmationWithUI: jest.fn(async () => ({ success: true })),
}))

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
        records.filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v)).map((r) => ({ ...r, id: 'r' })),
      save: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
    },
  },
})

describe('Vetting — a member', () => {
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

/**
 * One filled button per step: the next thing to do. Everything else on the
 * step is outlined (IN-16, IN-18 and the desk with three filled buttons).
 */
describe('Vetting — one filled button per step', () => {
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

  beforeEach(() => {
    jest.useFakeTimers()
    setVta({ link: linked })
  })
  afterEach(() => jest.useRealTimers())

  const renderWith = async (records: Rec[]) => {
    mockUseAgent.mockReturnValue(withRecords(records))
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

  /** The testIDs of the buttons drawn filled. */
  const filled = (tree: Awaited<ReturnType<typeof renderWith>>) =>
    Array.from(
      new Set(
        tree
          .UNSAFE_queryAllByProps({ accessibilityRole: 'button' })
          .filter((b) => typeof b.type === 'string' && b.props.testID)
          .filter((b) => StyleSheet.flatten(b.props.style)?.backgroundColor !== undefined)
          .map((b) => String(b.props.testID).replace(/^com\.ariesbifold:id\//, ''))
      )
    )

  test('a member: a done card with one way on, and no "being vetted" banner', async () => {
    const tree = await renderWith([persona, membership('member')])
    await tree.findByTestId(testIdWithKey('VettingMemberDone'))
    expect(tree.queryByTestId(testIdWithKey('VettingSeatBanner'))).toBeNull()
    expect(filled(tree)).toEqual(['VettingGoToMyAgent'])

    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    fireEvent.press(tree.getByTestId(testIdWithKey('VettingGoToMyAgent')))
    // A linked phone's My Agent is the "Your agent" home, never the old panel,
    // which told a person just admitted "You are being vetted" (225 gate).
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtaAgent)
    expect(navigation.navigate).not.toHaveBeenCalledWith(Screens.MyAgent)
  })

  test('asking a vetter: Scan is the step until a link is pasted, then "Use this link" is', async () => {
    const tree = await renderWith([persona, application])
    await tree.findByTestId(testIdWithKey('VettingApplicantStep_ticket'))
    expect(filled(tree)).toEqual(['VettingScanTicketButton'])

    const ticket = encodeTicketUri({
      community: communityDid,
      vetter: 'did:webvh:example:vetter',
      presentation: { code: { code: 'ABCD-EFGH' } },
    } as never)
    fireEvent.changeText(tree.getByTestId(testIdWithKey('VettingTicketInput')), ticket)
    expect(filled(tree)).toEqual(['VettingRequestButton'])
  })

  test('a link for another community does not become the step', async () => {
    const tree = await renderWith([persona, application])
    await tree.findByTestId(testIdWithKey('VettingApplicantStep_ticket'))
    const other = encodeTicketUri({
      community: 'did:webvh:example:another-community',
      vetter: 'did:webvh:example:vetter',
      presentation: { code: { code: 'ABCD-EFGH' } },
    } as never)
    fireEvent.changeText(tree.getByTestId(testIdWithKey('VettingTicketInput')), other)
    expect(filled(tree)).toEqual(['VettingScanTicketButton'])
  })
})

describe('Vetting — a failure is said in words, the raw text only under Details (225 gate)', () => {
  // What the 225 gate's applicant saw on this screen, verbatim, plus a task URI.
  const RAW =
    'vtiAgent: sent vtc/join-requests/manifest; the community has not answered yet https://trusttasks.org/spec/vtc/join-requests/manifest/1.0'
  beforeEach(() => {
    jest.useFakeTimers()
    setVta({ link: linked })
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  test("the persona's session failing to connect shows a sentence, not the agent's message", async () => {
    jest.spyOn(vtiAgent, 'connect').mockRejectedValue(new Error(RAW))
    mockUseAgent.mockReturnValue(withRecords([persona, membership('member')]))
    const tree = render(
      <BasicAppContext>
        <VtiVetting config={storeConfig} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(50)
    })
    const line = await tree.findByTestId(testIdWithKey('VettingError'))
    expect(line).toHaveTextContent('Errors.SentNoAnswer')
    expect(tree.queryByText(/vtiAgent:|trusttasks\.org/)).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey('VettingErrorDetailsToggle')))
    expect(tree.getByTestId(testIdWithKey('VettingErrorDetail'))).toHaveTextContent(RAW)
  })
})

/**
 * The desk's steps (vettingPrimary): it opens on a new ticket when nothing is
 * in progress, moves to handing the ticket over once one is cut, and says
 * "Statement issued" only right after this visit's attest. Before, a desk
 * whose newest request was attested opened on "Step 5 of 5 · Statement
 * issued" on every later visit, and "New ticket" stayed the filled button
 * after the ticket was cut.
 */
describe('Vetting — the desk', () => {
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
  const deskRequest = (status: string, extra: Record<string, unknown> = {}): Rec => ({
    tags: { recordType: 'keyring/vti-vetting', kind: 'desk', key: 'r1' },
    content: {
      requestId: 'r1',
      applicantDid: 'did:key:z6MkApplicant',
      communityDid,
      status,
      receivedAt: '2026-09-25T09:00:00Z',
      ...extra,
    },
  })
  /** A store that keeps what the screen saves, so a ticket cut is there on the next read. */
  const keeping = (records: Rec[]) => ({
    agent: {
      ...fakeAgent().agent,
      genericRecords: {
        findAllByQuery: async (query: Record<string, string>) =>
          records.filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v)),
        save: async (r: Rec) => {
          records.push({ tags: r.tags, content: r.content })
        },
        update: async () => undefined,
        delete: async (r: Rec) => {
          records.splice(records.indexOf(r), 1)
        },
      },
    },
  })

  beforeEach(() => {
    jest.useFakeTimers()
    setVta({ link: linked })
    jest.spyOn(vtiAgent, 'connect').mockResolvedValue(undefined as never)
    // A live grant: the fixture's credential is not one the chooser can check.
    jest.spyOn(grantState, 'pickOwnVetterGrant').mockImplementation(async (_agent, grants) => ({
      held: grants[0],
      state: { state: 'active', statusChecked: true },
    }))
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  const renderDesk = async (records: Rec[]) => {
    mockUseAgent.mockReturnValue(keeping(records))
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

  const filled = (tree: Awaited<ReturnType<typeof renderDesk>>) =>
    Array.from(
      new Set(
        tree
          .UNSAFE_queryAllByProps({ accessibilityRole: 'button' })
          .filter((b) => typeof b.type === 'string' && b.props.testID)
          .filter((b) => StyleSheet.flatten(b.props.style)?.backgroundColor !== undefined)
          .map((b) => String(b.props.testID).replace(/^com\.ariesbifold:id\//, ''))
      )
    )

  test('only a finished request on the desk: it opens on a new ticket, the finished one folded away', async () => {
    const tree = await renderDesk([persona, grant, deskRequest('attested')])
    expect(await tree.findByTestId(testIdWithKey('VettingVetterStep_ticket'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('VettingVetterStep_done'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('VettingVetSomeoneElse'))).toBeNull()
    expect(filled(tree)).toEqual(['VettingNewTicketButton'])

    // Folded: the count, and nothing else until it is opened.
    expect(tree.getByTestId(testIdWithKey('VettingDeskFinishedToggle'))).toHaveTextContent(/Vetting\.FinishedRequests/)
    expect(tree.queryByTestId(testIdWithKey('VettingDeskClearButton'))).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey('VettingDeskFinishedToggle')))
    expect(tree.getAllByTestId(testIdWithKey('VettingDeskFinishedRequest'))).toHaveLength(1)

    // Clearing them still works, from inside.
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('VettingDeskClearButton')))
    })
    expect(tree.queryByTestId(testIdWithKey('VettingDeskFinishedToggle'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('VettingVetterStep_ticket'))).toBeTruthy()
  })

  test('a ticket just cut: handing it over is the step, and the raw link waits under Details', async () => {
    const tree = await renderDesk([persona, grant])
    await tree.findByTestId(testIdWithKey('VettingVetterStep_ticket'))
    expect(filled(tree)).toEqual(['VettingNewTicketButton'])

    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('VettingNewTicketButton')))
    })
    expect(tree.getByTestId(testIdWithKey('VettingVetterStep_share'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('VettingTicketCode'))).toBeTruthy()
    expect(filled(tree)).toEqual(['VettingCopyTicketLink'])

    // The link is one tap away, not on the page.
    expect(tree.queryByTestId(testIdWithKey('VettingTicketLink'))).toBeNull()
    expect(tree.queryByText(/^vetting-ticket:/)).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey('VettingTicketLinkDetailsToggle')))
    expect(tree.getByTestId(testIdWithKey('VettingTicketLink'))).toHaveTextContent(/^vetting-ticket:/)

    // Still the step on the next read of the store.
    await act(async () => {
      jest.advanceTimersByTime(3100)
    })
    expect(tree.getByTestId(testIdWithKey('VettingVetterStep_share'))).toBeTruthy()
  })

  test('an open ticket from an earlier visit is not the step: the desk opens on a new ticket', async () => {
    const earlier: Rec = {
      tags: { recordType: 'keyring/vti-vetting', kind: 'ticket', key: 'vt-earlier' },
      content: {
        ticketId: 'vt-earlier',
        code: 'ABCD-EFGH',
        secret: 's',
        communityDid,
        usesLeft: 1,
        expiresAt: '2099-01-01T00:00:00Z',
        createdAt: '2026-09-25T00:00:00Z',
      },
    }
    const tree = await renderDesk([persona, grant, earlier])
    expect(await tree.findByTestId(testIdWithKey('VettingVetterStep_ticket'))).toBeTruthy()
    expect(filled(tree)).toEqual(['VettingNewTicketButton'])
  })

  test('attested here: "Statement issued", then Vet someone else goes back to a new ticket', async () => {
    const records = [
      persona,
      grant,
      deskRequest('cardReceived', {
        matchConfirmedAt: '2026-09-25T09:01:00Z',
        session: {
          documentId: 'urn:uuid:session',
          challenge: 'c',
          domain: communityDid,
          requiredClaims: ['name.legal'],
          method: 'inPerson',
          expiresAt: '2099-01-01T00:00:00Z',
          matchCode: 'PBWW-HACW',
        },
        card: { claims: [{ type: 'name.legal', value: 'Gate Applicant' }] },
      }),
    ]
    jest.spyOn(VtiVetterDesk.prototype, 'attest').mockImplementation(async () => {
      records[2].content.status = 'attested'
      return undefined as never
    })
    const tree = await renderDesk(records)
    await tree.findByTestId(testIdWithKey('VettingVetterStep_check'))
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('VettingAttestButton')))
    })
    expect(tree.getByTestId(testIdWithKey('VettingVetterStep_done'))).toBeTruthy()
    expect(filled(tree)).toEqual(['VettingVetSomeoneElse'])

    fireEvent.press(tree.getByTestId(testIdWithKey('VettingVetSomeoneElse')))
    expect(tree.getByTestId(testIdWithKey('VettingVetterStep_ticket'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('VettingDeskFinishedToggle'))).toBeTruthy()
  })
})
