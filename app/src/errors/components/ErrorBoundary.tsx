import { AbstractBifoldLogger } from '@bifold/core'
import React, { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { reportProblem } from '@/utils/logger'
import { toBifoldError } from '../errorHandler'
import { ErrorInfoCard } from './ErrorInfoCard'

interface ErrorBoundaryProps {
  children: ReactNode
  t: (key: string) => string
  logger: AbstractBifoldLogger
  /**
   * Leave whatever failed. Called before the subtree is rendered again, so the
   * app comes back somewhere that did not just throw — see `handleDismiss`.
   */
  onEscape?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  /** When the boundary last caught, so a repeat can be recognised. */
  caughtAt: number
  /** A second catch in quick succession: the error is deterministic. */
  deterministic: boolean
  /** Bumped on dismiss so the subtree is rebuilt rather than resumed. */
  attempt: number
}

/** Two catches closer together than this mean the same error, not bad luck. */
const REPEAT_WINDOW_MS = 5000

/**
 * React class error boundary that catches render errors in its subtree.
 *
 * Since this sits at the top of the component tree (above providers and
 * ErrorModal), it renders the shared ErrorInfoCard directly in its fallback
 * using hardcoded fallback colors. This avoids depending on ThemeProvider
 * or any other context that lives below it.
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, caughtAt: 0, deterministic: false, attempt: 0 }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error): void {
    this.props.logger.error(`ErrorBoundary caught an error: ${error}`)
    // A screen that throws every time it renders cannot be escaped by
    // rendering it again, and offering to try is what kept a tester bouncing
    // between this card and the app lock until they force-quit the app
    // (report #27). A second catch within a few seconds is the evidence.
    const now = Date.now()
    this.setState((prev) => ({
      caughtAt: now,
      deterministic: prev.caughtAt > 0 && now - prev.caughtAt < REPEAT_WINDOW_MS,
    }))
  }

  /**
   * Dismissing has to CHANGE something. Clearing the flag re-rendered the very
   * subtree that threw, so for any deterministic error the card came straight
   * back; the app lock then turned that into a trap, because unlocking
   * returned to the failed screen, which threw again.
   *
   * So: leave the screen first (`onEscape` resets navigation to a safe root),
   * then rebuild the subtree under a new key rather than resuming the one that
   * failed, and only then clear the error.
   */
  handleDismiss = (): void => {
    try {
      this.props.onEscape?.()
    } catch (error) {
      // Escaping must not itself throw us back into the card.
      this.props.logger.error(`ErrorBoundary could not leave the failed screen: ${error}`)
    }
    // `caughtAt` deliberately survives: it is the evidence a second catch is
    // measured against. Clearing it here made the repeat undetectable, so an
    // error that always throws never became "deterministic" and the card kept
    // offering a retry that could not work — the very trap this fixes.
    this.setState((prev) => ({
      hasError: false,
      error: null,
      deterministic: false,
      attempt: prev.attempt + 1,
    }))
  }

  getReportError = (error: Error) => {
    return toBifoldError(this.props.t('Error.Problem'), this.props.t('Error.ProblemDescription'), error)
  }

  handleReport = (): string | undefined => {
    const { error } = this.state
    const { logger } = this.props

    if (!error) {
      return
    }

    const reportError = this.getReportError(error)
    logger.error(`ErrorBoundary reported: ${error}`)
    return reportProblem(reportError)
  }

  render(): React.ReactNode {
    const { hasError, error, deterministic, attempt } = this.state

    if (hasError && error) {
      const reportError = this.getReportError(error)
      return (
        <SafeAreaView style={styles.overlay}>
          <ErrorInfoCard
            title={reportError.title}
            description={reportError.description}
            message={reportError.message}
            code={reportError.code}
            onDismiss={this.handleDismiss}
            onReport={this.handleReport}
            enableReport
            action={
              deterministic
                ? {
                    // Said plainly, because the person has already tried: this
                    // screen will keep failing, so the way out is out.
                    text: this.props.t('Error.GoHome'),
                    onPress: this.handleDismiss,
                  }
                : undefined
            }
          />
        </SafeAreaView>
      )
    }

    // A new key after a dismissal, so what comes back is built fresh rather
    // than resumed from the state that failed.
    return <React.Fragment key={attempt}>{this.props.children}</React.Fragment>
  }
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
})

interface ErrorBoundaryWrapperProps {
  children: ReactNode
  logger: AbstractBifoldLogger
  /** How to leave a failed screen; see `ErrorBoundary.handleDismiss`. */
  onEscape?: () => void
}

/**
 * Functional wrapper that provides useTranslation to the class-based
 * ErrorBoundary. Place at the top of the component tree so it acts as
 * the last-resort catch-all for unhandled render errors.
 */
export const ErrorBoundaryWrapper: React.FC<ErrorBoundaryWrapperProps> = ({ children, logger, onEscape }) => {
  const { t } = useTranslation()
  return (
    <ErrorBoundary t={t} logger={logger} onEscape={onEscape}>
      {children}
    </ErrorBoundary>
  )
}

export default ErrorBoundaryWrapper
