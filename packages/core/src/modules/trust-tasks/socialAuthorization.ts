/**
 * The Social Authorization (S2, trusted-approver plan stage 2): the guardian's phone, holding a Guardian card the
 * state issued to ITS OWN holder AID (sedi/holder/controller), issues the person it cares for (the card's own ward) an
 * authorization chained to that card, and sends it with the card (guardian-evidence/0.2, its optional `social` naming it). The
 * person's phone checks it (sedi/guardian verifySocialAuthorization) under the Guardian card's own live verdict, so a
 * card the state revokes takes the authorization with it.
 *
 * What it can honestly say: the authorization was signed by the key the state issued the card to, and it arrived over
 * this relationship, signed by the contact's relationship DID. So the card's holder is on the phone that sent it. It
 * says nothing more than that.
 *
 * Kept on the guardian's phone as one record, overwritten, never deleted: issued once per Guardian card, and only
 * issued again (the old one revoked in the same anchoring event) when the card changes. Behind trusted approvers and
 * state-verified approvers, as the card itself is.
 *
 * @module trust-tasks/socialAuthorization
 */
import type { Agent } from '@credo-ts/core'

import { verifySocialAuthorization } from '../sedi/guardian'
import { type Blinder, type Sad } from '../sedi/guardian/chain'
import {
  blindedState,
  proofOf,
  registryInception,
  registryUpdate,
  sealOf,
  socialAuthorization,
  type Random,
} from '../sedi/guardian/issue'
import { digest } from '../sedi/guardian/kel'
import { trustedStateRoots } from '../sedi/guardian/stateRoots'
import * as holderController from '../sedi/holder/controller'
import { HOLDER_IDENTITY, type ControllerAgent } from '../sedi/holder/controller'

import type { GuardianEvidence, GuardianVerdict } from './guardianEvidence'
import { isStateVerifiedApproversEnabled } from './module/stateVerifiedApproversFlag'
import { isTrustedApproversEnabled } from './module/trustedApproversFlag'

const te = new TextEncoder()
const td = new TextDecoder()
const isOn = () => isTrustedApproversEnabled() && isStateVerifiedApproversEnabled()

/** genericRecords recordType of the authorization this phone issued (one record, overwritten, never deleted). */
export const SOCIAL_AUTHORIZATION = 'keyring.sedi-social-authorization'

/** How long an authorization runs, at most: the Guardian card's own expiry cuts it shorter. */
export const SOCIAL_AUTHORIZATION_DAYS = 30

/** What goes with the card (in guardian-evidence/0.2's lists, named by its `social`): the S2, its registry, the guardian's KEL. */
export interface SocialMaterial {
  said: string
  /** The guardian's own KEL (CESR text): its holder AID, with the events that anchor the registry. */
  kel: string
  tel: { ripText: string; updateTexts: string[] }
  /** The S2 proof: its ACDC text followed by its state disclosure. */
  cred: string
}

/** The issuing side's controller (sedi/holder/controller): passed in so tests can stand in a key they hold. */
export interface HolderController {
  holderKel(agent: ControllerAgent): Promise<Uint8Array>
  appendInteraction(
    agent: ControllerAgent,
    seals: Array<{ i: string; s: string; d: string }>
  ): Promise<{ sn: number; said: string }>
}

interface KeptSocial {
  guardianSaid: string
  holder: string
  ward: string
  said: string
  rd: string
  ripText: string
  updateTexts: string[]
  acdcText: string
  /** The disclosure of the current state ('issued', then 'revoked'). */
  blinder: Blinder
  state: 'issued' | 'revoked'
  issuedAt: string
  expires: string
  revokedAt?: string
}

type Agentish = ControllerAgent & Partial<Pick<Agent, 'config'>>

/**
 * The holder AID this phone already made, read from its record WITHOUT making one (holderCodeOf would make one): a
 * phone holding someone else's card (the K0 fallback) never gets an identity as a side effect of sending it.
 */
async function keptHolderAid(agent: Pick<Agent, 'genericRecords'>): Promise<string | undefined> {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: HOLDER_IDENTITY })) ?? []
  const aid = (record?.content as { aid?: unknown } | undefined)?.aid
  return typeof aid === 'string' && aid.length > 0 ? aid : undefined
}

