/**
 * Stage 2 S1 (trusted-approver plan): verify a state-issued SEDI Guardian credential, and the Social Authorization a
 * guardian issues from it (S2). A TypeScript port of ref-21's guardian.mjs.
 *
 * What keripy does not check, and so what this adds (keripy 7143832, 2.1.0-dev1): its IPEX grant handler accepts a
 * grant whose disclosed state is 'revoked' (ipexing.py _vetRegistry 1486), never compares a Guardian's `ward` to
 * anyone, never reads `expirationDate`, and keeps no list of trusted roots. Those four decisions are the app's and are
 * made here, each a typed refusal.
 *
 * Expiry is read on the presented credential only, for now (guardianIn / socialIn, through readExpiry): intermediates
 * reached through checkEdge → node() are checked for revoked / not issued, never for expiry. Intermediate expiry is
 * a planned follow-up and needs kit fixtures with expiring intermediates (K0's Guardians expire 2030-11-10;
 * its unit and agent credentials carry no expiry).
 *
 * Every result is { ok: true, ... } or { ok: false, reason, detail }; reasons are stable codes the phone can word.
 *
 * @module sedi/guardian/chain
 */
import { DUMMY, saidOfRaw, type Digest, type Replay } from './kel'

const te = new TextEncoder()
const json = (o: unknown) => JSON.stringify(o)

/** Schema SAIDs of upstream's SEDI test schemas (keripy tests/sedi/test_sedi.py; K0 PROVENANCE.json). Pinned. */
export const SEDI_SCHEMAS = {
  orgUnit: 'EBbOpBe0lP_epHhakeiXdOmeal3leDfLRf0PAItsanoQ',
  issuingAgent: 'EGx4BLclkjhaK1501guyBifxuTTJLwuK61InBTdkKF7v',
  guardian: 'EDJzXg34opr6-odFix6lpiccfHF7ksITHuIES_MQRH4b',
  social: 'EB8MUTKRg8284YPduyhDgUVvNM192-247KcRaXhIxoni',
} as const

export type RefusalReason =
  | 'switchedOff'
  | 'unsupportedCesr'
  | 'malformedCesr'
  | 'kelNotReplaying'
  | 'revoked'
  | 'notIssued'
  | 'statusNotCurrent'
  | 'noStateDisclosure'
  | 'wardMismatch'
  | 'untrustedRoot'
  | 'expired'
  | 'expiryUnreadable'
  | 'wrongHolder'
  | 'edgeMissing'
  | 'edgeOperator'
  | 'edgeNotI2I'
  | 'telBroken'
  | 'telUnanchored'
  | 'saidMismatch'
  | 'schemaMismatch'
  | 'notAcdcV2'
  | 'chainMissing'

export type Refusal = { ok: false; reason: RefusalReason; detail: string }

/** Raised only by parseObject, and caught only by decide() (./index.ts), which refuses it as malformedCesr. */
export class MalformedMaterial extends Error {}

/** A credential's or TEL event's text as a JSON object. Anything else (not JSON, or JSON that is an array, a number,
 * a string or null) raises MalformedMaterial: the material can't be read, and must never throw out of an entry point. */
export function parseObject<T>(text: string, what: string): T {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new MalformedMaterial(`${what} is not JSON`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new MalformedMaterial(`${what} is JSON but not an object`)
  return value as T
}
const refuse = (reason: RefusalReason, detail: string): Refusal => ({ ok: false, reason, detail })

export type Sad = Record<string, unknown> & {
  d: string
  i: string
  s: string
  rd?: string
  v: string
  a?: Record<string, unknown> & { i?: string; ward?: string; role?: unknown; expirationDate?: { value?: string } }
  e?: Record<string, { n: string; s: string; o?: string; d?: string }>
}

// ---------- CESR text labels (only what TEL states use) ----------
// keripy LabelDex/MatterCodex: Tag codes carry short Base64 text inline; '' is Empty '1AAP'.
// Checked against keripy: Labeler('issued').qb64 == '0Missued', Labeler('revoked').qb64 == 'Yrevoked'.
const TAG: Record<number, string> = {
  1: '0J_',
  2: '0K',
  3: 'X',
  4: '1AAF',
  5: '0L_',
  6: '0M',
  7: 'Y',
  8: '1AAN',
  9: '0N_',
  10: '0O',
  11: 'Z',
}
export function labelQb64(text: string): string {
  if (text === '') return '1AAP'
  if (!/^[A-Za-z0-9_-]+$/.test(text) || !TAG[text.length]) throw new Error(`label "${text}" is not a short Base64 tag`)
  return TAG[text.length] + text
}
export function labelText(qb64: string): string | undefined {
  if (qb64 === '1AAP') return ''
  for (const [n, code] of Object.entries(TAG)) {
    if (qb64.startsWith(code) && qb64.length === code.length + Number(n)) return qb64.slice(code.length)
  }
  return undefined
}

// ---------- nested blocks ----------
const isBlock = (v: unknown): v is Record<string, unknown> & { d: string } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { d?: unknown }).d === 'string'

