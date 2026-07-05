import { render } from '@testing-library/react-native'
import React from 'react'

import ImportWallet from '../../src/screens/ImportWallet'
import { testIdWithKey } from '../../src/utils/testable'

jest.mock('react-native-document-picker', () => ({
  pick: jest.fn().mockResolvedValue([]),
  types: { allFiles: '*/*' },
}))

jest.mock('@credo-ts/react-hooks', () => ({
  useAgent: jest.fn(() => ({
    agent: {
      isInitialized: true,
      config: { walletConfig: {} },
      wallet: {
        isProvisioned: true,
        import: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      shutdown: jest.fn().mockResolvedValue(undefined),
    },
  })),
}))

describe('ImportWallet Screen', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => null)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('screen renders correctly', () => {
    const tree = render(<ImportWallet />)
    expect(tree).toMatchSnapshot()
  })

  test('password input exists', async () => {
    const { findByTestId } = render(<ImportWallet />)

    const passwordInput = await findByTestId(testIdWithKey('ImportPassword'))
    expect(passwordInput).not.toBe(null)
  })

  test('import button exists', async () => {
    const { findByTestId } = render(<ImportWallet />)

    const importButton = await findByTestId(testIdWithKey('ImportButton'))
    expect(importButton).not.toBe(null)
  })
})
