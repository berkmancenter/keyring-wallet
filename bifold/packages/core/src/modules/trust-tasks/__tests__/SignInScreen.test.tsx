/**
 * Signing in to a community's website from a scanned code: confirm (nothing
 * sent), claim, the two-digit number (one try), the community's report of
 * the browser, Approve or Decline, and every way it can end — against fake
 * steps, so no protocol runs here.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { testIdWithKey } from '../../../utils/testable'
import { SIGN_IN_FAILURE_MESSAGES, SignInError, type ClaimedSignIn } from '../module/oobSignIn'
import { GRANT_LIFETIME_SECONDS } from '../module/oobSignInAgent'
import { type ProvedSignIn, type SignInIdentity, type SignInSteps } from '../module/signInSteps'
import SignIn, { SignInFlow } from '../screens/SignIn'
import { SignInIds } from '../screens/SignIn.ids'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const VTC = 'did:webvh:QmNvAiYMwoZMWGfY62gqNJuedQgH224FMpHenzJTK1wJrG:webvh.storm.ws:test-vtc'
const NOW = 1_800_000_000
const codeFor = (exp: number) =>
  `https://link.trustoverip.org/t#_from=${VTC}&_id=XOcGXOQTCHb5iz4T2JD2RQ&_exp=${exp}&_type=/vti/flow/sign-in/0.1`
const LINK = codeFor(NOW + 300)

const claimed = {
  requestId: 'XOcGXOQTCHb5iz4T2JD2RQ',
  vtcDid: VTC,
  base: 'https://vtc.example.org',
  portalOrigin: 'https://portal.example.org',
  decisionDeadline: NOW + 120,
  keyA: { did: 'did:key:z6MkA', verificationMethod: 'did:key:z6MkA#z6MkA', sign: jest.fn() },
  answer: {},
} as unknown as ClaimedSignIn

const proved: ProvedSignIn = {
  claimed,
  step2: {},
  sessionKey: {},
  requester: { browser: 'Firefox 131', os: 'macOS', location: 'Boston, US', sameNetwork: true },
  identifiedAs: 'Alberto',
  persona: { did: 'did:webvh:QmP:host:persona', entryId: 'entry-1' },
  version: '0.2',
}

const fakeSteps = (over: Partial<SignInSteps> = {}): jest.Mocked<SignInSteps> =>
  ({
    community: jest.fn(async () => ({ member: true, name: 'Test Community' })),
    claim: jest.fn(async () => claimed),
    identifyAndProve: jest.fn(async () => proved),
    approve: jest.fn(async () => ({ status: 'approved' as const })),
    cancel: jest.fn(async () => ({ cancelled: true })),
    ...over,
  }) as jest.Mocked<SignInSteps>

let clock = NOW
const now = () => clock
const onClose = jest.fn()

/** `null`: no code held. */
const show = async (steps: SignInSteps, link: string | null = LINK) => {
  const tree = render(
    <BasicAppContext>
      <SignInFlow link={link ?? undefined} steps={steps} now={now} onClose={onClose} />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}

const press = async (tree: ReturnType<typeof render>, key: string) => {
  await act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })
}

const typeNumber = async (tree: ReturnType<typeof render>, text: string) => {
  await act(async () => {
    fireEvent.changeText(tree.getByTestId(id(SignInIds.numberInput)), text)
  })
}

/** Through confirm, claim and the number, to the review. */
const toReview = async (steps: SignInSteps) => {
  const tree = await show(steps)
  await press(tree, SignInIds.continue)
  await typeNumber(tree, '42')
  await press(tree, SignInIds.numberContinue)
  return tree
}

const message = (tree: ReturnType<typeof render>) => tree.getByTestId(id(SignInIds.resultMessage))

beforeEach(() => {
  clock = NOW
  onClose.mockReset()
  ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
})

afterEach(() => jest.useRealTimers())

