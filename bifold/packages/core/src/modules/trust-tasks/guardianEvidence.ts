/**
 * An approver's state Guardian card, carried to the phone of the person they approve for and checked there
 * (trusted-approver plan, stage 2, S1). Jordan says yes to approving for Sam; if Jordan's phone holds a Guardian card,
 * it sends the chain after the yes (approver/guardian-evidence/0.1, signed under its relationship DID). Sam's phone
 * checks it with sedi/guardian's verifyGuardian against the State roots this build trusts (sedi/guardian/stateRoots)
 * and this phone's ward (its own ward code when the card names it, else the ward set: {@link wardToCheck}), keeps the card and the verdict on the offer's record, and checks it again each
 * time Who approves opens (a card can expire or a root can leave the list).
 *
 * Jordan is asked first (Alberto, 2026-11-11): the card shows Sam Jordan's KERI identifier and the state's record of it,
 * so it goes only once Jordan has said yes to sending it to Sam, an answer asked once per person and kept. Never asked
 * means nothing is sent ({@link guardianCardAfterYes}).
 *
 * Behind both switches: trusted approvers (isTrustedApproversEnabled) and state-verified approvers
 * (isStateVerifiedApproversEnabled), each of which the SEDI/KERI umbrella turns off. Off, nothing is asked, nothing is
 * sent, nothing arriving is read, and nothing is shown.
 *
 * What a verified card says, and no more: a State root on this phone's list names the card's holder as the guardian
 * of this phone's ward. It does not say the contact's phone controls that holder (that waits for the approver's own
 * KERI identity, stage 3), and the ward is a Developer setting, not yet bound to the person (KH-P3).
 *
 * Every record here is changed in place, never deleted.
 *
 * The check on open is memoised for this run of the app only (see {@link guardianStandings}): it runs again whenever
 * anything it reads has moved, and never across a restart or an OTA, so a verdict from older verifier code is never
 * reused.
 *
 * @module trust-tasks/guardianEvidence
 */
import { utils, type Agent } from '@credo-ts/core'
import { EventEmitter } from 'events'

import { verifyGuardian, type ChainMaterial } from '../sedi/guardian'
import { wardNamedIn } from '../sedi/guardian/chain'
import { K0_REVOKED_TEST_GUARDIAN_CARD } from '../sedi/guardian/k0RevokedTestCard'
import { K0_TEST_GUARDIAN_CARD } from '../sedi/guardian/k0TestCard'
import { K0_REVOKED_OMITTED_CARD } from '../sedi/guardian/k0RevokedOmittedCard'
import { K0_TEST_WARD, isDemoStateRoot, k1Root, trustedStateRoots, type StateRoot } from '../sedi/guardian/stateRoots'
import {
  ourRootKelResolver,
  parseWebsDid,
  resolveRootKel,
  type RootKel,
  type RootKelResolver,
  type WebsFetch,
} from '../sedi/webs'
import { checkDesignation, type DesignationCheck } from '../sedi/webs/designatedAliases'
import { demoStateHostProblem, websDidToFetch } from '../sedi/webs/demoStateHost'
import { resetLiveResolutions, resolveRootKelReusing, type LiveRootKel } from '../sedi/webs/lastLive'
import { keptWardCodeOf } from '../sedi/identity/phoneIdentity'

import {
  ROLE_OFFER_ASK,
  approverRoleEvents,
  approvingFor,
  proofUnder,
  relationshipOn,
  writtenAsOf,
  type RoleOfferAsk,
  type RoleOfferPrompt,
} from './approverRole'
import {
  GUARDIAN_EVIDENCE_MAX_BYTES,
  GUARDIAN_EVIDENCE_SPEC,
  GUARDIAN_EVIDENCE_TYPE_URI,
  GUARDIAN_EVIDENCE_V2_SPEC,
  GUARDIAN_EVIDENCE_V2_TYPE_URI,
  type GuardianEvidencePayload,
} from './approverRoleSpec'
import { signDocumentProof } from './documentProof'
import {
  checkSocialAuthorization,
  socialMaterialFor,
  splitSocial,
  withSocial,
  type SocialMaterial,
  type SocialVerdict,
} from './socialAuthorization'
import { isStateVerifiedApproversEnabled } from './module/stateVerifiedApproversFlag'
import { isTrustedApproversEnabled } from './module/trustedApproversFlag'
import { isTrustTestStateEnabled } from './module/trustTestStateFlag'
import type { InboundContext } from './registry'
import type { TrustTasksService } from './services/TrustTasksService'

const LOG_PREFIX = '[TrustTasks:GuardianEvidence]'

/** genericRecords recordType of the Guardian card this phone holds to send (one record, changed in place). */
export const GUARDIAN_EVIDENCE_HELD = 'keyring.sedi-guardian-evidence-held'
/** genericRecords recordType of this phone's ward for Guardian checks (one record, changed in place). */
export const STATE_WARD = 'keyring.sedi-state-ward'
/**
 * genericRecords recordType of this phone's answer to "Also send your Guardian card to <name>?": one record per
 * connection, changed in place, never deleted.
 */
export const GUARDIAN_CARD_CONSENT = 'keyring.sedi-guardian-card-consent'

/** The card itself: the Guardian credential, the holder it names, and the chain to its root. */
export type GuardianEvidence = Pick<GuardianEvidencePayload, 'guardianSaid' | 'holder' | 'kels' | 'tels' | 'creds'>

/**
 * What the last check said. `ok: true` only from verifyGuardian's valid result on a root this build trusts, and its
 * `state` is the name on this phone's list, never one the sender gave, and `demo` is that list entry's demo mark.
 * Every other outcome is a refusal, kept with its reason for the details line and the log.
 */
export type GuardianVerdict =
  | {
      ok: true
      root: string
      state: string
      demo?: true
      /** That list entry's test mark (the K0 preload): a grey "Test" label in place of "Demo". */
      test?: true
      checkedAt: string
      expires?: string
      /** The host the root's KEL was actually fetched from on this check (its did:webs), when it was fetched live. */
      fetchedFrom?: string
      /**
       * Set only when that fetch is our own earlier live result reused because the host just failed (sedi/webs/lastLive,
       * within five minutes): when that earlier fetch was made. Absent on a fresh fetch.
       */
      fetchedAt?: string
      reused?: true
      /**
       * Set only when, besides the root, every issuer in the card's chain was fetched live too (a demo root; the org
       * unit's and issuing agent's histories, where the agent's credential and the card itself are anchored). Absent
       * when only the root's history was fetched and the issuers' came from the card: the screen then says so.
       */
      fetchedIssuers?: true
      /**
       * Set only when the root was fetched from the host the card itself came with (K1 in 'fromCard' mode, stateRoots
       * hostFromCard): the holder's line says "the host the state's QR named", the person's "the host <name>'s card
       * names", never "the state's record".
       */
      hostFromCard?: true
      /** Set when the card came with a host the state does not name (or it could not be told): see HostWithheld. */
      hostWithheld?: HostWithheld
    }
  | { ok: false; reason: string; detail: string; checkedAt: string; hostWithheld?: HostWithheld }

/**
 * A host a card came with that was NOT fetched, because the state root does not designate it (sedi/webs
 * designatedAliases): the card was checked against its own copy instead. `retryable` only for a transient failure to
 * read the designation (unreachable, timeout), never when the check was switched off or the state said no.
 */
export interface HostWithheld {
  host: string
  result: Exclude<DesignationCheck['result'], 'designated'>
  why: string
  retryable: boolean
}

/** Kept on the offer's record (RoleOfferAsk.guardian): the card a contact sent, as whom, and the last verdict. */
export interface GuardianOnAsk {
  approver: string
  evidence: GuardianEvidence
  /** The host the card came with (payload `stateHost`), for a root fetched from the card's host; else absent. */
  stateHost?: string
  receivedAt: string
  verdict: GuardianVerdict
  /**
   * The Social Authorization the contact sent with the card (0.2's `social`), if any: only with a card issued to their
   * own phone. `material` is absent when the document named one but did not carry all of it (refused as incomplete).
   */
  social?: { material?: SocialMaterial; verdict: SocialVerdict }
}

/**
 * What Who approves shows beside an approver: a card from a named state ("Has a Guardian card from <state>"), or could
 * not verify, with the outcome. An approver who sent no card (never asked, or chose not to) has no standing at all, so
 * no line: not sharing is a choice, never shown as a failed check.
 */
/**
 * What Who approves shows for a kept card. `unreachable`: a root on this phone's list publishes its KEL at a did:webs
 * that could not be fetched or checked on this open (`stateNotResolved`), so the card was not checked against it.
 * Kept apart from `unverified` so the screen says "Couldn't reach the state", not that the card failed a check.
 */
export type GuardianStanding =
  | {
      kind: 'verified'
      state: string
      demo?: true
      test?: true
      fetchedFrom?: string
      fetchedAt?: string
      fetchedIssuers?: true
      hostFromCard?: true
      hostWithheld?: HostWithheld
    }
  | { kind: 'unverified'; outcome: string }
  | { kind: 'unreachable'; state: string }

