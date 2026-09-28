/**
 * Keys stay in the agent (new-phone-new-device-plan.md §C, §D, §E): a lost
 * phone's two steps, a signing step while the agent is away, and the one-time
 * notice on a phone that used to keep its own copies.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { AgentUnreachableNotice } from '../screens/AgentUnreachableNotice'
import { KeysMovedNotice } from '../screens/KeysMovedNotice'
import { LostPhoneCard } from '../screens/LostPhoneCard'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const inApp = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)

describe('a lost phone', () => {
  const card = (props: Partial<React.ComponentProps<typeof LostPhoneCard>> = {}) =>
    inApp(
      <LostPhoneCard
        rotation="yes"
        onRotate={jest.fn().mockResolvedValue(undefined)}
        errorOf={() => 'could not'}
        {...props}
      />
    )

  test('says remove first, then change the keys', () => {
    const tree = card()
    const text = tree.getByTestId(id('LostPhone'))
    expect(text).toHaveTextContent(/AgentKeys\.LostStep1/)
    expect(text).toHaveTextContent(/AgentKeys\.LostStep2/)
    expect(tree.getByTestId(id('LostPhoneRotate'))).toBeTruthy()
  })

  test('changing the keys, then saying it is done', async () => {
    const onRotate = jest.fn().mockResolvedValue(undefined)
    const tree = card({ onRotate })
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('LostPhoneRotate')))
    })
    expect(onRotate).toHaveBeenCalledTimes(1)
    expect(tree.getByTestId(id('LostPhoneState'))).toHaveTextContent('AgentKeys.Rotated')
    expect(tree.queryByTestId(id('LostPhoneRotate'))).toBeNull()
  })

  test('a refusal is said and the button stays', async () => {
    const tree = card({ onRotate: jest.fn().mockRejectedValue(new Error('no')), errorOf: () => 'Agent said no' })
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('LostPhoneRotate')))
    })
    expect(tree.getByTestId(id('LostPhoneState'))).toHaveTextContent('Agent said no')
    expect(tree.getByTestId(id('LostPhoneRotate'))).toBeTruthy()
  })

  test('an agent too old for a safe change gets no button, and says why', () => {
    const tree = card({ rotation: 'agentTooOld' })
    expect(tree.queryByTestId(id('LostPhoneRotate'))).toBeNull()
    expect(tree.getByTestId(id('LostPhoneState'))).toHaveTextContent('AgentKeys.RotateTooOld')
  })

  test('an agent Keyring cannot read is treated like one too old, in softer words', () => {
    const tree = card({ rotation: 'unknown' })
    expect(tree.queryByTestId(id('LostPhoneRotate'))).toBeNull()
    expect(tree.getByTestId(id('LostPhoneState'))).toHaveTextContent('AgentKeys.RotateUnknown')
  })

  test('while the check is under way there is no button yet', () => {
    const tree = card({ rotation: undefined })
    expect(tree.queryByTestId(id('LostPhoneRotate'))).toBeNull()
  })
})

describe('a signing step while the agent is away', () => {
  test('says nothing while the agent is reachable', () => {
    const tree = inApp(<AgentUnreachableNotice state="ready" onRetry={jest.fn()} />)
    expect(tree.queryByTestId(id('AgentUnreachable'))).toBeNull()
  })

  test('says why the step waits, and offers to try again', () => {
    const onRetry = jest.fn()
    const tree = inApp(<AgentUnreachableNotice state="agentUnreachable" onRetry={onRetry} />)
    expect(tree.getByTestId(id('AgentUnreachable'))).toHaveTextContent(/AgentKeys\.Unreachable/)
    fireEvent.press(tree.getByTestId(id('AgentUnreachableRetry')))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('the one-time notice on an upgraded phone', () => {
  const notice = (props: Partial<React.ComponentProps<typeof KeysMovedNotice>> = {}) =>
    inApp(<KeysMovedNotice migration="done" seen={false} onOk={jest.fn()} onDevices={jest.fn()} {...props} />)

  test('nothing to say on a phone that never kept copies, or once it has been read', () => {
    expect(notice({ migration: 'notNeeded' }).queryByTestId(id('KeysMoved'))).toBeNull()
    expect(notice({ seen: true }).queryByTestId(id('KeysMoved'))).toBeNull()
  })

  test('while the move is under way it says so, without buttons', () => {
    const tree = notice({ migration: 'inProgress' })
    expect(tree.getByTestId(id('KeysMoved'))).toHaveTextContent(/AgentKeys\.Moving/)
    expect(tree.queryByTestId(id('KeysMovedOk'))).toBeNull()
  })

  test('once moved: what changed, what cannot be recalled, and the way to My devices', () => {
    const onOk = jest.fn()
    const onDevices = jest.fn()
    const tree = notice({ onOk, onDevices })
    expect(tree.getByTestId(id('KeysMoved'))).toHaveTextContent(/AgentKeys\.MovedBody/)
    fireEvent.press(tree.getByTestId(id('KeysMovedDevices')))
    fireEvent.press(tree.getByTestId(id('KeysMovedOk')))
    expect(onDevices).toHaveBeenCalledTimes(1)
    expect(onOk).toHaveBeenCalledTimes(1)
  })
})
