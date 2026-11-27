/**
 * The VDC re-issue policy (docs/plans/agent-connect-plan.md §3.4): a grant with 48 hours or less left is replaced, for
 * an `active` connection whose entry one read (`entryRead.ts`) proved listed.
 *
 * When to ask (app start, opening the agent list or the details, Extend) is the services' (backlog fb-5). This module
 * decides which records are due, builds, signs and stores their new grant, and reports what it did as ids.
 *
 * @module connected-agents/vdcReissue
 */

import { personaSigningKeyId } from './driver'
import type { EntryRead } from './entryRead'
import { statusOf } from './status'
import type { AgentConnection } from './types'
import { buildVdcGrant, issueVdc, shouldReissueVdc, vdcScopeFor, vtaVdcSigner, type VdcSignPort } from './vdc'

export type VdcReissuePorts = {
  clock: () => number
  /** `keys/sign-document/0.1` on the owner's VTA. */
  vdcSign: VdcSignPort
  /** The persona's signing key id; `personaSigningKeyId` when absent. */
  signingKeyIdOf?: (persona: string) => string
  connections: {
    update(id: string, change: (r: AgentConnection) => AgentConnection): Promise<AgentConnection | undefined>
  }
}

export type VdcReissueResult = { reissued: string[]; failed: string[] }

/** The grant's `validUntil`, when the record holds a grant that names one as a string. */
function grantValidUntil(record: AgentConnection): string | undefined {
  const until = record.vdcGrant?.validUntil
  return typeof until === 'string' ? until : undefined
}

/**
 * Re-issue every due grant, one record at a time. A record is due when `shouldReissueVdc` says so for its state, its
 * read (only `listed` confirms the entry present) and its grant's `validUntil`.
 *
 * Skipped, not failed: a record with no grant or no `validUntil` string, and a temporary record whose status is
 * `expired` (its entry has ended, so no grant can be built for it). A throw while building, signing or storing puts the
 * id in `failed` and the next record still runs. The new grant is written only onto a record that is still `active`
 * when it is stored; a record that left `active` meanwhile (or is gone) is in neither list.
 */
export async function reissueDueGrants(
  ports: VdcReissuePorts,
  records: readonly AgentConnection[],
  reads: ReadonlyMap<string, EntryRead>
): Promise<VdcReissueResult> {
  const result: VdcReissueResult = { reissued: [], failed: [] }
  for (const record of records) {
    const now = ports.clock()
    const validUntil = grantValidUntil(record)
    if (validUntil === undefined) continue
    if (record.grantType === 'temporary' && statusOf(record, now) === 'expired') continue
    const due = shouldReissueVdc({
      state: record.state,
      entryConfirmedPresent: reads.get(record.id)?.kind === 'listed',
      grantValidUntil: validUntil,
      now,
    })
    if (!due) continue
    try {
      const keyId = (ports.signingKeyIdOf ?? personaSigningKeyId)(record.ownerPersonaDid)
      const unsigned = buildVdcGrant({
        personaDid: record.ownerPersonaDid,
        agentDid: record.agentDid,
        scope: vdcScopeFor({ memory: record.memoryContexts.length > 0, roomAdded: false }),
        now,
        // A persistent agent's entry has no expiry, so its grant runs the full 7 days.
        ...(record.grantType === 'temporary' && record.expiresAt ? { entryExpiresAt: record.expiresAt } : {}),
      })
      const grant = (await issueVdc(unsigned, vtaVdcSigner(ports.vdcSign, keyId))) as unknown as Record<string, unknown>
      const written = await ports.connections.update(record.id, (r) =>
        r.state === 'active' ? { ...r, vdcGrant: grant } : r
      )
      if (written?.vdcGrant === grant) result.reissued.push(record.id)
    } catch {
      result.failed.push(record.id)
    }
  }
  return result
}