async function keptOf(agent: Pick<Agent, 'genericRecords'>) {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: SOCIAL_AUTHORIZATION })) ?? []
  const kept = record?.content as unknown as KeptSocial | undefined
  return record && kept?.said ? { record, kept } : undefined
}

/** Overwrite the one record (saved the first time). Never deleted. */
async function keep(agent: Pick<Agent, 'genericRecords'>, content: KeptSocial): Promise<void> {
  const [existing] = (await agent.genericRecords.findAllByQuery({ recordType: SOCIAL_AUTHORIZATION })) ?? []
  if (existing) {
    existing.content = { ...content }
    await agent.genericRecords.update(existing)
  } else {
    await agent.genericRecords.save({ content: { ...content }, tags: { recordType: SOCIAL_AUTHORIZATION } })
  }
}

/** The Guardian credential a card presents (its ACDC, parsed from its proof), or undefined. */
function guardianSadOf(evidence: GuardianEvidence): Sad | undefined {
  for (const text of evidence.creds) {
    try {
      const sad = JSON.parse(text.slice(0, text.lastIndexOf('}') + 1)) as Sad
      if (sad?.d === evidence.guardianSaid) return sad
    } catch {
      // unreadable: not the one
    }
  }
  return undefined
}

/** The end of the authorization: SOCIAL_AUTHORIZATION_DAYS from now, or the card's own expiry if that is sooner. */
function expiryFor(guardian: Sad, now: Date): string {
  const cap = new Date(now.getTime() + SOCIAL_AUTHORIZATION_DAYS * 24 * 60 * 60 * 1000)
  const value = guardian.a?.expirationDate?.value
  const cardEnds = typeof value === 'string' ? new Date(value) : undefined
  return cardEnds && !Number.isNaN(cardEnds.getTime()) && cardEnds < cap ? cardEnds.toISOString() : cap.toISOString()
}

const materialOf = (kept: KeptSocial, kel: Uint8Array): SocialMaterial => ({
  said: kept.said,
  kel: td.decode(kel),
  tel: { ripText: kept.ripText, updateTexts: [...kept.updateTexts] },
  cred: proofOf(kept.acdcText, kept.blinder),
})

/** The revocation of a kept authorization: its next registry update, and the seal that anchors it. */
function revocationOf(kept: KeptSocial, at: string, random: Random) {
  const blinder = blindedState(digest, kept.said, 'revoked', random)
  const prior = (JSON.parse(kept.updateTexts[kept.updateTexts.length - 1]) as { d: string }).d
  const n = kept.updateTexts.length + 1
  const bup = registryUpdate(digest, kept.rd, n, prior, at, blinder.blid)
  return { blinder, bup, seal: sealOf(kept.rd, n, bup.said) }
}

/**
 * The authorization to send with `evidence` (the card this phone holds): the one already issued for this card, or a
 * new one, issued now. Undefined, with nothing issued or anchored, when either switch is off, when the card is not
 * issued to this phone's own holder AID (a K0 card, or no holder made yet), or when the card names no ward. A K0
 * card therefore never carries one, and its payload is unchanged.
 */
