/**
 * "State card (demo)": off by default; on only when switched on and turned off neither by its own remote off nor by
 * the SEDI/KERI one, each read at the call.
 */
import { SEDI_KERI_REMOTE_OFF } from '../../../trust-tasks/module/sediKeriRemoteOff'
import { setStateVerifiedApproversEnabled } from '../../../trust-tasks/module/stateVerifiedApproversFlag'
import { setTrustedApproversEnabled } from '../../../trust-tasks/module/trustedApproversFlag'
import { STATE_CARD_REMOTE_OFF, isStateCardEnabled, setStateCardEnabled } from '../stateCardFlag'

afterEach(() => {
  setStateCardEnabled(false)
  STATE_CARD_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
})

describe('the "State card (demo)" switch', () => {
  test('off by default (control: switched on, on)', () => {
    expect(isStateCardEnabled()).toBe(false)
    setStateCardEnabled(true)
    expect(isStateCardEnabled()).toBe(true)
  })

  test.each([
    ['its own remote off', STATE_CARD_REMOTE_OFF],
    ['the SEDI/KERI remote off', SEDI_KERI_REMOTE_OFF],
  ])('%s beats a saved "on", read at the call (control: lifted, on again)', (_, kill) => {
    setStateCardEnabled(true)
    kill.off = true
    expect(isStateCardEnabled()).toBe(false)
    kill.off = false
    expect(isStateCardEnabled()).toBe(true)
  })

  test('needs neither trusted approvers nor state-verified approvers (both off, still on)', () => {
    setStateCardEnabled(true)
    expect(isStateCardEnabled()).toBe(true)
    setTrustedApproversEnabled(true)
    setStateVerifiedApproversEnabled(true)
    expect(isStateCardEnabled()).toBe(true)
  })
})