describe('1. confirm, before anything is sent', () => {
  test("names the community from Keyring's records and its host; nothing goes out before Continue", async () => {
    const steps = fakeSteps()
    const tree = await show(steps)
    expect(steps.community).toHaveBeenCalledWith(VTC)
    expect(tree.getByTestId(id(SignInIds.confirm))).toBeTruthy()
    expect(tree.getByTestId(id(SignInIds.community))).toHaveTextContent('Test Community')
    // VTI-LNK-050: the domain and then the path, marked unverified.
    expect(tree.getByTestId(id(SignInIds.host))).toHaveTextContent('webvh.storm.ws/test-vtc')
    expect(tree.getByTestId(id(SignInIds.unverified))).toHaveTextContent('SignIn.Unverified')
    expect(tree.getByText('SignIn.ConfirmTitle')).toBeTruthy()
    expect(steps.claim).not.toHaveBeenCalled()

    await press(tree, SignInIds.continue)
    expect(steps.claim).toHaveBeenCalledWith(LINK)
    expect(tree.getByTestId(id(SignInIds.number))).toBeTruthy()
  })

  // IN-249: a community with no name was shown as its raw did:webvh. It is
  // its handle, said as having no name yet; the DID is behind Details.
  test('a community with no name is shown by its handle, never its raw DID', async () => {
    const tree = await show(fakeSteps({ community: jest.fn(async () => ({ member: true })) }))
    expect(tree.getByTestId(id(SignInIds.community))).toHaveTextContent('Community.UnnamedRef')
    expect(tree.getByTestId(id(SignInIds.community))).not.toHaveTextContent(VTC)
  })

  test('a community this phone has not joined, with no name: its handle, the DID behind Details', async () => {
    const tree = await show(fakeSteps({ community: jest.fn(async () => ({ member: false })) }))
    expect(tree.getByTestId(id(SignInIds.notMember))).toBeTruthy()
    expect(tree.getByTestId(id(SignInIds.community))).not.toHaveTextContent(VTC)
    expect(tree.queryByTestId(id(`${SignInIds.communityDid}Did`))).toBeNull()
    await press(tree, `${SignInIds.communityDid}Toggle`)
    expect(tree.getByTestId(id(`${SignInIds.communityDid}Did`))).toHaveTextContent(VTC)
  })

  test('Cancel leaves without sending anything', async () => {
    const steps = fakeSteps()
    const tree = await show(steps)
    await press(tree, SignInIds.cancel)
    expect(onClose).toHaveBeenCalled()
    expect(steps.claim).not.toHaveBeenCalled()
    expect(steps.cancel).not.toHaveBeenCalled()
  })

  test('a community this phone has not joined is said so, and nothing else is offered', async () => {
    const steps = fakeSteps({ community: jest.fn(async () => ({ member: false, name: 'Elsewhere' })) })
    const tree = await show(steps)
    expect(tree.getByTestId(id(SignInIds.notMember))).toBeTruthy()
    expect(message(tree)).toHaveTextContent('SignIn.Failure.notAMember')
    expect(tree.queryByTestId(id(SignInIds.continue))).toBeNull()
    expect(tree.getByTestId(id(SignInIds.done))).toBeTruthy()
    expect(steps.claim).not.toHaveBeenCalled()
  })

  test('a code that expired on the way is refused before the records are even read', async () => {
    const steps = fakeSteps()
    const tree = await show(steps, codeFor(NOW - 3600))
    expect(message(tree)).toHaveTextContent('SignIn.Failure.expired')
    expect(steps.community).not.toHaveBeenCalled()
    expect(steps.claim).not.toHaveBeenCalled()
  })

  test('with no code held, it says to scan again', async () => {
    const steps = fakeSteps()
    const tree = await show(steps, null)
    expect(message(tree)).toHaveTextContent('SignIn.NoCode')
    expect(steps.community).not.toHaveBeenCalled()
  })
})

