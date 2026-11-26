/**
 * Agent connect, the second half of the connect flow as views (plan §6 "Approve", "Done"; canvas frames 5 and 5b):
 * Approve with HCP's checklist on the base path and its face-or-fingerprint check, the wait while the agent enrols,
 * and Done. Views only: the routes and hooks are wired in a later PR.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import ApproveView, { ApproveViewProps } from '../screens/ApproveView'
import ConnectedView, { ConnectingView } from '../screens/ConnectedView'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)

describe('ApproveView', () => {
  const approve = (over: Partial<ApproveViewProps> = {}) => {
    const props: ApproveViewProps = {
      name: 'Notes helper',
      memoryNames: ['Education', 'Healthcare'],
      purposes: ['personalisation', 'taskExecution'],
      until: '14:30',
      confirm: jest.fn(async () => true),
      onApproved: jest.fn(),
      ...over,
    }
    return { props, tree: show(<ApproveView {...props} />) }
  }
  const press = (tree: ReturnType<typeof show>) => fireEvent.press(tree.getByTestId(id('ConnectApproveButton')))

  it("shows the plan's lines in its order, with no room sentence in P0 and nothing that elects persistence", () => {
    const { tree } = approve()
    const keys = [
      'ApproveTitle',
      'ApproveRunBy',
      'ApproveChat',
      'ApproveMemories',
      'ApprovePurposes',
      'PurposePersonalisation',
      'PurposeTaskExecution',
      'ApproveUntil',
      'ApproveNotSignIn',
      'ApproveOwnTerminal',
    ].map((k) => `ConnectedAgents.${k}`)
    const shown = tree
      .getAllByText(/^ConnectedAgents\./)
      .map((node) => node.props.children as string)
      .filter((text) => keys.includes(text))
    expect(shown).toEqual(keys)
    expect(tree.queryByText('ConnectedAgents.KeepConnected')).toBeNull()
    expect(tree.queryByText(/room/i)).toBeNull()
    expect(tree.queryByText('ConnectedAgents.ApproveNoMemory')).toBeNull()
  })

  it('says "It will have no memory." and leaves the purposes out when no memory was picked', () => {
    const { tree } = approve({ memoryNames: [] })
    expect(tree.getByText('ConnectedAgents.ApproveNoMemory')).toBeTruthy()
    expect(tree.queryByText('ConnectedAgents.ApproveMemories')).toBeNull()
    expect(tree.queryByTestId(id('ConnectApprovePurposes'))).toBeNull()
  })

  it('shows the requester as its claim and the network signal only when known; a different network warns', () => {
    const plain = approve().tree
    expect(plain.queryByTestId(id('ConnectApproveRequester'))).toBeNull()
    expect(plain.queryByTestId(id('ConnectApproveSameNetwork'))).toBeNull()
    expect(plain.queryByTestId(id('ConnectApproveOtherNetwork'))).toBeNull()

    const same = approve({ requester: 'Claude Code on a laptop', sameNetwork: true }).tree
    expect(same.getByText('ConnectedAgents.ApproveRequester')).toBeTruthy()
    expect(same.getByTestId(id('ConnectApproveSameNetwork'))).toBeTruthy()
    expect(same.queryByTestId(id('ConnectApproveOtherNetwork'))).toBeNull()

    const other = approve({ sameNetwork: false }).tree
    expect(other.getByTestId(id('ConnectApproveOtherNetwork')).props.accessibilityLabel).toBe(
      'ConnectedAgents.ApproveOtherNetwork'
    )
    expect(other.queryByTestId(id('ConnectApproveSameNetwork'))).toBeNull()
  })

  it('approves only after the face or fingerprint check passes', async () => {
    const { props, tree } = approve()
    press(tree)
    await waitFor(() => expect(props.onApproved).toHaveBeenCalledTimes(1))
    expect(props.confirm).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the check is declined', async () => false],
    ['the check fails with an error', async () => Promise.reject(new Error('no biometrics'))],
    ['the check answers something other than true', async () => 'confirmed' as unknown as boolean],
  ])('never approves when %s', async (_, confirm) => {
    const { props, tree } = approve({ confirm: jest.fn(confirm) })
    press(tree)
    await waitFor(() => expect(props.confirm).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    expect(props.onApproved).not.toHaveBeenCalled()
    // And the person can try the check again.
    expect(tree.getByTestId(id('ConnectApproveButton')).props.accessibilityState.disabled).toBe(false)
  })

  it('asks once while a check is open', async () => {
    let answer: (value: boolean) => void = () => undefined
    const confirm = jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve)))
    const { props, tree } = approve({ confirm })
    press(tree)
    press(tree)
    expect(confirm).toHaveBeenCalledTimes(1)
    await act(async () => answer(true))
    expect(props.onApproved).toHaveBeenCalledTimes(1)
  })
})

describe('ConnectingView', () => {
  it('says it is connecting, busy, with nothing to press', () => {
    const tree = show(<ConnectingView name="Notes helper" />)
    const view = tree.getByTestId(id('ConnectConnecting'))
    expect(view.props.accessibilityLabel).toBe('ConnectedAgents.Connecting')
    expect(view.props.accessibilityState).toEqual({ busy: true })
    expect(tree.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('ConnectedView', () => {
  it('says the agent is connected until when, with the mark, and offers "See details" until the chat exists', () => {
    const onSeeDetails = jest.fn()
    const tree = show(<ConnectedView name="Notes helper" until="14:30" onSeeDetails={onSeeDetails} />)
    expect(tree.getByText('ConnectedAgents.IsConnected')).toBeTruthy()
    expect(tree.getByText('Rooms.AgentBadge')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.ConnectedUntilSentence')).toBeTruthy()
    expect(tree.queryByTestId(id('ConnectOpenChat'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('ConnectSeeDetails')))
    expect(onSeeDetails).toHaveBeenCalledTimes(1)
    // "Keep it connected" is not offered until step 7.28 passes it in.
    expect(tree.queryByTestId(id('ConnectKeepConnected'))).toBeNull()
  })

  it('offers "Open chat" in place of "See details" once there is a chat, and "Keep it connected" when offered', () => {
    const onOpenChat = jest.fn()
    const onKeepConnected = jest.fn()
    const tree = show(
      <ConnectedView
        name="Notes helper"
        until="14:30"
        onOpenChat={onOpenChat}
        onSeeDetails={jest.fn()}
        onKeepConnected={onKeepConnected}
      />
    )
    expect(tree.queryByTestId(id('ConnectSeeDetails'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('ConnectOpenChat')))
    fireEvent.press(tree.getByTestId(id('ConnectKeepConnected')))
    expect(onOpenChat).toHaveBeenCalledTimes(1)
    expect(onKeepConnected).toHaveBeenCalledTimes(1)
  })
})