/** A block's SAID over its most compact form, recursively (keripy SerderACDC compactify); each nested SAID checked. */
export function compactBlock(
  dig: Digest,
  block: Record<string, unknown> & { d: string },
  path = ''
): { ok: true; compact: Record<string, unknown> } | Refusal {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(block)) {
    if (isBlock(v)) {
      const inner = compactBlock(dig, v, `${path}.${k}`)
      if (!inner.ok) return inner
      out[k] = v.d
    } else out[k] = v
  }
  const said = dig(block.d[0], te.encode(json({ ...out, d: DUMMY })))
  return said === block.d
    ? { ok: true, compact: out }
    : refuse('saidMismatch', `block ${path || '(top)'} computed ${said}`)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
function versify(vs: string, size: number): string {
  let s = ''
  let n = size
  for (let i = 0; i < 4; i++) {
    s = B64[n & 63] + s
    n = Math.floor(n / 64)
  }
  return vs.slice(0, 14) + s + '.'
}

/** An ACDC v2 with nested blocks: every block's SAID, and the top-level SAID over the most compact form. */
export function verifyAcdcV2(dig: Digest, rawText: string): { ok: true; sad: Sad } | Refusal {
  let sad: Sad
  try {
    sad = JSON.parse(rawText) as Sad
  } catch {
    return refuse('notAcdcV2', 'not JSON')
  }
  if (!sad || typeof sad !== 'object' || Array.isArray(sad)) return refuse('notAcdcV2', 'JSON but not an object')
  if (typeof sad.v !== 'string' || sad.v.length !== 19 || !sad.v.startsWith('ACDC'))
    return refuse('notAcdcV2', String(sad.v))
  const c: Record<string, unknown> = { ...sad }
  for (const k of ['a', 'e', 'r']) {
    const block = sad[k]
    if (isBlock(block)) {
      const r = compactBlock(dig, block, k)
      if (!r.ok) return r
      c[k] = block.d
    }
  }
  c.d = DUMMY
  c.v = versify(sad.v, 0)
  c.v = versify(sad.v, te.encode(json(c)).length)
  const top = dig(sad.d[0], te.encode(json(c)))
  return top === sad.d ? { ok: true, sad } : refuse('saidMismatch', `top-level computed ${top}`)
}

// ---------- the disclosed state: a blinded state quadruple ----------
export interface Blinder {
  blid: string
  uuid: string
  td: string
  ts: string
}

/** The ACDC and the BlindedStateQuadruples group (-aAj) a holder's proof attaches after it. */
export function parseProof(text: string): { ok: true; acdcText: string; blinder: Blinder } | Refusal {
  const end = text.lastIndexOf('}')
  const tail = text.slice(end + 1)
  const at = tail.indexOf('-aAj')
  if (at < 0) return refuse('noStateDisclosure', 'no -aAj blinded-state group after the ACDC')
  const q = tail.slice(at + 4)
  const blid = q.slice(0, 44)
  const uuid = q.slice(44, 88)
  const td = q.startsWith('1AAP', 88) ? '' : q.slice(88, 132)
  const tsq = q.slice(td ? 132 : 92)
  const ts = labelText(tsq)
  if (ts === undefined) return refuse('noStateDisclosure', `unreadable state label ${tsq}`)
  return { ok: true, acdcText: text.slice(0, end + 1), blinder: { blid, uuid, td, ts } }
}

/** keripy Blinder: blid = Blake3 of the dummied concatenation '#'*44 + uuid + td + ts. */
export function blidOf(dig: Digest, { uuid, td, ts }: Pick<Blinder, 'uuid' | 'td' | 'ts'>): string {
  return dig('E', te.encode(DUMMY + uuid + (td || '1AAP') + labelQb64(ts)))
}