// IN-296: identities on any linked agent, the plugin's too. Several: which one signs in is asked before anything is
// sent; one goes straight on, as before.
const identity = (over: Partial<SignInIdentity> = {}): SignInIdentity => ({
  vtaDid: 'did:webvh:QmA:dids.example:agent-a',
  agentName: 'Home agent',
  current: true,
  did: 'did:webvh:QmP:host:joined',
  contextId: 'ctx-a',
  label: 'Me at Test',
  source: 'thisPhone',
  ...over,
})
const PLUGIN = identity({
  vtaDid: 'did:webvh:QmB:dids.example:agent-b',
  agentName: 'Work agent',
  current: false,
  did: 'did:webvh:QmQ:host:plugin',
  entryId: 'entry-plugin',
  label: 'Test (browser)',
  source: 'agent',
})

describe('1b. which identity, when several hold a membership', () => {
  test('several: a picker with each identity, its agent and where it came from; nothing is sent before a choice', async () => {
    const steps = fakeSteps({
      community: jest.fn(async () => ({ member: true, name: 'Test Community', identities: [identity(), PLUGIN] })),
    })
    const tree = await show(steps)
    await press(tree, SignInIds.continue)
    expect(tree.getByTestId(id(SignInIds.choose))).toBeTruthy()
    expect(steps.claim).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(`${SignInIds.identityOption}-0`))).toHaveTextContent(/Me at Test/)
    expect(tree.getByTestId(id(`${SignInIds.identityAgent}-0`))).toHaveTextContent('SignIn.ChooseOnAgentCurrent')
    expect(tree.getByTestId(id(`${SignInIds.identityOption}-0`))).toHaveTextContent(/SignIn\.ChooseFromPhone/)
    expect(tree.getByTestId(id(`${SignInIds.identityAgent}-1`))).toHaveTextContent('SignIn.ChooseOnAgent')
    expect(tree.getByTestId(id(`${SignInIds.identityOption}-1`))).toHaveTextContent(/SignIn\.ChooseFromAgent/)

    await press(tree, `${SignInIds.identityOption}-1`)
    expect(steps.claim).toHaveBeenCalledWith(LINK)
    await typeNumber(tree, '42')
    await press(tree, SignInIds.numberContinue)
    expect(steps.identifyAndProve).toHaveBeenCalledWith(claimed, '42', PLUGIN)
    // The review still says who is signing in.
    expect(tree.getByTestId(id(SignInIds.identifiedAs))).toHaveTextContent('Alberto')
  })

  test('one: no picker, straight on to the claim as before', async () => {
    const steps = fakeSteps({
      community: jest.fn(async () => ({ member: true, name: 'Test Community', identities: [PLUGIN] })),
    })
    const tree = await show(steps)
    await press(tree, SignInIds.continue)
    expect(tree.queryByTestId(id(SignInIds.choose))).toBeNull()
    expect(steps.claim).toHaveBeenCalledWith(LINK)
    expect(tree.getByTestId(id(SignInIds.number))).toBeTruthy()
  })

  test('Cancel at the picker leaves without sending anything', async () => {
    const steps = fakeSteps({
      community: jest.fn(async () => ({ member: true, name: 'Test Community', identities: [identity(), PLUGIN] })),
    })
    const tree = await show(steps)
    await press(tree, SignInIds.continue)
    await press(tree, SignInIds.cancel)
    expect(onClose).toHaveBeenCalled()
    expect(steps.claim).not.toHaveBeenCalled()
  })

  test("an identity with no name is shown by its DID's last part, never the whole DID", async () => {
    const steps = fakeSteps({
      community: jest.fn(async () => ({
        member: true,
        name: 'Test Community',
        identities: [identity(), { ...PLUGIN, label: undefined }],
      })),
    })
    const tree = await show(steps)
    await press(tree, SignInIds.continue)
    expect(tree.getByTestId(id(`${SignInIds.identityOption}-1`))).toHaveTextContent(/^plugin/)
    expect(tree.getByTestId(id(`${SignInIds.identityOption}-1`))).not.toHaveTextContent(/did:webvh/)
  })

  test('the words are in every language', () => {
    for (const lang of [en, fr, ptBr] as Record<string, Record<string, string>>[])
      for (const key of [
        'ChooseTitle',
        'ChooseBody',
        'ChooseOnAgent',
        'ChooseOnAgentCurrent',
        'ChooseFromPhone',
        'ChooseFromAgent',
      ])
        expect(lang.SignIn[key]).toBeTruthy()
  })
})

