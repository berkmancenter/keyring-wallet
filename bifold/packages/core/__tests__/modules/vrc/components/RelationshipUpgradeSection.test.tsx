/**
 * A contact's quick actions: Message, Sign again (secure hardware now) and Add a witness, on the existing
 * connection. Every request asks first and says what is shared; a pending one says so and can be withdrawn; nothing
 * is sent twice for one tap. An action that can't be used now is shown disabled, with the reason under the row.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import RelationshipUpgradeSection from '../../../../src/modules/vrc/components/RelationshipUpgradeSection'
import { testIdWithKey } from '../../../../src/utils/testable'
import { BasicAppContext } from '../../../helpers/app'

const mockUpgrade = jest.fn()
const mockPending = jest.fn()
const mockCancel = jest.fn()
jest.mock('../../../../src/modules/trust-tasks/ceremony', () => ({
  upgradeRelationship: (...a: unknown[]) => mockUpgrade(...a),
  pendingUpgradeOf: (...a: unknown[]) => mockPending(...a),
  cancelRelationshipUpgrade: (...a: unknown[]) => mockCancel(...a),
}))
let mockWitness: string | undefined
jest.mock('../../../../src/modules/vrc/vrc-manager', () => ({
  ...jest.requireActual('../../../../src/modules/vrc/vrc-manager'),
  getConnectedWitnessConnectionId: () => mockWitness,
}))
jest.mock('@bifold/react-hooks')

const id = (k: string) => testIdWithKey(k)
const agent = { config: { logger: { info: jest.fn(), warn: jest.fn() } } }

const show = async (props: Partial<React.ComponentProps<typeof RelationshipUpgradeSection>> = {}) => {
  const tree = render(
    <BasicAppContext>
      <RelationshipUpgradeSection connectionId="conn-1" name="Oli" hardwareSigned={false} {...props} />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}

describe('adding to a relationship', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(useAgent as jest.Mock).mockReturnValue({ agent })
    mockPending.mockResolvedValue(undefined)
    mockUpgrade.mockResolvedValue({ kind: 'sent', exchangeId: 'x2' })
    mockWitness = 'witness-conn'
  })

  const disabled = (tree: Awaited<ReturnType<typeof show>>, key: string) =>
    tree.getByTestId(id(key)).props.accessibilityState?.disabled

  test('three actions: Message, Sign again and Add a witness', async () => {
    const onMessage = jest.fn()
    const tree = await show({ onMessage })
    expect(tree.getByTestId(id('ContactViewMessages'))).toHaveTextContent(/ContactDetails\.QuickMessage/)
    expect(tree.getByTestId(id('RelationshipUpgradeResign'))).toHaveTextContent(/Relationship\.Resign/)
    expect(tree.getByTestId(id('RelationshipUpgradeWitness'))).toHaveTextContent(/Relationship\.Witness/)
    await act(async () => fireEvent.press(tree.getByTestId(id('ContactViewMessages'))))
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  test('no chat to open: Message is shown, disabled', async () => {
    const tree = await show()
    expect(disabled(tree, 'ContactViewMessages')).toBe(true)
  })

  test('no connection yet: nothing can be asked, and that is said', async () => {
    const tree = await show({ connectionId: null })
    expect(disabled(tree, 'RelationshipUpgradeResign')).toBe(true)
    expect(disabled(tree, 'RelationshipUpgradeWitness')).toBe(true)
    expect(tree.getByText('Relationship.NoRelationship')).toBeTruthy()
    expect(mockPending).not.toHaveBeenCalled()
  })

  test('signing again asks first, says what is shared, then sends once', async () => {
    const tree = await show()
    await act(async () => fireEvent.press(tree.getByTestId(id('RelationshipUpgradeResign'))))
    expect(mockUpgrade).not.toHaveBeenCalled()
    expect(tree.getByTestId(id('RelationshipUpgradeConfirm'))).toHaveTextContent(/Relationship\.ConfirmResignBody/)
    mockPending.mockResolvedValue({ exchangeId: 'x2', witnessed: false })
    await act(async () => fireEvent.press(tree.getByTestId(id('RelationshipUpgradeSend'))))
    expect(mockUpgrade).toHaveBeenCalledTimes(1)
    expect(mockUpgrade).toHaveBeenCalledWith(agent, 'conn-1', { witnessed: false })
    expect(tree.queryByTestId(id('RelationshipUpgradeConfirm'))).toBeNull()
    expect(tree.getByTestId(id('RelationshipUpgradeWaiting'))).toHaveTextContent('Relationship.WaitingForAnswer')
  })

  test('adding a witness asks first with what the witness sees, and sends witnessed', async () => {
    const tree = await show()
    await act(async () => fireEvent.press(tree.getByTestId(id('RelationshipUpgradeWitness'))))
    expect(tree.getByTestId(id('RelationshipUpgradeConfirm'))).toHaveTextContent(/Relationship\.ConfirmWitnessBody/)
    await act(async () => fireEvent.press(tree.getByTestId(id('RelationshipUpgradeSend'))))
    expect(mockUpgrade).toHaveBeenCalledWith(agent, 'conn-1', { witnessed: true })
  })

  test('not now sends nothing', async () => {
    const tree = await show()
    await act(async () => fireEvent.press(tree.getByTestId(id('RelationshipUpgradeResign'))))
    await act(async () => fireEvent.press(tree.getByTestId(id('RelationshipUpgradeDismiss'))))
    expect(mockUpgrade).not.toHaveBeenCalled()
    expect(tree.queryByTestId(id('RelationshipUpgradeConfirm'))).toBeNull()
  })

  test('with no witness connected, adding one is disabled, and the reason says how', async () => {
    mockWitness = undefined
    const tree = await show()
    expect(disabled(tree, 'RelationshipUpgradeWitness')).toBe(true)
    expect(tree.getByTestId(id('RelationshipUpgradeNoWitness'))).toHaveTextContent('Relationship.WitnessUnavailable')
    await act(async () => fireEvent.press(tree.getByTestId(id('RelationshipUpgradeWitness'))))
    expect(tree.queryByTestId(id('RelationshipUpgradeConfirm'))).toBeNull()
  })

  test('a pending request says so and can be withdrawn, which makes both ways usable again', async () => {
    mockPending.mockResolvedValueOnce({ exchangeId: 'x9', witnessed: false })
    const tree = await show()
    expect(tree.getByTestId(id('RelationshipUpgradeWaiting'))).toHaveTextContent('Relationship.WaitingForAnswer')
    expect(disabled(tree, 'RelationshipUpgradeResign')).toBe(true)
    expect(disabled(tree, 'RelationshipUpgradeWitness')).toBe(true)
    await act(async () => fireEvent.press(tree.getByTestId(id('RelationshipUpgradeCancel'))))
    expect(mockCancel).toHaveBeenCalledWith(agent, 'conn-1', 'x9')
    expect(disabled(tree, 'RelationshipUpgradeResign')).toBe(false)
    expect(disabled(tree, 'RelationshipUpgradeWitness')).toBe(false)
  })

  test.each([
    ['peerUnsupported', 'Relationship.PeerUnsupported'],
    ['noRelationship', 'Relationship.NoRelationship'],
    ['noWitness', 'Relationship.NoWitness'],
  ])('a request not sent (%s) is said, not waited on', async (kind, words) => {
    mockUpgrade.mockResolvedValue({ kind })
    const tree = await show()
    await act(async () => fireEvent.press(tree.getByTestId(id('RelationshipUpgradeResign'))))
    await act(async () => fireEvent.press(tree.getByTestId(id('RelationshipUpgradeSend'))))
    expect(tree.getByTestId(id('RelationshipUpgradeNote'))).toHaveTextContent(words)
    expect(tree.queryByTestId(id('RelationshipUpgradeWaiting'))).toBeNull()
  })

  test('once signed with secure hardware, signing again is disabled and says why; a witness can still be added', async () => {
    const tree = await show({ hardwareSigned: true })
    expect(tree.getByTestId(id('RelationshipUpgradeHardwareDone'))).toHaveTextContent('Relationship.ResignUnavailable')
    expect(disabled(tree, 'RelationshipUpgradeResign')).toBe(true)
    expect(disabled(tree, 'RelationshipUpgradeWitness')).toBe(false)
  })
})
