/**
 * The summary read of "What my agent saw" (C4; backlog brief, section B part 3, "The reads"): Keyring, as Management
 * Client, sends `hcp/disclosures/summary/0.1` `{ client }` through the HCP port and takes the `clients[]` entry
 * whose `client.id` is the client's VID.
 *
 * Nothing here logs a payload or a response.
 *
 * @module connected-agents/hcp/whatItSaw/summary
 */
import { HCP_DISCLOSURES_SUMMARY } from '../types'
import { callHcp, type HcpCallOutcome, type HcpVtaPort } from '../vtaPort'

/** One client's `disclosures/summary` entry (HCP 8.6), as far as the view reads it. Times are ISO-8601 instants. */
export interface HcpClientSummary {
  retrievals: number
  categories: string[]
  lastAt: string
  usableUntil: string | null
}

const isInstant = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

/** The `clients[]` entry for `clientVid`, if the answer has one of the expected shape. */
function readEntry(value: unknown, clientVid: string): HcpClientSummary | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const clients = (value as { clients?: unknown }).clients
  if (!Array.isArray(clients)) return undefined
  for (const entry of clients) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if ((e.client as { id?: unknown } | undefined)?.id !== clientVid) continue
    const { retrievals, categories, lastAt, usableUntil } = e
    if (typeof retrievals !== 'number' || !Number.isInteger(retrievals) || retrievals < 0) return undefined
    if (!Array.isArray(categories) || !isInstant(lastAt)) return undefined
    return {
      retrievals,
      categories: categories.filter((c): c is string => typeof c === 'string'),
      lastAt,
      usableUntil: isInstant(usableUntil) ? usableUntil : null,
    }
  }
  return undefined
}

/**
 * The client's summary entry: `{ ok: true, entry }`, with no `entry` when the answer has none for this client (or
 * none of the expected shape); a refusal, an unreachable VTA or the flags off as {@link callHcp} gives them.
 */
export async function readHcpSummary(
  port: HcpVtaPort,
  clientVid: string
): Promise<HcpCallOutcome<HcpClientSummary | undefined>> {
  const outcome = await callHcp<unknown>(port, HCP_DISCLOSURES_SUMMARY, { client: clientVid })
  if (!outcome.ok) return outcome
  return { ok: true, value: readEntry(outcome.value, clientVid) }
}