describe('3. the number the website shows', () => {
  test('takes two digits only, and Continue waits for both', async () => {
    const steps = fakeSteps()
    const tree = await show(steps)
    await press(tree, SignInIds.continue)
    expect(tree.getByText('SignIn.NumberTitle')).toBeTruthy()

    await typeNumber(tree, '7')
    expect(tree.getByTestId(id(SignInIds.numberContinue)).props.accessibilityState).toMatchObject({ disabled: true })
    await press(tree, SignInIds.numberContinue)
    expect(steps.identifyAndProve).not.toHaveBeenCalled()

    await typeNumber(tree, 'a4-25')
    expect(tree.getByTestId(id(SignInIds.numberInput)).props.value).toBe('42')
    await press(tree, SignInIds.numberContinue)
    expect(steps.identifyAndProve).toHaveBeenCalledWith(claimed, '42', undefined)
  })

  test('shows the time left to decide', async () => {
    const tree = await show(fakeSteps())
    await press(tree, SignInIds.continue)
    expect(tree.getByTestId(id(SignInIds.timeLeft))).toHaveTextContent('SignIn.TimeLeft')
  })

  test('a wrong number ends the request and says to scan again', async () => {
    const steps = fakeSteps({
      identifyAndProve: jest.fn(async () => {
        throw new SignInError('wrongNumber')
      }),
    })
    const tree = await toReview(steps)
    expect(message(tree)).toHaveTextContent('SignIn.Failure.wrongNumber')
    expect(en.SignIn.Failure.wrongNumber).toBe(
      "That isn't the number on the sign-in page. Refresh the page and scan the new code."
    )
    expect(tree.queryByTestId(id(SignInIds.numberInput))).toBeNull()
    expect(steps.approve).not.toHaveBeenCalled()
  })

  test('Cancel at the number gives the claimed request up', async () => {
    const steps = fakeSteps()
    const tree = await show(steps)
    await press(tree, SignInIds.continue)
    await press(tree, SignInIds.cancel)
    expect(steps.cancel).toHaveBeenCalledWith(claimed)
    expect(message(tree)).toHaveTextContent('SignIn.Declined')
  })
})

