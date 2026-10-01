/**
 * Link your agent — the success screen is shown once, and names this phone
 * (new-phone-new-device-plan.md §A). Continue registers the name and sets the
 * stack to the offer instead of pushing on top of it, so a return to the tab
 * does not bring "Linked ✓" back.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import QRCode from 'react-native-qrcode-svg'

import { useAgent } from '@bifold/react-hooks'

import enCopy from '../../../localization/en/en.json'
import frCopy from '../../../localization/fr/fr.json'
import ptBrCopy from '../../../localization/pt-br/pt-br.json'
import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens, Stacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { openScanner } from '../screens/openScanner'
import VtaLink, { PHONE_GRANT_POLL_EVERY_MS } from '../screens/VtaLink'
import { shareableKey } from '../screens/shareableKey'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Setter = { set(next: Record<string, unknown>): void }

describe('Link your agent — done', () => {
  let navigation: { reset: jest.Mock; navigate: jest.Mock }

  beforeEach(() => {
    navigation = useNavigation() as unknown as { reset: jest.Mock; navigate: jest.Mock }
    navigation.reset.mockClear()
    navigation.navigate.mockClear()
    ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
  })

  const linked = () => {
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
    const tree = render(
      <BasicAppContext>
        <VtaLink />
      </BasicAppContext>
    )
    return { tree, navigation }
  }

  afterEach(() => jest.restoreAllMocks())

  test('Continue names this phone on the agent, then sets the stack to the offer, with the success screen gone', async () => {
    const register = jest.spyOn(vtaAgent, 'registerThisDevice').mockResolvedValue(undefined)
    const { tree, navigation } = linked()
    // The short dated default, ready to keep or change.
    expect(tree.getByTestId(testIdWithKey('DeviceNameInput')).props.value).toMatch(/^Devices\.DefaultName/)
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkContinue')))
    })
    expect(register).toHaveBeenCalledWith({}, expect.stringMatching(/^Devices\.DefaultName/))
    // Set, not pushed: a linked phone has no operator panel under it to go back to. The
    // offer moves on to Your agent by itself when there is no other phone.
    expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: Screens.VtaNewPhoneOffer }] })
    expect(navigation.navigate).not.toHaveBeenCalledWith(Screens.VtaAgent)
  })

  test('a name the person types is the one registered, trimmed', async () => {
    const register = jest.spyOn(vtaAgent, 'registerThisDevice').mockResolvedValue(undefined)
    const { tree } = linked()
    fireEvent.changeText(tree.getByTestId(testIdWithKey('DeviceNameInput')), '  Sam’s phone ')
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkContinue')))
    })
    expect(register).toHaveBeenCalledWith({}, 'Sam’s phone')
  })

  test('a blank name falls back to the default', async () => {
    const register = jest.spyOn(vtaAgent, 'registerThisDevice').mockResolvedValue(undefined)
    const { tree } = linked()
    fireEvent.changeText(tree.getByTestId(testIdWithKey('DeviceNameInput')), '   ')
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkContinue')))
    })
    expect(register).toHaveBeenCalledWith({}, expect.stringMatching(/^Devices\.DefaultName/))
  })

  test('a refused registration does not hold the person up: the phone is linked, and it goes on', async () => {
    jest.spyOn(vtaAgent, 'registerThisDevice').mockRejectedValue(new Error('no answer'))
    const { tree, navigation } = linked()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkContinue')))
    })
    expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: Screens.VtaNewPhoneOffer }] })
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

  // #30 (IN-52/53): after scanning another phone's "Add another phone" code,
  // this phone shows ITS code for that phone to scan — no admin, no Share —
  // and notices by itself when it has been added.
  describe('after scanning the other phone', () => {
    const show = () =>
      render(
        <BasicAppContext>
          <VtaLink />
        </BasicAppContext>
      )

    test('shows its code as a QR, with Copy and the code as text, and nothing about an admin', () => {
      showKey({ via: 'scan', did: 'did:key:z6MkNewPhone' })
      const tree = show()
      expect(tree.getByTestId(testIdWithKey('VtaLinkForOtherPhone'))).toHaveTextContent(/VtaLink\.AddThisPhone/)
      expect(tree.UNSAFE_getByType(QRCode).props.value).toBe('did:key:z6MkNewPhone')
      expect(tree.getByTestId(testIdWithKey('VtaLinkCopyKey'))).toBeTruthy()
      expect(tree.queryByTestId(testIdWithKey('VtaLinkShareKey'))).toBeNull()
      expect(tree.queryByTestId(testIdWithKey('VtaLinkGiveKeyHow'))).toBeNull()
      fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkShowAsText')))
      expect(tree.getByTestId(testIdWithKey('VtaLinkManualDid'))).toHaveTextContent('did:key:z6MkNewPhone')
    })

    test('checks by itself whether the other phone has added it, and says it is waiting', () => {
      jest.useFakeTimers()
      try {
        const check = jest.spyOn(vtaAgent, 'checkManualGrant').mockResolvedValue(undefined)
        showKey({ via: 'scan', did: 'did:key:z6MkNewPhone' })
        const tree = show()
        expect(tree.getByTestId(testIdWithKey('VtaLinkWaitingForPhone'))).toBeTruthy()
        // No "I've been added" to press: the check runs on its own.
        expect(tree.queryByTestId(testIdWithKey('VtaLinkCheckGrant'))).toBeNull()
        act(() => {
          jest.advanceTimersByTime(PHONE_GRANT_POLL_EVERY_MS * 2 + 10)
        })
        expect(check).toHaveBeenCalledTimes(2)
      } finally {
        jest.useRealTimers()
      }
    })

    /**
     * On a Pixel 6 (1080×2400, default text) Copy sat under the ~260 dp QR, at
     * the bottom of the scrolling card: only its top edge showed above "Stop
     * linking", and "Show as text" was off screen (2026-10-01). Larger text
     * pushes it further down. Copy now belongs to the action bar, which never
     * scrolls — this test fails if it drifts back inside the card.
     */
    test('Copy sits with Stop linking in the action bar, not under the QR', () => {
      showKey({ via: 'scan', did: 'did:key:z6MkNewPhone' })
      const tree = show()
      const card = tree.getByTestId(testIdWithKey('VtaLinkForOtherPhone'))
      const inCard = (testID: string) =>
        Boolean(card.findAll((node) => node.props?.testID === testIdWithKey(testID)).length)
      expect(tree.getByTestId(testIdWithKey('VtaLinkCopyKey'))).toBeTruthy()
      expect(inCard('VtaLinkCopyKey')).toBe(false)
      expect(inCard('VtaLinkCancel')).toBe(false)
      expect(inCard('VtaLinkKeyQr')).toBe(true)
    })

    /**
     * The same scan lands here from an agent host's own page (a QR holding
     * just the agent's address, beside an "Admin DID" box) as from another
     * phone's "Add another phone" code: both are a bare agent DID, and the
     * phone cannot tell them apart. So the words cover both, and name no host.
     */
    test('the words cover an agent host’s Admin DID box as well as another phone', () => {
      for (const words of [enCopy, frCopy, ptBrCopy]) {
        const said = [words.VtaLink.AddThisPhone, words.VtaLink.AddThisPhoneBody, words.VtaLink.WaitingToBeAdded]
        expect(said.join(' ')).not.toMatch(/farm/i)
        expect(words.VtaLink.AddThisPhoneBody).toContain('Admin DID')
      }
      expect(enCopy.VtaLink.AddThisPhone).not.toMatch(/other phone/i)
      expect(enCopy.VtaLink.WaitingToBeAdded).not.toMatch(/other phone/i)
      expect(enCopy.VtaLink.AddThisPhoneBody).toMatch(/other phone/i)
    })
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
    // Where the admin adds it is in view — behind a quiet link nobody found it (219)…
    expect(tree.getByTestId(testIdWithKey('VtaLinkGiveKeyHow'))).toHaveTextContent(/VtaLink\.GiveKeyHow/)
    // …while the code itself stays out of sight until asked for.
    expect(tree.queryByTestId(testIdWithKey('VtaLinkManualDid'))).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkShowTheCode')))
    expect(tree.getByTestId(testIdWithKey('VtaLinkManualDid'))).toBeTruthy()
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

