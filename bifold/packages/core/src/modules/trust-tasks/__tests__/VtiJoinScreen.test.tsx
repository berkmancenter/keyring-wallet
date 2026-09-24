/**
 * "I want to join a community" — Door 2. The community comes from a link (or
 * the build's suggestion), then what it asks for, then the identity for it,
 * then vetting at the ticket.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { vtiAgent } from '../module/vtiAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import VtiJoin, { asksFrom } from '../screens/VtiJoin'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../../vrc/vrc-biometric', () => ({
  requestBiometricConfirmationWithUI: jest.fn(async () => ({ success: true, reason: 'confirmed' })),
}))
const mockEnsurePersona = jest.fn(async () => ({ did: 'did:webvh:QmPersona:p' }))
jest.mock('../module/vtiJoin', () => ({
  ensurePersonaFor: (...args: unknown[]) => mockEnsurePersona(...(args as [])),
}))

type Setter = { set(next: Record<string, unknown>): void }
const suggested = 'did:webvh:QmSuggested:vtc.suggested.example'
const linked = 'did:webvh:QmLinked:vtc.linked.example'
const config = { mediatorDid: 'did:peer:2:mediator', communityDid: suggested }

describe('what a community asks for', () => {
  it('reads statements and claims from a vetting criterion', () => {
    expect(
      asksFrom({ criteria: [{ vetting: { minStatements: 2, requiredClaims: ['name.legal'] } }] } as never)
    ).toEqual({ kind: 'vetting', statements: 2, claims: ['name.legal'], descriptions: [], invitationOnly: false })
  })
  it('only invitation criteria: admits by invitation', () => {
    expect(asksFrom({ criteria: [{ id: 'invited-member' }] } as never).invitationOnly).toBe(true)
  })
  it('another kind of criterion is described, not taken for invitation-only', () => {
    const asks = asksFrom({
      criteria: [{ id: 'invited-member' }, { id: 'staff', description: 'A staff credential' }],
    } as never)
    expect(asks).toMatchObject({ kind: 'other', invitationOnly: false, descriptions: ['A staff credential'] })
  })
  it('no criteria: nothing to ask (upstream cannot publish this yet, KR-13)', () => {
    expect(asksFrom({ criteria: [] } as never).kind).toBe('open')
  })
})

describe('I want to join a community', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    communityTarget.clear()
    mockEnsurePersona.mockClear()
    // No network in tests: a community that cannot be read, unless a test says otherwise.
    jest.spyOn(vtiAgent, 'fetchManifest').mockRejectedValue(new Error('offline'))
    const mockUseAgent = useAgent as jest.Mock
    mockUseAgent.mockReturnValue({ agent: { config: { logger: { info: jest.fn(), error: jest.fn() } } } })
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
    jest.restoreAllMocks()
  })

  const renderJoin = async () => {
    const tree = render(
      <BasicAppContext>
        <VtiJoin config={config} />
      </BasicAppContext>
    )
    await act(async () => {
      jest.advanceTimersByTime(10)
    })
    return tree
  }

  // A community's code can arrive before any agent is linked — the phone's
  // camera opens Keyring on it. Join says what is missing and offers the way.
  it('with no agent linked: says so and offers to link one, as "I was invited" does', async () => {
    const controller = vtaAgent as unknown as Setter
    controller.set({ link: { kind: 'notLinked' } })
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    const tree = await renderJoin()
    expect(tree.getByTestId(testIdWithKey('JoinNeedsAgent'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('JoinLinkAgent'))))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtaLink)
  })

  it('offers the suggested community, then what it asks, then the identity → vetting', async () => {
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    const tree = await renderJoin()
    expect(tree.getByTestId(testIdWithKey('JoinSuggested'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('JoinThisCommunity'))))
    expect(tree.getByTestId(testIdWithKey('JoinAsks'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('JoinStart'))))
    expect(tree.getByTestId(testIdWithKey('JoinMakeIdentity'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('JoinAsContinue'))))
    expect(mockEnsurePersona).toHaveBeenCalledWith(expect.objectContaining({ communityDid: suggested }))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtiVetting)
  })

  /**
   * A tester was offered "Join keyring-vti-vtc.ngrok.app" by a community that
   * had published no name (report #14). A hostname where a name belongs reads
   * as a name, so the card says there is none and names the host as the host.
   */
  it('does not pass a hostname off as the suggested community\u2019s name', async () => {
    const tree = await renderJoin()
    expect(tree.getByTestId(testIdWithKey('JoinSuggestedName'))).toHaveTextContent('Join.Unnamed')
    expect(tree.getByTestId(testIdWithKey('JoinSuggestedWhere'))).toHaveTextContent('vtc.suggested.example')
    // and the button cannot be "Join <hostname>" either
    expect(tree.getByTestId(testIdWithKey('JoinThisCommunity'))).toHaveTextContent('Join.JoinSuggested')
    // nothing claimed a name, so there is nothing to caveat
    expect(tree.queryByTestId(testIdWithKey('JoinNameClaimed'))).toBeNull()
  })

  /**
   * A name the community published is remembered for the community, not for
   * the visit, so the suggestion is offered by name from then on — the build's
   * suggested community is named by no link at all. (A link's claimed name is
   * rendered on the community screen; a link also takes this screen straight
   * past the suggestion, which is why the caveat is tested there.)
   */
  /**
   * A fresh phone has read nothing about the community yet. The card must ask
   * the community on its own first step, and show its published name — not
   * "hasn't published a name" (Farm gate, 2026-09-23: keyring-test-vtc
   * publishes "Keyring Lab Community" and a fresh phone was told it had none).
   */
  it('on a fresh phone, learns the published name on the first step and offers it', async () => {
    jest.spyOn(vtiAgent, 'fetchManifest').mockImplementation(async (did: string) => {
      communityTarget.publishedName(did, 'Keyring Lab Community')
      return { criteria: [] } as never
    })
    const tree = await renderJoin()
    // With this screen's agent: a fresh phone has no session to lend the read one.
    expect(vtiAgent.fetchManifest).toHaveBeenCalledWith(
      suggested,
      expect.objectContaining({ config: expect.anything() })
    )
    expect(tree.getByTestId(testIdWithKey('JoinSuggestedName'))).toHaveTextContent('Keyring Lab Community')
  })

  it('says it is checking, not "unnamed", while the community has not answered', async () => {
    jest.spyOn(vtiAgent, 'fetchManifest').mockImplementation(() => new Promise(() => undefined))
    const tree = await renderJoin()
    expect(tree.getByTestId(testIdWithKey('JoinSuggestedChecking'))).toHaveTextContent('Join.CheckingName')
    expect(tree.queryByTestId(testIdWithKey('JoinSuggestedName'))).toBeNull()
  })

  it('offers the suggestion by the name the community published, with no caveat', async () => {
    communityTarget.publishedName(suggested, 'Keyring Lab Community')
    const tree = await renderJoin()
    expect(tree.getByTestId(testIdWithKey('JoinSuggestedName'))).toHaveTextContent('Keyring Lab Community')
    expect(tree.queryByTestId(testIdWithKey('JoinNameClaimed'))).toBeNull()
  })

  /**
   * "Suggested for this app" for a community the person had joined on an
   * earlier build told them their software has an opinion it does not have —
   * and sent two sessions hunting a configuration leak that did not exist
   * (report #23). The label has to say which of the two it is.
   */
  it('says the build suggests a community only when the build does', async () => {
    const tree = await renderJoin()
    expect(tree.getByTestId(testIdWithKey('JoinSuggestedSource'))).toHaveTextContent('Join.Suggested')
  })

  it('says a remembered community is remembered, not suggested', async () => {
    // What a phone carries after joining on an earlier build: a CHOSEN
    // community and no link being viewed — a link would take this screen
    // straight past the card.
    communityTarget.choose(suggested)
    const tree = await renderJoin()
    expect(tree.getByTestId(testIdWithKey('JoinSuggestedSource'))).toHaveTextContent('Join.Remembered')
  })

  it('a remembered community that does not answer says so, beside a different one', async () => {
    // An upgrader from a build that named the lab: the lab may be gone.
    communityTarget.choose(suggested)
    const tree = await renderJoin()
    expect(tree.getByTestId(testIdWithKey('JoinRememberedUnreachable'))).toHaveTextContent('Join.RememberedUnreachable')
    expect(tree.getByTestId(testIdWithKey('JoinScanCommunity'))).toBeTruthy()
  })

  it('a suggested community that does not answer is not called gone', async () => {
    const tree = await renderJoin()
    expect(tree.queryByTestId(testIdWithKey('JoinRememberedUnreachable'))).toBeNull()
  })

  it('a community a link brought can still be swapped for a different one', async () => {
    // On a build that names no community, every community arrives by a link,
    // and reopening Join lands on what it asks. It must not be a dead end.
    communityTarget.set({ communityDid: linked, name: 'Linked Lab' })
    const tree = await renderJoin()
    expect(tree.getByTestId(testIdWithKey('JoinAsks'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('JoinScanCommunity'))).toHaveTextContent('Join.Different')
  })

  it('a community chosen by a link goes straight to what it asks, and is the one joined', async () => {
    communityTarget.set({ communityDid: linked, name: 'Linked Lab' })
    const tree = await renderJoin()
    expect(tree.queryByTestId(testIdWithKey('JoinSuggested'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('JoinAsks'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('JoinStart'))))
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('JoinAsContinue'))))
    expect(mockEnsurePersona).toHaveBeenCalledWith(expect.objectContaining({ communityDid: linked }))
  })

  it('Join as can create a profile in the real profile editor', async () => {
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    communityTarget.set({ communityDid: linked, name: 'Linked Lab' })
    const tree = await renderJoin()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('JoinStart'))))
    expect(tree.getByTestId(testIdWithKey('JoinAs'))).toBeTruthy()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('JoinAsCreateProfile'))))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.EditRCard)
  })

  it('the "what it asks" card says the whole sentence itself', async () => {
    communityTarget.set({ communityDid: linked, name: 'Linked Lab' })
    const tree = await renderJoin()
    const card = tree.getByTestId(testIdWithKey('JoinAsks'))
    // Without a session the screen shows what every vetting community asks.
    expect(card.props.accessibilityLabel).toContain('Join.AsksStatements')
    expect(card.props.accessibilityLabel).toContain('Join.AsksLegalName')
  })
})
