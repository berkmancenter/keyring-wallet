import type { BifoldError } from '@bifold/core'
import { RemoteLogger, RemoteLoggerOptions, lokiTransport } from '@bifold/remote-logs'
import Config from 'react-native-config'
import {
  getApplicationName,
  getBuildNumber,
  getSystemName,
  getSystemVersion,
  getVersion,
} from 'react-native-device-info'
import { autoDisableRemoteLoggingIntervalInMinutes } from '../constants'
import { generateReferenceCode } from './reference-code'

const logOptions: RemoteLoggerOptions = {
  lokiUrl: Config.REMOTE_LOGGING_URL,
  lokiLabels: {
    application: getApplicationName().toLowerCase(),
    version: `${getVersion()}-${getBuildNumber()}`,
    system: `${getSystemName()} v${getSystemVersion()}`,
  },
  autoDisableRemoteLoggingIntervalInMinutes,
}

const BCLogger = new RemoteLogger(logOptions)

/**
 * Sends a problem report to Loki and returns a user-facing reference code.
 *
 * Ported from bc-wallet-mobile. The reference code is embedded in the report
 * payload as `report_id`, so support can locate the incident later by searching
 * the `incident-report` job for it (e.g. in Grafana:
 * `{job="incident-report"} |= "<code>"`). It is intentionally placed in the log
 * body rather than as a Loki label to avoid high label cardinality.
 *
 * Reporting is best-effort: any transport failure is swallowed so the user is
 * always given a code to share, even when the network/Loki is unavailable.
 *
 * @param error - the error being reported
 * @returns the reference code to surface to the user
 */
export const reportProblem = (error: BifoldError): string => {
  const referenceCode = generateReferenceCode()
  const { title, description, code, message, stack } = error

  try {
    if (logOptions.lokiUrl) {
      lokiTransport({
        msg: title,
        // Only attach `stack` when the error actually carries one — user-initiated
        // reports have no real trace, so the field is omitted rather than logging
        // meaningless construction frames.
        rawMsg: [
          {
            message: title,
            data: { description, code, message, ...(stack ? { stack } : {}), report_id: referenceCode },
          },
        ],
        level: { severity: 3, text: 'error' },
        options: {
          lokiUrl: logOptions.lokiUrl,
          lokiLabels: logOptions.lokiLabels,
          job: 'incident-report',
        },
      })
    }
  } catch (e) {
    // Never let a reporting failure prevent the user from getting their code.
    BCLogger.error?.(`Failed to send problem report to Loki: ${e}`)
  }

  return referenceCode
}

export default BCLogger