const OFF = 'state-verified approvers are switched off on this phone (Settings › Developer)'
const warn = (agent: Pick<Agent, 'config'>, message: string) => agent.config?.logger?.warn(`${LOG_PREFIX} ${message}`)
const isOn = () => isTrustedApproversEnabled() && isStateVerifiedApproversEnabled()

const te = new TextEncoder()

/** The size the cap reads: kels, tels and creds as UTF-8 JSON. Never throws on a shape it does not expect. */
export function evidenceBytes(
  evidence: Partial<Pick<GuardianEvidence, 'kels' | 'tels' | 'creds'>> | undefined
): number {
  const json = JSON.stringify({ kels: evidence?.kels, tels: evidence?.tels, creds: evidence?.creds })
  return te.encode(json ?? '').length
}

const evidenceOf = (from: GuardianEvidence): GuardianEvidence => ({
  guardianSaid: from.guardianSaid,
  holder: from.holder,
  kels: from.kels,
  tels: from.tels,
  creds: from.creds,
})

/**
 * Check a card against this phone's ward and trusted roots. Never throws, and never returns `ok: true` from a catch:
 * verifyGuardian still throws on an error it does not expect (only unreadable material and unknown digest codes are
 * refusals), and such a throw is a refusal here (`checkFailed`), logged through `onThrow`.
 */
export function checkGuardianEvidence(
  evidence: GuardianEvidence,
  ward: string | null,
  now: Date,
  onThrow: (message: string) => void
): GuardianVerdict {
  return checkWith(evidence, ward, now, onThrow, [])
}

/** The check itself; `resolvedKels` are root KELs already fetched and verified at their did:webs (sedi/webs). */
function checkWith(
  evidence: GuardianEvidence,
  ward: string | null,
  now: Date,
  onThrow: (message: string) => void,
  resolvedKels: Uint8Array[]
): GuardianVerdict {
  const checkedAt = now.toISOString()
  const refuse = (reason: string, detail: string): GuardianVerdict => ({ ok: false, reason, detail, checkedAt })
  if (!ward) return refuse('noWard', 'no ward is set on this phone (Settings › Developer)')
  if (evidenceBytes(evidence) > GUARDIAN_EVIDENCE_MAX_BYTES)
    return refuse('tooLarge', `the card is over ${GUARDIAN_EVIDENCE_MAX_BYTES} bytes`)
  try {
    const roots = trustedStateRoots()
    const material: ChainMaterial = {
      kels: evidence.kels.map((kel) => te.encode(kel)),
      tels: evidence.tels.map((tel) => ({ ripText: tel.ripText, updateTexts: [...tel.updateTexts] })),
      creds: [...evidence.creds],
    }
    const result = verifyGuardian(
      material,
      evidence.guardianSaid,
      { holder: evidence.holder, ward },
      { trustedRoots: roots.map((root) => root.aid), now, resolvedKels }
    )
    if (result.ok !== true) return refuse(result.reason, result.detail)
    const root = roots.find((known) => known.aid === result.root)
    if (!root) return refuse('untrustedRoot', `root ${result.root} is not on this phone's list`)
    return {
      ok: true,
      root: root.aid,
      state: root.name,
      ...(root.demo ? { demo: true as const } : {}),
      ...(root.test ? { test: true as const } : {}),
      checkedAt,
      ...(result.expires ? { expires: result.expires } : {}),
    }
  } catch (e) {
    const message = `the check stopped on an error: ${(e as Error)?.message ?? String(e)}`
    onThrow(message)
    return refuse('checkFailed', message)
  }
}

/** The one record of `recordType`, its content replaced; saved the first time. */
/**
 * One open's did:webs resolutions, by DID: each root is fetched at most once per open, however many cards name it.
 * Past the open, only our own last SUCCESSFUL live result is kept, for five minutes (sedi/webs/lastLive); a failure is
 * never remembered, and so never stands in for a later check.
 */
export type WebsResolves = Map<string, Promise<RootKel | LiveRootKel>>

/**
 * Which resolver a check uses: one passed in, else ours over a passed-in fetch, else the app-wide seam
 * (sedi/webs resolveRootKel, which the VTI maintainer's resolver replaces). Nothing here calls resolveWebs directly.
 */
const resolverFor = (deps: { fetch?: WebsFetch; resolveRootKel?: RootKelResolver }): RootKelResolver =>
  deps.resolveRootKel ?? (deps.fetch ? ourRootKelResolver(deps.fetch) : resolveRootKel)

/**
 * The roots on this phone's list that this card names (no other can be its root) and that are fetched at a did:webs
 * now, each with the did:webs to fetch: a real root's own; a demo root's with the Developer "Demo state host" in place
 * of its host, or none when no host is in effect (sedi/webs/demoStateHost, read at each call).
 */
function websRootsFor(
  evidence: GuardianEvidence,
  roots: StateRoot[],
  stateHost?: string
): (StateRoot & { webs: string })[] {
  const said = JSON.stringify([evidence.kels, evidence.tels, evidence.creds])
  return roots.flatMap((r) => {
    if (!said.includes(r.aid)) return []
    const webs = r.hostFromCard ? websFromCardHost(r, stateHost) : websDidToFetch(r)
    return webs ? [{ ...r, webs }] : []
  })
}

/**
 * Why a host a card came with is not even a host, or null when it is one: a bare public hostname, by the Developer
 * "Demo state host" field's own rules (no path, no address, no local name). Such a host refuses the check outright; it
 * is never read past. Whether the STATE names it is a separate, network question ({@link designationFor}).
 */
export function cardStateHostProblem(_root: Pick<StateRoot, 'aid'>, host: string): string | null {
  return demoStateHostProblem(host)
}

/** The designation check a Guardian check uses: the real one, or one a row passes in. */
export type DesignationCheckFn = (rootAid: string, host: string, fetchImpl?: WebsFetch) => Promise<DesignationCheck>

/**
 * Whether the state root names `host` as one of its own (its designated-aliases file there, checked against its live
 * KEL there: sedi/webs designatedAliases). Only 'designated' lets the host be fetched; every other answer withholds it,
 * and the card is checked against its own copy, said so.
 */
async function designationFor(
  root: StateRoot,
  host: string,
  deps: { fetch?: WebsFetch; checkDesignation?: DesignationCheckFn }
): Promise<DesignationCheck> {
  return (deps.checkDesignation ?? checkDesignation)(root.aid, host.toLowerCase(), deps.fetch)
}

/** A designation answer that can come out differently if asked again soon: a failure to read, never a "no". */
const transient = (d: DesignationCheck) =>
  d.result === 'unreachable' && (d.why === 'unreachable' || d.why === 'timeout')

/** A 'fromCard' root's did:webs with the card's host in place of its placeholder host; none without a usable host. */
function websFromCardHost(root: StateRoot, stateHost?: string): string | undefined {
  if (!root.webs || !stateHost || cardStateHostProblem(root, stateHost) !== null) return undefined
  const parsed = parseWebsDid(root.webs)
  if (!parsed.ok || parsed.value.aid !== root.aid) return undefined
  return ['did:webs', stateHost.toLowerCase().replace(':', '%3A'), ...parsed.value.path, parsed.value.aid].join(':')
}

/** A 'fromCard' root this card names, given a host that is refused: the check must refuse rather than read the copy. */
function refusedCardHost(evidence: GuardianEvidence, roots: StateRoot[], stateHost?: string): StateRoot | undefined {
  if (stateHost === undefined) return undefined
  const said = JSON.stringify([evidence.kels, evidence.tels, evidence.creds])
  return roots.find((r) => r.hostFromCard && said.includes(r.aid) && cardStateHostProblem(r, stateHost) !== null)
}

/**
 * The issuers of the credentials a card presents, other than `root`: for the K0 chain the org unit (who issued the
 * agent credential) and the issuing agent (who issued the Guardian card). A credential's revocation is anchored in its
 * issuer's key history, so these are the histories that say whether the card or its agent was revoked. A credential
 * whose text cannot be read is skipped here; the check itself refuses it.
 */
function chainIssuersOf(evidence: GuardianEvidence, root: string): string[] {
  const issuers = new Set<string>()
  for (const text of evidence.creds) {
    try {
      const i = (JSON.parse(text.slice(0, text.lastIndexOf('}') + 1)) as { i?: unknown }).i
      if (typeof i === 'string' && i !== root) issuers.add(i)
    } catch {
      // unreadable: the chain check refuses it
    }
  }
  return [...issuers]
}

/**
 * The did:webs of an intermediate in a DEMO root's chain: the root's fetched did:webs (host and path as fetched) with
 * the intermediate's AID in place of the root's. The demo publishes the whole K0 chain under one path on one host.
 */
const intermediateDid = (rootDid: string, aid: string) => rootDid.slice(0, rootDid.lastIndexOf(':') + 1) + aid

