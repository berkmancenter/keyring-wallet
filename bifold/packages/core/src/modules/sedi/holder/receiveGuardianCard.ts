/**
 * A Guardian card from a state office, received by its link (a QR the guardian scans, or the pickup page's "Open in
 * Keyring"), checked, and kept as the card this phone sends after a yes. In this order, and refused at the first that
 * fails, with its own reason:
 *
 * 1. the switches (trusted approvers and state-verified approvers; each folds in the SEDI/KERI kill) and K1's root:
 *    'off' while either is off or K1's root AID is a placeholder;
 * 2. K1's host for this build (stateRoots K1_WEBS_HOST): none ('noHost': this build names no host); a fixed host;
 *    or 'fromCard', the host the link itself names, which must be a bare public hostname the root allows
 *    (guardianEvidence cardStateHostProblem: no path, no address, no local name). The Developer "Demo state host" field
 *    never applies here;
 * 3. the URL: exactly https://<that host>/cards/<22-character id>.json, nothing else ('wrongHost'). Never another
 *    host, another path on the same host, a query or a fragment;
 * 4. the fetch: no redirect, a timeout, 2xx only ('unreachable'), and at most GUARDIAN_EVIDENCE_MAX_BYTES ('tooLarge');
 * 5. the file: our card shape ('badCard');
 * 6. the holder: the card must be issued to THIS phone's own holder code ('notForThisPhone'). A card is public, so a
 *    phone that is not its holder keeps nothing: the link is not a secret;
 * 7. the check: the full Guardian check with K1's history fetched live from that same host, ONLY if the state names it
 *    (its designated aliases: 'hostNotNamed' when it does not, 'unreachable' when that cannot be read), the ward being
 *    the one the card names, and the chain ending at K1 ('refused', with the check's own reason);
 * 8. kept (holdGuardianEvidence), in place of any card held before, WITH the host it came from in 'fromCard' mode, so
 *    its later checks, and the person's phone it is sent to, fetch the state from that host only. Nothing is ever
 *    deleted.
 *
 * The verifier and the card store are reached lazily, so the link router and the screens can import this without
 * loading them at start-up.
 *
 * @module sedi/holder/receiveGuardianCard
 */
import type { Agent } from '@credo-ts/core'

import { GUARDIAN_EVIDENCE_MAX_BYTES } from '../../trust-tasks/approverRoleSpec'
import type { GuardianEvidence, GuardianVerdict } from '../../trust-tasks/guardianEvidence'
import { k1FixedHost, k1HostMode, k1Root } from '../guardian/stateRoots'
import { phoneCodesOn } from '../identity/phoneCodesOn'
import type { IdentityAgent } from '../identity/phoneIdentity'

import { holderCodeOf } from './controller'
import type { RootKelResolver } from '../webs'
import type { WebsFetch } from '../webs/resolve'

/** The type tag of a card file a state office publishes. */
export const GUARDIAN_CARD_TYPE = 'keyring.sedi.guardian-card/0.1'

const TIMEOUT_MS = 10_000

export type CardCheckFailure =
  | { kind: 'off' }
  | { kind: 'noHost' }
  | { kind: 'hostNotNamed' }
  | { kind: 'wrongHost' }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'tooLarge' }
  | { kind: 'badCard'; detail: string }
  | { kind: 'notForThisPhone' }
  | { kind: 'refused'; reason: string; detail: string }

/** A card that passed every check, not yet kept. */
export type CardChecked = {
  kind: 'checked'
  evidence: GuardianEvidence
  state: string
  ward: string
  /** The host the card came from, kept with it ('fromCard' mode only). */
  stateHost?: string
  expires?: string
  fetchedFrom?: string
}

export type ReceiveResult = CardCheckFailure | (Omit<CardChecked, 'kind' | 'evidence'> & { kind: 'kept' })

export interface ReceiveDeps {
  /** The fetch for the card file (default: the global fetch). */
  fetchCard?: (url: string, init: { redirect: 'manual'; signal?: AbortSignal }) => Promise<CardResponse>
  /** For the did:webs fetches of the check (see guardianEvidence checkGuardianEvidenceResolving). */
  fetch?: WebsFetch
  resolveRootKel?: RootKelResolver
  /** The designation check (default: sedi/webs designatedAliases checkDesignation). */
  checkDesignation?: import('../../trust-tasks/guardianEvidence').DesignationCheckFn
  now?: Date
  warn?: (message: string) => void
}

