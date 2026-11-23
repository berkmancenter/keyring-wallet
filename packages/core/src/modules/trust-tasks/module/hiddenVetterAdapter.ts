/**
 * The vetter's side, as the vetter screens ask for it.
 *
 * `screens/hiddenVetterSeam.ts` owns the contract; this implements it over the
 * seven `vta/pcs/*` vetter tasks and registers itself at import, the same way
 * the applicant's adapter does. A build that never imports it registers
 * nothing and shows no vetter screens.
 *
 * **Enrolling and drawing are each a round trip through two parties**, which
 * is the part no schema could tell us and the part most likely to surprise:
 *
 * 1. the agent builds a request (`root-request` / `tokens/request`) — it holds
 *    the key, so only it can blind anything;
 * 2. the phone carries that request to the **community**
 *    (`vtc/vetting/vetters/pcs-root` / `pcs-tokens`);
 * 3. the phone hands the community's answer back to the agent
 *    (`root-accept` / `tokens/accept`), which unblinds and keeps the result.
 *
 * Note what upstream's TUI is and is not a model for here. It performs the
 * same ceremony, but it holds the PCS key itself and calls `vetter_start`
 * locally; our agent holds the key, which is the whole point of upstream's
 * #487. So its *flow* is a reference and its *sequencing* is not.
 *
 * @module trust-tasks/module/hiddenVetterAdapter
 */
import type { Agent } from '@credo-ts/core'

import type {
  HiddenVetterRequest,
  HiddenVetterSeam,
  HiddenVetterStanding,
  HiddenVetterStatement,
} from '../screens/hiddenVetterSeam'
import { registerHiddenVetter } from '../screens/hiddenVetterSeam'

import { GenericRecordsCommunityStore } from './VtiCommunityStore'
import { GenericRecordsIdentityStore } from './VtiIdentityStore'
import {
  boundElsewhere,
  connectedVetterClient as connected,
  currentHiddenCriterion,
  drawVetterTokens,
  enrolVetter,
  loadVetterRecord as loadRecord,
  nextTickOpensAt,
  nowMs,
  publishedOf,
  tickMillis,
  vetterContextOf as contextOf,
} from './hiddenVetterRounds'
import type { VtiCriterion } from './joinManifest'
import { GenericRecordsVettingStore, VtiVetterDesk } from './vtiVetting'

export { tickMillis }

/**
 * Which community a request belongs to, from the desk's own store.
 *
 * The seam names a request by id alone, so the community has to be looked up
 * rather than passed — and the lookup is the store's, not a guess.
 */
async function communityOfRequest(agent: Agent, requestId: string): Promise<string> {
  const desk = await new GenericRecordsVettingStore(agent).listDesk()
  const found = desk.find((r) => r.requestId === requestId)
  if (!found) {
    throw Object.assign(new Error(`no request ${requestId} on this phone`), {
      code: 'keyring/hidden-vetter:noSuchRequest',
    })
  }
  return found.communityDid
}

/** The community's hidden criterion as it serves it now, for the parameters and the current digest. */
async function hiddenCriterionOf(agent: Agent, communityDid: string): Promise<VtiCriterion> {
  const criterion = await currentHiddenCriterion(agent, communityDid)
  if (!criterion) {
    throw Object.assign(new Error('this community publishes no hidden criterion'), {
      code: 'keyring/hidden-vetter:notHiddenCommunity',
    })
  }
  return criterion
}

/** A desk for this community's persona, built from the stores the screens use. */
async function deskFor(agent: Agent, communityDid: string): Promise<VtiVetterDesk> {
  const persona = await new GenericRecordsIdentityStore(agent).getPersona(communityDid)
  if (!persona) {
    throw Object.assign(new Error('no persona for this community'), {
      code: 'keyring/hidden-vetter:noPersona',
    })
  }
  return new VtiVetterDesk(
    agent,
    persona,
    new GenericRecordsVettingStore(agent),
    new GenericRecordsCommunityStore(agent)
  )
}

