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
    const asks = asksFrom({ criteria: [{ id: 'invited-member' }, { id: 'staff', description: 'A staff credential' }] } as never)
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
  afterEach(() => jest.useRealTimers())

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