/**
 * The check, with every listed root the card names that publishes at a did:webs read from there first. If one does
 * not resolve, the verdict is `stateNotResolved` (its own reason; never the card's own copy instead). With no such
 * root it is exactly {@link checkGuardianEvidence}. Never throws, and never returns `ok: true` from a catch.
 *
 * For a DEMO root (isDemoStateRoot, read live) the chain's INTERMEDIATES are fetched too, from the same host and path:
 * the org unit's and the issuing agent's key histories, where the agent's credential and the Guardian card itself are
 * anchored, issued and revoked. So a card whose own copy leaves out its revocation is refused when the published
 * history anchors it: `revokedInIssuerRecord` ("The issuer's published record shows it was revoked") when an issuer's
 * history carried the seal, `revokedInStateRecord` ("The state's published record…") when the root's own did. An
 * intermediate that cannot be fetched refuses as `stateNotResolved`, never the card's copy instead. A REAL root's
 * intermediates are not fetched: only the root publishes at a did:webs on our list, so for a real state this still
 * reads the issuers' histories from the card (a real state's units and agents would need their own did:webs).
 */
export type GuardianCheckDeps = {
  fetch?: WebsFetch
  resolveRootKel?: RootKelResolver
  resolves?: WebsResolves
  /** The host the card came with (K1 'fromCard'): fetched only if the state names it. */
  stateHost?: string
  checkDesignation?: DesignationCheckFn
}

export async function checkGuardianEvidenceResolving(
  evidence: GuardianEvidence,
  ward: string | null,
  now: Date,
  onThrow: (message: string) => void,
  deps: GuardianCheckDeps = {}
): Promise<GuardianVerdict> {
  const checkedAt = now.toISOString()
  try {
    // A host the card came with that is not a host at all (a path, an address, a local name) refuses the check: it is
    // never read past, and never replaced by the card's own copy.
    const badHost = refusedCardHost(evidence, trustedStateRoots(), deps.stateHost)
    if (badHost)
      return {
        ok: false,
        reason: 'stateHostRefused',
        detail: `${badHost.name}: the card's host ${deps.stateHost} is ${cardStateHostProblem(badHost, deps.stateHost as string)}`,
        checkedAt,
      }
    // A host the card came with is fetched only if the state names it; otherwise the copy is checked, and said so.
    const fromCard = cardHostRoot(evidence, trustedStateRoots())
    let liveHost = deps.stateHost
    let withheld: HostWithheld | undefined
    if (fromCard && deps.stateHost) {
      const d = await designationFor(fromCard, deps.stateHost, deps)
      if (d.result !== 'designated') {
        liveHost = undefined
        withheld = { host: deps.stateHost, result: d.result, why: d.why, retryable: transient(d) }
      }
    }
    const verdict = await checkResolving(evidence, ward, now, onThrow, { ...deps, stateHost: liveHost })
    return withheld ? { ...verdict, hostWithheld: withheld } : verdict
  } catch (e) {
    const message = `the check stopped on an error: ${(e as Error)?.message ?? String(e)}`
    onThrow(message)
    return { ok: false, reason: 'checkFailed', detail: message, checkedAt }
  }
}

/** The 'fromCard' root (K1) a card names, if it names one. */
function cardHostRoot(evidence: GuardianEvidence, roots: StateRoot[]): StateRoot | undefined {
  const said = JSON.stringify([evidence.kels, evidence.tels, evidence.creds])
  return roots.find((r) => r.hostFromCard && said.includes(r.aid))
}

/** The check itself, with the host already decided (a host the state names, or none). */
async function checkResolving(
  evidence: GuardianEvidence,
  ward: string | null,
  now: Date,
  onThrow: (message: string) => void,
  deps: GuardianCheckDeps
): Promise<GuardianVerdict> {
  const checkedAt = now.toISOString()
  try {
    const roots = websRootsFor(evidence, trustedStateRoots(), deps.stateHost)
    if (!ward || roots.length === 0) return checkWith(evidence, ward, now, onThrow, [])
    const resolves = deps.resolves ?? new Map()
    const resolvedKels: Uint8Array[] = []
    // The roots' own published histories, apart: a revocation found live is named by WHICH history carried it.
    const rootKels: Uint8Array[] = []
    const fetchedFrom = new Map<string, string>()
    const reusedFrom = new Map<string, string>()
    // The roots whose chain issuers were fetched live too (demo roots); for any other, the issuers came from the card.
    const issuersFetched = new Set<string>()
    for (const root of roots) {
      const did = root.webs
      let pending = resolves.get(did)
      if (!pending) {
        pending = resolveRootKelReusing(did, resolverFor(deps), now)
        resolves.set(did, pending)
      }
      const r = await pending
      if (!r.ok)
        return { ok: false, reason: 'stateNotResolved', detail: `${root.name}: ${r.reason}: ${r.detail}`, checkedAt }
      if (r.aid !== root.aid)
        return {
          ok: false,
          reason: 'stateNotResolved',
          detail: `${root.name}: its did:webs names another AID`,
          checkedAt,
        }
      resolvedKels.push(r.kel)
      rootKels.push(r.kel)
      // The host of the DID that was fetched, so the screen names where it came from, never a host it did not use.
      const parsed = parseWebsDid(did)
      if (parsed.ok) fetchedFrom.set(root.aid, parsed.value.host)
      // A reused earlier result says so, with its time: the screen must not show it as fetched just now.
      if ('reused' in r && r.reused) reusedFrom.set(root.aid, r.fetchedAt)
      if (isDemoStateRoot(root.aid) !== true) continue
      // A demo root: its chain's intermediates from the same host and path, each through the same seam and reuse.
      for (const aid of chainIssuersOf(evidence, root.aid)) {
        const idid = intermediateDid(did, aid)
        let ipending = resolves.get(idid)
        if (!ipending) {
          ipending = resolveRootKelReusing(idid, resolverFor(deps), now)
          resolves.set(idid, ipending)
        }
        const ir = await ipending
        if (!ir.ok)
          return {
            ok: false,
            reason: 'stateNotResolved',
            detail: `${root.name}: issuer ${aid}: ${ir.reason}: ${ir.detail}`,
            checkedAt,
          }
        if (ir.aid !== aid)
          return {
            ok: false,
            reason: 'stateNotResolved',
            detail: `${root.name}: the did:webs for issuer ${aid} names another AID`,
            checkedAt,
          }
        resolvedKels.push(ir.kel)
        // The oldest reused fetch in the chain is the one the screen names: the result is no fresher than that.
        if ('reused' in ir && ir.reused) {
          const was = reusedFrom.get(root.aid)
          if (!was || ir.fetchedAt < was) reusedFrom.set(root.aid, ir.fetchedAt)
        }
      }
      issuersFetched.add(root.aid)
    }
    // The full check runs on the KEL either way, fresh or reused, with today's ward, roots and card text.
    const verdict = checkWith(evidence, ward, now, onThrow, resolvedKels)
    // A status the card's own copy does not show, but the published histories do, is a revocation the card left out,
    // apart from a card that carries its own revocation ('revoked'). It is named by the history that carried it: the
    // state root's own (the org unit's credential: "The state's published record…") or an issuer's in its chain (the
    // agent's or the Guardian card itself: "The issuer's published record…").
    if (verdict.ok !== true && verdict.reason === 'statusNotCurrent') {
      const ownCopy = checkWith(evidence, ward, now, onThrow, [])
      if (ownCopy.ok === true || ownCopy.reason !== 'statusNotCurrent') {
        const rootOnly = checkWith(evidence, ward, now, onThrow, rootKels)
        const fromRoot = rootOnly.ok !== true && rootOnly.reason === 'statusNotCurrent'
        return { ...verdict, reason: fromRoot ? 'revokedInStateRecord' : 'revokedInIssuerRecord' }
      }
    }
    const host = verdict.ok === true ? fetchedFrom.get(verdict.root) : undefined
    if (!host || verdict.ok !== true) return verdict
    const at = reusedFrom.get(verdict.root)
    const fromCard = roots.find((r) => r.aid === verdict.root)?.hostFromCard === true
    return {
      ...verdict,
      fetchedFrom: host,
      ...(fromCard ? { hostFromCard: true as const } : {}),
      ...(at ? { fetchedAt: at, reused: true as const } : {}),
      ...(issuersFetched.has(verdict.root) ? { fetchedIssuers: true as const } : {}),
    }
  } catch (e) {
    const message = `the check stopped on an error: ${(e as Error)?.message ?? String(e)}`
    onThrow(message)
    return { ok: false, reason: 'checkFailed', detail: message, checkedAt }
  }
}