// ---------- the TEL ----------
export interface TelInput {
  ripText: string
  updateTexts: string[]
}
type TelEvent = Record<string, string> & { d: string; n: string }
export type Tel = { ok: true; rip: TelEvent & { i: string }; updates: TelEvent[]; head: TelEvent }

/** keripy regeventing vet / vetBinds / vetBindings / _verifyAnchorCouple, over a registry's rip and its updates. */
export function verifyTel(
  dig: Digest,
  { ripText, updateTexts, issuerKel }: TelInput & { issuerKel?: Replay }
): Tel | Refusal {
  const rip = parseObject<TelEvent & { i: string; t: string }>(ripText, 'a TEL rip')
  if (rip.t !== 'rip') return refuse('telBroken', 'first event is not a rip')
  if (saidOfRaw(dig, ripText, rip.d, ['d']) !== rip.d) return refuse('telBroken', 'rip SAID does not recompute')
  if (!issuerKel?.ok)
    return refuse(
      issuerKel && 'cesr' in issuerKel && issuerKel.cesr ? issuerKel.cesr : 'telBroken',
      `issuer KEL does not replay: ${issuerKel?.reason}`
    )
  if (issuerKel.state.pre !== rip.i) return refuse('telBroken', 'registry issuer is not the KEL given')
  const anchored = (ev: TelEvent) =>
    issuerKel.history.some((h) => h && h.seals.some((s) => s.i === rip.d && s.s === ev.n && s.d === ev.d))
  if (!anchored(rip)) return refuse('telUnanchored', `rip ${rip.d} has no seal in the issuer KEL`)
  const ups = updateTexts
    .map((t) => ({ t, ev: parseObject<TelEvent>(t, 'a TEL event') }))
    .sort((a, b) => parseInt(a.ev.n, 16) - parseInt(b.ev.n, 16))
  let prior: TelEvent = rip
  for (const [i, { t, ev }] of ups.entries()) {
    if (ev.t !== 'bup') return refuse('telBroken', `unsupported TEL event ${ev.t}`)
    if (ev.rd !== rip.d) return refuse('telBroken', `${ev.d} names another registry`)
    if (parseInt(ev.n, 16) !== i + 1) return refuse('telBroken', `gapped chain at n=${i + 1}`)
    if (ev.p !== prior.d) return refuse('telBroken', `${ev.d} prior is not ${prior.d}`)
    if (saidOfRaw(dig, t, ev.d, ['d']) !== ev.d) return refuse('telBroken', `${ev.d} SAID does not recompute`)
    if (!anchored(ev)) return refuse('telUnanchored', `${ev.d} has no seal in the issuer KEL`)
    prior = ev
  }
  // Completeness: the newest event presented must be the newest the issuer's KEL anchors for this registry. Each
  // presented event being anchored (above) is not enough: withhold the revocation and the issuance becomes the head,
  // and the holder has that disclosure. The KEL is the evidence: it carries a seal for every event the issuer made.
  let sealedHead = -1
  for (const h of issuerKel.history) {
    for (const s of h?.anchors ?? []) {
      if (s.i !== rip.d) continue
      const n = typeof s.s === 'string' && /^[0-9a-f]+$/.test(s.s) ? parseInt(s.s, 16) : NaN
      if (Number.isNaN(n)) return refuse('telBroken', `a seal for registry ${rip.d} has an unreadable sn`)
      if (n > sealedHead) sealedHead = n
    }
  }
  if (sealedHead !== parseInt(prior.n, 16))
    return refuse(
      'statusNotCurrent',
      `the issuer KEL anchors registry events to n=${sealedHead.toString(16)}, the newest presented is n=${prior.n}`
    )
  return { ok: true, rip, updates: ups.map((u) => u.ev), head: prior }
}

/** The ACDC's current state from the TEL and the holder's disclosures (newest first, as keripy vetBinds). */
export function stateOf(
  dig: Digest,
  tel: Tel,
  disclosures: Blinder[],
  acdc: Sad
): { ok: true; state: string; at: string; n: string } | Refusal {
  const newestFirst = [...tel.updates].reverse()
  if (!newestFirst.length) return refuse('noStateDisclosure', 'registry has no updates')
  for (const up of newestFirst) {
    const matches = disclosures.filter((b) => b.blid === up.b)
    if (matches.length !== 1) return refuse('statusNotCurrent', `no disclosure for update n=${up.n} (blid ${up.b})`)
    const b = matches[0]
    if (blidOf(dig, b) !== up.b) return refuse('statusNotCurrent', `disclosure does not unblind ${up.b}`)
    if (!b.td && !b.ts) continue // a vacuous placeholder
    if (b.td !== acdc.d) return refuse('telBroken', `state binds ${b.td}, not ${acdc.d}`)
    if (acdc.i !== tel.rip.i) return refuse('telBroken', 'ACDC issuer is not the registry issuer')
    if (acdc.rd && acdc.rd !== tel.rip.d) return refuse('telBroken', 'ACDC rd is not this registry')
    return { ok: true, state: b.ts, at: up.dt, n: up.n }
  }
  return refuse('noStateDisclosure', 'no non-vacuous state disclosed')
}

