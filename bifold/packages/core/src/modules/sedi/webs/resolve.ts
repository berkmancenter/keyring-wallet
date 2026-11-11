/**
 * Verify-only did:webs key state: fetch a did:webs identifier's two published artifacts, replay its KEL with this
 * package's own reader (../cesr, ../guardian/kel: no second KEL verifier), and check that the published did.json
 * carries exactly the keys that KEL implies. Behind the state-verified approvers switch, like the Guardian check.
 *
 * Fail closed, everywhere: any fetch problem, any limit, any mismatch is a refusal with its own reason, and nothing here
 * ever falls back to a copy held elsewhere. What it returns is the AID's verified key state as published at that
 * location; it is NOT a trust decision. Whether that AID is trusted is the caller's root list, as before.
 *
 * Narrower than a full did:webs resolver; ./README.md lists what is not checked (notably designated-alias
 * attestations and witness receipts).
 *
 * @module sedi/webs/resolve
 */
import { isStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { readKelStream } from '../cesr/reader'
import { digest, replayKel, type HistoryEntry, type KeyState } from '../guardian/kel'

import { checkDocument } from './document'
import { artifactUrl, originOf, parseWebsDid, type WebsDid } from './identifier'

/** The parts of a fetch Response this module reads (React Native's and Node's fetch both fit). */
export interface WebsResponse {
  ok: boolean
  status: number
  url?: string
  redirected?: boolean
  headers?: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}
export type WebsFetch = (
  url: string,
  init: { redirect: 'manual'; headers: Record<string, string>; signal?: AbortSignal }
) => Promise<WebsResponse>

export interface WebsLimits {
  /** did.json: a document of one key per current key, a few hundred bytes each. 64 KiB is far above any real one. */
  didJsonBytes: number
  /** keri.cesr: grows by one event per anchoring (DBI §7.2 R6), about 0.4 KiB each. 512 KiB is about a thousand events,
   * well over a demo state's and still a bounded replay on the phone; a state that outgrows it is refused, not cut. */
  keriCesrBytes: number
  timeoutMs: number
}
export const WEBS_LIMITS: WebsLimits = { didJsonBytes: 64 * 1024, keriCesrBytes: 512 * 1024, timeoutMs: 10_000 }

export type WebsRefusalReason =
  | 'switchedOff'
  | 'notWebs'
  | 'notHttps'
  | 'redirectRefused'
  | 'unreachable'
  | 'timeout'
  | 'tooLarge'
  | 'witnessesUnsupported'
  | 'unsupportedCesr'
  | 'malformedCesr'
  | 'kelNotReplaying'
  | 'aidMismatch'
  | 'didDocMismatch'
  | 'aliasMismatch'

export type WebsRefusal = { ok: false; reason: WebsRefusalReason; detail: string }

export interface WebsResolution {
  ok: true
  did: string
  aid: string
  /** The verified current key state, and every event's, as the Guardian check reads a KEL. */
  state: KeyState
  history: HistoryEntry[]
  /** The exact keri.cesr bytes that replayed: the KEL a caller hands on, never re-fetched or rebuilt. */
  kel: Uint8Array
  /** Aliases did.json lists that this package does not verify (designated-alias attestations are not read). */
  unverifiedAliases: string[]
}

const refuse = (reason: WebsRefusalReason, detail: string): WebsRefusal => ({ ok: false, reason, detail })

type Got = { ok: true; bytes: Uint8Array } | WebsRefusal

/** One artifact: HTTPS only, no redirect off the identifier's origin, a timeout and a size cap, 2xx only. */
async function getArtifact(
  fetchFn: WebsFetch,
  id: WebsDid,
  name: 'did.json' | 'keri.cesr',
  cap: number,
  timeoutMs: number
): Promise<Got> {
  const url = artifactUrl(id, name)
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort()
      resolve('timeout')
    }, timeoutMs)
  })
  try {
    const call = (async (): Promise<Got> => {
      let res: WebsResponse
      try {
        res = await fetchFn(url, {
          redirect: 'manual',
          headers: { accept: name === 'did.json' ? 'application/json' : 'application/cesr' },
          ...(controller ? { signal: controller.signal } : {}),
        })
      } catch (e) {
        return refuse('unreachable', `${name}: ${(e as Error)?.message ?? String(e)}`)
      }
      const finalUrl = res.url || url
      if (!finalUrl.startsWith('https://')) return refuse('notHttps', `${name} was served from ${finalUrl}`)
      if ((res.redirected && finalUrl !== url) || !finalUrl.startsWith(originOf(id) + '/'))
        return refuse('redirectRefused', `${name} was redirected to ${finalUrl}`)
      if (res.status >= 300 && res.status < 400)
        return refuse('redirectRefused', `${name} answered a redirect (${res.status})`)
      if (!res.ok) return refuse('unreachable', `${name} answered ${res.status}`)
      const declared = Number(res.headers?.get('content-length') ?? NaN)
      if (Number.isFinite(declared) && declared > cap)
        return refuse('tooLarge', `${name} is ${declared} bytes (cap ${cap})`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.length > cap) return refuse('tooLarge', `${name} is ${bytes.length} bytes (cap ${cap})`)
      return { ok: true, bytes }
    })()
    const first = await Promise.race([call, timedOut])
    return first === 'timeout' ? refuse('timeout', `${name}: no answer within ${timeoutMs} ms`) : first
  } catch (e) {
    return refuse('unreachable', `${name}: ${(e as Error)?.message ?? String(e)}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Resolve `did` to the verified key state of its AID, or refuse. In this order: the switch; the identifier; both
 * artifacts (keri.cesr first, so a KEL problem is reported before a document one); witnesses (refused: receipts are not
 * read); the KEL replay; the AID; the published document against the replayed keys.
 */
export async function resolveWebs(
  did: string,
  options: { fetch: WebsFetch; limits?: Partial<WebsLimits> }
): Promise<WebsResolution | WebsRefusal> {
  if (!isStateVerifiedApproversEnabled()) return refuse('switchedOff', 'state-verified approvers are switched off')
  const limits = { ...WEBS_LIMITS, ...options.limits }
  const parsed = parseWebsDid(did)
  if (!parsed.ok) return refuse('notWebs', parsed.detail)
  const id = parsed.value

  const kel = await getArtifact(options.fetch, id, 'keri.cesr', limits.keriCesrBytes, limits.timeoutMs)
  if (!kel.ok) return kel
  const doc = await getArtifact(options.fetch, id, 'did.json', limits.didJsonBytes, limits.timeoutMs)
  if (!doc.ok) return doc

  // Witness receipts are not read by this package's reader, so a KEL that declares witnesses cannot be verified here.
  // Said as its own reason, before the replay would refuse it as an unsupported feature.
  const frames = readKelStream(kel.bytes)
  if (!frames.ok) return refuse(frames.reason, `keri.cesr: ${frames.detail}`)
  const witnessed = frames.frames.find((f) => f.body.backs.length > 0 || (f.body.bn ?? 0) > 0)
  if (witnessed)
    return refuse(
      'witnessesUnsupported',
      `keri.cesr declares witnesses at sn ${witnessed.body.sn}; Keyring does not read witness receipts yet`
    )

  const replay = replayKel(digest, kel.bytes)
  if (!replay.ok) {
    if (replay.cesr) return refuse(replay.cesr, `keri.cesr: ${replay.reason}`)
    if (replay.limit) return refuse('unsupportedCesr', `keri.cesr: Keyring can't verify this (${replay.reason})`)
    return refuse('kelNotReplaying', `keri.cesr does not replay: ${replay.reason}`)
  }
  if (replay.state.pre !== id.aid)
    return refuse('aidMismatch', `keri.cesr is the KEL of ${replay.state.pre}, not of ${id.aid}`)

  let parsedDoc: unknown
  try {
    parsedDoc = JSON.parse(new TextDecoder().decode(doc.bytes))
  } catch {
    return refuse('didDocMismatch', 'did.json is not JSON')
  }
  const checked = checkDocument(parsedDoc, id, replay.state.keys)
  if (!checked.ok) return refuse(checked.reason, checked.detail)

  return {
    ok: true,
    did: id.did,
    aid: id.aid,
    state: replay.state,
    history: replay.history,
    kel: kel.bytes,
    unverifiedAliases: checked.unverifiedAliases,
  }
}