async function keepOne(agent: Pick<Agent, 'genericRecords'>, recordType: string, content: object): Promise<void> {
  const [existing] = (await agent.genericRecords.findAllByQuery({ recordType })) ?? []
  if (existing) {
    existing.content = { ...content }
    await agent.genericRecords.update(existing)
  } else {
    await agent.genericRecords.save({ content: { ...content }, tags: { recordType } })
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The approver's phone (Jordan)

/**
 * Hold a Guardian card on this phone, to send after a yes (Developer setting: there is no wallet flow that receives a
 * card yet). Refused over the cap, so a card that cannot go is never kept.
 */
export async function holdGuardianEvidence(
  agent: Pick<Agent, 'genericRecords'>,
  evidence: GuardianEvidence,
  options: { stateHost?: string } = {}
): Promise<'held' | 'tooLarge'> {
  if (evidenceBytes(evidence) > GUARDIAN_EVIDENCE_MAX_BYTES) return 'tooLarge'
  // The host the card came with (a state office's QR, K1 'fromCard'), kept with it; any other card replaces it, so a
  // card held from the Developer settings never carries a host it did not come with.
  await keepOne(agent, GUARDIAN_EVIDENCE_HELD, {
    ...evidenceOf(evidence),
    ...(options.stateHost ? { stateHost: options.stateHost } : {}),
    heldAt: new Date().toISOString(),
  })
  return 'held'
}

/** The host the held card came with (K1 'fromCard'), if it came with one. */
export async function heldGuardianStateHost(agent: Pick<Agent, 'genericRecords'>): Promise<string | undefined> {
  return (await heldGuardianCard(agent))?.stateHost
}

/** The held card and the host it came with (K1 'fromCard'), in one read of its record. */
export async function heldGuardianCard(
  agent: Pick<Agent, 'genericRecords'>
): Promise<{ evidence: GuardianEvidence; stateHost?: string } | undefined> {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_EVIDENCE_HELD })) ?? []
  const content = record?.content as unknown as (GuardianEvidence & { stateHost?: unknown }) | undefined
  if (!content?.guardianSaid) return undefined
  return {
    evidence: evidenceOf(content),
    ...(typeof content.stateHost === 'string' ? { stateHost: content.stateHost } : {}),
  }
}

/** The card this phone holds to send, if any. */
export async function heldGuardianEvidence(
  agent: Pick<Agent, 'genericRecords'>
): Promise<GuardianEvidence | undefined> {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_EVIDENCE_HELD })) ?? []
  const held = record?.content as unknown as GuardianEvidence | undefined
  return held?.guardianSaid ? evidenceOf(held) : undefined
}

/**
 * Hold no card on this phone (Developer setup "as the person": the person's phone holds no card, so no state card
 * shows there). The held record is overwritten with no card in it, never deleted, exactly as holding another card
 * replaces it; heldGuardianEvidence then finds none. Cards already sent stay with whoever has them.
 */
export async function holdNoGuardianEvidence(agent: Pick<Agent, 'genericRecords'>): Promise<void> {
  const [existing] = (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_EVIDENCE_HELD })) ?? []
  if (existing) await keepOne(agent, GUARDIAN_EVIDENCE_HELD, { noneSince: new Date().toISOString() })
}

export type EvidenceSendResult = 'sent' | 'off' | 'none' | 'tooLarge' | 'noRelationship'

/**
 * After a yes as `approverDid` to approve for the agent `agentDid`: send the card this phone holds to the contact on
 * `connectionId`. Nothing goes with either switch off or no card held, or over the cap.
 */
export async function sendGuardianEvidence(
  agent: Agent,
  connectionId: string,
  agentDid: string,
  approverDid: string
): Promise<EvidenceSendResult> {
  if (!isOn()) return 'off'
  const held = await heldGuardianEvidence(agent)
  if (!held) return 'none'
  if (evidenceBytes(held) > GUARDIAN_EVIDENCE_MAX_BYTES) {
    warn(agent, `the card held here is over ${GUARDIAN_EVIDENCE_MAX_BYTES} bytes; not sent on ${connectionId}`)
    return 'tooLarge'
  }
  const relationship = await relationshipOn(agent, connectionId)
  if (!relationship) return 'noRelationship'
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return 'noRelationship'

  // The authorization this phone's holder issues the card's ward (S2): only for a card issued to this phone's own
  // holder AID, so a K0 card's payload is exactly what older builds accept. A failure to issue one never stops the
  // card: it goes without it, and the person's phone shows the card as before.
  const issued = await socialMaterialFor(agent, held).catch((e: unknown) => {
    warn(agent, `no authorization sent with the card on ${connectionId}: ${(e as Error)?.message ?? e}`)
    return undefined
  })
  const withIt = issued ? withSocial(held, issued) : undefined
  const carried = withIt && evidenceBytes(withIt) <= GUARDIAN_EVIDENCE_MAX_BYTES ? withIt : undefined
  if (issued && !carried) warn(agent, `the card and its authorization are over ${GUARDIAN_EVIDENCE_MAX_BYTES} bytes`)

  const id = utils.uuid()
  // The host goes ONLY with a K1 card, and only as 0.2: a K0 card stays 0.1, exactly what earlier builds send and
  // accept. A phone that knows only 0.1 refuses a 0.2 document by its type (and, today, silently: it answers nothing).
  const k1Card = isK1Card(held)
  const stateHost = k1Card ? await heldGuardianStateHost(agent) : undefined
  // 0.2 for a K1 card or a card carrying its authorization; 0.1 (unchanged) otherwise, so a K0 card is what it was.
  // `carried` cannot widen this to a K0 card: socialMaterialFor returns undefined unless the card's holder is this
  // phone's own holder AID (holder === evidence.holder) AND the Guardian credential is issued to it (a.i === holder),
  // which a K0 card, issued to the kit's own holder, never is. So a K0 card never carries an authorization.
  const v2 = k1Card || !!carried
  const payload: GuardianEvidencePayload = {
    agent: agentDid,
    approver: approverDid,
    ...(carried ?? held),
    // The host the card came with (K1 'fromCard'), so the person's phone fetches the state from the same one.
    ...(stateHost ? { stateHost } : {}),
    sentAt: new Date().toISOString(),
    // 0.2's `social` names the authorization; its proof, registry and the guardian's KEL are in the lists above.
    ...(carried && issued ? { social: { said: issued.said } } : {}),
  }
  const document: Record<string, unknown> = {
    id,
    type: v2 ? GUARDIAN_EVIDENCE_V2_TYPE_URI : GUARDIAN_EVIDENCE_TYPE_URI,
    threadId: id,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    payload,
  }
  const signed = await signDocumentProof(agent, document, relationship.myRelationshipDid as string)
  const { getTrustTasksService, sendTrustTaskDocument } = ceremony()
  await getTrustTasksService(agent).retain(agent.context, signed, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)
  agent.config?.logger?.info(`${LOG_PREFIX} guardian card sent on connection ${connectionId}`)
  return 'sent'
}

/** The ceremony module, reached lazily: it registers this type, so importing it at the top would be a cycle. */
function ceremony(): typeof import('./ceremony') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('./ceremony')
}

// ---------------------------------------------------------------------------------------------------------------
// Asking Jordan first: "Also send your Guardian card to <name>?"

/** This phone's answer for one person: send the card to them, or not. No answer: never asked, and nothing is sent. */
export type CardConsent = 'yes' | 'no'

/**
 * This phone's answer for the contact on `connectionId`, if it gave one.
 *
 * Persisted, on purpose: an answer is the person's decision, not a computation, so it must outlive a restart and an
 * OTA, and a no must never be forgotten into a re-ask until they say yes. (A Guardian verdict is the opposite: it is
 * computed by one version of the checker, so it is never kept as an answer to reuse across an update.)
 *
 * Keyed by the connection, not by a DID. A relationship DID that rotates on the same connection keeps the answer, so
 * a no stays a no. A new connection (a reconnect, which may be another phone or another person) has no answer and is
 * asked again; with no answer nothing is sent, so a re-ask can only withhold.
 */
export async function cardConsentOn(
  agent: Pick<Agent, 'genericRecords'>,
  connectionId: string
): Promise<CardConsent | undefined> {
  const [record] =
    (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_CARD_CONSENT, connectionId })) ?? []
  const answer = (record?.content as { answer?: unknown } | undefined)?.answer
  return answer === 'yes' || answer === 'no' ? answer : undefined
}

/**
 * The state root the answer for `connectionId` was given for (the root of the card held when it was answered), if
 * one was recorded. An answer from before roots were recorded has none.
 */
export async function cardConsentRootOn(
  agent: Pick<Agent, 'genericRecords'>,
  connectionId: string
): Promise<string | undefined> {
  const [record] =
    (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_CARD_CONSENT, connectionId })) ?? []
  const root = (record?.content as { root?: unknown } | undefined)?.root
  return typeof root === 'string' && root.length > 0 ? root : undefined
}

/**
 * Keep this phone's answer for the contact on `connectionId` (changed in place; saved the first time), with the state
 * root of the card it was given for, when known: the question names the state, so the answer is kept for that state.
 */
