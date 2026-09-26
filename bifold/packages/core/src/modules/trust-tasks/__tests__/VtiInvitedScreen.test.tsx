/**
 * "I was invited" — the person sends the community's admin who to invite,
 * waits, and joins. The identity is made inside the flow (one confirmation),
 * the step shown follows what the phone already holds, and what is copied or
 * shared carries the identity for the admin.
 */
import Clipboard from '@react-native-clipboard/clipboard'
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render, within } from '@testing-library/react-native'
import React from 'react'
import { DeviceEventEmitter, ScrollView } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { VtiRefusal, vtiAgent } from '../module/vtiAgent'
import { emitCommunityChanged } from '../module/communityChanged'
import { communityTarget } from '../module/vtiCommunityLink'
import { communityLinkReturn } from '../module/vtiLinks'
import { VTI_PERSONA_DELIVERIES_EVENT } from '../module/vtiPersonaInbox'
import VtiInvited from '../screens/VtiInvited'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../../vrc/vrc-biometric', () => ({
  requestBiometricConfirmationWithUI: jest.fn(async () => ({ success: true, reason: 'confirmed' })),
}))
const mockEnsurePersona = jest.fn()
const mockJoin = jest.fn()
const mockReadJoinState = jest.fn()
jest.mock('../module/vtiJoin', () => ({
  ensurePersonaFor: (...args: unknown[]) => mockEnsurePersona(...args),
  joinCommunity: (...args: unknown[]) => mockJoin(...args),
  readJoinState: (...args: unknown[]) => mockReadJoinState(...args),
}))

type Setter = { set(next: Record<string, unknown>): void }
type Rec = { tags: Record<string, string>; content: Record<string, unknown> }

const communityDid = 'did:webvh:QmCommunity:keyring-vti-vtc.example'
const personaDid = 'did:webvh:QmPersona:keyring-vti-bob.example:personas:p1'
// A store build: no VTA named, the linked one is used.
const config = { mediatorDid: 'did:peer:2:mediator', communityDid }

const personaRecord: Rec = {
  tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: communityDid },
  content: {
    communityDid,
    vtaDid: 'did:webvh:example:vta',
    did: personaDid,
    contextId: 'vta',
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { signing: 'ks', keyAgreement: 'kk' },
    createdAt: '2026-09-22T00:00:00Z',
  },
}
const invitationRecord: Rec = {
  tags: { recordType: 'keyring/vti-community', kind: 'invitation', key: 'i1' },
  content: {
    id: 'i1',
    communityDid,
    subjectDid: personaDid,
    role: 'member',
    status: 'pending',
    credential: {},
    receivedAt: '2026-09-22T00:00:00Z',
  },
}

function fakeAgent(records: Rec[]) {
  return {
    agent: {
      genericRecords: {
        findAllByQuery: async (query: Record<string, string>) =>
          records
            .filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
            .map((r) => ({ ...r, id: 'r' })),
        save: async () => undefined,
        update: async () => undefined,
        delete: async () => undefined,
      },
      config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    },
  }
}