const seam: HiddenVetterSeam = {
  async standing(agent, communityDid, criterion): Promise<HiddenVetterStanding> {
    const parameters = publishedOf(criterion)
    const client = await connected(agent)
    const contextId = await contextOf(client)
    const vetter = await client.showPcsVetter({ contextId, community: communityDid })
    const record = await loadRecord(agent, communityDid)
    const persona = await new GenericRecordsIdentityStore(agent).getPersona(communityDid)

    const period = parameters?.vetterLabels?.[0]
    const tokenLabel = parameters?.tokenLabels?.[0]
    // The community's schedule, not the phone's: tick windows begin at 00:00Z
    // on the label's first day, so when the next one opens is known whether
    // or not this phone has drawn before.
    const nextDrawAt = parameters ? nextTickOpensAt(parameters, nowMs()) : undefined
    const lapsesAt = nextDrawAt
    const stuck = boundElsewhere(vetter, persona)

    return {
      // An engine bound to another DID holds labels it can never draw from:
      // not enrolled for anything this vetter can do, and said as stuck.
      enrolled: !stuck && Boolean(period && vetter?.enrolledLabels?.includes(period)),
      ...(stuck ? { stuck: 'memberMismatch' as const } : {}),
      ...(period ? { period } : {}),
      tokens: vetter?.tokensFree ?? 0,
      ...(tokenLabel ? { tokenLabel } : {}),
      ...(record?.lastDrawAt ? { lastDrawAt: record.lastDrawAt } : {}),
      ...(nextDrawAt ? { nextDrawAt } : {}),
      ...(lapsesAt ? { lapsesAt } : {}),
      // `enrolledUntil` is deliberately absent: the agent reports labels and
      // no expiry, and parsing a date out of "vetter/2026-10" would present an
      // inference as a fact.
    }
  },

  async enrol(agent, communityDid, criterion) {
    await enrolVetter(agent, communityDid, criterion)
  },

  async drawTokens(agent, communityDid, criterion) {
    return drawVetterTokens(agent, communityDid, criterion)
  },

  async requests(agent, communityDid): Promise<HiddenVetterRequest[]> {
    // The desk marks a request private when it arrives carrying the
    // hidden-vetting ext, so the queue is its own and never a filter over the
    // named one.
    const desk = await deskFor(agent, communityDid)
    const open = await desk.hiddenRequests(communityDid)
    return open.map((r) => ({
      id: r.requestId,
      applicantDid: r.applicantDid,
      receivedAt: r.receivedAt,
      ...(r.preferredMethod ? { method: r.preferredMethod } : {}),
      // No applicantName: the desk holds none, and inventing one from a DID
      // would be worse than the screen saying nothing.
    }))
  },

  async attest(agent, requestId, statement: HiddenVetterStatement) {
    const communityDid = await communityOfRequest(agent, requestId)
    const desk = await deskFor(agent, communityDid)
    const criterion = await hiddenCriterionOf(agent, communityDid)
    const parameters = publishedOf(criterion)
    if (!parameters) {
      throw Object.assign(new Error('this community no longer publishes hidden vetting'), {
        code: 'keyring/hidden-vetter/attest:noParameters',
      })
    }

    const client = await connected(agent)
    const contextId = await contextOf(client)

    await desk.attestHidden(requestId, statement, async ({ applicantId, meta }) => {
      // The digest the applicant's proof will bind to is the one their
      // application gathered for, which is what the desk puts in `meta`. If
      // the community has since changed the criterion, that proof cannot
      // verify — so attesting would spend one of this vetter's scarce tokens
      // on an application that is already dead. Refuse instead, and say which.
      const current = criterion.requirementsDigest
      if (current && meta.requirementsDigest && current !== meta.requirementsDigest) {
        throw Object.assign(new Error('the community changed what it asks since this application was made'), {
          code: 'keyring/hidden-vetter/attest:requirementsChanged',
        })
      }
      return client.pcsAttest({ contextId, community: communityDid, parameters, applicantId, meta })
    })
  },

  async decline(agent, requestId) {
    const desk = await deskFor(agent, await communityOfRequest(agent, requestId))
    await desk.decline(requestId)
  },
}

registerHiddenVetter(seam)

export { seam as hiddenVetterSeamImplementation }
