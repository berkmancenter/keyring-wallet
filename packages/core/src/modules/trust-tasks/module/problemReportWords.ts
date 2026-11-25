import { didPrefix } from './didPrefix'

/** DIDComm v2's problem-report (`report-problem/2.0`). */
export const PROBLEM_REPORT = 'https://didcomm.org/report-problem/2.0/problem-report'

export const isProblemReport = (message: { type?: unknown }): boolean => message.type === PROBLEM_REPORT

/** A DID anywhere in free text: the method, then everything up to a space, quote or closing bracket. */
const DID_IN_TEXT = /did:[a-z0-9]+:[^\s"'<>,;()[\]{}]+/gi

/**
 * A problem-report's code, its words and the thread it answers, for one log line
 * that reaches testers' problem reports.
 *
 * Three problem-reports reached a tester's report as a bare type, and nothing
 * said what they were about (IN-617). The `comment` is the sender's own words,
 * so a DID in it is cut to its prefix, or said as "a DID" where even a prefix
 * would say too much (`hideDids`: hidden vetting).
 *
 * `args` are never read, and that is the privacy line: report-problem/2.0
 * keeps a comment's values out of the comment, in `args`, filled into its
 * `{1}`, `{2}` placeholders. The values are where a DID, a key id or a
 * person's data would be, and they are not scrubbed, so the line carries the
 * comment with its placeholders unfilled.
 */
export function problemReportWords(
  message: { body?: unknown; thid?: unknown; pthid?: unknown },
  options: { hideDids?: boolean } = {}
): string {
  const body = (message.body ?? {}) as { code?: unknown; comment?: unknown }
  // A sentence's closing stop is not part of the DID before it.
  const scrub = (text: string) =>
    text.replace(DID_IN_TEXT, (match) => {
      const did = match.replace(/[.:]+$/, '')
      return `${options.hideDids ? 'a DID' : didPrefix(did)}${match.slice(did.length)}`
    })
  const code = typeof body.code === 'string' && body.code ? scrub(body.code).slice(0, 80) : 'no code'
  const comment = typeof body.comment === 'string' ? scrub(body.comment.replace(/\s+/g, ' ').trim()).slice(0, 200) : ''
  const thread = [message.thid, message.pthid].find((id): id is string => typeof id === 'string' && id.length > 0)
  return `${code}${comment ? ` — ${comment}` : ''} (${thread ? `thread ${scrub(thread).slice(0, 64)}` : 'no thread'})`
}