// ---------- one credential, then the chain ----------
export interface ChainContext {
  digest: Digest
  /** Replayed KELs by prefix. */
  kels: Map<string, Replay>
  /** Registries by registry SAID. */
  tels: Map<string, TelInput>
  /** Proofs (ACDC text followed by its state disclosure) by credential SAID. */
  creds: Map<string, string>
  trustedRoots: Set<string>
  now: Date
}

function node(ctx: ChainContext, said: string, schema?: string): { ok: true; sad: Sad } | Refusal {
  const text = ctx.creds.get(said)
  if (!text) return refuse('chainMissing', `no credential ${said}`)
  const p = parseProof(text)
  if (!p.ok) return p
  const ac = verifyAcdcV2(ctx.digest, p.acdcText)
  if (!ac.ok) return ac
  if (ac.sad.d !== said) return refuse('chainMissing', `presented ${ac.sad.d}, edge names ${said}`)
  if (schema && ac.sad.s !== schema)
    return refuse('schemaMismatch', `${said} is schema ${ac.sad.s}, expected ${schema}`)
  const telIn = ac.sad.rd ? ctx.tels.get(ac.sad.rd) : undefined
  if (!telIn) return refuse('telBroken', `no TEL for ${ac.sad.rd}`)
  const tel = verifyTel(ctx.digest, { ...telIn, issuerKel: ctx.kels.get(ac.sad.i) })
  if (!tel.ok) return tel
  const st = stateOf(ctx.digest, tel, [p.blinder], ac.sad)
  if (!st.ok) return st
  if (st.state === 'revoked') return refuse('revoked', `${said} revoked at ${st.at}`)
  if (st.state !== 'issued') return refuse('notIssued', `${said} state "${st.state}"`)
  return { ok: true, sad: ac.sad }
}

/** I2I (keripy verifyChain 402-480): the far node is the edge's target, and its issuee is the near node's issuer. */
export function checkEdge(
  ctx: ChainContext,
  near: Sad,
  name: string,
  schema: string
): { ok: true; sad: Sad } | Refusal {
  const e = near.e?.[name]
  if (!e || typeof e !== 'object') return refuse('edgeMissing', `${near.d} has no edge "${name}"`)
  if (e.s !== schema) return refuse('schemaMismatch', `edge ${name} pins ${e.s}, expected ${schema}`)
  const op = e.o ?? 'I2I'
  if (op !== 'I2I') return refuse('edgeOperator', `edge ${name} operator ${op}; only I2I is supported`)
  const far = node(ctx, e.n, schema)
  if (!far.ok) return far
  if (far.sad.a?.i === undefined) return refuse('edgeNotI2I', `edge ${name}: far node ${e.n} has no issuee`)
  if (far.sad.a.i !== near.i)
    return refuse('edgeNotI2I', `edge ${name}: far issuee ${far.sad.a.i} is not near issuer ${near.i}`)
  return far
}

/**
 * The presented credential's expiry, read the one way both entry points use (guardianIn, socialIn).
 *
 * A credential that carries no expiry field passes with none. One that carries an expiry this phone can't read (not a
 * string, empty, or a string Date can't parse) is refused as expiryUnreadable, never treated as "never expires":
 * `new Date('nonsense') <= now` is false, so the bare comparison would let it through. "This expired" (expired) and
 * "we can't tell when this expires" (expiryUnreadable) are different facts, so they are different reasons.
 *
 * This is the only place in sedi/ that parses a date: expiryParseGuard.test.ts fails on a parse anywhere else.
 * Read on the presented credential only, for now: node() (intermediates, via checkEdge) reads no expiry yet.
 */
