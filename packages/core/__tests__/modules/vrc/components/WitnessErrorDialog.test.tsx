import { render, fireEvent } from '@testing-library/react-native'
import React from 'react'

import WitnessErrorDialog, {
  WitnessErrorType,
  WitnessErrorDialogProps,
} from '../../../../src/modules/vrc/components/WitnessErrorDialog'

jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon')

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => <MockView {...props}>{children}</MockView>,
  SafeAreaProvider: ({ children }: any) => <>{children}</>,
}))

jest.mock('../../../../src/contexts/theme', () => ({
  useTheme: () => ({
    ColorPalette: {
      brand: {
        modalPrimaryBackground: '#fff',
        primary: '#667eea',
        primaryLight: '#eef',
        modalIcon: '#333',
      },
      grayscale: { black: '#000', mediumGrey: '#6b7280' },
      notification: {
        info: '#E3F2FD',
        infoText: '#1e40af',
        infoIcon: '#1976D2',
        errorBorder: '#ef4444',
      },
    },
    TextTheme: {
      headingThree: { fontSize: 20, fontWeight: 'bold', color: '#333' },
      headingFour: { fontSize: 18, fontWeight: '600', color: '#333' },
      normal: { fontSize: 15, color: '#555' },
      modalTitle: { color: '#333' },
      modalNormal: { color: '#555' },
    },
  }),
}))

jest.mock('../../../../src/components/modals/SafeAreaModal', () => {
  return ({ children, visible, ...props }: any) => {
    if (!visible) return null
    return <MockView {...props}>{children}</MockView>
  }
})

jest.mock('../../../../src/components/buttons/Button', () => {
  const { TouchableOpacity, Text } = require('react-native')
  const ButtonMock = ({ title, accessibilityLabel, testID, onPress, disabled }: any) => (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      disabled={disabled}
    >
      <Text>{title}</Text>
    </TouchableOpacity>
  )
  ButtonMock.displayName = 'Button'
  return {
    __esModule: true,
    default: ButtonMock,
    ButtonType: { Primary: 0, Secondary: 1, ModalCritical: 4 },
  }
})

jest.mock('../../../../src/components/texts/ThemedText', () => {
  const { Text } = require('react-native')
  return { ThemedText: ({ children, style }: any) => <Text style={style}>{children}</Text> }
})

jest.mock('../../../../src/constants', () => ({
  hitSlop: { top: 10, bottom: 10, left: 10, right: 10 },
}))

jest.mock('../../../../src/utils/testable', () => ({
  testIdWithKey: (key: string) => `com.bifold:id/${key}`,
}))

const { View: MockView } = require('react-native')

