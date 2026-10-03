import type { BifoldError } from '@bifold/core'

import { reportProblem } from './logger'
import { offerProblemReport } from './problemReport'

jest.mock('@bifold/remote-logs', () => ({ RemoteLogger: jest.fn(), lokiTransport: jest.fn() }))
jest.mock('react-native-config', () => ({}))
jest.mock('react-native-device-info', () => ({
  getApplicationName: () => 'KeyRing',
  getBuildNumber: () => '1',
  getSystemName: () => 'iOS',
  getSystemVersion: () => '26.3',
  getVersion: () => '0.1.0',
}))
jest.mock('./problemReport', () => ({ offerProblemReport: jest.fn() }))

const failure = Object.assign(new Error("Error during call to 'onInitializeContext' method in module 'didcomm'"), {
  title: 'Unable to complete agent initialization',
  description: 'There was a problem while initializing the agent.',
  code: 2031,
}) as unknown as BifoldError

describe('a problem report says what the person saw', () => {
  beforeEach(() => (offerProblemReport as jest.Mock).mockClear())

  it("carries the screen's words when the screen said something other than the error's description", () => {
    reportProblem(failure, "Keyring couldn't reach its message service. Your wallet and everything in it are fine.")
    expect(offerProblemReport).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Unable to complete agent initialization',
        description: "Keyring couldn't reach its message service. Your wallet and everything in it are fine.",
        message: failure.message,
        error: failure,
      })
    )
  })

  it("and the error's own description where the screen showed that", () => {
    reportProblem(failure)
    expect(offerProblemReport).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'There was a problem while initializing the agent.' })
    )
  })
})