export async function socialMaterialFor(
  agent: Agentish,
  evidence: GuardianEvidence,
  controller: HolderController = holderController,
  now: Date = new Date()
): Promise<SocialMaterial | undefined> {
  if (!isOn()) return undefined
  const holder = await keptHolderAid(agent)
  if (!holder || holder !== evidence.holder) return undefined
  const guardian = guardianSadOf(evidence)
  const ward = guardian?.a?.ward
  if (!guardian || guardian.a?.i !== holder || typeof ward !== 'string' || ward.length === 0) return undefined

  const found = await keptOf(agent)
  const kept = found?.kept
  // The same card: the authorization already made goes as it stands, a revoked one with its revocation. A revoke is
  // the guardian's own word, so sending the card again never authorizes the person again.
  if (kept && kept.guardianSaid === evidence.guardianSaid && kept.holder === holder)
    return materialOf(kept, await controller.holderKel(agent))

  const random: Random = (length) => agent.kms.randomBytes({ length })
  const at = now.toISOString()
  const rip = registryInception(digest, holder, at, random)
  const s2 = socialAuthorization(
    digest,
    {
      issuer: holder,
      ward,
      rd: rip.rd,
      guardianSaid: evidence.guardianSaid,
      issued: at,
      expires: expiryFor(guardian, now),
    },
    random
  )
  const blinder = blindedState(digest, s2.sad.d, 'issued', random)
  const bup = registryUpdate(digest, rip.rd, 1, rip.rd, at, blinder.blid)
  // A card that changed: the authorization under the old card is revoked in the same anchoring event.
  const old = kept && kept.state === 'issued' && kept.holder === holder ? revocationOf(kept, at, random) : undefined
  const seals = [...(old ? [old.seal] : []), sealOf(rip.rd, 0, rip.rd), sealOf(rip.rd, 1, bup.said)]
  await controller.appendInteraction(agent, seals)
  const next: KeptSocial = {
    guardianSaid: evidence.guardianSaid,
    holder,
    ward,
    said: s2.sad.d,
    rd: rip.rd,
    ripText: rip.text,
    updateTexts: [bup.text],
    acdcText: s2.text,
    blinder,
    state: 'issued',
    issuedAt: at,
    expires: s2.sad.a?.expires as string,
  }
  await keep(agent, next)
  agent.config?.logger?.info(`[TrustTasks:SocialAuthorization] issued ${next.said} for card ${evidence.guardianSaid}`)
  return materialOf(next, await controller.holderKel(agent))
}

/**
 * Revoke the authorization this phone issued (its next registry update, anchored in its own KEL). The person's
 * phone sees it at its next check of a card sent after this. 'none': nothing issued, or already revoked.
 */
export async function revokeSocialAuthorization(
  agent: Agentish,
  controller: HolderController = holderController,
  now: Date = new Date()
): Promise<'revoked' | 'none' | 'off'> {
  if (!isOn()) return 'off'
  const found = await keptOf(agent)
  if (!found || found.kept.state !== 'issued') return 'none'
  const at = now.toISOString()
  const r = revocationOf(found.kept, at, (length) => agent.kms.randomBytes({ length }))
  await controller.appendInteraction(agent, [r.seal])
  await keep(agent, {
    ...found.kept,
    updateTexts: [...found.kept.updateTexts, r.bup.text],
    blinder: r.blinder,
    state: 'revoked',
    revokedAt: at,
  })
  return 'revoked'
}

/**
 * The card as it goes with its authorization (guardian-evidence/0.2, whose `social` member names only its SAID): the
 * S2 proof, its registry and the guardian's own KEL appended to the card's own lists. Any copy of the holder's KEL the
 * card carried is replaced by the one sent with the authorization (the newest): two KELs for one prefix are refused.
 */
export function withSocial(card: GuardianEvidence, social: SocialMaterial): GuardianEvidence {
  return {
    guardianSaid: card.guardianSaid,
    holder: card.holder,
    kels: [...card.kels.filter((k) => prefixOf(k) !== card.holder), social.kel],
    tels: [...card.tels, social.tel],
    creds: [...card.creds, social.cred],
  }
}

const sadOf = (proof: string): Sad | undefined => {
  try {
    return JSON.parse(proof.slice(0, proof.lastIndexOf('}') + 1)) as Sad
  } catch {
    return undefined
  }
}

const ripSaidOf = (ripText: string): string | undefined => {
  try {
    return (JSON.parse(ripText) as { d?: string }).d
  } catch {
    return undefined
  }
}

/**
 * The reverse, on the person's phone: the card's own evidence, and the authorization named `said` taken out of it (its
 * proof by its SAID, its registry by the proof's `rd`, its issuer's KEL by the proof's issuer). The card is always
 * returned without them, so its own check never reads (or fetches) the guardian's KEL. `material` is undefined when
 * any of the three is not there: the authorization is then refused as incomplete, never checked from part of it.
 */
