/**
 * Link your agent — the success screen is shown once. Continue sets the stack
 * to My Agent → Your agent instead of pushing on top of it, so a return to the
 * tab does not bring "Linked ✓" back.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import enCopy from '../../../localization/en/en.json'
import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens, Stacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { openScanner } from '../screens/openScanner'
import VtaLink from '../screens/VtaLink'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Setter = { set(next: Record<string, unknown>): void }

describe('Link your agent — done', () => {
  test('Continue leaves My Agent → Your agent, with the success screen gone', async () => {
    const mockUseAgent = useAgent as jest.Mock
    mockUseAgent.mockReturnValue({ agent: {} })
    const controller = vtaAgent as unknown as Setter
    controller.set({
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:example:vta',
        label: 'alice',
        linkedAt: '2026-09-22T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
    const navigation = useNavigation() as unknown as { reset: jest.Mock; navigate: jest.Mock }
    navigation.reset.mockClear()
    navigation.navigate.mockClear()
    const tree = render(
      <BasicAppContext>
        <VtaLink />
      </BasicAppContext>
    )
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkContinue')))
    })
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 1,
      routes: [{ name: Screens.MyAgent }, { name: Screens.VtaAgent }],
    })
    expect(navigation.navigate).not.toHaveBeenCalledWith(Screens.VtaAgent)
  })
})

describe('the key the admin has to add', () => {
  const showKey = (extra: Record<string, unknown>) =>
    (vtaAgent as unknown as Setter).set({
      link: {
        kind: 'showingKey',
        vtaDid: 'did:webvh:example:vta',
        label: 'alice',
        did: 'did:peer:2.temporary',
        checking: false,
        ...extra,
      },
    })

  test('an agent that said nothing says so, and the button offers another go', async () => {
    const mockUseAgent = useAgent as jest.Mock
    mockUseAgent.mockReturnValue({ agent: {} })
    showKey({ noAnswer: true })
    const tree = render(
      <BasicAppContext>
        <VtaLink />
      </BasicAppContext>
    )
    expect(tree.getByTestId(testIdWithKey('VtaLinkNoAnswer'))).toHaveTextContent('VtaLink.NoAnswer')
    // A silence is not a refusal: only one of the two ever shows.
    expect(tree.queryByTestId(testIdWithKey('VtaLinkNotYet'))).toBeNull()
    // The key stays put, so the admin can still be given it.
    expect(tree.getByTestId(testIdWithKey('VtaLinkManualDid'))).toBeTruthy()
    expect(tree.getByText('VtaLink.TryAgain')).toBeTruthy()
  })

  /**
   * The screens above render keys, not sentences. What the person actually
   * reads lives in the string table, so the substance is checked there: the
   * agent is named, something to check is given, and nobody is told to go and
   * find an operator.
   */
  test('the words say which agent, and what to do about it', () => {
    const said = enCopy.VtaLink.NoAnswer
    expect(said).toContain('{{label}}')
    expect(said).toMatch(/exact code/i)
    expect(said).toMatch(/try again/i)
    expect(said).not.toMatch(/contact|support|administrator of/i)
  })

  /**
   * The refusal was rendered at the end of the card, after a ~350-character
   * key: on a phone it sat below the fold while the button that produced it
   * stayed pinned to the bottom of the screen, so tapping "I've been added"
   * looked like it did nothing (Android, 2026-09-22). Both messages now belong
   * to the action bar, with the button — this test fails if either drifts back
   * inside the scrolling card.
   */
  test('what the check found sits with the button, not below the key', () => {
    const mockUseAgent = useAgent as jest.Mock
    mockUseAgent.mockReturnValue({ agent: {} })
    showKey({ notYet: true })
    const tree = render(
      <BasicAppContext>
        <VtaLink />
      </BasicAppContext>
    )
    const card = tree.getByTestId(testIdWithKey('VtaLinkShowingKey'))
    const inCard = (testID: string) =>
      Boolean(card.findAll((node) => node.props?.testID === testIdWithKey(testID)).length)
    expect(inCard('VtaLinkManualDid')).toBe(true)
    expect(inCard('VtaLinkNotYet')).toBe(false)
  })

  test('while a check is in flight neither message shows', async () => {
    const mockUseAgent = useAgent as jest.Mock
    mockUseAgent.mockReturnValue({ agent: {} })
    showKey({ checking: true })
    const tree = render(
      <BasicAppContext>
        <VtaLink />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(testIdWithKey('VtaLinkNoAnswer'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('VtaLinkNotYet'))).toBeNull()
  })
})

describe('the scanner these flows open', () => {
  test('is the camera with its paste-link button, never a leftover "show my QR"', () => {
    const navigate = jest.fn()
    openScanner({ navigate })
    expect(navigate).toHaveBeenCalledWith(Stacks.ConnectStack, {
      screen: Screens.Scan,
      params: { defaultToConnect: false },
    })
  })
})
