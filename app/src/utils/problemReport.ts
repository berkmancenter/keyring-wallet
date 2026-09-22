/**
 * "Report this problem" for testers: builds a plain-text report (what failed,
 * the full error chain, the build and device, the recent log lines) and lets
 * the tester send it by email or through the share sheet. Nothing is sent
 * anywhere unless the tester chooses to.
 */
import { Alert, Linking, Platform, Share } from 'react-native'
import Config from 'react-native-config'
import {
  getApplicationName,
  getBuildNumber,
  getModel,
  getSystemName,
  getSystemVersion,
  getVersion,
} from 'react-native-device-info'
import { CachesDirectoryPath, writeFile } from 'react-native-fs'

import { getRecentLogLines } from './logBuffer'
import { generateReferenceCode } from './reference-code'

export interface ProblemReportInput {
  referenceCode: string
  title?: string
  description?: string
  message?: string
  error?: unknown
}

export interface ReportEnvironment {
  app: string
  version: string
  build: string
  system: string
  device: string
  time: string
}

// Mail apps take a long body, but keep the mailto URL well inside what iOS and
// Android accept; the share-sheet path carries the whole report as a file.
export const EMAIL_LOG_LINES = 150

/** Walks `cause` like the agent-init logging does: "A <- B <- C". */
export const errorChain = (error: unknown, max = 8): string[] => {
  const chain: string[] = []
  let current: unknown = error
  while (current && chain.length < max) {
    if (current instanceof Error) {
      chain.push(`${current.name}: ${current.message}`)
      current = (current as Error & { cause?: unknown }).cause
    } else {
      chain.push(String(current))
      break
    }
  }
  return chain
}

export const currentEnvironment = (now: Date = new Date()): ReportEnvironment => ({
  app: getApplicationName(),
  version: getVersion(),
  build: getBuildNumber(),
  system: `${getSystemName()} ${getSystemVersion()}`,
  device: getModel(),
  time: now.toISOString(),
})

export const buildProblemReport = (
  input: ProblemReportInput,
  env: ReportEnvironment,
  logLines: string[],
  maxLogLines?: number
): string => {
  const chain = errorChain(input.error)
  const shownLines = maxLogLines !== undefined ? logLines.slice(-maxLogLines) : logLines
  const sections = [
    `Keyring problem report ${input.referenceCode}`,
    `${env.app} ${env.version} (${env.build}) · ${env.system} · ${env.device} · ${env.time}`,
    '',
    input.title ? `What failed: ${input.title}` : undefined,
    input.description ? `Shown to the user: ${input.description}` : undefined,
    input.message ? `Details: ${input.message}` : undefined,
    chain.length ? `Error chain:\n  ${chain.join('\n  <- ')}` : undefined,
    '',
    `Recent log (${shownLines.length} of ${logLines.length} lines, oldest first):`,
    ...shownLines,
  ]
  return sections.filter((line) => line !== undefined).join('\n')
}

const reportSubject = (input: ProblemReportInput, env: ReportEnvironment) =>
  `Keyring problem ${input.referenceCode} — ${env.version} (${env.build})`

const emailReport = async (to: string, input: ProblemReportInput, env: ReportEnvironment) => {
  const body = buildProblemReport(input, env, getRecentLogLines(), EMAIL_LOG_LINES)
  const url = `mailto:${to}?subject=${encodeURIComponent(reportSubject(input, env))}&body=${encodeURIComponent(body)}`
  await Linking.openURL(url)
}

const shareReport = async (input: ProblemReportInput, env: ReportEnvironment) => {
  const text = buildProblemReport(input, env, getRecentLogLines())
  if (Platform.OS === 'ios') {
    const path = `${CachesDirectoryPath}/keyring-report-${input.referenceCode}.txt`
    await writeFile(path, text, 'utf8')
    await Share.share({ url: `file://${path}`, title: reportSubject(input, env) })
  } else {
    await Share.share({ title: reportSubject(input, env), message: text })
  }
}

/**
 * Asks the tester how to send the report. Best-effort: a failure to open Mail
 * or the share sheet never throws into the error screen.
 */
export const offerProblemReport = (input: ProblemReportInput): void => {
  const env = currentEnvironment()
  const to = Config.FEEDBACK_EMAIL
  const run = (send: () => Promise<void>) => () => {
    send().catch(() => undefined)
  }
  Alert.alert(
    'Send this problem report?',
    `Reference ${input.referenceCode}. The report includes what went wrong, your app version and device, and the app's recent activity log. The log can include the names and cards exchanged with your contacts, but never keys, passwords or your PIN. Only you decide where it goes.`,
    [
      ...(to ? [{ text: 'Email report', onPress: run(() => emailReport(to, input, env)) }] : []),
      { text: 'Share…', onPress: run(() => shareReport(input, env)) },
      { text: 'Cancel', style: 'cancel' as const },
    ]
  )
}

/**
 * Settings → Help → Give feedback: the same report and choice, for things that
 * went wrong without an error screen (or ideas). The recent log rides along.
 */
export const offerFeedbackReport = (): void => {
  offerProblemReport({ referenceCode: generateReferenceCode(), title: 'Feedback from Settings' })
}