export async function setCardConsent(
  agent: Pick<Agent, 'genericRecords'>,
  connectionId: string,
  answer: CardConsent,
  root?: string
): Promise<void> {
  const content = { connectionId, answer, answeredAt: new Date().toISOString(), ...(root ? { root } : {}) }
  const [existing] =
    (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_CARD_CONSENT, connectionId })) ?? []
  if (existing) {
    existing.content = { ...content }
    await agent.genericRecords.update(existing)
  } else {
    await agent.genericRecords.save({
      content: { ...content },
      tags: { recordType: GUARDIAN_CARD_CONSENT, connectionId },
    })
  }
}

/** Every answer this phone gave, by connection (for People I approve for). */
export async function cardConsents(agent: Pick<Agent, 'genericRecords'>): Promise<Record<string, CardConsent>> {
  const records = (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_CARD_CONSENT })) ?? []
  const answers: Record<string, CardConsent> = {}
  for (const record of records) {
    const { connectionId, answer } = (record.content ?? {}) as { connectionId?: unknown; answer?: unknown }
    if (typeof connectionId === 'string' && (answer === 'yes' || answer === 'no')) answers[connectionId] = answer
  }
  return answers
}

/** "Also send your Guardian card to <asker>?", waiting for this phone's person. */
export interface CardQuestion {
  connectionId: string
  asker: string
  /** The state named on this phone's own list for the card's root, if it is on the list. */
  state?: string
  /** That list entry's demo mark ("Demo" pill beside the name). */
  demo?: true
  /** That list entry's test mark: the grey "Test" label in place of "Demo". */
  test?: true
}

class CardQuestionStore {
  private questions = new Map<string, CardQuestion>()
  set(question: CardQuestion) {
    this.questions.set(question.connectionId, question)
  }
  take(connectionId: string) {
    this.questions.delete(connectionId)
  }
  first(): CardQuestion | undefined {
    return [...this.questions.values()][0]
  }
  /** Tests only. */
  reset() {
    this.questions.clear()
  }
}

/** The questions asked this run. Not kept: one not answered before a restart is answered on People I approve for. */
export const cardQuestions = new CardQuestionStore()
/** 'question': a question was added or answered. */
export const guardianCardEvents = new EventEmitter()

/**
 * The state this phone's own list names for the card's root, and that entry's demo mark, if the root is on the list;
 * never the card's word.
 */
/** The root on this phone's list the card chains to (its AID found among the card's KELs), if it is on the list. */
function rootAidOf(evidence: GuardianEvidence): string | undefined {
  return trustedStateRoots().find((known) => evidence.kels.some((kel) => kel.includes(`"i":"${known.aid}"`)))?.aid
}

function stateOf(evidence: GuardianEvidence): { state?: string; demo?: true; test?: true } {
  // The same match as rootAidOf: one rule decides whether a card counts as a known state's.
  const aid = rootAidOf(evidence)
  const root = aid ? trustedStateRoots().find((known) => known.aid === aid) : undefined
  if (!root) return {}
  return {
    state: root.name,
    ...(root.demo ? { demo: true as const } : {}),
    ...(root.test ? { test: true as const } : {}),
  }
}

/** The card this phone could share, and the state it is from: none with either switch off or no card held. */
/**
 * Whether a card is K1's (a state office's), for the wire version only: K1's root AID present among the KELs the card
 * carries. That is presence in a carried KEL, not proof of issuance (the check decides that). Credentials are not read:
 * a K0 card whose credentials mention K1's AID still goes as 0.1. Such a card goes as guardian-evidence/0.2.
 */
export function isK1Card(evidence: GuardianEvidence): boolean {
  const k1 = k1Root()
  return !!k1 && evidence.kels.some((kel) => kel.includes(k1.aid))
}

/**
 * The card this phone would send, for the screens: its state, its demo mark, and `k1` when it is K1's (sent as 0.2, so
 * a phone on an older build will not show it; the line says so, and claims nothing about receipt).
 */
export async function cardToShare(
  agent: Pick<Agent, 'genericRecords'>
): Promise<{ state?: string; demo?: true; test?: true; k1?: true } | undefined> {
  if (!isOn()) return undefined
  const held = await heldGuardianEvidence(agent)
  if (!held) return undefined
  return { ...stateOf(held), ...(isK1Card(held) ? { k1: true as const } : {}) }
}

export type CardAfterYesResult = EvidenceSendResult | 'declined' | 'asked' | 'notApproving'

/**
 * After a yes to approve for the contact on `prompt.connectionId`: send the card this phone holds only if its person
 * already said yes to sending it to this contact, for a card from the same state (the question names the state; a
 * yes for another state's card, or one kept before states were, puts the question again for this card's state).
 * Said no: nothing goes, and nothing is asked again. Never asked:
 * nothing goes, and the question is put to the person ({@link cardQuestions}). Either switch off: nothing is asked
 * and nothing goes. The approval itself is never touched here.
 */
export async function guardianCardAfterYes(
  agent: Agent,
  prompt: Pick<RoleOfferPrompt, 'connectionId' | 'agentDid' | 'asker'>,
  approverDid: string
): Promise<CardAfterYesResult> {
  if (!isOn()) return 'off'
  const held = await heldGuardianEvidence(agent)
  if (!held) return 'none'
  const consent = await cardConsentOn(agent, prompt.connectionId)
  // A yes counts only for the state it was given for (the question names it): for another state's card, or a yes
  // kept before states were, the question is put again, naming the held card's state.
  if (consent === 'yes' && (await yesForAnotherState(agent, prompt.connectionId))) return askAgain(agent, prompt)
  if (consent === 'yes') return sendGuardianEvidence(agent, prompt.connectionId, prompt.agentDid, approverDid)
  if (consent === 'no') return 'declined'
  cardQuestions.set({ connectionId: prompt.connectionId, asker: prompt.asker, ...stateOf(held) })
  guardianCardEvents.emit('question', { connectionId: prompt.connectionId })
  return 'asked'
}

/**
 * This phone's person answers "Also send your Guardian card to <name>?" (the question after a yes, or the button on
 * People I approve for): the answer is kept, and a yes sends the card now, for the agent and as the DID of the yes
 * kept here. Either switch off: nothing is kept and nothing goes.
 */
export async function shareGuardianCard(
  agent: Agent,
  connectionId: string,
  send: boolean
): Promise<CardAfterYesResult> {
  if (!isOn()) return 'off'
  const held = await heldGuardianEvidence(agent)
  await setCardConsent(agent, connectionId, send ? 'yes' : 'no', held ? rootAidOf(held) : undefined)
  cardQuestions.take(connectionId)
  guardianCardEvents.emit('question', { connectionId })
  if (!send) return 'declined'
  const yes = (await approvingFor(agent)).find((prompt) => prompt.connectionId === connectionId)
  if (!yes?.answeredAs) return 'notApproving'
  return sendGuardianEvidence(agent, connectionId, yes.agentDid, yes.answeredAs)
}

/** A yes kept for this contact, given for a card from a state other than the held card's (or with no state kept). */
async function yesForAnotherState(agent: Agent, connectionId: string): Promise<boolean> {
  if ((await cardConsentOn(agent, connectionId)) !== 'yes') return false
  const held = await heldGuardianEvidence(agent)
  if (!held) return false
  const root = rootAidOf(held)
  return !root || (await cardConsentRootOn(agent, connectionId)) !== root
}

/** Put "Also send your Guardian card from <state> to <name>?" for the held card's state; nothing goes yet. */
async function askAgain(agent: Agent, prompt: Pick<RoleOfferPrompt, 'connectionId' | 'asker'>): Promise<'asked'> {
  const held = await heldGuardianEvidence(agent)
  cardQuestions.set({ connectionId: prompt.connectionId, asker: prompt.asker, ...(held ? stateOf(held) : {}) })
  guardianCardEvents.emit('question', { connectionId: prompt.connectionId })
  return 'asked'
}

/** What {@link guardianCardAfterKeep} did for one person: the after-a-yes result, or 'failed' when it threw. */
export type CardAfterKeepResult = CardAfterYesResult | 'failed'

/**
 * A card was just kept on this phone (a state office's pick-up, sedi/holder/receiveGuardianCard): offer it to each
 * person this phone already approves for, by exactly the rule after a yes ({@link guardianCardAfterYes}): their
 * earlier yes sends this card only if it was given for a card from the SAME state (its root, kept with the answer),
 * else the question is put again naming this card's state; a no sends nothing and is not asked again; never asked
 * puts the question. So a card picked up AFTER the yes reaches the person with no step
 * on People I approve for (K1 test, 11-14), and never without an answer for its state.
 *
 * One person's send failing never stops the next: it reads 'failed' and is logged. Either switch off: nothing at
 * all. One entry per person, with their name, for the screen to say who it went to.
 */
