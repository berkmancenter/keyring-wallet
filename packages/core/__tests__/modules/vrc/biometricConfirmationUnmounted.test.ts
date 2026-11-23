/**
 * IN-452: with no BiometricConfirmationProvider mounted, nothing can ask the person: the answer is 'not_available',
 * which the confirm step reads as a stop and says so (vrc-biometric.test.ts), never as a pass.
 */
import { requestBiometricConfirmationUI } from '../../../src/contexts/biometric-confirmation'

describe('a confirm asked with no provider mounted', () => {
  it('answers that no one could ask, never a confirm', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const response = await requestBiometricConfirmationUI('Keyring Lab Community', 'join', false, 'keyringPin')
    expect(response.status).toBe('not_available')
    expect(response.error).toMatch(/not mounted/)
    warn.mockRestore()
  })
})
