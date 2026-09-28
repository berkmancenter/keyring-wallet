/**
 * My devices (own_agent_subtask.md §4; new-phone-new-device-plan.md §B): this
 * phone and the others that run the agent, each with its name, what it is and
 * when it was last seen; "Remove this phone" on the others, Rename on this
 * one. Removing a phone cuts its access and asks it to erase its copy; it
 * leaves the list.
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import type { AgentDevice } from '../module/vtaDevices'
import { DeviceActionRefused } from '../module/vtaOwner'
import VtaDevices, { deviceKey, deviceNameKey } from '../screens/VtaDevices'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const THIS = 'did:peer:2.Vz6MkThisPhone00000001'
const OLD = 'did:peer:2.Vz6MkOldPhone000000002'
const PLUGIN = 'did:key:z6MkPlugin0000000003'
const id = (key: string) => testIdWithKey(key)

const device = (did: string, extra: Partial<AgentDevice> = {}): AgentDevice => ({
  did,
  source: 'registered',
  isThisPhone: false,
  accessRevoked: false,
  wipePending: false,
  ...extra,
})
const thisPhone = device(THIS, {
  isThisPhone: true,
  displayName: 'iPhone · added 28 Sep',
  platform: 'ios',
  kind: 'keyring',
})
const oldPhone = device(OLD, {
  displayName: 'iPhone · added 2 Aug',
  platform: 'ios',
  kind: 'keyring',
  lastSeenAt: new Date(Date.now() - 5 * 60_000).toISOString(),
})
const plugin = device(PLUGIN, { source: 'aclOnly', label: 'browser-plugin onboarding' })

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
  // Run the focus effect once, as a screen coming into view would, and keep it.
  ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
  ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
  jest.spyOn(vtaAgent, 'canRotatePersonaKeys').mockResolvedValue('unknown')
})

describe('your devices', () => {
  test('each device by name, what it is and when it was seen; this phone first, with Rename and no Remove', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([oldPhone, plugin, thisPhone])
    const tree = await show()
    const rows = tree.getAllByTestId(/AgentDevice_/)
    expect(rows[0].props.testID).toBe(id(`AgentDevice_${deviceKey(THIS)}`))
    expect(tree.getByTestId(id(`AgentDevice_${deviceKey(THIS)}`))).toHaveTextContent(/Devices\.ThisPhone/)
    expect(tree.queryByTestId(id(`AgentDeviceRemove_${deviceKey(THIS)}`))).toBeNull()
    expect(tree.getByTestId(id('AgentDeviceRename'))).toBeTruthy()
    const old = tree.getByTestId(id(`AgentDevice_${deviceKey(OLD)}`))
    expect(old).toHaveTextContent(/iPhone · added 2 Aug/)
    expect(old).toHaveTextContent(/Devices\.PlatformIos/)
    expect(old).toHaveTextContent(/Devices\.SeenMinutes/)
    expect(tree.getByTestId(id(`AgentDeviceRemove_${deviceKey(OLD)}`))).toHaveTextContent('Devices.RemoveThisPhone')
    expect(tree.getByTestId(id(`AgentDeviceRemove_${deviceKey(PLUGIN)}`))).toHaveTextContent('Devices.Remove')
    expect(tree.getByTestId(id(`AgentDevice_${deviceKey(PLUGIN)}`))).toHaveTextContent(/Devices\.BrowserPlugin/)
    // Never a DID in the main text.
    expect(old).not.toHaveTextContent(new RegExp(OLD))
  })

  test('every admin gets a plain name: its label, the browser plugin, or the kind of key', () => {
    expect(deviceNameKey({ did: OLD, label: 'Keyring — Ada’s iPhone' })).toEqual({ label: 'Keyring — Ada’s iPhone' })
    expect(deviceNameKey({ did: 'did:key:z6Mk1', label: 'browser-plugin onboarding' }).key).toBe(
      'Devices.BrowserPlugin'
    )
    expect(deviceNameKey({ did: 'did:key:z6Mk1' }).key).toBe('Devices.AComputer')
    expect(deviceNameKey({ did: OLD }).key).toBe('Devices.AKeyringPhone')
  })

  test('Add another device opens the add flow', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([thisPhone])
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    const tree = await show()
    fireEvent.press(tree.getByTestId(id('AgentDeviceAdd')))
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.VtaCreateAgent, { addDevice: true })
  })

  test('only this phone: says a backup keeps the agent safe', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([thisPhone])
    const tree = await show()
    expect(tree.getByTestId(id('AgentDeviceOnlyThis'))).toHaveTextContent('Devices.OnlyThisPhone')
  })

  test('removing a registered phone wipes and revokes it: it says so, and the phone leaves the list', async () => {
    // The agent serves a wiped device over TSP until it is revoked too (lab O8),
    // so removal is both, and revoking deletes the device's binding.
    const list = jest
      .spyOn(vtaAgent, 'agentDevices')
      .mockResolvedValueOnce([thisPhone, oldPhone])
      .mockResolvedValueOnce([thisPhone])
    const remove = jest.spyOn(vtaAgent, 'removeAgentDevice').mockResolvedValue({ mode: 'wiped' })
    const tree = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(`AgentDeviceRemove_${deviceKey(OLD)}`)))
    })
    expect(remove).toHaveBeenCalledWith({}, oldPhone)
    expect(tree.getByTestId(id('AgentDeviceRemoved'))).toHaveTextContent(/Devices\.RemovedWiped/)
    expect(list).toHaveBeenCalledTimes(2)
    expect(tree.queryByTestId(id(`AgentDevice_${deviceKey(OLD)}`))).toBeNull()
  })

  test('removing something never registered revokes it, and it goes', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValueOnce([thisPhone, plugin]).mockResolvedValueOnce([thisPhone])
    jest.spyOn(vtaAgent, 'removeAgentDevice').mockResolvedValue({ mode: 'revoked' })
    const tree = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(`AgentDeviceRemove_${deviceKey(PLUGIN)}`)))
    })
    expect(tree.getByTestId(id('AgentDeviceRemoved'))).toHaveTextContent(/^Devices\.Removed$/)
    expect(tree.queryByTestId(id(`AgentDevice_${deviceKey(PLUGIN)}`))).toBeNull()
  })

  test('a refused removal is said in words, and the device stays listed', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([thisPhone, oldPhone])
    jest.spyOn(vtaAgent, 'removeAgentDevice').mockRejectedValue(new DeviceActionRefused('stepUpRequired'))
    const tree = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(`AgentDeviceRemove_${deviceKey(OLD)}`)))
    })
    expect(tree.getByTestId(id('AgentDeviceError'))).toHaveTextContent('CreateAgent.Device.stepUpRequired')
    expect(tree.getByTestId(id(`AgentDeviceRemove_${deviceKey(OLD)}`))).toBeTruthy()
  })

  test('cancelling Face ID on Remove says nothing', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([thisPhone, oldPhone])
    jest
      .spyOn(vtaAgent, 'removeAgentDevice')
      .mockRejectedValue(Object.assign(new Error('not confirmed'), { name: 'OwnerNotConfirmed', reason: 'cancelled' }))
    const tree = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(`AgentDeviceRemove_${deviceKey(OLD)}`)))
    })
    expect(tree.queryByTestId(id('AgentDeviceError'))).toBeNull()
  })

  test('Rename opens the name prompt with the current name, saves it, and reads the list again', async () => {
    const list = jest
      .spyOn(vtaAgent, 'agentDevices')
      .mockResolvedValueOnce([thisPhone])
      .mockResolvedValueOnce([{ ...thisPhone, displayName: 'Sam’s phone' }])
    const rename = jest.spyOn(vtaAgent, 'renameThisDevice').mockResolvedValue(undefined)
    const tree = await show()
    fireEvent.press(tree.getByTestId(id('AgentDeviceRename')))
    expect(tree.getByTestId(id('DeviceNameInput')).props.value).toBe('iPhone · added 28 Sep')
    fireEvent.changeText(tree.getByTestId(id('DeviceNameInput')), 'Sam’s phone')
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('DeviceNameSave')))
    })
    expect(rename).toHaveBeenCalledWith({}, 'Sam’s phone')
    expect(list).toHaveBeenCalledTimes(2)
    expect(tree.queryByTestId(id('DeviceNameInput'))).toBeNull()
    expect(tree.getByTestId(id(`AgentDevice_${deviceKey(THIS)}`))).toHaveTextContent(/Sam’s phone/)
  })

  test('a list the agent refuses is said in words', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockRejectedValue(new DeviceActionRefused('noAnswer'))
    const tree = await show()
    expect(tree.getByTestId(id('AgentDeviceError'))).toHaveTextContent('CreateAgent.Device.noAnswer')
  })

  test('a lost phone: remove it, then change the keys, offered when the agent can do it safely', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([thisPhone, oldPhone])
    jest.spyOn(vtaAgent, 'canRotatePersonaKeys').mockResolvedValue('yes')
    const rotate = jest
      .spyOn(vtaAgent, 'rotateAllPersonaKeys')
      .mockResolvedValue({ rotated: ['did:webvh:a'], failed: [] })
    const tree = await show()
    expect(tree.getByTestId(id('LostPhone'))).toHaveTextContent(/AgentKeys\.LostStep2/)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('LostPhoneRotate')))
    })
    expect(rotate).toHaveBeenCalledWith({})
    expect(tree.getByTestId(id('LostPhoneState'))).toHaveTextContent('AgentKeys.Rotated')
  })

  test('identities whose keys could not be changed are said, and the button stays to try again', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([thisPhone, oldPhone])
    jest.spyOn(vtaAgent, 'canRotatePersonaKeys').mockResolvedValue('yes')
    jest
      .spyOn(vtaAgent, 'rotateAllPersonaKeys')
      .mockResolvedValue({ rotated: ['did:webvh:a'], failed: [{ did: 'did:webvh:b', reason: 'noAnswer' }] })
    const tree = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('LostPhoneRotate')))
    })
    expect(tree.getByTestId(id('LostPhoneState'))).toHaveTextContent('AgentKeys.RotatePartial')
    expect(tree.getByTestId(id('LostPhoneRotate'))).toBeTruthy()
  })

  test('an agent too old for a safe change: words, no button', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([thisPhone, oldPhone])
    jest.spyOn(vtaAgent, 'canRotatePersonaKeys').mockResolvedValue('agentTooOld')
    const tree = await show()
    expect(tree.queryByTestId(id('LostPhoneRotate'))).toBeNull()
    expect(tree.getByTestId(id('LostPhoneState'))).toHaveTextContent('AgentKeys.RotateTooOld')
  })

  test('the lost-phone card stays once the lost one is gone from the list', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([thisPhone])
    jest.spyOn(vtaAgent, 'canRotatePersonaKeys').mockResolvedValue('yes')
    const tree = await show()
    expect(tree.getByTestId(id('LostPhoneRotate'))).toBeTruthy()
  })
})