export async function guardianCardAfterKeep(
  agent: Agent
): Promise<Array<{ connectionId: string; asker: string; result: CardAfterKeepResult }>> {
  const results: Array<{ connectionId: string; asker: string; result: CardAfterKeepResult }> = []
  if (!isOn()) return results
  for (const yes of await approvingFor(agent)) {
    if (!yes.answeredAs) continue
    let result: CardAfterKeepResult
    try {
      result = await guardianCardAfterYes(agent, yes, yes.answeredAs)
    } catch (e) {
      warn(agent, `the kept card was not sent on ${yes.connectionId}: ${(e as Error)?.message ?? e}`)
      result = 'failed'
    }
    results.push({ connectionId: yes.connectionId, asker: yes.asker, result })
  }
  return results
}

// ---------------------------------------------------------------------------------------------------------------
// Developer actions for a tester build: the K0 test card and the K0 test ward

/** What a Developer action did: done, or nothing because "Trust the test state (K0)" (or a switch under it) is off. */
export type TestStateActionResult = 'done' | 'off'

/**
 * Developer action "Hold the test Guardian card (K0)", on an approver's phone: keep the K0 kit's Guardian card as the
 * card this phone sends after a yes. Does nothing unless "Trust the test state (K0)" holds (so trusted approvers and
 * state-verified approvers are both on, and no remote off is set).
 */
export async function holdK0TestGuardianCard(agent: Pick<Agent, 'genericRecords'>): Promise<TestStateActionResult> {
  return (await keepK0TestGuardianCard(agent)) === 'done' ? 'done' : 'off'
}

/**
 * Why holdK0TestGuardianCard did or did not keep the card: 'off' (the test state is not trusted) and 'tooLarge' (the
 * card is over GUARDIAN_EVIDENCE_MAX_BYTES) are different facts, which the one-tap "Set up the SEDI demo" reports
 * apart. holdK0TestGuardianCard keeps its two results for its Developer row; this is not exported from the package.
 */
export type K0CardKeepResult = TestStateActionResult | 'tooLarge'

/** holdK0TestGuardianCard, saying which of 'off' and 'tooLarge' stopped it. */
export async function keepK0TestGuardianCard(agent: Pick<Agent, 'genericRecords'>): Promise<K0CardKeepResult> {
  if (!isTrustTestStateEnabled()) return 'off'
  return (await holdGuardianEvidence(agent, K0_TEST_GUARDIAN_CARD)) === 'held' ? 'done' : 'tooLarge'
}

/**
 * Developer action "Hold the revoked card without its revocation (K0)", on an approver's phone: keep the K0 kit's
 * revoked Guardian card with its revocation left out (sedi/guardian/k0RevokedOmittedCard) as the card this phone sends
 * after a yes, in place of whatever card it held. For the demo of a revocation caught from the state's published
 * record: against its own copy it reads as issued; with a Demo state host in effect, the person's phone fetches the
 * issuing agent's published history and refuses it. Does nothing unless "Trust the test state (K0)" holds.
 */
export async function holdK0RevokedOmittedCard(agent: Pick<Agent, 'genericRecords'>): Promise<K0CardKeepResult> {
  if (!isTrustTestStateEnabled()) return 'off'
  // 'tooLarge' kept apart from 'off' (the same split as keepK0TestGuardianCard): two facts, never one result.
  return (await holdGuardianEvidence(agent, K0_REVOKED_OMITTED_CARD)) === 'held' ? 'done' : 'tooLarge'
}

/**
 * Developer action "Hold the revoked test card (K0)", on an approver's phone: keep the K0 kit's REVOKED Guardian card,
 * carried with its revocation, as the card this phone sends after a yes. The person's phone then refuses it as revoked
 * ("The card shows it was revoked"). It replaces any card held. Does nothing unless "Trust the test state (K0)" holds,
 * exactly as "Hold the test Guardian card (K0)".
 */
export async function holdK0RevokedTestCard(agent: Pick<Agent, 'genericRecords'>): Promise<TestStateActionResult> {
  if (!isTrustTestStateEnabled()) return 'off'
  return (await holdGuardianEvidence(agent, K0_REVOKED_TEST_GUARDIAN_CARD)) === 'held' ? 'done' : 'off'
}

/**
 * Developer action "I'm the test ward (K0)", on the person's phone: set this phone's ward to the K0 kit's ward (Sam),
 * so a K0 card checks as naming it. Does nothing unless "Trust the test state (K0)" holds.
 */
export async function becomeK0TestWard(agent: Pick<Agent, 'genericRecords'>): Promise<TestStateActionResult> {
  if (!isTrustTestStateEnabled()) return 'off'
  await setStateWard(agent, K0_TEST_WARD)
  return 'done'
}

// ---------------------------------------------------------------------------------------------------------------
// The person's phone (Sam)

/**
 * Set this phone's ward for Guardian checks (Developer setting; the K0 kit's is K0_TEST_WARD). A card is checked as
 * naming this AID. Not a binding to the person: that waits for stage 3 (KH-P3).
 */
export async function setStateWard(agent: Pick<Agent, 'genericRecords'>, ward: string): Promise<void> {
  await keepOne(agent, STATE_WARD, { ward, setAt: new Date().toISOString() })
}

/** This phone's ward for Guardian checks, or null when none is set (then no card verifies). */
export async function stateWardOf(agent: Pick<Agent, 'genericRecords'>): Promise<string | null> {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: STATE_WARD })) ?? []
  const ward = (record?.content as { ward?: unknown } | undefined)?.ward
  return typeof ward === 'string' && ward.length > 0 ? ward : null
}

/**
 * This phone's two wards: the one set ({@link stateWardOf}: K0's by "Set up as the person", or its own code by "Use
 * this code on this phone") and its own ward code, if it was made (sedi/identity/phoneIdentity).
 */
export interface PhoneWards {
  set: string | null
  own: string | null
}

export async function phoneWardsOf(agent: Pick<Agent, 'genericRecords'>): Promise<PhoneWards> {
  return { set: await stateWardOf(agent), own: await keptWardCodeOf(agent) }
}

/**
 * The ward a card is checked against: this phone's own ward code when the card names it, so a state office's card
 * for this phone checks with no Developer step, whichever ward is set (K1 test, 11-14: "Set up as the person" had set
 * K0's ward over it). Otherwise the ward set, exactly as before, so a card naming neither is refused as it was
 * ('noWard' or 'wardMismatch'). Only chooses: the check itself still refuses a card naming any other ward.
 */
export function wardToCheck(
  wards: PhoneWards,
  evidence: Pick<GuardianEvidence, 'creds' | 'guardianSaid'>
): string | null {
  if (wards.own !== null && wardNamedIn(evidence.creds, evidence.guardianSaid) === wards.own) return wards.own
  return wards.set
}

/**
 * Set no ward on this phone (Developer setup "as the guardian": the guardian's phone is not the person the card
 * names). The ward record is overwritten with an empty ward, never deleted; stateWardOf then reads null, so no card
 * received here verifies against a SET ward. A card naming this phone's OWN ward code still does (wardToCheck): such
 * a card names this very phone, so it is not shown as naming someone else (decided 11-14 with #1072). A phone has an
 * own ward code only once its codes screen has shown it.
 */
export async function unsetStateWard(agent: Pick<Agent, 'genericRecords'>): Promise<void> {
  const [existing] = (await agent.genericRecords.findAllByQuery({ recordType: STATE_WARD })) ?? []
  if (existing) await keepOne(agent, STATE_WARD, { ward: '', unsetAt: new Date().toISOString() })
}

const dropped = (agent: Agent, connectionId: string, why: string) =>
  warn(agent, `a guardian card on connection ${connectionId} not taken: ${why}`)

/**
 * A contact's Guardian card arrives: refused over the cap before anything else, verified under their relationship
 * DID, then checked and kept with its verdict on the offer this phone sent on that connection (for the agent the
 * offer named). Kept whatever the verdict, so Who approves can say it could not verify; shown only beside the DID the
 * contact said yes as (see {@link guardianStandings}), so a card that overtakes the yes is not lost.
 */