/** The parts of a fetch Response read here. */
export interface CardResponse {
  ok: boolean
  status: number
  url?: string
  redirected?: boolean
  headers?: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}

function guardianEvidenceModule(): typeof import('../../trust-tasks/guardianEvidence') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('../../trust-tasks/guardianEvidence')
}

const CARD_URL = /^https:\/\/([^/?#\s]+)\/cards\/([A-Za-z0-9_-]{22})\.json$/

/**
 * Whether `url` may be fetched as a K1 card, and from which host: https://<host>/cards/<22-character id>.json and
 * nothing else, where the host is this build's fixed one, or in 'fromCard' mode the URL's own, if it is a bare public
 * hostname K1 allows. 'noHost' when this build names none.
 */
export function cardUrlHost(
  url: string,
  root: { aid: string }
): { ok: true; host: string; fromCard: boolean } | CardCheckFailure {
  const mode = k1HostMode()
  if (mode === 'none') return { kind: 'noHost' }
  const m = typeof url === 'string' ? CARD_URL.exec(url) : null
  if (!m) return { kind: 'wrongHost' }
  const host = m[1]
  if (mode === 'fixed') return host === k1FixedHost() ? { ok: true, host, fromCard: false } : { kind: 'wrongHost' }
  // 'fromCard': the link names the host. The same rules the check applies to it later, on both phones.
  if (host !== host.toLowerCase() || guardianEvidenceModule().cardStateHostProblem(root, host) !== null)
    return { kind: 'wrongHost' }
  return { ok: true, host, fromCard: true }
}

async function fetchCardBytes(
  url: string,
  deps: ReceiveDeps
): Promise<{ ok: true; bytes: Uint8Array } | CardCheckFailure> {
  const fetchFn = deps.fetchCard ?? (globalThis.fetch as unknown as NonNullable<ReceiveDeps['fetchCard']>)
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<CardCheckFailure>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort()
      resolve({ kind: 'unreachable', detail: `no answer within ${TIMEOUT_MS} ms` })
    }, TIMEOUT_MS)
  })
  const call = (async (): Promise<{ ok: true; bytes: Uint8Array } | CardCheckFailure> => {
    let res: CardResponse
    try {
      res = await fetchFn(url, { redirect: 'manual', ...(controller ? { signal: controller.signal } : {}) })
    } catch (e) {
      return { kind: 'unreachable', detail: (e as Error)?.message ?? String(e) }
    }
    // A redirect is never followed, to anywhere: the card is read from the one URL that was allowed.
    if (res.redirected || (res.url && res.url !== url) || (res.status >= 300 && res.status < 400))
      return { kind: 'unreachable', detail: `the card's address answered a redirect (${res.status})` }
    if (!res.ok) return { kind: 'unreachable', detail: `the card's address answered ${res.status}` }
    const declared = Number(res.headers?.get('content-length') ?? NaN)
    if (Number.isFinite(declared) && declared > GUARDIAN_EVIDENCE_MAX_BYTES) return { kind: 'tooLarge' }
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length > GUARDIAN_EVIDENCE_MAX_BYTES) return { kind: 'tooLarge' }
    return { ok: true, bytes }
  })()
  try {
    return await Promise.race([call, timedOut])
  } catch (e) {
    return { kind: 'unreachable', detail: (e as Error)?.message ?? String(e) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr)

/** The card file as GuardianEvidence, or why it is not one. */
export function readCardFile(
  bytes: Uint8Array
): { ok: true; evidence: GuardianEvidence } | { ok: false; detail: string } {
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  } catch {
    return { ok: false, detail: 'not JSON' }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, detail: 'not an object' }
  if (doc.type !== GUARDIAN_CARD_TYPE) return { ok: false, detail: `type ${String(doc.type)}` }
  const { guardianSaid, holder, kels, tels, creds } = doc
  if (!isStr(guardianSaid) || !isStr(holder)) return { ok: false, detail: 'no guardianSaid or holder' }
  if (!isStrList(kels) || !isStrList(creds) || kels.length === 0 || creds.length === 0)
    return { ok: false, detail: 'no KELs or credentials' }
  if (
    !Array.isArray(tels) ||
    tels.length === 0 ||
    !tels.every(
      (t) =>
        t &&
        typeof t === 'object' &&
        isStr((t as { ripText?: unknown }).ripText) &&
        isStrList((t as { updateTexts?: unknown }).updateTexts)
    )
  )
    return { ok: false, detail: 'no registries' }
  return {
    ok: true,
    evidence: {
      guardianSaid,
      holder,
      kels: [...kels],
      tels: (tels as { ripText: string; updateTexts: string[] }[]).map((t) => ({
        ripText: t.ripText,
        updateTexts: [...t.updateTexts],
      })),
      creds: [...creds],
    } as unknown as GuardianEvidence,
  }
}

