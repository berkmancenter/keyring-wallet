/**
 * The one-time offer on a newly linked phone (new-phone-new-device-plan.md
 * §B): the person's other phones, each with Keep and Remove as equal choices.
 * Nothing is preselected and nothing is removed without a press.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import type { DeviceView } from '../screens/DeviceRow'
import { NewPhoneOffer } from '../screens/NewPhoneOffer'
import { deviceKey } from '../screens/VtaDevices'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const phone = (n: number, extra: Partial<DeviceView> = {}): DeviceView => ({
  did: `did:peer:2.Vz6MkPhone${n}000000000000`,
  name: `Phone ${n}`,
  platform: 'ios',
  status: 'active',
  thisPhone: false,
  phone: true,
  ...extra,
})
const THIS = phone(0, { thisPhone: true, name: 'This one' })
const A = phone(1)
const B = phone(2)

const offer = (props: Partial<React.ComponentProps<typeof NewPhoneOffer>> = {}) =>
  render(
    <BasicAppContext>
      <NewPhoneOffer
        devices={[THIS, A, B]}
        onRemove={jest.fn().mockResolvedValue(undefined)}
        errorOf={() => 'could not'}
        onDone={jest.fn()}
        {...props}
      />
    </BasicAppContext>
  )

describe('the offer on a new phone', () => {
  test('lists only the other active phones, each with Keep and Remove, neither chosen', () => {
    const tree = offer({
      devices: [THIS, A, B, phone(3, { status: 'removedErasePending' }), phone(4, { phone: false })],
    })
    expect(tree.queryByTestId(id(`OfferDevice_${deviceKey(THIS.did)}`))).toBeNull()
    expect(tree.queryByTestId(id(`OfferDevice_${deviceKey(phone(3).did)}`))).toBeNull()
    expect(tree.queryByTestId(id(`OfferDevice_${deviceKey(phone(4).did)}`))).toBeNull()
    for (const d of [A, B]) {
      expect(tree.getByTestId(id(`OfferKeep_${deviceKey(d.did)}`))).toBeTruthy()
      expect(tree.getByTestId(id(`OfferRemove_${deviceKey(d.did)}`))).toBeTruthy()
      expect(tree.queryByTestId(id(`OfferChoice_${deviceKey(d.did)}`))).toBeNull()
    }
  })

  test('Keep and Remove carry equal weight', () => {
    const tree = offer()
    const keep = tree.getByTestId(id(`OfferKeep_${deviceKey(A.did)}`))
    const remove = tree.getByTestId(id(`OfferRemove_${deviceKey(A.did)}`))
    expect(keep.props.accessibilityRole).toBe(remove.props.accessibilityRole)
    expect(JSON.stringify(keep.props.style)).toBe(JSON.stringify(remove.props.style))
  })

  test('Keep sends nothing and says Kept', async () => {
    const onRemove = jest.fn()
    const tree = offer({ onRemove })
    fireEvent.press(tree.getByTestId(id(`OfferKeep_${deviceKey(A.did)}`)))
    expect(onRemove).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(`OfferChoice_${deviceKey(A.did)}`))).toHaveTextContent('Devices.OfferKept')
  })

  test('Remove removes that phone only and says it erases on its next connection', async () => {
    const onRemove = jest.fn().mockResolvedValue(undefined)
    const tree = offer({ onRemove })
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(`OfferRemove_${deviceKey(A.did)}`)))
    })
    expect(onRemove).toHaveBeenCalledWith(A.did)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(tree.getByTestId(id(`OfferChoice_${deviceKey(A.did)}`))).toHaveTextContent('Devices.RemovedErasePending')
    // The other phone is still undecided.
    expect(tree.getByTestId(id(`OfferRemove_${deviceKey(B.did)}`))).toBeTruthy()
  })

  test('a refused removal is said, and the choice stays open', async () => {
    const tree = offer({ onRemove: jest.fn().mockRejectedValue(new Error('no')), errorOf: () => 'Your agent said no' })
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(`OfferRemove_${deviceKey(A.did)}`)))
    })
    expect(tree.getByTestId(id('OfferError'))).toHaveTextContent('Your agent said no')
    expect(tree.getByTestId(id(`OfferRemove_${deviceKey(A.did)}`))).toBeTruthy()
  })

  test('a cancelled confirmation says nothing', async () => {
    const tree = offer({ onRemove: jest.fn().mockRejectedValue(new Error('cancel')), errorOf: () => undefined })
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(`OfferRemove_${deviceKey(A.did)}`)))
    })
    expect(tree.queryByTestId(id('OfferError'))).toBeNull()
  })

  test('Done leaves at any point, with every phone kept that was not removed', () => {
    const onDone = jest.fn()
    const tree = offer({ onDone })
    fireEvent.press(tree.getByTestId(id('OfferDone')))
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