describe('5. the request, as the community reports it', () => {
  test('shows what the community reports of the browser, labelled as its report, and that only that session signs in', async () => {
    const tree = await toReview(fakeSteps())
    expect(tree.getByTestId(id(SignInIds.review))).toBeTruthy()
    expect(tree.getByTestId(id(SignInIds.reportedBy))).toHaveTextContent('SignIn.ReportedBy')
    expect(tree.getByTestId(id(SignInIds.browser))).toHaveTextContent('Firefox 131')
    expect(tree.getByTestId(id(SignInIds.system))).toHaveTextContent('macOS')
    expect(tree.getByTestId(id(SignInIds.location))).toHaveTextContent('Boston, US')
    expect(tree.getByTestId(id(SignInIds.sameNetwork))).toHaveTextContent('SignIn.Yes')
    expect(tree.getByTestId(id(SignInIds.community))).toHaveTextContent('Test Community')
    expect(tree.getByTestId(id(SignInIds.website))).toHaveTextContent('https://portal.example.org')
    expect(tree.getByTestId(id(SignInIds.identifiedAs))).toHaveTextContent('Alberto')
    expect(tree.getByTestId(id(SignInIds.sessionOnly))).toHaveTextContent('SignIn.SessionOnly')
    // How long it lasts, in hours read from the grant's notAfter (maintainer, IN-280: 12 h, as the plugin grants).
    // A ceiling: the VTC ends the session sooner if its refresh-token expiry comes first (review on #435).
    expect(en.SignIn.SessionOnly).toBe('This signs in that browser for up to {{hours}} hours, or until you sign out.')
    expect(GRANT_LIFETIME_SECONDS).toBe(12 * 60 * 60)
  })

  // IN-280: a 0.2 sign-in that delegates signing says so, in words, before the person approves.
  test('a scope the community offers is said in words: the browser may also act as the person there, this session', async () => {
    const scoped = { ...proved, signingScope: ['vtc/directory'] }
    const tree = await toReview(fakeSteps({ identifyAndProve: jest.fn(async () => scoped) }))
    expect(tree.getByTestId(id(SignInIds.signingScope))).toHaveTextContent(/SignIn\.SigningScope/)
    expect(en.SignIn.SigningScope).toBe('For that time it also lets that browser act as you in: {{areas}}.')
    expect(en.SignIn.ScopeDirectory).toBe('the member directory (reading it, and editing your own card)')
  })

  test('no scope offered (0.1, or none): nothing more is said', async () => {
    const tree = await toReview(fakeSteps())
    expect(tree.queryByTestId(id(SignInIds.signingScope))).toBeNull()
  })

  test('what the community did not report is said to be not reported', async () => {
    const bare = { ...proved, requester: {} }
    const tree = await toReview(fakeSteps({ identifyAndProve: jest.fn(async () => bare) }))
    expect(tree.getByTestId(id(SignInIds.browser))).toHaveTextContent('SignIn.NotReported')
    expect(tree.getByTestId(id(SignInIds.sameNetwork))).toHaveTextContent('SignIn.NotReported')
  })

  test('Approve approves, and says to return to the website; nothing is cancelled', async () => {
    const steps = fakeSteps()
    const tree = await toReview(steps)
    await press(tree, SignInIds.approve)
    expect(steps.approve).toHaveBeenCalledWith(proved)
    expect(message(tree)).toHaveTextContent('SignIn.SignedIn')
    expect(en.SignIn.SignedIn).toBe('Signed in. You can return to the website.')
    tree.unmount()
    expect(steps.cancel).not.toHaveBeenCalled()
  })

  test('Decline cancels the request and never approves', async () => {
    const steps = fakeSteps()
    const tree = await toReview(steps)
    await press(tree, SignInIds.decline)
    expect(steps.cancel).toHaveBeenCalledWith(claimed)
    expect(steps.approve).not.toHaveBeenCalled()
    expect(message(tree)).toHaveTextContent('SignIn.Declined')
  })

  test('Decline still ends declined when the cancel goes unanswered', async () => {
    const steps = fakeSteps({ cancel: jest.fn(async () => Promise.reject(new Error('offline'))) })
    const tree = await toReview(steps)
    await press(tree, SignInIds.decline)
    expect(message(tree)).toHaveTextContent('SignIn.Declined')
    expect(steps.approve).not.toHaveBeenCalled()
  })
})