describe('a link that failed', () => {
  const failed = (lastError: Record<string, unknown>) =>
    (vtaAgent as unknown as Setter).set({ link: { kind: 'notLinked', lastError } })

  test('says what was caught in words, with the original text behind Details', async () => {
    // As an iPhone's link failed on the lab (2026-09-25): the mediator socket
    // never opened, and the screen said only "something went wrong".
    const mockUseAgent = useAgent as jest.Mock
    mockUseAgent.mockReturnValue({ agent: {} })
    const raw = '[TrustTasks:VtiMediatorTransport] socket failed to open: network connection lost'
    failed({ reason: 'failed', detail: raw })
    const tree = render(
      <BasicAppContext>
        <VtaLink />
      </BasicAppContext>
    )
    expect(tree.getByTestId(testIdWithKey('VtaLinkError'))).toHaveTextContent('Errors.Unreachable')
    expect(tree.queryByText(raw)).toBeNull()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkErrorDetailsToggle')))
    })
    expect(tree.getByTestId(testIdWithKey('VtaLinkErrorDetail'))).toHaveTextContent(raw)
  })

  test('with nothing caught, the general sentence and no Details', () => {
    const mockUseAgent = useAgent as jest.Mock
    mockUseAgent.mockReturnValue({ agent: {} })
    failed({ reason: 'failed' })
    const tree = render(
      <BasicAppContext>
        <VtaLink />
      </BasicAppContext>
    )
    expect(tree.getByTestId(testIdWithKey('VtaLinkError'))).toHaveTextContent('VtaLink.FailedOther')
    expect(tree.queryByTestId(testIdWithKey('VtaLinkErrorDetailsToggle'))).toBeNull()
  })
})

