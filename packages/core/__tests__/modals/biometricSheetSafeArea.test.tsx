/**
 * The biometric sheet must mount where it is actually mounted.
 *
 * BiometricConfirmationProvider renders BiometricConfirmationModal
 * unconditionally in RootStack, above the navigators that supply React
 * Navigation's SafeAreaProviderCompat. Nothing wraps that point in a
 * SafeAreaProvider, so a useSafeAreaInsets() call in the component's body
 * throws on every render -- before the early return, because hooks always run.
 * That crashed the app at main-stack mount on every build.
 *
 * It reached main green on all ten checks because core/jestSetup.js mocks
 * react-native-safe-area-context with the library's own jest mock, which
 * returns fixed insets and never throws. So this file unmocks that module and
 * uses the real one: under the global mock it cannot see this defect at all,
 * and a test that cannot fail for the right reason is not a guard.
 */

jest.unmock('react-native-safe-area-context')

import { render } from '@testing-library/react-native'
import React from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { BasicAppContext } from '../helpers/app'
import { testIdWithKey } from '../../src/utils/testable'

const mockUseBiometricConfirmation = jest.fn()

jest.mock('../../src/contexts/biometric-confirmation', () => ({
  ...jest.requireActual('../../src/contexts/biometric-confirmation'),
  useBiometricConfirmation: () => mockUseBiometricConfirmation(),
}))

jest.mock('../../src/services/keychain', () => ({
  loadWalletKey: jest.fn().mockResolvedValue(true),
}))

import BiometricConfirmationModal from '../../src/components/modals/BiometricConfirmationModal'

describe('the biometric sheet outside a safe-area provider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('is the real safe-area module, not the jest mock', () => {
    // Guards the guard: if the global mock were still in place, every row below
    // would pass whatever the component did. The real module throws when no
    // provider is in scope; the mock never does.
    // A plain require, NOT jest.requireMock: requireMock deliberately returns the
    // mock registry's entry, so it reports a mock whether or not jest.unmock took
    // effect and the guard could never pass.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useSafeAreaInsets } = require('react-native-safe-area-context')
    expect(jest.isMockFunction(useSafeAreaInsets)).toBe(false)
  })

  it('mounts outside a safe-area provider without throwing', () => {
    // Exactly the production case: mounted by the provider in RootStack with
    // nothing pending, so the sheet is not showing. The hook still runs.
    mockUseBiometricConfirmation.mockReturnValue({
      isModalVisible: false,
      pendingRequest: null,
      onConfirm: jest.fn(),
      onCancel: jest.fn(),
      onError: jest.fn(),
    })

    expect(() =>
      render(
        <BasicAppContext>
          <BiometricConfirmationModal />
        </BasicAppContext>
      )
    ).not.toThrow()
  })

  it('still mounts without throwing when a request is pending', () => {
    // The sheet itself renders inside SafeAreaModal, which carries a provider of
    // its own, so the inset read belongs under there and this must not throw
    // either.
    //
    // What this row does NOT prove: under the real module a SafeAreaProvider with
    // no parent insets, no initialMetrics and no native onInsetsChange holds its
    // insets at null and renders `insets != null ? children : null`
    // (SafeAreaContext.tsx:43-45, 97). In jest nothing fires that event, so the
    // modal's subtree -- SheetOverlay included -- never mounts here. This row is
    // therefore a second reading of the mount path, which is the crash, and not a
    // check of SheetOverlay itself. The row below is that check.
    mockUseBiometricConfirmation.mockReturnValue({
      isModalVisible: true,
      pendingRequest: {
        counterpartyName: 'Keyring Lab Community',
        connectionId: 'vetting',
        timestamp: '2026-09-23T12:00:00.000Z',
        skipNativeBiometric: false,
        authMode: 'biometric',
      },
      onConfirm: jest.fn(),
      onCancel: jest.fn(),
      onError: jest.fn(),
    })

    expect(() =>
      render(
        <BasicAppContext>
          <BiometricConfirmationModal />
        </BasicAppContext>
      )
    ).not.toThrow()
  })

  it('renders the sheet and applies the inset as the top padding', () => {
    // SheetOverlay is new code and the two rows above cannot reach it, so on its
    // own the fix could ship with a broken overlay and this file would stay green.
    // An outer provider carrying initialMetrics gives the inner one a non-null
    // parentInsets, so the modal's subtree mounts and SheetOverlay's own
    // useSafeAreaInsets() read actually runs.
    //
    // This row is NOT a control row: with a provider in scope the old body hook
    // would not throw either, so it passes on the pre-fix branch too. Its job is
    // to prove the new component works and to keep it working.
    mockUseBiometricConfirmation.mockReturnValue({
      isModalVisible: true,
      pendingRequest: {
        counterpartyName: 'Keyring Lab Community',
        connectionId: 'vetting',
        timestamp: '2026-09-23T12:00:00.000Z',
        skipNativeBiometric: false,
        authMode: 'biometric',
      },
      onConfirm: jest.fn(),
      onCancel: jest.fn(),
      onError: jest.fn(),
    })

    const metrics = {
      insets: { top: 44, left: 0, right: 0, bottom: 34 },
      frame: { x: 0, y: 0, width: 390, height: 844 },
    }

    const tree = render(
      <SafeAreaProvider initialMetrics={metrics}>
        <BasicAppContext>
          <BiometricConfirmationModal />
        </BasicAppContext>
      </SafeAreaProvider>
    )

    // The subtree really mounted, so SheetOverlay's hook really ran.
    expect(tree.getByTestId(testIdWithKey('BiometricConfirmationScroll'))).toBeTruthy()

    // And it fed the inset through as the sheet's top padding.
    const paddings: number[] = []
    const walk = (node: any): void => {
      if (!node || typeof node !== 'object') return
      const style = node.props?.style
      for (const entry of Array.isArray(style) ? style : [style]) {
        if (entry && typeof entry === 'object' && typeof entry.paddingTop === 'number') {
          paddings.push(entry.paddingTop)
        }
      }
      for (const child of node.children ?? []) walk(child)
    }
    walk(tree.toJSON())
    expect(paddings).toContain(44)
  })
})
