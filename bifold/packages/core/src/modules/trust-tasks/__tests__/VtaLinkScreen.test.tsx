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
import { shareableKey } from '../screens/shareableKey'

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
    // The card with the code is still there to be given to an admin; the code
    // itself now sits behind "Show the code" (#25).
    expect(tree.getByTestId(testIdWithKey('VtaLinkShowingKey'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('VtaLinkShareKey'))).toBeTruthy()
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
    // Reveal the code, so this asserts the arrangement rather than the
    // absence of something merely collapsed.
    fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkShowTheCode')))
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

/**
 * Report #25: the link screen buried Share, Copy and "I've been added" under a
 * ~350-character code and a paragraph about a browser extension, so a tester
 * had to scroll a wall of characters to find the controls. Report #26: sharing
 * the bare code sent a `did:peer:` URI, which AirDrop handed to Finder as a URL
 * to open. Report #24: choosing "without a QR code" led to a screen offering
 * the same choice again.
 */
describe('giving the code to an admin', () => {
  const showKey = (extra: Record<string, unknown> = {}) =>
    (vtaAgent as unknown as Setter).set({
      link: {
        kind: 'showingKey',
        vtaDid: 'did:webvh:example:vta',
        label: 'alice',
        did: 'did:peer:2.Vz6Mk' + 'x'.repeat(340),
        checking: false,
        ...extra,
      },
    })

  test('the two things to do come before the code, which starts hidden', () => {
    const mockUseAgent = useAgent as jest.Mock
    mockUseAgent.mockReturnValue({ agent: {} })
    showKey()
    const tree = render(
      <BasicAppContext>
        <VtaLink />
      </BasicAppContext>
    )
    expect(tree.getByTestId(testIdWithKey('VtaLinkShareKey'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('VtaLinkCopyKey'))).toBeTruthy()
    // The code and the admin instructions are behind the affordance…
    expect(tree.queryByTestId(testIdWithKey('VtaLinkManualDid'))).toBeNull()
    expect(tree.queryByTestId(testIdWithKey('VtaLinkGiveKeyHow'))).toBeNull()
    // …and still reachable for anyone who wants them.
    fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkShowTheCode')))
    expect(tree.getByTestId(testIdWithKey('VtaLinkManualDid'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('VtaLinkGiveKeyHow'))).toBeTruthy()
  })

  test('what is shared is a message containing the code, not a bare URI', () => {
    const shared = shareableKey(((k: string) => k) as never, 'alice', 'did:peer:2.abc')
    expect(shared.message).not.toBe('did:peer:2.abc')
    expect(shared.message.startsWith('did:')).toBe(false)
    expect(shared.message).toContain('did:peer:2.abc')
    expect(shared.title).toBeTruthy()
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
