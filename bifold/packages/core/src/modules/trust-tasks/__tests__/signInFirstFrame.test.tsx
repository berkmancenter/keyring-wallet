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
const heldSteps = () => {
  let answer: (records: Records) => void = () => undefined
  const steps = {
    community: jest.fn(() => new Promise<Records>((resolve) => (answer = resolve))),
    claim: jest.fn(
      async () => ({ requestId: 'r', vtcDid: VTC, decisionDeadline: NOW + 120 }) as unknown as ClaimedSignIn
    ),
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
}

const textOf = (node: { props: { children?: unknown } } | null) =>
  node
    ? [node.props.children]
        .flat()
        .filter((c) => typeof c === 'string')
        .join('')
    : undefined

/** The screen for `link` (`null`: no code), with what every committed frame showed. */
const open = async (steps: SignInSteps, link: string | null = LINK) => {
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
    })
  }
  tree.rerender(
    <BasicAppContext>
      <Profiler id="sign-in" onRender={seen}>
        <SignInFlow link={link ?? undefined} steps={steps} now={() => NOW} onClose={jest.fn()} />
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