describe('Link your agent — this phone was removed', () => {
  // A removed phone can't learn over TSP that it was wiped: its next call is
  // refused "not in ACL". It never erases itself on that alone (226 rule):
  // the person chooses, and nothing is preselected.
  const erase = jest.fn()
  const controller = vtaAgent as unknown as Setter & { eraseThisPhonesCopy: jest.Mock }
  const mockUseAgent = useAgent as jest.Mock
  beforeEach(() => {
    mockUseAgent.mockReturnValue({ agent: {} })
    erase.mockReset().mockResolvedValue(undefined)
    controller.eraseThisPhonesCopy = erase
  })
  const removed = (cause?: 'wiped' | 'notInAcl') => {
    controller.set({
      link: {
        kind: 'revoked',
        vtaDid: 'did:webvh:example:vta',
        label: 'alice',
        reason: 'not in ACL',
        ...(cause ? { cause } : {}),
      },
    })
    return render(
      <BasicAppContext>
        <VtaLink />
      </BasicAppContext>
    )
  }

  test('says so, and offers Erase and Link again with equal weight, neither chosen', () => {
    const tree = removed('notInAcl')
    expect(tree.getByText('VtaLink.RevokedTitle')).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('VtaLinkError'))).toHaveTextContent('VtaLink.RevokedBody')
    const eraseButton = tree.getByTestId(testIdWithKey('VtaLinkErase'))
    const again = tree.getByTestId(testIdWithKey('VtaLinkScanAgain'))
    expect(JSON.stringify(eraseButton.props.style)).toBe(JSON.stringify(again.props.style))
    expect(erase).not.toHaveBeenCalled()
  })

  test('a positive wipe signal changes the words, not the choice: nothing is erased by itself', () => {
    const tree = removed('wiped')
    expect(tree.getByTestId(testIdWithKey('VtaLinkError'))).toHaveTextContent('VtaLink.RevokedBodyWiped')
    expect(tree.getByTestId(testIdWithKey('VtaLinkErase'))).toBeTruthy()
    expect(erase).not.toHaveBeenCalled()
  })

  test('Erase says what goes and what stays, and erases only once confirmed', async () => {
    const tree = removed('notInAcl')
    fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkErase')))
    expect(tree.getByTestId(testIdWithKey('VtaLinkEraseWhat'))).toHaveTextContent('VtaLink.RevokedEraseWhat')
    expect(erase).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkEraseConfirm')))
    })
    expect(erase).toHaveBeenCalledWith({})
  })

  test('once erased, the phone is unlinked and says its copy is gone', async () => {
    erase.mockImplementation(async () => controller.set({ link: { kind: 'notLinked' } }))
    const tree = removed('notInAcl')
    fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkErase')))
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkEraseConfirm')))
    })
    expect(tree.getByTestId(testIdWithKey('VtaLinkErased'))).toHaveTextContent('VtaLink.RevokedErased')
  })

  test('Keep backs out of erasing, and nothing is sent', () => {
    const tree = removed('notInAcl')
    fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkErase')))
    fireEvent.press(tree.getByTestId(testIdWithKey('VtaLinkEraseKeep')))
    expect(tree.queryByTestId(testIdWithKey('VtaLinkEraseWhat'))).toBeNull()
    expect(erase).not.toHaveBeenCalled()
  })
})