export function splitSocial(
  evidence: GuardianEvidence,
  said: string
): { card: GuardianEvidence; material?: SocialMaterial } {
  const cred = evidence.creds.find((c) => sadOf(c)?.d === said)
  const sad = cred ? sadOf(cred) : undefined
  const tel = sad?.rd ? evidence.tels.find((t) => ripSaidOf(t.ripText) === sad.rd) : undefined
  const kel = sad?.i ? evidence.kels.find((k) => prefixOf(k) === sad.i) : undefined
  const card: GuardianEvidence = {
    guardianSaid: evidence.guardianSaid,
    holder: evidence.holder,
    kels: evidence.kels.filter((k) => k !== kel),
    tels: evidence.tels.filter((t) => t !== tel),
    creds: evidence.creds.filter((c) => c !== cred),
  }
  return cred && tel && kel ? { card, material: { said, kel, tel, cred } } : { card }
}

/**
 * What the person's phone keeps about an authorization. `ok: true` only from verifySocialAuthorization's valid
 * result, under a Guardian verdict that is itself valid. `underCard`: refused because the Guardian card under it was
 * (revoked, couldn't reach the state, couldn't verify), with that card's own reason.
 */
export type SocialVerdict =
  | { ok: true; root: string; state: string; demo?: true; test?: true; checkedAt: string; expires?: string }
  | { ok: false; reason: string; detail: string; checkedAt: string; underCard?: true }

/** The first prefix a KEL stream's text names (its inception's `i`), or undefined. */
function prefixOf(kel: string): string | undefined {
  return /^\{"v":"[^"]+","t":"icp","d":"[^"]+","i":"([^"]+)"/.exec(kel)?.[1]
}

/**
 * Check the authorization a contact sent with their card, on the person's phone. It stands on the card's own verdict
 * (`guardian`), computed on the same open with the same live fetches, so a revoked card refuses it with the card's
 * reason. It must be issued by the card's holder, name the card, and name this phone's ward. Never throws.
 */
export function checkSocialAuthorization(
  evidence: GuardianEvidence,
  social: SocialMaterial,
  ward: string | null,
  guardian: GuardianVerdict,
  now: Date,
  onThrow: (message: string) => void
): SocialVerdict {
  const checkedAt = now.toISOString()
  const refuse = (reason: string, detail: string): SocialVerdict => ({ ok: false, reason, detail, checkedAt })
  if (guardian.ok !== true)
    return {
      ok: false,
      reason: guardian.reason,
      detail: `the Guardian card under it: ${guardian.detail}`,
      checkedAt,
      underCard: true,
    }
  if (!ward) return refuse('noWard', 'no ward is set on this phone')
  try {
    const sad = JSON.parse(social.cred.slice(0, social.cred.lastIndexOf('}') + 1)) as Sad
    if (sad.d !== social.said) return refuse('notThisAuthorization', 'the credential sent is not the one it names')
    if (sad.i !== evidence.holder) return refuse('notTheHolder', "it was not issued by the card's holder")
    if (sad.e?.guardian?.n !== evidence.guardianSaid) return refuse('notThisCard', 'it stands on another Guardian card')
    // The holder's KEL is the one sent with the authorization (the newest); any copy the card carried is dropped.
    const kels = [...evidence.kels.filter((k) => prefixOf(k) !== evidence.holder), social.kel]
    const r = verifySocialAuthorization(
      {
        kels: kels.map((k) => te.encode(k)),
        tels: [...evidence.tels, social.tel],
        creds: [...evidence.creds, social.cred],
      },
      social.said,
      { ward },
      { trustedRoots: trustedStateRoots().map((root) => root.aid), now }
    )
    if (r.ok !== true) return refuse(r.reason, r.detail)
    return {
      ok: true,
      root: guardian.root,
      state: guardian.state,
      ...(guardian.demo ? { demo: true as const } : {}),
      ...(guardian.test ? { test: true as const } : {}),
      checkedAt,
      ...(r.expires ? { expires: r.expires } : {}),
    }
  } catch (e) {
    const message = `the check stopped on an error: ${(e as Error)?.message ?? String(e)}`
    onThrow(message)
    return refuse('checkFailed', message)
  }
}
