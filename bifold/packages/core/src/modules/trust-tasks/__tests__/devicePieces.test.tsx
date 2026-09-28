/**
 * The pieces of My devices (new-phone-new-device-plan.md §A, §B, §F): a
 * device's row, the "also open as you" notice, and naming this phone.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { DeviceNamePrompt } from '../screens/DeviceNamePrompt'
import { DeviceRow, type DeviceView } from '../screens/DeviceRow'
import { SiblingNotice } from '../screens/SiblingNotice'
import { deviceKey } from '../screens/VtaDevices'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const NOW = new Date('2026-09-28T12:00:00Z')
const OLD = 'did:peer:2.Vz6MkOldPhone000000000001'
const id = (key: string) => testIdWithKey(key)
const k = deviceKey(OLD)

const oldPhone: DeviceView = {
  did: OLD,
  name: 'iPhone · added 2 Aug',
  platform: 'ios',
  lastSeenAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
  status: 'active',
  thisPhone: false,
  phone: true,
}

const row = (device: DeviceView, handlers: Partial<React.ComponentProps<typeof DeviceRow>> = {}) =>
  render(
    <BasicAppContext>
      <DeviceRow device={device} now={NOW} onRemove={jest.fn()} onRename={jest.fn()} {...handlers} />
    </BasicAppContext>
  )

describe('a device row', () => {
  test('another phone: its name, what it is, when it was seen, and Remove this phone', () => {
    const onRemove = jest.fn()
    const tree = row(oldPhone, { onRemove })
    const card = tree.getByTestId(id(`AgentDevice_${k}`))
    expect(card).toHaveTextContent(/iPhone · added 2 Aug/)
    expect(card).toHaveTextContent(/Devices\.PlatformIos/)
    expect(card).toHaveTextContent(/Devices\.SeenMinutes/)
    expect(tree.getByTestId(id(`AgentDeviceRemove_${k}`))).toHaveTextContent('Devices.RemoveThisPhone')
    fireEvent.press(tree.getByTestId(id(`AgentDeviceRemove_${k}`)))
    expect(onRemove).toHaveBeenCalledTimes(1)
    // Never the DID in the main text; it sits behind Details.
    expect(card).not.toHaveTextContent(new RegExp(OLD))
    fireEvent.press(tree.getByTestId(id(`AgentDeviceDetails_${k}`)))
    expect(tree.getByTestId(id(`AgentDeviceDid_${k}`))).toHaveTextContent(OLD)
  })

  test('something that is not a phone is removed with a plain Remove', () => {
    const tree = row({ ...oldPhone, name: 'Browser plugin', platform: undefined, phone: false })
    expect(tree.getByTestId(id(`AgentDeviceRemove_${k}`))).toHaveTextContent('Devices.Remove')
    expect(tree.getByTestId(id(`AgentDevice_${k}`))).not.toHaveTextContent(/Devices\.Platform/)
  })

  test('a device never seen says nothing about when', () => {
    const tree = row({ ...oldPhone, lastSeenAt: undefined })
    expect(tree.getByTestId(id(`AgentDevice_${k}`))).not.toHaveTextContent(/Devices\.Seen/)
  })

  test('a removed phone says it erases on its next connection, and has no Remove', () => {
    const tree = row({ ...oldPhone, status: 'removedErasePending' })
    expect(tree.getByTestId(id(`AgentDeviceState_${k}`))).toHaveTextContent('Devices.RemovedErasePending')
    expect(tree.queryByTestId(id(`AgentDeviceRemove_${k}`))).toBeNull()
  })

  test('this phone: marked as this phone, can be renamed, never removed', () => {
    const onRename = jest.fn()
    const tree = row({ ...oldPhone, thisPhone: true }, { onRename })
    expect(tree.getByTestId(id(`AgentDevice_${k}`))).toHaveTextContent(/Devices\.ThisPhone/)
    expect(tree.queryByTestId(id(`AgentDeviceRemove_${k}`))).toBeNull()
    fireEvent.press(tree.getByTestId(id('AgentDeviceRename')))
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  test('while a removal is under way no other Remove can be pressed', () => {
    const onRemove = jest.fn()
    const tree = row(oldPhone, { onRemove, disabled: true })
    fireEvent.press(tree.getByTestId(id(`AgentDeviceRemove_${k}`)))
    expect(onRemove).not.toHaveBeenCalled()
  })
})

describe('also open as you', () => {
  const notice = (names: string[], onOpen = jest.fn(), onDismiss = jest.fn()) =>
    render(
      <BasicAppContext>
        <SiblingNotice names={names} onOpen={onOpen} onDismiss={onDismiss} />
      </BasicAppContext>
    )

  test('nothing to say with no other device open', () => {
    expect(notice([]).queryByTestId(id('SiblingNotice'))).toBeNull()
  })

  test('one other device, by name, with a way to My devices and OK', () => {
    const onOpen = jest.fn()
    const onDismiss = jest.fn()
    const tree = notice(['iPhone · added 2 Aug'], onOpen, onDismiss)
    expect(tree.getByTestId(id('SiblingNotice'))).toHaveTextContent(/Devices\.SiblingOne/)
    fireEvent.press(tree.getByTestId(id('SiblingNoticeOpen')))
    fireEvent.press(tree.getByTestId(id('SiblingNoticeDismiss')))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  test('several are counted', () => {
    expect(notice(['A', 'B']).getByTestId(id('SiblingNotice'))).toHaveTextContent(/Devices\.SiblingMany/)
  })
})

describe('naming this phone', () => {
  const prompt = (onSave = jest.fn(), initial = 'iPhone · added 28 Sep') =>
    render(
      <BasicAppContext>
        <DeviceNamePrompt initial={initial} onSave={onSave} />
      </BasicAppContext>
    )

  test('offers the short dated default, and saves it as it stands', () => {
    const onSave = jest.fn()
    const tree = prompt(onSave)
    expect(tree.getByTestId(id('DeviceNameInput')).props.value).toBe('iPhone · added 28 Sep')
    fireEvent.press(tree.getByTestId(id('DeviceNameSave')))
    expect(onSave).toHaveBeenCalledWith('iPhone · added 28 Sep')
  })

  test('saves a new name trimmed', () => {
    const onSave = jest.fn()
    const tree = prompt(onSave)
    fireEvent.changeText(tree.getByTestId(id('DeviceNameInput')), '  Sam’s work phone ')
    fireEvent.press(tree.getByTestId(id('DeviceNameSave')))
    expect(onSave).toHaveBeenCalledWith('Sam’s work phone')
  })

  test('a blank name cannot be saved', () => {
    const onSave = jest.fn()
    const tree = prompt(onSave)
    fireEvent.changeText(tree.getByTestId(id('DeviceNameInput')), '   ')
    fireEvent.press(tree.getByTestId(id('DeviceNameSave')))
    expect(onSave).not.toHaveBeenCalled()
  })
})