describe('I was invited', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockEnsurePersona.mockReset()
    mockJoin.mockReset()
    // Nothing stored about the community until a test says otherwise.
    mockReadJoinState.mockReset()
    mockReadJoinState.mockResolvedValue({ kind: 'none' })
    const setString = Clipboard.setString as jest.Mock
    setString.mockClear()
    const controller = vtaAgent as unknown as Setter
    controller.set({
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:example:vta',
        label: 'bob',
        linkedAt: '2026-09-22T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  const renderInvited = async (records: Rec[]) => {
    const mockUseAgent = useAgent as jest.Mock
    const agent = fakeAgent(records)
    mockUseAgent.mockReturnValue(agent)
    const tree = render(
      <BasicAppContext>
        <VtiInvited config={config} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    return { tree, records }
  }

  test('no identity yet: Continue makes it, then the step is sending it to the admin', async () => {
    const { tree, records } = await renderInvited([])
    expect(tree.queryByText('MyAgent.NotConfigured')).toBeNull()
    expect(tree.getByTestId(testIdWithKey('InvitedStepIndicator'))).toBeTruthy()
    mockEnsurePersona.mockImplementation(async () => {
      records.push(personaRecord)
      return personaRecord.content
    })
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedContinue')))
    })
    expect(mockEnsurePersona).toHaveBeenCalledWith(
      expect.objectContaining({ vtaDid: 'did:webvh:example:vta', communityDid })
    )
    expect(tree.getByTestId(testIdWithKey('InvitedShare'))).toBeTruthy()
  })

  test('an agent with nowhere to publish: says so plainly, with the original text under Details', async () => {
    // As the Farm's keyring-runner-nohost answers (2026-09-24): the raw text
    // used to be the whole message.
    const raw = '[TrustTasks:VtaClient] the agent has no DID host to publish a new identity on'
    const { tree } = await renderInvited([])
    mockEnsurePersona.mockRejectedValue(new Error(raw))
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedContinue')))
    })
    expect(tree.getByTestId(testIdWithKey('InvitedError'))).toHaveTextContent('Errors.NoDidHost')
    expect(tree.queryByText(raw)).toBeNull()
    // Above Continue, outside the scrolled body: at the body's end it fell
    // below the fold on Android and Continue looked dead (221).
    const [body] = tree.UNSAFE_getAllByType(ScrollView)
    expect(within(body).queryByTestId(testIdWithKey('InvitedErrorCard'))).toBeNull()
    const order = tree.root
      .findAll((n) => typeof n.type === 'string' && typeof n.props.testID === 'string')
      .map((n) => n.props.testID as string)
    expect(order.indexOf(testIdWithKey('InvitedErrorCard'))).toBeGreaterThan(-1)
    expect(order.indexOf(testIdWithKey('InvitedErrorCard'))).toBeLessThan(
      order.indexOf(testIdWithKey('InvitedContinue'))
    )
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedErrorDetailsToggle')))
    })
    expect(tree.getByTestId(testIdWithKey('InvitedErrorDetail'))).toHaveTextContent(raw)
    expect(tree.queryByTestId(testIdWithKey('InvitedShare'))).toBeNull()
  })

  test('an identity made earlier: straight to sending it, and Copy carries it', async () => {
    const { tree } = await renderInvited([personaRecord])
    expect(tree.queryByTestId(testIdWithKey('InvitedContinue'))).toBeNull()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedCopy')))
    })
    expect(Clipboard.setString).toHaveBeenCalledWith(expect.stringContaining('Invited.ShareText'))
    // The DID itself is only under Details, not on the main path.
    expect(tree.queryByTestId(testIdWithKey('InvitedPersonaDid'))).toBeNull()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedDetailsToggle')))
    })
    expect(tree.getByTestId(testIdWithKey('InvitedPersonaDid'))).toHaveTextContent(personaDid)
  })

  // join.rego: where every way in is vetted, an invitation does not bypass it,
  // so an arrived invitation must not promise a membership card by itself.
  test('an invitation to a community that vets everyone says vetting still follows', async () => {
    const manifest = jest
      .spyOn(vtiAgent, 'fetchManifest')
      .mockResolvedValue({ criteria: [{ vetting: { minStatements: 1, requiredClaims: ['name.legal'] } }] } as never)
    const { tree } = await renderInvited([personaRecord, invitationRecord])
    await act(async () => undefined)
    expect(tree.getByTestId(testIdWithKey('InvitedArrivedBody'))).toHaveTextContent('Invited.ArrivedBodyVets')
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('InvitedCommunityToggle'))))
    expect(tree.getByTestId(testIdWithKey('InvitedCommunityDid'))).toHaveTextContent(communityDid)
    manifest.mockRestore()
  })

  test('an invitation to a community it admits: Join for the card, as before', async () => {
    const manifest = jest
      .spyOn(vtiAgent, 'fetchManifest')
      .mockResolvedValue({ criteria: [{ id: 'invited-member' }] } as never)
    const { tree } = await renderInvited([personaRecord, invitationRecord])
    await act(async () => undefined)
    expect(tree.getByTestId(testIdWithKey('InvitedArrivedBody'))).toHaveTextContent(/^Invited\.ArrivedBody$/)
    manifest.mockRestore()
  })

  // keyring-bifold#139 gate: a console QR scanned from the "send it" step came
  // back to this screen, already open, and it went on showing that step.
  test('an invitation kept while the screen shows another step appears when it is announced', async () => {
    const { tree, records } = await renderInvited([personaRecord])
    expect(tree.getByTestId(testIdWithKey('InvitedShare'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('InvitedInvitationCard'))).toBeNull()
    records.push(invitationRecord)
    await act(async () => {
      DeviceEventEmitter.emit(VTI_PERSONA_DELIVERIES_EVENT, { communityDid, kinds: ['invitation'] })
      // Changes that land together refresh once, on the next tick.
      jest.advanceTimersByTime(10)
    })
    await act(async () => undefined)
    expect(tree.getByTestId(testIdWithKey('InvitedInvitationCard'))).toBeTruthy()
  })

  // The same, when the invitation is kept from a link or a console QR: the
  // store announces what it keeps, so there is no second event to send.
  test('an invitation a link keeps while the screen is open appears through the store', async () => {
    const { tree, records } = await renderInvited([personaRecord])
    expect(tree.queryByTestId(testIdWithKey('InvitedInvitationCard'))).toBeNull()
    records.push(invitationRecord)
    await act(async () => {
      emitCommunityChanged(communityDid, 'invitation')
      jest.advanceTimersByTime(10)
    })
    await act(async () => undefined)
    expect(tree.getByTestId(testIdWithKey('InvitedInvitationCard'))).toBeTruthy()
  })

  test('the invitation already arrived: Join', async () => {
    const { tree } = await renderInvited([personaRecord, invitationRecord])
    expect(tree.getByTestId(testIdWithKey('InvitedInvitationCard'))).toBeTruthy()
    mockJoin.mockResolvedValue({ membership: {} })
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedJoin')))
    })
    expect(mockJoin).toHaveBeenCalledWith(
      expect.objectContaining({ communityDid, mediatorDid: config.mediatorDid }),
      expect.objectContaining({ subjectDid: personaDid })
    )
    expect(tree.getByTestId(testIdWithKey('InvitedJoined'))).toBeTruthy()
  })

  // 220: a community that vets everyone answers an invitation with
  // request_more. That is not membership, and the screen must not say it is.
  test('the community still needs vetting: says so, never "You\'re a member", and goes on to vetting', async () => {
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    const { tree } = await renderInvited([personaRecord, invitationRecord])
    mockJoin.mockResolvedValue({ verdict: { effect: 'requestMore', needs: ['vetting:statements:1'] } })
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedJoin')))
    })
    expect(tree.queryByTestId(testIdWithKey('InvitedJoined'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('InvitedDeferred'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('InvitedDeferredNeed'))).toHaveTextContent(/Vetting\.NeedsStatements/)
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('InvitedContinueVetting'))))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtiVetting)
  })

  // Lab, 2026-09-25: the join's answer was lost ("Your agent didn't answer"),
  // the community had deferred it, and the second tap met it still open.
  test('a join the community already holds: shows where it stands, never "didn\'t answer" or "doesn\'t know why"', async () => {
    const { tree } = await renderInvited([personaRecord, invitationRecord])
    mockJoin.mockRejectedValue(
      new VtiRefusal('vtc/join-requests/submit:requestAlreadyOpen', 'an open join request already exists', {
        requestId: 'cfea2409',
        status: 'deferred',
      })
    )
    mockReadJoinState.mockResolvedValue({
      kind: 'deferred',
      submission: { needs: ['vetting:statements:1'] },
      needs: [{ kind: 'statements', count: 1 }],
    })
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedJoin')))
    })
    expect(mockReadJoinState).toHaveBeenCalledWith(expect.anything(), communityDid, expect.anything())
    expect(tree.getByTestId(testIdWithKey('InvitedDeferred'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('InvitedDeferredNeed'))).toHaveTextContent(/Vetting\.NeedsStatements/)
    expect(tree.queryByTestId(testIdWithKey('InvitedError'))).toBeNull()
  })

  test('the community fell silent after the submit: asks where it stands instead of offering a blind retry', async () => {
    const { tree } = await renderInvited([personaRecord, invitationRecord])
    mockJoin.mockRejectedValue(
      Object.assign(new Error('vtiAgent: sent vtc/join-requests/submit; the community has not answered yet'), {
        name: 'VtiSentNoAnswer',
      })
    )
    mockReadJoinState.mockResolvedValue({ kind: 'sent', submission: {} })
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedJoin')))
    })
    expect(tree.getByTestId(testIdWithKey('InvitedPending'))).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('InvitedError'))).toBeNull()
  })

  test('a request the community holds open can be withdrawn from the flow, which offers Join again', async () => {
    const { tree } = await renderInvited([personaRecord, invitationRecord])
    mockJoin.mockResolvedValue({ verdict: { effect: 'refer', needs: [] } })
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedJoin')))
    })
    const connect = jest.spyOn(vtiAgent, 'connect').mockResolvedValue(undefined as never)
    const withdraw = jest.spyOn(vtiAgent, 'withdraw').mockResolvedValue({ status: 'withdrawn' })
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedWithdraw')))
    })
    expect(withdraw).toHaveBeenCalledWith(communityDid)
    expect(tree.getByTestId(testIdWithKey('InvitedJoin'))).toBeTruthy()
    connect.mockRestore()
    withdraw.mockRestore()
  })

  // The journey-state audit (G): "joined" lived only in the screen, so leaving
  // and coming back showed a member the start of the invitation again.
  test('a member who comes back (or the screen remounts) sees that they joined', async () => {
    mockReadJoinState.mockResolvedValue({ kind: 'member', membership: { communityDid } })
    const first = await renderInvited([personaRecord])
    expect(first.tree.getByTestId(testIdWithKey('InvitedJoined'))).toBeTruthy()
    first.tree.unmount()
    const again = await renderInvited([personaRecord])
    expect(again.tree.getByTestId(testIdWithKey('InvitedJoined'))).toBeTruthy()
  })

  // Android, 2026-09-26 (1 run in 2): the join saves its request as it sends
  // it; the store announces that, and the screen turned into "Sent — deciding"
  // mid-join, its Withdraw reading "Withdrawing…" though nobody had tapped it.
  test('a join in flight stays on the join while its own "sent" is stored, and Withdraw is not "Withdrawing…"', async () => {
    const { tree } = await renderInvited([personaRecord, invitationRecord])
    let finish: (v: unknown) => void = () => undefined
    mockJoin.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedJoin')))
    })
    // The join's own submission lands in the store while it waits for the answer.
    mockReadJoinState.mockResolvedValue({ kind: 'sent', submission: {} })
    await act(async () => {
      emitCommunityChanged(communityDid, 'submission')
      jest.advanceTimersByTime(10)
    })
    await act(async () => undefined)
    expect(tree.queryByTestId(testIdWithKey('InvitedPending'))).toBeNull()
    expect(tree.queryByText('Invited.Withdrawing')).toBeNull()
    // The community's answer arrives: joined.
    await act(async () => {
      finish({ verdict: { effect: 'allow' }, membership: {} })
    })
    expect(tree.getByTestId(testIdWithKey('InvitedJoined'))).toBeTruthy()
  })

  test('a membership that arrives after the screen settled on "deciding" moves it to joined', async () => {
    const { tree } = await renderInvited([personaRecord, invitationRecord])
    // The join's answer was lost; asked where it stands, the community said pending.
    mockJoin.mockRejectedValue(
      Object.assign(new Error('vtiAgent: sent vtc/join-requests/submit; the community has not answered yet'), {
        name: 'VtiSentNoAnswer',
      })
    )
    mockReadJoinState.mockResolvedValue({ kind: 'pending', submission: {} })
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedJoin')))
    })
    expect(tree.getByTestId(testIdWithKey('InvitedPending'))).toBeTruthy()
    // Then the card is delivered and stored.
    mockReadJoinState.mockResolvedValue({ kind: 'member', membership: { communityDid } })
    await act(async () => {
      emitCommunityChanged(communityDid, 'membership')
      jest.advanceTimersByTime(10)
    })
    await act(async () => undefined)
    expect(tree.getByTestId(testIdWithKey('InvitedJoined'))).toBeTruthy()
  })

  test('a membership stored while the screen is open shows at once, with no poll', async () => {
    const { tree } = await renderInvited([personaRecord, invitationRecord])
    expect(tree.queryByTestId(testIdWithKey('InvitedJoined'))).toBeNull()
    mockReadJoinState.mockResolvedValue({ kind: 'member', membership: { communityDid } })
    await act(async () => {
      emitCommunityChanged(communityDid, 'membership')
      jest.advanceTimersByTime(10)
    })
    expect(tree.getByTestId(testIdWithKey('InvitedJoined'))).toBeTruthy()
    // Only what the phone stored was read: nothing asked the community.
    expect(mockReadJoinState).toHaveBeenLastCalledWith(expect.anything(), communityDid, { poll: false })
  })

  test('referred to a person: says the community is deciding', async () => {
    const { tree } = await renderInvited([personaRecord, invitationRecord])
    mockJoin.mockResolvedValue({ verdict: { effect: 'refer', needs: [] } })
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('InvitedJoin')))
    })
    expect(tree.queryByTestId(testIdWithKey('InvitedJoined'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('InvitedPending'))).toBeTruthy()
  })
})

