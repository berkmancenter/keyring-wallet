/**
 * The app-wide banner says the phone's date and time look wrong when the agent
 * refused this phone's clock (vtaPhoneClock.test.ts has the reading), at once
 * and before "not answering" or "away", which would send the person to the
 * network. The words are the same in every language: no direction, no amount.
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { VtaOfflineBanner } from '../screens/VtaStatus'

let mockState: Record<string, unknown> = {}
jest.mock('../module/vtaAgent', () => ({
  vtaAgent: { subscribe: () => () => undefined, getState: () => mockState },
}))

const online = { kind: 'linked', vtaDid: 'did:webvh:bob', label: 'bob', connection: { kind: 'online' } }
const show = (state: Record<string, unknown>) => {
  mockState = state
  return render(
    <BasicAppContext>
      <VtaOfflineBanner />
    </BasicAppContext>
  )
}

describe('the banner for a phone clock the agent refused', () => {
  it('shows the clock words while the agent is online', () => {
    const { getByTestId, getByText } = show({ link: online, phoneClockRefused: { code: 'expired', at: 1 } })
    expect(getByTestId(testIdWithKey('VtaOfflineBanner'))).toBeTruthy()
    expect(getByText('VtaLink.BannerPhoneClock')).toBeTruthy()
  })

  it('comes before "not answering"', () => {
    const { getByText, queryByText } = show({
      link: online,
      repliesStalled: true,
      phoneClockRefused: { code: 'malformedRequest', at: 1 },
    })
    expect(getByText('VtaLink.BannerPhoneClock')).toBeTruthy()
    expect(queryByText('VtaLink.BannerNotAnswering')).toBeNull()
  })

  it('control: nothing refused and online, no banner', () => {
    const { queryByTestId } = show({ link: online })
    expect(queryByTestId(testIdWithKey('VtaOfflineBanner'))).toBeNull()
  })

  it('control: replies stalled without it says "not answering", as before', () => {
    const { getByText } = show({ link: online, repliesStalled: true })
    expect(getByText('VtaLink.BannerNotAnswering')).toBeTruthy()
  })

  it.each([
    ['en', en],
    ['fr', fr],
    ['pt-br', ptBr],
  ])('%s: the banner and the device refusal say the same, and name no direction', (_, words) => {
    const banner = (words as { VtaLink: Record<string, string> }).VtaLink.BannerPhoneClock
    const device = (words as { CreateAgent: { Device: Record<string, string> } }).CreateAgent.Device.phoneClock
    expect(banner).toBeTruthy()
    expect(device).toBe(banner)
    expect(banner).not.toMatch(/\d/)
  })
})
