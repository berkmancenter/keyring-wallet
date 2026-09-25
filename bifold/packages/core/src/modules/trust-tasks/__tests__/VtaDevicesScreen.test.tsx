/**
 * Your devices (own_agent_subtask.md §4): this phone and its backups, with
 * Remove on the others — how a backup takes a lost phone off the agent.
 */
import { act, render } from '@testing-library/react-native'
import { fireEvent } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { DeviceActionRefused } from '../module/vtaOwner'
import VtaDevices, { deviceKey } from '../screens/VtaDevices'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native')
  return { ...actual, useFocusEffect: (effect: () => void) => require('react').useEffect(effect, []) }
})

const THIS = 'did:peer:2.Vz6MkThisPhone00000001'
const LOST = 'did:peer:2.Vz6MkLostPhone00000002'
const id = (key: string) => testIdWithKey(key)

const show = async () => {
  const tree = render(
    <BasicAppContext>
      <VtaDevices />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}

beforeEach(() => {
  jest.restoreAllMocks()
  ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
})

describe('your devices', () => {
  test('this phone is named and has no Remove; the other device does', async () => {
    jest.spyOn(vtaAgent, 'listDevices').mockResolvedValue([
      { did: THIS, role: 'admin', thisPhone: true },
      { did: LOST, role: 'admin', label: 'Old phone', thisPhone: false },
    ])
    const tree = await show()
    expect(tree.getByTestId(id(`AgentDevice_${deviceKey(THIS)}`))).toHaveTextContent('Devices.ThisPhone')
    expect(tree.queryByTestId(id(`AgentDeviceRemove_${deviceKey(THIS)}`))).toBeNull()
    expect(tree.getByTestId(id(`AgentDevice_${deviceKey(LOST)}`))).toHaveTextContent(/Old phone/)
  })

  test('Remove takes the other device off, says so, and reads the list again', async () => {
    const list = jest
      .spyOn(vtaAgent, 'listDevices')
      .mockResolvedValueOnce([
        { did: THIS, role: 'admin', thisPhone: true },
        { did: LOST, role: 'admin', label: 'Old phone', thisPhone: false },
      ])
      .mockResolvedValueOnce([{ did: THIS, role: 'admin', thisPhone: true }])
    const remove = jest.spyOn(vtaAgent, 'removeDevice').mockResolvedValue(undefined)
    const tree = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(`AgentDeviceRemove_${deviceKey(LOST)}`)))
    })
    expect(remove).toHaveBeenCalledWith({}, LOST)
    expect(tree.getByTestId(id('AgentDeviceRemoved'))).toHaveTextContent(/Devices\.Removed/)
    expect(list).toHaveBeenCalledTimes(2)
    expect(tree.queryByTestId(id(`AgentDevice_${deviceKey(LOST)}`))).toBeNull()
  })

  test('a refused removal is said in words, and the device stays listed', async () => {
    jest.spyOn(vtaAgent, 'listDevices').mockResolvedValue([
      { did: THIS, role: 'admin', thisPhone: true },
      { did: LOST, role: 'admin', thisPhone: false },
    ])
    jest.spyOn(vtaAgent, 'removeDevice').mockRejectedValue(new DeviceActionRefused('stepUpRequired'))
    const tree = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(`AgentDeviceRemove_${deviceKey(LOST)}`)))
    })
    expect(tree.getByTestId(id('AgentDeviceError'))).toHaveTextContent('CreateAgent.Device.stepUpRequired')
    expect(tree.getByTestId(id(`AgentDevice_${deviceKey(LOST)}`))).toBeTruthy()
  })

  test('cancelling Face ID on Remove says nothing', async () => {
    jest.spyOn(vtaAgent, 'listDevices').mockResolvedValue([
      { did: THIS, role: 'admin', thisPhone: true },
      { did: LOST, role: 'admin', thisPhone: false },
    ])
    jest
      .spyOn(vtaAgent, 'removeDevice')
      .mockRejectedValue(Object.assign(new Error('not confirmed'), { name: 'OwnerNotConfirmed', reason: 'cancelled' }))
    const tree = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(`AgentDeviceRemove_${deviceKey(LOST)}`)))
    })
    expect(tree.queryByTestId(id('AgentDeviceError'))).toBeNull()
  })
})