export function readExpiry(sad: Sad, now: Date): { ok: true; expires?: string } | Refusal {
  const a = (sad.a ?? {}) as Record<string, unknown>
  if (a.expirationDate === undefined && a.expires === undefined) return { ok: true }
  const block = a.expirationDate
  const fromBlock = typeof block === 'object' && block !== null ? (block as { value?: unknown }).value : undefined
  const raw = fromBlock ?? a.expires
  if (typeof raw !== 'string' || raw === '' || Number.isNaN(Date.parse(raw))) {
    const shown = String(JSON.stringify(raw ?? block) ?? raw).slice(0, 64)
    return refuse('expiryUnreadable', `its expiry can't be read: ${shown}`)
  }
  if (Date.parse(raw) <= now.getTime()) return refuse('expired', `expired ${raw}`)
  return { ok: true, expires: raw }
}

export type GuardianResult =
  | { ok: true; guardian: string; ward: string; role: unknown; root: string; expires?: string }
  | Refusal

/** The Guardian, its chain to a trusted State root, and the four app checks: holder, ward, expiry, root. */
export function guardianIn(
  ctx: ChainContext,
  guardianSaid: string,
  expect: { guardian: string; ward: string }
): GuardianResult {
  const g = node(ctx, guardianSaid, SEDI_SCHEMAS.guardian)
  if (!g.ok) return g
  const sad = g.sad
  if (sad.a?.i !== expect.guardian) return refuse('wrongHolder', `issued to ${sad.a?.i}, not ${expect.guardian}`)
  if (sad.a?.ward !== expect.ward) return refuse('wardMismatch', `names ward ${sad.a?.ward}, not ${expect.ward}`)
  const exp = readExpiry(sad, ctx.now)
  if (!exp.ok) return exp
  const agent = checkEdge(ctx, sad, 'utahAgent', SEDI_SCHEMAS.issuingAgent)
  if (!agent.ok) return agent
  const unit = checkEdge(ctx, agent.sad, 'orgUnit', SEDI_SCHEMAS.orgUnit)
  if (!unit.ok) return unit
  if (!ctx.trustedRoots.has(unit.sad.i))
    return refuse('untrustedRoot', `chain ends at ${unit.sad.i}, not a trusted State root`)
  return { ok: true, guardian: sad.a.i, ward: sad.a.ward, role: sad.a.role, root: unit.sad.i, expires: exp.expires }
}

export type SocialResult = { ok: true; guardian: string; ward: string; root: string; expires?: string } | Refusal

/** S2: the Social Authorization the guardian issues the ward, chained to the guardian's own Guardian credential. */
export function socialIn(ctx: ChainContext, socialSaid: string, expect: { ward: string }): SocialResult {
  const s = node(ctx, socialSaid, SEDI_SCHEMAS.social)
  if (!s.ok) return s
  if (s.sad.a?.i !== expect.ward) return refuse('wrongHolder', `issued to ${s.sad.a?.i}, not ${expect.ward}`)
  const exp = readExpiry(s.sad, ctx.now)
  if (!exp.ok) return exp
  const e = s.sad.e?.guardian
  if (!e) return refuse('edgeMissing', 'no guardian edge')
  const g = checkEdge(ctx, s.sad, 'guardian', SEDI_SCHEMAS.guardian)
  if (!g.ok) return g
  const gv = guardianIn(ctx, e.n, { guardian: s.sad.i, ward: expect.ward })
  if (!gv.ok) return gv
  return { ok: true, guardian: s.sad.i, ward: expect.ward, root: gv.root, expires: exp.expires }
}

/** Re-SAID a modified ACDC. Tests only: builds a well-formed credential that differs in one field. */
export function saidifyAcdcV2(dig: Digest, sad: Sad): Sad {
  const out = JSON.parse(json(sad)) as Sad
  const fill = (block: Record<string, unknown> & { d: string }) => {
    for (const v of Object.values(block)) if (isBlock(v)) fill(v)
    const flat = Object.fromEntries(Object.entries(block).map(([k, v]) => [k, isBlock(v) ? v.d : v]))
    block.d = dig(block.d[0], te.encode(json({ ...flat, d: DUMMY })))
  }
  for (const k of ['a', 'e', 'r']) {
    const b = out[k]
    if (isBlock(b)) fill(b)
  }
  const c: Record<string, unknown> = { ...out }
  for (const k of ['a', 'e', 'r']) {
    const b = out[k]
    if (isBlock(b)) c[k] = b.d
  }
  c.d = DUMMY
  c.v = versify(out.v, 0)
  c.v = versify(out.v, te.encode(json(c)).length)
  out.v = c.v as string
  out.d = dig(sad.d[0], te.encode(json(c)))
  return out
}