describe('WitnessErrorDialog', () => {
  const defaultProps: WitnessErrorDialogProps = {
    visible: true,
    errorType: 'witness-timeout',
    onCancel: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ============================================
  // 1. RENDERING TESTS FOR EACH ERROR TYPE
  // ============================================

  describe('Rendering tests for each error type', () => {
    test('witness-timeout shows correct title and message', () => {
      const { getByText } = render(
        <WitnessErrorDialog {...defaultProps} errorType="witness-timeout" />
      )

      expect(getByText('Witness Not Responding')).toBeTruthy()
      expect(getByText(/did not respond in time/)).toBeTruthy()
    })

    test('vp-submission-failed shows correct title and message', () => {
      const { getByText } = render(
        <WitnessErrorDialog {...defaultProps} errorType="vp-submission-failed" />
      )

      expect(getByText('Submission Failed')).toBeTruthy()
      expect(getByText(/Failed to submit credentials to the witness/)).toBeTruthy()
    })

    test('session-timeout shows correct title and message', () => {
      const { getByText } = render(
        <WitnessErrorDialog {...defaultProps} errorType="session-timeout" />
      )

      expect(getByText('Session Could Not Be Established')).toBeTruthy()
      expect(getByText(/Could not establish a witness session/)).toBeTruthy()
    })

    test('counterparty-not-connected shows correct title and message', () => {
      const { getByText } = render(
        <WitnessErrorDialog {...defaultProps} errorType="counterparty-not-connected" />
      )

      expect(getByText('Contact Not on Witness')).toBeTruthy()
      expect(getByText(/does not appear to be connected to/)).toBeTruthy()
    })

    test('biometric-cancelled shows correct title and message', () => {
      const { getByText } = render(
        <WitnessErrorDialog {...defaultProps} errorType="biometric-cancelled" />
      )

      expect(getByText('Verification Cancelled')).toBeTruthy()
      expect(getByText('Biometric verification was cancelled.')).toBeTruthy()
    })

    test('biometric-failed shows correct title and message', () => {
      const { getByText } = render(
        <WitnessErrorDialog {...defaultProps} errorType="biometric-failed" />
      )

      expect(getByText('Verification Failed')).toBeTruthy()
      expect(getByText('Biometric verification failed.')).toBeTruthy()
    })

    test('stale-witness shows correct title and message', () => {
      const { getByText } = render(
        <WitnessErrorDialog {...defaultProps} errorType="stale-witness" />
      )

      expect(getByText('Witness Disconnected')).toBeTruthy()
      expect(getByText(/has expired/)).toBeTruthy()
    })

    test('network-error shows correct title and message', () => {
      const { getByText } = render(
        <WitnessErrorDialog {...defaultProps} errorType="network-error" />
      )

      expect(getByText('Connection Error')).toBeTruthy()
      expect(getByText('A network error occurred during the exchange.')).toBeTruthy()
    })

    test('does not render when visible is false', () => {
      const { queryByText } = render(
        <WitnessErrorDialog {...defaultProps} visible={false} />
      )

      expect(queryByText('Witness Not Responding')).toBeNull()
    })
  })

  // ============================================
  // 2. BUTTON VISIBILITY TESTS
  // ============================================

  describe('Button visibility tests', () => {
    describe('Retry button visibility', () => {
      const errorTypesWithRetry: WitnessErrorType[] = [
        'witness-timeout',
        'vp-submission-failed',
        'session-timeout',
        'counterparty-not-connected',
        'biometric-cancelled',
        'biometric-failed',
        'network-error',
      ]

      test.each(errorTypesWithRetry)(
        'Retry button shows for %s when onRetry is provided',
        (errorType) => {
          const { getByLabelText } = render(
            <WitnessErrorDialog
              {...defaultProps}
              errorType={errorType}
              onRetry={jest.fn()}
            />
          )

          expect(getByLabelText('Retry')).toBeTruthy()
        }
      )

      test('Retry button does NOT show for stale-witness (need to reconnect instead)', () => {
        const { queryByLabelText } = render(
          <WitnessErrorDialog
            {...defaultProps}
            errorType="stale-witness"
            onRetry={jest.fn()}
          />
        )

        expect(queryByLabelText('Retry')).toBeNull()
      })

      test('Retry button does NOT show when onRetry is not provided', () => {
        const { queryByLabelText } = render(
          <WitnessErrorDialog {...defaultProps} errorType="witness-timeout" />
        )

        expect(queryByLabelText('Retry')).toBeNull()
      })
    })

    describe('Cancel button visibility', () => {
      const allErrorTypes: WitnessErrorType[] = [
        'witness-timeout',
        'vp-submission-failed',
        'session-timeout',
        'counterparty-not-connected',
        'biometric-cancelled',
        'biometric-failed',
        'stale-witness',
        'network-error',
      ]

      test.each(allErrorTypes)('Cancel button always shows for %s', (errorType) => {
        const { getByLabelText } = render(
          <WitnessErrorDialog {...defaultProps} errorType={errorType} />
        )

        expect(getByLabelText('Cancel')).toBeTruthy()
      })
    })

    describe('Proceed Without Witness button visibility', () => {
      const errorTypesWithProceedWithout: WitnessErrorType[] = [
        'witness-timeout',
        'vp-submission-failed',
        'session-timeout',
        'counterparty-not-connected',
        'stale-witness',
        'network-error',
      ]

      test.each(errorTypesWithProceedWithout)(
        'Proceed Without Witness button shows for %s when onProceedWithout is provided',
        (errorType) => {
          const { getByLabelText } = render(
            <WitnessErrorDialog
              {...defaultProps}
              errorType={errorType}
              onProceedWithout={jest.fn()}
            />
          )

          expect(getByLabelText('Proceed without witness')).toBeTruthy()
        }
      )

      test('Proceed Without Witness button does NOT show for biometric-cancelled', () => {
        const { queryByLabelText } = render(
          <WitnessErrorDialog
            {...defaultProps}
            errorType="biometric-cancelled"
            onProceedWithout={jest.fn()}
          />
        )

        expect(queryByLabelText('Proceed without witness')).toBeNull()
      })

      test('Proceed Without Witness button does NOT show for biometric-failed', () => {
        const { queryByLabelText } = render(
          <WitnessErrorDialog
            {...defaultProps}
            errorType="biometric-failed"
            onProceedWithout={jest.fn()}
          />
        )

        expect(queryByLabelText('Proceed without witness')).toBeNull()
      })

      test('Proceed Without Witness button does NOT show when onProceedWithout is not provided', () => {
        const { queryByLabelText } = render(
          <WitnessErrorDialog {...defaultProps} errorType="witness-timeout" />
        )

        expect(queryByLabelText('Proceed without witness')).toBeNull()
      })
    })
  })

  // ============================================
  // 3. CALLBACK TESTS
  // ============================================

  describe('Callback tests', () => {
    test('onRetry is called when Retry button is pressed', () => {
      const onRetry = jest.fn()
      const { getByLabelText } = render(
        <WitnessErrorDialog {...defaultProps} onRetry={onRetry} />
      )

      fireEvent.press(getByLabelText('Retry'))
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    test('onCancel is called when Cancel button is pressed', () => {
      const onCancel = jest.fn()
      const { getByLabelText } = render(
        <WitnessErrorDialog {...defaultProps} onCancel={onCancel} />
      )

      fireEvent.press(getByLabelText('Cancel'))
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    test('onProceedWithout is called when Proceed Without Witness button is pressed', () => {
      const onProceedWithout = jest.fn()
      const { getByLabelText } = render(
        <WitnessErrorDialog {...defaultProps} onProceedWithout={onProceedWithout} />
      )

      fireEvent.press(getByLabelText('Proceed without witness'))
      expect(onProceedWithout).toHaveBeenCalledTimes(1)
    })

    test('onCancel is called when close button is pressed', () => {
      const onCancel = jest.fn()
      const { getByLabelText } = render(
        <WitnessErrorDialog {...defaultProps} onCancel={onCancel} />
      )

      const closeButton = getByLabelText('Close')
      fireEvent.press(closeButton)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    test('Retry button is replaced by spinner when isRetrying is true', () => {
      const onRetry = jest.fn()
      const { queryByLabelText, getByText } = render(
        <WitnessErrorDialog {...defaultProps} onRetry={onRetry} isRetrying={true} />
      )

      expect(queryByLabelText('Retry')).toBeNull()
      expect(getByText('Retrying...')).toBeTruthy()
    })
  })

  // ============================================
  // 4. CONTEXT SUBSTITUTION TESTS
  // ============================================

  describe('Context substitution tests', () => {
    test('witnessName appears in message for witness-timeout', () => {
      const { getByText } = render(
        <WitnessErrorDialog
          {...defaultProps}
          errorType="witness-timeout"
          witnessName="TestWitness"
        />
      )

      expect(getByText(/The witness "TestWitness" did not respond/)).toBeTruthy()
    })

    test('witnessName appears in message for vp-submission-failed', () => {
      const { getByText } = render(
        <WitnessErrorDialog
          {...defaultProps}
          errorType="vp-submission-failed"
          witnessName="MyWitness"
        />
      )

      expect(getByText(/Failed to submit credentials to the witness "MyWitness"/)).toBeTruthy()
    })

    test('witnessName appears in message for session-timeout', () => {
      const { getByText } = render(
        <WitnessErrorDialog
          {...defaultProps}
          errorType="session-timeout"
          witnessName="SessionWitness"
        />
      )

      expect(getByText(/Could not establish a witness session with "SessionWitness"/)).toBeTruthy()
    })

    test('witnessName appears in message for stale-witness', () => {
      const { getByText } = render(
        <WitnessErrorDialog
          {...defaultProps}
          errorType="stale-witness"
          witnessName="StaleWitness"
        />
      )

      expect(getByText(/Your connection to "StaleWitness" has expired/)).toBeTruthy()
    })

    test('contactName appears in message for counterparty-not-connected', () => {
      const { getByText } = render(
        <WitnessErrorDialog
          {...defaultProps}
          errorType="counterparty-not-connected"
          contactName="John Doe"
        />
      )

      expect(getByText(/John Doe does not appear to be connected to/)).toBeTruthy()
    })

    test('contactName and witnessName both appear for counterparty-not-connected', () => {
      const { getByText } = render(
        <WitnessErrorDialog
          {...defaultProps}
          errorType="counterparty-not-connected"
          contactName="Jane Smith"
          witnessName="EventWitness"
        />
      )

      expect(getByText(/Jane Smith does not appear to be connected to "EventWitness"/)).toBeTruthy()
    })

    test('errorMessage appears in info box for vp-submission-failed', () => {
      const customError = 'Custom error: Server returned 503'
      const { getByText } = render(
        <WitnessErrorDialog
          {...defaultProps}
          errorType="vp-submission-failed"
          errorMessage={customError}
        />
      )

      expect(getByText(customError)).toBeTruthy()
    })

    test('errorMessage appears in info box for biometric-failed', () => {
      const customError = 'Too many failed attempts'
      const { getByText } = render(
        <WitnessErrorDialog
          {...defaultProps}
          errorType="biometric-failed"
          errorMessage={customError}
        />
      )

      expect(getByText(customError)).toBeTruthy()
    })

    test('errorMessage appears in info box for network-error', () => {
      const customError = 'Connection timed out after 30 seconds'
      const { getByText } = render(
        <WitnessErrorDialog
          {...defaultProps}
          errorType="network-error"
          errorMessage={customError}
        />
      )

      expect(getByText(customError)).toBeTruthy()
    })

    test('default message is shown when errorMessage is not provided', () => {
      const { getByText } = render(
        <WitnessErrorDialog {...defaultProps} errorType="network-error" />
      )

      expect(getByText(/Please check your network connection and try again/)).toBeTruthy()
    })
  })

  // ============================================
  // 5. EDGE CASES
  // ============================================

  describe('Edge cases', () => {
    test('handles unknown error type gracefully (falls back to network-error)', () => {
      const { getByText } = render(
        <WitnessErrorDialog
          {...defaultProps}
          // @ts-expect-error - Testing unknown error type
          errorType="unknown-error-type"
        />
      )

      expect(getByText('Connection Error')).toBeTruthy()
    })

    test('close button is disabled when isRetrying', () => {
      const onCancel = jest.fn()
      const { getByLabelText } = render(
        <WitnessErrorDialog {...defaultProps} onCancel={onCancel} isRetrying={true} />
      )

      const closeButton = getByLabelText('Close')
      fireEvent.press(closeButton)

      expect(onCancel).not.toHaveBeenCalled()
    })

    test('renders all three action buttons when retry and proceedWithout are provided', () => {
      const { getByLabelText } = render(
        <WitnessErrorDialog
          {...defaultProps}
          onRetry={jest.fn()}
          onProceedWithout={jest.fn()}
        />
      )

      expect(getByLabelText('Retry')).toBeTruthy()
      expect(getByLabelText('Cancel')).toBeTruthy()
      expect(getByLabelText('Proceed without witness')).toBeTruthy()
    })

    test('does not show Retry option description when retry is not available', () => {
      const { queryByText } = render(
        <WitnessErrorDialog {...defaultProps} errorType="stale-witness" />
      )

      expect(queryByText(/Retry:/)).toBeNull()
    })

    test('does not show Proceed Without option description when not available', () => {
      const { queryByText } = render(
        <WitnessErrorDialog {...defaultProps} errorType="biometric-cancelled" />
      )

      expect(queryByText(/Proceed Without Witness:/)).toBeNull()
    })
  })
})
