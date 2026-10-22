/**
 * "Add to this relationship" on a contact: sign the relationship cards again
 * (secure hardware now) or add a witness, on the existing connection. Every
 * request asks first and says what is shared; a pending one says so and can
 * be withdrawn; nothing is sent twice for one tap.
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

  test('both ways are offered, under the section title', async () => {
    const tree = await show()
    expect(tree.getByTestId(id('RelationshipUpgrade'))).toHaveTextContent(/Relationship\.UpgradeTitle/)
    expect(tree.getByTestId(id('RelationshipUpgradeResign'))).toHaveTextContent(/Relationship\.Resign/)
    expect(tree.getByTestId(id('RelationshipUpgradeWitness'))).toHaveTextContent(/Relationship\.Witness/)
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

  test('with no witness connected, adding one says how, and cannot be pressed', async () => {
    mockWitness = undefined
    const tree = await show()
    const row = tree.getByTestId(id('RelationshipUpgradeWitness'))
    expect(row).toHaveTextContent(/Relationship\.NoWitness/)
    await act(async () => fireEvent.press(row))
    expect(tree.queryByTestId(id('RelationshipUpgradeConfirm'))).toBeNull()
  })

  test('a pending request says so and can be withdrawn, which offers both ways again', async () => {
    mockPending.mockResolvedValueOnce({ exchangeId: 'x9', witnessed: false })
    const tree = await show()
    expect(tree.getByTestId(id('RelationshipUpgradeWaiting'))).toHaveTextContent('Relationship.WaitingForAnswer')
    expect(tree.queryByTestId(id('RelationshipUpgradeResign'))).toBeNull()
    await act(async () => fireEvent.press(tree.getByTestId(id('RelationshipUpgradeCancel'))))
    expect(mockCancel).toHaveBeenCalledWith(agent, 'conn-1', 'x9')
    expect(tree.getByTestId(id('RelationshipUpgradeResign'))).toBeTruthy()
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

  test('once signed with secure hardware, that is said instead of offering it', async () => {
    const tree = await show({ hardwareSigned: true })
    expect(tree.getByTestId(id('RelationshipUpgradeHardwareDone'))).toHaveTextContent('Relationship.HardwareDone')
    expect(tree.queryByTestId(id('RelationshipUpgradeResign'))).toBeNull()
    expect(tree.getByTestId(id('RelationshipUpgradeWitness'))).toBeTruthy()
  })
})
