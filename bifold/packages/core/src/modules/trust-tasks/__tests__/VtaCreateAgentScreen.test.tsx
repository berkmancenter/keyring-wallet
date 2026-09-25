/**
 * Create my agent (own_agent_subtask.md §1, §7), from the person's side: the
 * address first, then the owner code behind Face ID, then connect, then a
 * backup phone. What the person sees at each step, and the words when a step
 * does not happen.
 */
import Clipboard from '@react-native-clipboard/clipboard'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { confirmOwner } from '../module/ownerConfirm'
import { vtaAgent } from '../module/vtaAgent'
import { DeviceActionRefused, DeviceCannotOwn } from '../module/vtaOwner'
import VtaCreateAgent from '../screens/VtaCreateAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/ownerConfirm', () => ({
  confirmOwner: jest.fn(),
  deviceCanOwn: jest.fn(async () => true),
}))

type Setter = { set(next: Record<string, unknown>): void }
const controller = vtaAgent as unknown as Setter
const VTA = 'did:webvh:QmAgent:agents.example:alice'
const id = (key: string) => testIdWithKey(key)

const show = () =>
  render(
    <BasicAppContext>
      <VtaCreateAgent />
    </BasicAppContext>
  )

beforeEach(() => {
  (useAgent as jest.Mock).mockReturnValue({ agent: {} })
  controller.set({ link: { kind: 'notLinked' } })
  jest.restoreAllMocks()
  ;(confirmOwner as jest.Mock).mockReset()
})

describe('create my agent: the address comes first', () => {
  test('something that is not an agent address is refused in words, and nothing is made', async () => {
    const start = jest.spyOn(vtaAgent, 'startCreateAgent').mockResolvedValue(undefined)
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentCreateContinue')))
    fireEvent.changeText(tree.getByTestId(id('AgentCreateAddressInput')), 'alice.example')
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateAddressContinue')))
    })
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('CreateAgent.NotAnAddress')
    expect(start).not.toHaveBeenCalled()
  })

  test("an agent's address makes this phone's owner code, named by the agent's host", async () => {
    const start = jest.spyOn(vtaAgent, 'startCreateAgent').mockResolvedValue(undefined)
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentCreateContinue')))
    fireEvent.changeText(tree.getByTestId(id('AgentCreateAddressInput')), `  ${VTA} `)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateAddressContinue')))
    })
    expect(start).toHaveBeenCalledWith({}, VTA, 'agents.example')
  })

  test('a phone with no screen lock is told how to protect its agent first', async () => {
    jest.spyOn(vtaAgent, 'startCreateAgent').mockRejectedValue(new DeviceCannotOwn())
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentCreateContinue')))
    fireEvent.changeText(tree.getByTestId(id('AgentCreateAddressInput')), VTA)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateAddressContinue')))
    })
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('CreateAgent.NeedsScreenLock')
  })
})

describe('the owner code is handed out only after Face ID', () => {
  const showingKey = () =>
    controller.set({
      link: { kind: 'showingKey', vtaDid: VTA, label: 'agents.example', did: 'did:key:z6MkOwner', checking: false },
    })

  test('cancelling Face ID says nothing and copies nothing', async () => {
    showingKey()
    ;(confirmOwner as jest.Mock).mockResolvedValue({ ok: false, reason: 'cancelled' })
    const copy = jest.spyOn(Clipboard, 'setString')
    const tree = show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateCopyCode')))
    })
    expect(copy).not.toHaveBeenCalled()
    expect(tree.queryByTestId(id('AgentCreateError'))).toBeNull()
  })

  test('a failed Face ID is said in words', async () => {
    showingKey()
    ;(confirmOwner as jest.Mock).mockResolvedValue({ ok: false, reason: 'failed' })
    const tree = show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateCopyCode')))
    })
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('CreateAgent.NotConfirmed')
  })

  test('confirmed, the code is copied; connect signs in only after Face ID too', async () => {
    showingKey()
    ;(confirmOwner as jest.Mock).mockResolvedValue({ ok: true })
    const copy = jest.spyOn(Clipboard, 'setString')
    const check = jest.spyOn(vtaAgent, 'checkManualGrant').mockResolvedValue(undefined)
    const tree = show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateCopyCode')))
    })
    expect(copy).toHaveBeenCalledWith('did:key:z6MkOwner')
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentCreateConnect')))
    })
    expect(confirmOwner).toHaveBeenCalledTimes(2)
    expect(check).toHaveBeenCalled()
  })

  test('an agent that has not admitted the code yet says so beside Connect', () => {
    controller.set({
      link: { kind: 'showingKey', vtaDid: VTA, label: 'a', did: 'did:key:z6MkOwner', checking: false, notYet: true },
    })
    const tree = show()
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('CreateAgent.NotAcceptedYet')
  })
})

describe('a backup phone, once the agent is linked', () => {
  const linked = () =>
    controller.set({
      link: {
        kind: 'linked',
        vtaDid: VTA,
        label: 'agents.example',
        linkedAt: '2026-09-25T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })

  const toBackupCode = async () => {
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentBackupPhone')))
    expect(tree.getByTestId(id('AgentBackupAddressQr'))).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('AgentBackupNext')))
    fireEvent.changeText(tree.getByTestId(id('AgentBackupCodeInput')), 'did:key:z6MkBackup')
    return tree
  }

  test("the other phone's code is added, and Ready names the backup", async () => {
    linked()
    jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
    const add = jest
      .spyOn(vtaAgent, 'addBackupDevice')
      .mockResolvedValue({ did: 'did:key:z6MkBackup', role: 'admin', label: 'Backup phone', thisPhone: false })
    const tree = await toBackupCode()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentBackupAdd')))
    })
    expect(add).toHaveBeenCalledWith({}, 'did:key:z6MkBackup', 'CreateAgent.BackupLabel')
    expect(tree.getByTestId(id('AgentBackupAdded'))).toHaveTextContent(/CreateAgent\.YourBackup/)
  })

  test("this phone's own code is refused in words, and the screen stays", async () => {
    linked()
    jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
    jest.spyOn(vtaAgent, 'addBackupDevice').mockRejectedValue(new DeviceActionRefused('thisPhone'))
    const tree = await toBackupCode()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AgentBackupAdd')))
    })
    expect(tree.getByTestId(id('AgentCreateError'))).toHaveTextContent('CreateAgent.Device.thisPhone')
    expect(tree.getByTestId(id('AgentBackupScanCode'))).toBeTruthy()
  })

  test('Not now goes to Ready, which says a backup can be added later', () => {
    linked()
    const tree = show()
    fireEvent.press(tree.getByTestId(id('AgentBackupLater')))
    expect(tree.getByTestId(id('AgentBackupNone'))).toHaveTextContent('CreateAgent.BackupLater')
  })

  test('every refusal a device action can give has words', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const copy = require('../../../localization/en/en.json')
    for (const reason of [
      'notLinked',
      'notADid',
      'thisPhone',
      'alreadyAdded',
      'notFound',
      'notPermitted',
      'accessRevoked',
      'stepUpRequired',
      'awaitingApproval',
      'noAnswer',
      'unreachable',
      'failed',
    ]) {
      expect(typeof copy.CreateAgent.Device[reason]).toBe('string')
    }
  })
})
