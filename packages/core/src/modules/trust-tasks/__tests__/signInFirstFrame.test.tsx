/**
 * A scanned sign-in code opens on Confirm, in the first frame (UI-smoothness plan, Phase 3). The screen started on a
 * bare spinner while it read the community's records, the identities on every linked agent among them (network), so
 * even a known member waited before Confirm drew. The community and its host come from the code alone, offline;
 * the name on record and the identities fill in after, and Continue waits for them: nothing is claimed before then.
 *
 * Every committed frame is kept in order (a Profiler's onRender runs once per commit, so a render React discards is
 * not a frame). The tree is mounted first and the screen into it, so the first frame is seen too.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React, { Profiler } from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import type { ClaimedSignIn } from '../module/oobSignIn'
import type { SignInIdentity, SignInSteps } from '../module/signInSteps'
import { SignInFlow } from '../screens/SignIn'
import { SignInIds } from '../screens/SignIn.ids'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const VTC = 'did:webvh:QmNvAiYMwoZMWGfY62gqNJuedQgH224FMpHenzJTK1wJrG:webvh.storm.ws:test-vtc'
const NOW = 1_800_000_000
const codeFor = (exp: number) =>
  `https://link.trustoverip.org/t#_from=${VTC}&_id=XOcGXOQTCHb5iz4T2JD2RQ&_exp=${exp}&_type=/vti/flow/sign-in/0.1`
const LINK = codeFor(NOW + 300)
const IDENTITY = {
  vtaDid: 'did:webvh:vta',
  did: 'did:webvh:persona',
  agentName: 'bob',
  source: 'thisPhone',
} as SignInIdentity

type Records = { member: boolean; name?: string; identities?: SignInIdentity[] }

/** Steps whose community read answers only when the test says so. */
const heldSteps = (decisionDeadline = NOW + 120) => {
  let answer: (records: Records) => void = () => undefined
  const steps = {
    community: jest.fn(() => new Promise<Records>((resolve) => (answer = resolve))),
    claim: jest.fn(async () => ({ requestId: 'r', vtcDid: VTC, decisionDeadline }) as unknown as ClaimedSignIn),
    identifyAndProve: jest.fn(),
    approve: jest.fn(),
    cancel: jest.fn(async () => ({ cancelled: true })),
  } as unknown as jest.Mocked<SignInSteps>
  return {
    steps,
    answer: (records: Records) =>
      act(async () => {
        answer(records)
      }),
  }
}

type Frame = {
  confirm: boolean
  host?: string
  community?: string
  title?: string
  continueDisabled?: boolean
  result?: string
  number: boolean
  timeLeft?: string
}

const textOf = (node: { props: { children?: unknown } } | null) =>
  node
    ? [node.props.children]
        .flat()
        .filter((c) => typeof c === 'string')
        .join('')
    : undefined

/** The screen for `link` (`null`: no code), with what every committed frame showed. */
const open = async (steps: SignInSteps, link: string | null = LINK, now: () => number = () => NOW) => {
  const frames: Frame[] = []
  const tree = render(<BasicAppContext>{null}</BasicAppContext>)
  const seen = () => {
    const button = tree.queryByTestId(id(SignInIds.continue))
    frames.push({
      confirm: tree.queryByTestId(id(SignInIds.confirm)) !== null,
      host: textOf(tree.queryByTestId(id(SignInIds.host))),
      community: textOf(tree.queryByTestId(id(SignInIds.community))),
      title: tree.queryByRole('header') ? textOf(tree.queryByRole('header')) : undefined,
      continueDisabled: button ? Boolean(button.props.accessibilityState?.disabled) : undefined,
      result: textOf(tree.queryByTestId(id(SignInIds.resultMessage))),
      number: tree.queryByTestId(id(SignInIds.number)) !== null,
      timeLeft: textOf(tree.queryByTestId(id(SignInIds.timeLeft))),
    })
  }
  tree.rerender(
    <BasicAppContext>
      <Profiler id="sign-in" onRender={seen}>
        <SignInFlow link={link ?? undefined} steps={steps} now={now} onClose={jest.fn()} />
      </Profiler>
    </BasicAppContext>
  )
  await act(async () => undefined)
  return { tree, frames }
}

const press = (tree: ReturnType<typeof render>, key: string) =>
  act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })

beforeEach(() => {
  ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
})