/** The ward the card's Guardian credential names, read from its own text (the check confirms it), or undefined. */
export function wardNamedBy(evidence: GuardianEvidence): string | undefined {
  for (const text of evidence.creds) {
    try {
      const acdc = JSON.parse(text.slice(0, text.lastIndexOf('}') + 1)) as { d?: unknown; a?: { ward?: unknown } }
      if (acdc.d === evidence.guardianSaid) return isStr(acdc.a?.ward) ? acdc.a?.ward : undefined
    } catch {
      // unreadable: the check refuses it
    }
  }
  return undefined
}

/** Steps 1 to 7: fetch and check the card a link names, keeping nothing. */
export async function checkGuardianCard(
  agent: IdentityAgent,
  url: string,
  deps: ReceiveDeps = {}
): Promise<CardChecked | CardCheckFailure> {
  const k1 = k1Root()
  if (!k1 || !phoneCodesOn()) return { kind: 'off' }
  const where = cardUrlHost(url, k1)
  if (!('ok' in where)) return where
  const got = await fetchCardBytes(url, deps)
  if (!('ok' in got)) return got
  const file = readCardFile(got.bytes)
  if (!file.ok) return { kind: 'badCard', detail: file.detail }
  let mine: string
  try {
    mine = await holderCodeOf(agent)
  } catch {
    // The switches went off during the fetch (the controller refuses then): nothing is checked or kept.
    return { kind: 'off' }
  }
  if (file.evidence.holder !== mine) return { kind: 'notForThisPhone' }
  const ward = wardNamedBy(file.evidence)
  if (!ward) return { kind: 'badCard', detail: 'no ward named' }
  const verdict: GuardianVerdict = await guardianEvidenceModule().checkGuardianEvidenceResolving(
    file.evidence,
    ward,
    deps.now ?? new Date(),
    deps.warn ?? (() => undefined),
    {
      fetch: deps.fetch,
      resolveRootKel: deps.resolveRootKel,
      checkDesignation: deps.checkDesignation,
      ...(where.fromCard ? { stateHost: where.host } : {}),
    }
  )
  // A link host the state does not name is refused at receipt: the card is not kept from a host the state never named,
  // even though its own copy might check out. A failure to read the designation is a failure to reach, said as one.
  if (verdict.hostWithheld)
    return verdict.hostWithheld.result === 'unreachable'
      ? { kind: 'unreachable', detail: `the state's list of its hosts: ${verdict.hostWithheld.why}` }
      : { kind: 'hostNotNamed' }
  if (verdict.ok !== true) return { kind: 'refused', reason: verdict.reason, detail: verdict.detail }
  // The card must come from the state the link's address belongs to, never another root on this phone's list.
  if (verdict.root !== k1.aid)
    return { kind: 'refused', reason: 'notThisState', detail: `the card's chain ends at ${verdict.root}` }
  return {
    kind: 'checked',
    evidence: file.evidence,
    state: verdict.state,
    ward,
    ...(where.fromCard ? { stateHost: where.host } : {}),
    ...(verdict.expires ? { expires: verdict.expires } : {}),
    ...('fetchedFrom' in verdict && verdict.fetchedFrom ? { fetchedFrom: verdict.fetchedFrom } : {}),
  }
}

/** Steps 1 to 8: fetch, check and keep the card a link names, as the card this phone sends after a yes. */
export async function receiveGuardianCard(
  agent: IdentityAgent & Pick<Agent, 'genericRecords'>,
  url: string,
  deps: ReceiveDeps = {}
): Promise<ReceiveResult> {
  const checked = await checkGuardianCard(agent, url, deps)
  if (checked.kind !== 'checked') return checked
  // Checked again for the switches at the moment of keeping: a kill that landed during the check wins.
  if (!k1Root() || !phoneCodesOn()) return { kind: 'off' }
  const held = await guardianEvidenceModule().holdGuardianEvidence(
    agent,
    checked.evidence,
    checked.stateHost ? { stateHost: checked.stateHost } : {}
  )
  if (held !== 'held') return { kind: 'tooLarge' }
  const { evidence: _evidence, kind: _kind, ...rest } = checked
  return { kind: 'kept', ...rest }
}