export async function handleGuardianEvidence(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  if (!isOn()) return dropped(agent, context.connectionId, OFF)
  const size = evidenceBytes(document?.payload as GuardianEvidencePayload | undefined)
  if (size > GUARDIAN_EVIDENCE_MAX_BYTES)
    return dropped(agent, context.connectionId, `it is ${size} bytes, over the ${GUARDIAN_EVIDENCE_MAX_BYTES} cap`)
  const relationship = await relationshipOn(agent, context.connectionId)
  if (!relationship)
    return dropped(agent, context.connectionId, 'no relationship with this contact to check it against')
  // Either version this build knows, by the document's own type: 0.2 may carry stateHost (and social); 0.1 never does.
  const v2 = document?.type === GUARDIAN_EVIDENCE_V2_TYPE_URI
  if (!v2 && document?.type !== GUARDIAN_EVIDENCE_TYPE_URI)
    return dropped(agent, context.connectionId, `its type ${String(document?.type)} is not one this build knows`)
  const outcome = await service.consume(agent.context, {
    spec: (v2 ? GUARDIAN_EVIDENCE_V2_SPEC : GUARDIAN_EVIDENCE_SPEC) as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    proofPolicy: proofUnder(agent, relationship.counterpartyRelationshipDid as string),
    handler: async () => undefined,
  })
  if (outcome.kind !== 'accepted' && outcome.kind !== 'handled')
    return dropped(agent, context.connectionId, `it did not pass its check (${outcome.kind})`)

  const payload = document.payload as GuardianEvidencePayload
  const [record] =
    (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK, connectionId: context.connectionId })) ??
    []
  const ask = record?.content as unknown as RoleOfferAsk | undefined
  if (!record || !ask || ask.agentDid !== payload.agent)
    return dropped(agent, context.connectionId, 'it names no offer this phone sent on this connection')

  // 0.2's authorization (named by `social`) is taken out of the card's lists first, so the card's own check never
  // reads, or fetches, the guardian's KEL; 0.1 never carries one.
  const said = v2 && typeof payload.social?.said === 'string' ? payload.social.said : undefined
  const split = said ? splitSocial(evidenceOf(payload), said) : undefined
  const evidence = split ? split.card : evidenceOf(payload)
  // The host the card came with, and only that: never this phone's Developer field, never a host from elsewhere.
  const stateHost = v2 && typeof payload.stateHost === 'string' ? payload.stateHost : undefined
  const ward = wardToCheck(await phoneWardsOf(agent), evidence)
  const verdict = await checkGuardianEvidenceResolving(
    evidence,
    ward,
    new Date(),
    (m) => warn(agent, m),
    stateHost ? { stateHost } : {}
  )
  // The authorization stands on the card's verdict just computed (the same live fetches), never on its own.
  const social = said
    ? split?.material
      ? {
          material: split.material,
          verdict: checkSocialAuthorization(evidence, split.material, ward, verdict, new Date(), (m) => warn(agent, m)),
        }
      : {
          verdict: {
            ok: false as const,
            reason: 'socialIncomplete',
            detail: 'the authorization named was not all there (its proof, registry or the guardian KEL)',
            checkedAt: new Date().toISOString(),
          },
        }
    : undefined
  const guardian: GuardianOnAsk = {
    approver: payload.approver,
    evidence,
    ...(stateHost ? { stateHost } : {}),
    receivedAt: new Date().toISOString(),
    verdict,
    ...(social ? { social } : {}),
  }
  record.content = { ...ask, guardian }
  await agent.genericRecords.update(record)
  agent.config?.logger?.info(
    `${LOG_PREFIX} guardian card kept on connection ${context.connectionId}: ${verdict.ok ? 'valid' : verdict.reason}` +
      (social ? `; authorization ${social.verdict.ok ? 'valid' : social.verdict.reason}` : '')
  )
  approverRoleEvents.emit('answered', { connectionId: context.connectionId, decision: 'guardianCard' })
}

/** The DID a kept card is shown beside: the one written on the agent, or a yes not yet written; else none. */
function shownBeside(ask: RoleOfferAsk, guardian: GuardianOnAsk): string | undefined {
  if (writtenAsOf(ask) === guardian.approver) return guardian.approver
  if (ask.state === 'accepted' && ask.acceptedAs === guardian.approver) return guardian.approver
  return undefined
}

/**
 * What a check on open read, as one string: the ward, the roots this build trusts (AID, the name we show, and whether
 * the root is marked demo: a mark that moves must re-check, or a demo root could show no Demo pill), and the card's
 * exact stored text. Equal strings mean the check would read the same inputs; anything that differs,
 * including a key order that changed, only makes the check run again. The card's text is compared whole, not
 * hashed: a hash would cost more than comparing ~14 KB and could only be less exact.
 */
function checkInputs(evidence: GuardianEvidence, ward: string | null): string {
  const roots = trustedStateRoots()
    .map((root) => JSON.stringify([root.aid, root.name, root.demo === true, root.test === true]))
    .sort()
  return JSON.stringify([ward, roots, evidenceOf(evidence)])
}

/**
 * The last check on open per ask record, for this run of the app only: never stored, so a restart or an OTA that
 * changes the verifier checks every card again, and a verdict computed by older code is never reused.
 */
const lastChecks = new Map<string, { inputs: string; verdict: GuardianVerdict }>()

/**
 * Empty the in-memory memo and the kept live did:webs results (nothing stored is touched): the next open checks each
 * card again and fetches every root fresh, as after a restart.
 * Tests only: rows use it to simulate a restart. Nothing in production calls it, and it is not exported from the package
 * (a real restart empties the memo by itself). Don't wire it anywhere, or delete it as unused while rows use it.
 */
export function resetGuardianCheckMemo(): void {
  lastChecks.clear()
  resetLiveResolutions()
}

/**
 * A verdict that expires is reused only while its expiry is still ahead. The verifier refuses an unreadable expiry
 * (bifold #1031, expiryUnreadable), so a valid verdict always carries a readable expiry or none; if one ever did
 * not, `new Date(x) > now` is false for an unreadable x and the check runs again, which is the safe direction.
 *
 * The time trigger assumes the check reads only the PRESENTED credential's expiry, which is the `expires` a valid
 * verdict carries (sedi/guardian/chain.ts guardianIn; intermediates go through node(), which never reads expiry). If
 * intermediate expiry is ever checked, this must become the earliest expiry across the whole chain.
 */
const stillCurrent = (verdict: GuardianVerdict, now: Date) =>
  verdict.ok !== true || verdict.expires === undefined || new Date(verdict.expires) > now

/**
 * The verdict on open: the memoised one if the check would read exactly the same inputs and it has not expired,
 * else the check run now (and memoised). Reuse only ever returns a verdict the check itself gave for those inputs,
 * so it cannot turn a refusal into valid. The exception: a card whose root publishes at a did:webs is never
 * memoised. It is resolved again on every open (once per open), and "couldn't reach the state" is never reused. A
 * root's rotation or revocation shows on the next open while its host answers; while its host is unreachable, our
 * own last successful fetch (under five minutes old) stands in, so such a change can take up to five minutes to show
 * (sedi/webs/lastLive). Its verdict then says when that fetch was made.
 */
async function verdictNow(
  agent: Agent,
  recordId: string,
  guardian: GuardianOnAsk,
  ward: string | null,
  deps: { fetch?: WebsFetch; resolveRootKel?: RootKelResolver; resolves: WebsResolves }
): Promise<GuardianVerdict> {
  const now = new Date()
  // A card naming a root that publishes at a did:webs is checked against what that root serves now, so it is never
  // memoised: the inputs below do not include the fetched history.
  const stateHost = guardian.stateHost
  if (
    websRootsFor(guardian.evidence, trustedStateRoots(), stateHost).length > 0 ||
    refusedCardHost(guardian.evidence, trustedStateRoots(), stateHost)
  )
    return checkGuardianEvidenceResolving(guardian.evidence, ward, now, (m) => warn(agent, m), {
      ...deps,
      ...(stateHost ? { stateHost } : {}),
    })
  const inputs = checkInputs(guardian.evidence, ward)
  const last = lastChecks.get(recordId)
  if (last && last.inputs === inputs && stillCurrent(last.verdict, now)) return last.verdict
  const verdict = checkGuardianEvidence(guardian.evidence, ward, now, (m) => warn(agent, m))
  lastChecks.set(recordId, { inputs, verdict })
  return verdict
}

/**
 * Which "fetched live" line a verified standing gets, as a translation key (or none: checked from the card's copy).
 * The full line ("Fetched live from <host>…") only when the root AND every issuer in its chain were fetched live
 * (`fetchedIssuers`); with only the root fetched, the line says the issuers' records came from the card. Each has its
 * "at <time>" variant for our own earlier live result reused (sedi/webs/lastLive). One place decides, so the screen
 * and the guard row that holds it read the same answer.
 */
export function guardianSourceKey(
  standing: Extract<GuardianStanding, { kind: 'verified' }>
):
  | 'Approver.GuardianFetchedLive'
  | 'Approver.GuardianFetchedLiveAt'
  | 'Approver.GuardianFetchedRootLive'
  | 'Approver.GuardianFetchedRootLiveAt'
  | 'Approver.GuardianFetchedFromCardHost'
  | 'Approver.GuardianFetchedFromCardHostAt'
  | null {
  if (!standing.fetchedFrom) return null
  // The host the approver's card names is said to be that: never "the state's record", whatever else was fetched.
  if (standing.hostFromCard)
    return standing.fetchedAt ? 'Approver.GuardianFetchedFromCardHostAt' : 'Approver.GuardianFetchedFromCardHost'
  if (standing.fetchedIssuers)
    return standing.fetchedAt ? 'Approver.GuardianFetchedLiveAt' : 'Approver.GuardianFetchedLive'
  return standing.fetchedAt ? 'Approver.GuardianFetchedRootLiveAt' : 'Approver.GuardianFetchedRootLive'
}