describe('a scanned sign-in code, in the first frame', () => {
  test('is Confirm, with the host the code names, while the records are still being read', async () => {
    const { steps } = heldSteps()
    const { frames } = await open(steps)
    expect(frames[0]).toMatchObject({ confirm: true, host: 'webvh.storm.ws/test-vtc', continueDisabled: true })
    // Never a frame without Confirm while it waits, and nothing sent.
    expect(frames.filter((f) => !f.confirm)).toEqual([])
    expect(steps.community).toHaveBeenCalledWith(VTC)
    expect(steps.claim).not.toHaveBeenCalled()
  })

  test("names no community until its record is read: never a name from the code, then the record's", async () => {
    const { steps, answer } = heldSteps()
    const { tree, frames } = await open(steps)
    expect(frames[0].community).toBeUndefined()
    expect(frames[0].title).toBe('SignIn.ConfirmTitleUnread')
    expect(frames.some((f) => f.title?.includes('test-vtc') || f.community?.includes('test-vtc'))).toBe(false)

    await answer({ member: true, name: 'Test Community', identities: [IDENTITY] })
    expect(tree.getByTestId(id(SignInIds.community))).toHaveTextContent('Test Community')
    expect(frames[frames.length - 1]).toMatchObject({ confirm: true, title: 'SignIn.ConfirmTitle' })
  })

  test('Continue sends nothing until the identities are known, then claims', async () => {
    const { steps, answer } = heldSteps()
    const { tree } = await open(steps)
    await press(tree, SignInIds.continue)
    expect(steps.claim).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(SignInIds.confirm))).toBeTruthy()

    await answer({ member: true, name: 'Test Community', identities: [IDENTITY] })
    expect(tree.getByTestId(id(SignInIds.continue)).props.accessibilityState?.disabled).toBe(false)
    await press(tree, SignInIds.continue)
    expect(steps.claim).toHaveBeenCalledWith(LINK)
  })

  test("moves to 'not a member' when the records say so, and never offers Continue for it", async () => {
    const { steps, answer } = heldSteps()
    const { tree } = await open(steps)
    await answer({ member: false })
    expect(tree.getByTestId(id(SignInIds.notMember))).toBeTruthy()
    expect(tree.queryByTestId(id(SignInIds.continue))).toBeNull()
    expect(steps.claim).not.toHaveBeenCalled()
  })

  test('a code that cannot be used says why in the first frame, and reads no records', async () => {
    const { steps } = heldSteps()
    const { frames } = await open(steps, codeFor(NOW - 3600))
    expect(frames[0].confirm).toBe(false)
    expect(frames[0].result).toBe('SignIn.Failure.expired')
    expect(steps.community).not.toHaveBeenCalled()

    const none = await open(heldSteps().steps, null)
    expect(none.frames[0].result).toBe('SignIn.NoCode')
  })
})

// "Timed out" is decided in render, from the clock (Phase 3). It was set by an effect after the frame had painted,
// so the number step showed once with no time left before it said so; and a claim whose deadline had already passed
// showed the number first.
describe('a deadline that has passed, in the first frame it is known', () => {
  afterEach(() => jest.useRealTimers())

  test('a claim answered after its deadline: timed out, never the number', async () => {
    const { steps, answer } = heldSteps(NOW - 1)
    const { tree, frames } = await open(steps)
    await answer({ member: true, name: 'Test Community', identities: [IDENTITY] })
    const before = frames.length
    await press(tree, SignInIds.continue)
    const after = frames.slice(before)
    expect(after.filter((f) => f.number)).toEqual([])
    expect(after[after.length - 1].result).toBe('SignIn.TimedOut')
  })

  test('a deadline passing while the number waits: the frame in which it passes says timed out', async () => {
    jest.useFakeTimers()
    let clock = NOW
    const { steps, answer } = heldSteps(NOW + 2)
    const { tree, frames } = await open(steps, LINK, () => clock)
    await answer({ member: true, name: 'Test Community', identities: [IDENTITY] })
    await press(tree, SignInIds.continue)
    expect(tree.getByTestId(id(SignInIds.number))).toBeTruthy()
    const before = frames.length
    clock = NOW + 2
    await act(async () => {
      jest.advanceTimersByTime(1000)
    })
    const after = frames.slice(before)
    expect(after.length).toBeGreaterThan(0)
    expect(after[0]).toMatchObject({ number: false, result: 'SignIn.TimedOut' })
    expect(after.filter((f) => f.number)).toEqual([])
    // Recorded, too: leaving now gives nothing up, the request already ended.
    tree.unmount()
    expect(steps.cancel).not.toHaveBeenCalled()
  })
})
