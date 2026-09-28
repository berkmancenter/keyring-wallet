/**
 * The one-time offer after a new phone links (new-phone-new-device-plan.md
 * §B), as a screen: the agent's other phones with Keep and Remove, then on to
 * the agent. With no other phone there is nothing to offer, and it moves on.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import type { AgentDevice } from '../module/vtaDevices'
import { DeviceActionRefused } from '../module/vtaOwner'
import VtaNewPhoneOffer from '../screens/VtaNewPhoneOffer'
import { deviceKey } from '../screens/VtaDevices'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const device = (did: string, extra: Partial<AgentDevice> = {}): AgentDevice => ({
  did,
  source: 'registered',
  isThisPhone: false,
  accessRevoked: false,
  wipePending: false,
  kind: 'keyring',
  platform: 'ios',
  ...extra,
})
const THIS = device('did:peer:2.Vz6MkThis0000000001', { isThisPhone: true, displayName: 'iPhone · added 28 Sep' })
const OLD = device('did:peer:2.Vz6MkOld00000000002', { displayName: 'iPhone · added 2 Aug' })

const show = async () => {
  const tree = render(
    <BasicAppContext>
      <VtaNewPhoneOffer />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}

let navigation: { reset: jest.Mock }

beforeEach(() => {
  jest.restoreAllMocks()
  ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
  navigation = useNavigation() as unknown as { reset: jest.Mock }
  navigation.reset = jest.fn()
})

const wentToAgent = () =>
  expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: Screens.VtaAgent }] })

describe('the offer after a new phone links', () => {
  test('shows the other phones, each with Keep and Remove', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([THIS, OLD])
    const tree = await show()
    expect(tree.getByTestId(id(`OfferKeep_${deviceKey(OLD.did)}`))).toBeTruthy()
    expect(tree.getByTestId(id(`OfferRemove_${deviceKey(OLD.did)}`))).toBeTruthy()
    expect(navigation.reset).not.toHaveBeenCalled()
  })

  test('Remove removes that phone through the agent', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([THIS, OLD])
    const remove = jest.spyOn(vtaAgent, 'removeAgentDevice').mockResolvedValue({ mode: 'wiped' })
    const tree = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(`OfferRemove_${deviceKey(OLD.did)}`)))
    })
    expect(remove).toHaveBeenCalledWith({}, OLD)
    expect(tree.getByTestId(id(`OfferChoice_${deviceKey(OLD.did)}`))).toHaveTextContent('Devices.RemovedErasePending')
  })

  test('a refusal is said in words', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([THIS, OLD])
    jest.spyOn(vtaAgent, 'removeAgentDevice').mockRejectedValue(new DeviceActionRefused('stepUpRequired'))
    const tree = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(`OfferRemove_${deviceKey(OLD.did)}`)))
    })
    expect(tree.getByTestId(id('OfferError'))).toHaveTextContent('CreateAgent.Device.stepUpRequired')
  })

  test('Done goes on to the agent', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockResolvedValue([THIS, OLD])
    const tree = await show()
    fireEvent.press(tree.getByTestId(id('OfferDone')))
    wentToAgent()
  })

  test('with no other phone there is nothing to offer: straight on to the agent', async () => {
    jest
      .spyOn(vtaAgent, 'agentDevices')
      .mockResolvedValue([THIS, device('did:key:z6MkPlugin', { kind: undefined, source: 'aclOnly' })])
    await show()
    wentToAgent()
  })

  test('if the list cannot be read, it does not hold the person up: on to the agent', async () => {
    jest.spyOn(vtaAgent, 'agentDevices').mockRejectedValue(new DeviceActionRefused('noAnswer'))
    await show()
    wentToAgent()
  })
})