/** A verdict as Who approves shows it. `stateNotResolved` has its own kind, named by the root on our list. */
function standingOf(verdict: GuardianVerdict, evidence: GuardianEvidence, stateHost?: string): GuardianStanding {
  if (verdict.ok === true)
    return {
      kind: 'verified',
      state: verdict.state,
      ...(verdict.demo ? { demo: true as const } : {}),
      ...(verdict.test ? { test: true as const } : {}),
      ...(verdict.fetchedFrom ? { fetchedFrom: verdict.fetchedFrom } : {}),
      ...(verdict.fetchedAt ? { fetchedAt: verdict.fetchedAt } : {}),
      ...(verdict.fetchedIssuers ? { fetchedIssuers: true as const } : {}),
      ...(verdict.hostFromCard ? { hostFromCard: true as const } : {}),
      ...(verdict.hostWithheld ? { hostWithheld: verdict.hostWithheld } : {}),
    }
  if (verdict.reason === 'stateNotResolved')
    return { kind: 'unreachable', state: websRootsFor(evidence, trustedStateRoots(), stateHost)[0]?.name ?? '' }
  return { kind: 'unverified', outcome: verdict.reason }
}

const sameVerdict = (a: GuardianVerdict | undefined, b: GuardianVerdict) =>
  !!a &&
  a.ok === b.ok &&
  (a.ok === true && b.ok === true
    ? a.root === b.root &&
      a.state === b.state &&
      a.demo === b.demo &&
      a.test === b.test &&
      a.expires === b.expires &&
      a.fetchedFrom === b.fetchedFrom &&
      a.fetchedAt === b.fetchedAt &&
      // The screen reads it (which "fetched live" line), so a verdict differing only in it is written back.
      a.fetchedIssuers === b.fetchedIssuers &&
      a.hostFromCard === b.hostFromCard &&
      a.hostWithheld?.result === b.hostWithheld?.result &&
      a.hostWithheld?.why === b.hostWithheld?.why
    : a.ok === false && b.ok === false && a.reason === b.reason && a.detail === b.detail)

/**
 * Who approves, on open: each kept card checked again now (expiry, the roots this build trusts, this phone's ward now),
 * by the approver DID it is shown beside. The check runs on the JS thread, so it is memoised for this run of the app
 * (see {@link verdictNow}): it runs again only when the ward, the trusted roots or the card's text moved, or a valid
 * verdict's expiry has come, and always on the first open after a restart. Except for a card whose root publishes
 * at a did:webs: that one is fetched and checked again on EVERY open, never memoised. A verdict that changed is
 * written back in place; if that write fails, the fresh verdict is still what shows. Empty with either switch off,
 * and an approver with no card has no entry.
 */
export async function guardianStandings(
  agent: Agent,
  deps: { fetch?: WebsFetch; resolveRootKel?: RootKelResolver } = {}
): Promise<Record<string, GuardianStanding>> {
  return (await approverCardStandings(agent, deps)).cards
}

/**
 * What Who approves shows for an approver's Social Authorization (S2), beside their card: `authorized` only when the
 * authorization checks out under a card that checks out on this same open; `refused` otherwise, with `underCard` when
 * it was the card under it that failed (revoked, unreachable, couldn't verify), so the screen never says the
 * authorization itself is at fault. An approver who sent none has no entry.
 */
export type SocialStanding =
  | { kind: 'authorized'; state: string }
  | { kind: 'refused'; outcome: string; underCard?: true }

const socialStandingOf = (verdict: SocialVerdict): SocialStanding =>
  verdict.ok === true
    ? { kind: 'authorized', state: verdict.state }
    : { kind: 'refused', outcome: verdict.reason, ...(verdict.underCard ? { underCard: true as const } : {}) }

const sameSocial = (a: SocialVerdict | undefined, b: SocialVerdict) =>
  !!a &&
  a.ok === b.ok &&
  (a.ok === true && b.ok === true
    ? a.root === b.root && a.state === b.state && a.demo === b.demo && a.test === b.test && a.expires === b.expires
    : a.ok === false && b.ok === false && a.reason === b.reason && a.detail === b.detail && a.underCard === b.underCard)

/**
 * {@link guardianStandings}, and beside it each approver's Social Authorization checked on the SAME open, against the
 * card's verdict just computed (never a stored one): the two can never disagree about whether the card stands.
 */
export async function approverCardStandings(
  agent: Agent,
  deps: { fetch?: WebsFetch; resolveRootKel?: RootKelResolver } = {}
): Promise<{ cards: Record<string, GuardianStanding>; social: Record<string, SocialStanding> }> {
  if (!isOn()) return { cards: {}, social: {} }
  const resolves: WebsResolves = new Map()
  const records = (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK })) ?? []
  const wards = await phoneWardsOf(agent)
  const standings: Record<string, GuardianStanding> = {}
  const social: Record<string, SocialStanding> = {}
  for (const record of records) {
    const ask = record.content as unknown as RoleOfferAsk
    const guardian = ask?.guardian
    if (!guardian) continue
    const beside = shownBeside(ask, guardian)
    if (!beside) continue
    const ward = wardToCheck(wards, guardian.evidence)
    const verdict = await verdictNow(agent, record.id, guardian, ward, { ...deps, resolves })
    // Checked again against this open's card verdict; one kept incomplete stays the refusal it was.
    const socialVerdict = guardian.social
      ? guardian.social.material
        ? checkSocialAuthorization(guardian.evidence, guardian.social.material, ward, verdict, new Date(), (m) =>
            warn(agent, m)
          )
        : guardian.social.verdict
      : undefined
    const socialMoved = !!guardian.social && !!socialVerdict && !sameSocial(guardian.social.verdict, socialVerdict)
    if (!sameVerdict(guardian.verdict, verdict) || socialMoved) {
      const kept: GuardianOnAsk = {
        ...guardian,
        verdict,
        ...(guardian.social && socialVerdict ? { social: { ...guardian.social, verdict: socialVerdict } } : {}),
      }
      record.content = { ...ask, guardian: kept }
      await agent.genericRecords
        .update(record)
        .catch((e: unknown) => warn(agent, `could not keep a new verdict: ${(e as Error)?.message ?? e}`))
    }
    standings[beside] = standingOf(verdict, guardian.evidence, guardian.stateHost)
    if (socialVerdict) social[beside] = socialStandingOf(socialVerdict)
  }
  return { cards: standings, social }
}

/**
 * Who approves (B, 11-12): for each approver whose kept card carries the key history (KEL) of a root this phone's
 * list marks demo (isDemoStateRoot), that root's name, by the approver DID it is shown beside, whatever the card's standing (verified,
 * unreachable, revoked, couldn't verify). The screen draws the state's own box, titled with that name and the Demo
 * pill, from it. Read from the list's own entry, never from the card's word or inferred from the name; a card whose
 * root is not on the list, or not demo, has no entry. Empty with either switch off. Runs no check.
 */
async function demoRootsBeside(agent: Pick<Agent, 'genericRecords'>): Promise<Record<string, StateRoot>> {
  if (!isOn()) return {}
  const records = (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK })) ?? []
  const roots = trustedStateRoots().filter((root) => isDemoStateRoot(root.aid))
  const named: Record<string, StateRoot> = {}
  for (const record of records) {
    const ask = record.content as unknown as RoleOfferAsk
    const guardian = ask?.guardian
    if (!guardian) continue
    const beside = shownBeside(ask, guardian)
    if (!beside) continue
    // Matched on the key histories the card carries (kels) only, never on its credentials or registries: a demo
    // root's AID named only as a reference inside `creds` or `tels` gives no name. This is PRESENCE in a carried KEL,
    // not proof the card is anchored at that root; it only labels a box on a Developer-gated demo screen, and the
    // screen shows it only beside a card that checked up to a revocation or whose live fetch failed, never beside
    // any other refusal. Making it structural (one helper with websRootsFor) is backlog (ac, 11-12).
    const kels = JSON.stringify(guardian.evidence.kels)
    const root = roots.find((r) => kels.includes(r.aid))
    if (root) named[beside] = root
  }
  return named
}

export async function guardianDemoStates(agent: Pick<Agent, 'genericRecords'>): Promise<Record<string, string>> {
  const roots = await demoRootsBeside(agent)
  return Object.fromEntries(Object.entries(roots).map(([beside, root]) => [beside, root.name]))
}

/**
 * The approvers {@link guardianDemoStates} names whose root the list marks `test` (the K0 preload): their state box
 * shows the grey "Test" label and the test words in place of "Demo". Read from the list's entry, never the name.
 */
export async function guardianTestStates(agent: Pick<Agent, 'genericRecords'>): Promise<Record<string, true>> {
  const roots = await demoRootsBeside(agent)
  return Object.fromEntries(
    Object.entries(roots)
      .filter(([, root]) => root.test === true)
      .map(([beside]) => [beside, true as const])
  )
}
