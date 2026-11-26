/**
 * The practice request as one shared card (B7, Alberto 11-12: move it to Developer). Who approves keeps showing it
 * (approverScreens.test.tsx holds its probe and result rows); here, what any host screen gets: nothing with the
 * trusted-approvers switch or its remote off, the probe only on a tap, and the host's busy honoured both ways.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from '../module/trustedApproversFlag'
import * as enforcement from '../screens/approverEnforcementCheck'
import { EnforcementCheckCard, EnforcementCheckIds } from '../screens/approver/EnforcementCheckCard'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const AGENT = {} as never

const show = async (element: React.ReactElement = <EnforcementCheckCard />) => {
  const tree = render(<BasicAppContext>{element}</BasicAppContext>)
  await act(async () => undefined)
  return tree
}

let probe: jest.SpyInstance

beforeEach(() => {
  jest.restoreAllMocks()
  ;(useAgent as jest.Mock).mockReturnValue({ agent: AGENT })
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setTrustedApproversEnabled(true)
  enforcement.forgetEnforcementChecks()
  probe = jest.spyOn(enforcement, 'checkEnforcement').mockResolvedValue({ kind: 'held' } as never)
})
afterAll(() => setTrustedApproversEnabled(false))

describe('the shared practice-request card', () => {
  test('its IDs are the strings Who approves always rendered (e2e and the wallet find it by them)', () => {
    expect(EnforcementCheckIds).toEqual({
      check: 'TrustedApproversCheck',
      checkResult: 'TrustedApproversCheckResult',
      checkPrompt: 'TrustedApproversCheckPrompt',
    })
  })

  test.each([
    ['the trusted-approvers switch off', () => setTrustedApproversEnabled(false)],
    ['the trusted-approvers remote off', () => (TRUSTED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI remote off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s: renders nothing, wherever it is placed (control: on, it shows)', async (_, off) => {
    const on = await show()
    expect(on.queryByTestId(id(EnforcementCheckIds.check))).not.toBeNull()
    on.unmount()
    off()
    const tree = await show()
    expect(tree.queryByTestId(id(EnforcementCheckIds.check))).toBeNull()
  })

  test('the probe runs only on a tap, and its result shows (control: open alone sends nothing)', async () => {
    const tree = await show()
    expect(probe).not.toHaveBeenCalled()
    expect(tree.queryByTestId(id(EnforcementCheckIds.checkResult))).toBeNull()
    await act(async () => fireEvent.press(tree.getByTestId(id(`${EnforcementCheckIds.check}Button`))))
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith(AGENT)
    expect(tree.getByTestId(id(EnforcementCheckIds.checkResult))).toBeTruthy()
  })

  test('the host is told when it starts and ends, so its own buttons can wait', async () => {
    const onBusy = jest.fn()
    const tree = await show(<EnforcementCheckCard onBusy={onBusy} />)
    await act(async () => fireEvent.press(tree.getByTestId(id(`${EnforcementCheckIds.check}Button`))))
    expect(onBusy.mock.calls).toEqual([[true], [false]])
  })

  test('while the host writes, the button waits (control: not busy, it runs)', async () => {
    const busy = await show(<EnforcementCheckCard hostBusy />)
    await act(async () => fireEvent.press(busy.getByTestId(id(`${EnforcementCheckIds.check}Button`))))
    expect(probe).not.toHaveBeenCalled()
  })
})
