import { render } from '@testing-library/react-native'
import React from 'react'

import ExportWallet from '../../src/screens/ExportWallet'
import { testIdWithKey } from '../../src/utils/testable'

jest.mock('@credo-ts/react-hooks', () => ({
  useAgent: jest.fn(() => ({
    agent: {
      isInitialized: true,
      wallet: {
        export: jest.fn().mockResolvedValue(undefined),
      },
    },
  })),
}))

describe('ExportWallet Screen', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => null)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('screen renders correctly', () => {
    const tree = render(<ExportWallet />)
    expect(tree).toMatchSnapshot()
  })

  test('password inputs exist', async () => {
    const { findByTestId } = render(<ExportWallet />)

    const passwordInput = await findByTestId(testIdWithKey('ExportPassword'))
    const confirmPasswordInput = await findByTestId(testIdWithKey('ExportPasswordConfirm'))

    expect(passwordInput).not.toBe(null)
    expect(confirmPasswordInput).not.toBe(null)
  })

  test('export button exists', async () => {
    const { findByTestId } = render(<ExportWallet />)

    const exportButton = await findByTestId(testIdWithKey('ExportButton'))
    expect(exportButton).not.toBe(null)
  })
})