describe('6. how it ended: every reason has its words', () => {
  const fails = (reason: string) => async () => {
    throw new SignInError(reason as never, 'detail')
  }

  test.each(['unreachable', 'noSignIn', 'alreadyClaimed', 'notFound', 'refused', 'badAnswer', 'expired'])(
    'a claim refused for %s',
    async (reason) => {
      const tree = await show(fakeSteps({ claim: jest.fn(fails(reason)) }))
      await press(tree, SignInIds.continue)
      expect(message(tree)).toHaveTextContent(`SignIn.Failure.${reason}`)
    }
  )

  test.each(['noVaultEntry', 'grantReplayed', 'notEnrolledDevice', 'refused'])(
    'identify and prove refused for %s',
    async (reason) => {
      const tree = await toReview(fakeSteps({ identifyAndProve: jest.fn(fails(reason)) }))
      expect(message(tree)).toHaveTextContent(`SignIn.Failure.${reason}`)
    }
  )

  test.each(['uvRequired', 'notEnrolledDevice', 'unreachable'])('an approval that fails for %s', async (reason) => {
    const steps = fakeSteps({ approve: jest.fn(fails(reason)) })
    const tree = await toReview(steps)
    await press(tree, SignInIds.approve)
    expect(message(tree)).toHaveTextContent(`SignIn.Failure.${reason}`)
    // Never cancelled after Approve: the community would cancel an approved sign-in.
    tree.unmount()
    expect(steps.cancel).not.toHaveBeenCalled()
  })

  test('an error with no reason is worded generally', async () => {
    const tree = await show(fakeSteps({ claim: jest.fn(async () => Promise.reject(new Error('boom'))) }))
    await press(tree, SignInIds.continue)
    expect(message(tree)).toHaveTextContent('SignIn.Failure.unknown')
  })

  const reasons = [
    ...Object.keys(SIGN_IN_FAILURE_MESSAGES),
    'wrongNumber',
    'noVaultEntry',
    'uvRequired',
    'notEnrolledDevice',
    'grantReplayed',
    'unknown',
  ]
  test.each([
    ['en', en],
    ['fr', fr],
    ['pt-br', ptBr],
  ] as const)('every reason, and every ending, has words in %s', (_, locale) => {
    const signIn = (locale as unknown as { SignIn: Record<string, unknown> & { Failure: Record<string, string> } })
      .SignIn
    for (const reason of reasons) expect(typeof signIn.Failure[reason]).toBe('string')
    for (const key of ['SignedIn', 'Declined', 'TimedOut', 'NoCode']) expect(typeof signIn[key]).toBe('string')
    expect(typeof (locale as unknown as { Screens: Record<string, string> }).Screens.SignIn).toBe('string')
  })

  test("the English for the claim's reasons is the module's own", () => {
    for (const [reason, words] of Object.entries(SIGN_IN_FAILURE_MESSAGES)) {
      expect((en.SignIn.Failure as Record<string, string>)[reason]).toBe(words)
    }
  })
})

describe('the decision window', () => {
  test('when it runs out before Approve, the request is over', async () => {
    jest.useFakeTimers()
    const steps = fakeSteps()
    const tree = await toReview(steps)
    expect(tree.getByTestId(id(SignInIds.approve))).toBeTruthy()
    clock = NOW + 121
    await act(async () => {
      jest.advanceTimersByTime(1000)
    })
    expect(message(tree)).toHaveTextContent('SignIn.TimedOut')
    expect(tree.queryByTestId(id(SignInIds.approve))).toBeNull()
    expect(steps.approve).not.toHaveBeenCalled()
  })

  test('an answer that arrives after it ran out is not shown', async () => {
    jest.useFakeTimers()
    let answer: (p: ProvedSignIn) => void = () => undefined
    const steps = fakeSteps({ identifyAndProve: jest.fn(() => new Promise<ProvedSignIn>((r) => (answer = r))) })
    const tree = await toReview(steps)
    expect(tree.getByTestId(id(SignInIds.checking))).toBeTruthy()
    clock = NOW + 121
    await act(async () => {
      jest.advanceTimersByTime(1000)
    })
    expect(message(tree)).toHaveTextContent('SignIn.TimedOut')
    await act(async () => answer(proved))
    expect(tree.queryByTestId(id(SignInIds.review))).toBeNull()
    expect(message(tree)).toHaveTextContent('SignIn.TimedOut')
  })
})

describe('leaving the screen', () => {
  test('after a claim and before Approve gives the request up', async () => {
    const steps = fakeSteps()
    const tree = await show(steps)
    await press(tree, SignInIds.continue)
    tree.unmount()
    expect(steps.cancel).toHaveBeenCalledWith(claimed)
  })

  test('before any claim sends nothing', async () => {
    const steps = fakeSteps()
    const tree = await show(steps)
    tree.unmount()
    expect(steps.cancel).not.toHaveBeenCalled()
  })
})

describe('the screen in the stack', () => {
  test('takes the code its route carries', async () => {
    clock = NOW
    jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000)
    const steps = fakeSteps()
    const tree = render(
      <BasicAppContext>
        <SignIn steps={steps} route={{ params: { link: LINK } }} />
      </BasicAppContext>
    )
    await act(async () => undefined)
    expect(steps.community).toHaveBeenCalledWith(VTC)
    expect(tree.getByTestId(id(SignInIds.confirm))).toBeTruthy()
    ;(Date.now as jest.Mock).mockRestore()
  })
})