/**
 * A store build names no community: testers bring their own. The admin
 * invites an identity made for a community, so "I was invited" asks which
 * community first — it used to say "No agent is configured for this build".
 */
describe('I was invited, on a build that names no community', () => {
  const linked = {
    kind: 'linked',
    vtaDid: 'did:webvh:example:vta',
    label: 'bob',
    linkedAt: '2026-09-22T00:00:00Z',
    connection: { kind: 'online', since: 0 },
  }
  beforeEach(() => {
    jest.useFakeTimers()
    communityTarget.clear()
    communityLinkReturn.take()
  })
  afterEach(() => jest.useRealTimers())

  const controller = vtaAgent as unknown as Setter
  const mockUseAgent = useAgent as jest.Mock
  const renderEmpty = async () => {
    mockUseAgent.mockReturnValue(fakeAgent([]))
    const tree = render(
      <BasicAppContext>
        <VtiInvited config={{}} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    return tree
  }

  it('asks which community invited you, and brings its link back here', async () => {
    controller.set({ link: linked })
    const tree = await renderEmpty()
    expect(tree.getByTestId(testIdWithKey('InvitedWhichCommunity'))).toBeTruthy()
    expect(tree.queryByText('MyAgent.NotConfigured')).toBeNull()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('InvitedScanCommunity'))))
    // The community link the person brings back lands on this screen, not on Join.
    expect(communityLinkReturn.take()).toBe(true)
  })

  it('with no agent linked, says so and offers linking', async () => {
    controller.set({ link: { kind: 'notLinked' } })
    const navigate = useNavigation().navigate as jest.Mock
    navigate.mockClear()
    const tree = await renderEmpty()
    expect(tree.getByTestId(testIdWithKey('InvitedNeedsAgent'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('InvitedLinkAgent'))))
    expect(navigate).toHaveBeenCalledWith(Screens.VtaLink)
  })
})
