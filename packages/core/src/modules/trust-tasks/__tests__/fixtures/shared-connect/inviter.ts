/**
 * An independent shared-connect INVITER for the rungs (sharedConnectSpecRungs.test.ts), written from the
 * specifications, NOT from Keyring's code, so that where Keyring and the spec disagree the rungs fail. It imports
 * nothing from Keyring. Its schemas are ahead of the repository's pin on purpose: see ./schemas/SOURCE.txt.
 *
 * - the flow and the link: trust-tasks #1034 and dtgwg-vti-spec#86, both as revised 2026-11-05
 *   (`_from` = a fresh did:peer:2, `_id` 16 random bytes, `_exp`, `_type=/vti/flow/shared-connect/0.1`,
 *   optional `_label`; the scanner proposes; propose#response, issue both ways, a receipt for each issue;
 *   a proof on every step; one `_id` accepts one propose; an expired code accepts none);
 * - did:peer:2 and did:peer:0: the DIF Peer DID method spec (purpose codes E/V/S, service abbreviations,
 *   key ids `#key-N` in order of the key elements);
 * - proofs: W3C Data Integrity eddsa-jcs-2022 (proof config carries the document's @context when present);
 * - payloads and envelope: the registry's schemas, copied unchanged into ./schemas;
 * - the wire: TSP 1.0 through upstream's own library (@openvtc/vti-tsp-js 0.4.0, byte-compatible with
 *   affinidi-tsp), with its relationship state machine: an application frame from a VID with no
 *   relationship is DROPPED, as affinidi-tsp's default RelationshipPolicy::Gated does;
 * - the binding envelope: registry bindings/tsp/0.1 (`{type: …/binding/tsp/0.1/envelope, document}`).
 *
 * Plain objects and its own small crypto (@noble). Silent drops are recorded in `events`, never answered:
 * the binding owes no reply path (#853 §2.8).
 */
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  admitsApplicationMessage,
  decodeEnvelope,
  isRevisionError,
  pack,
  packAccept,
  transition,
  unpack,
  type RelationshipState,
} from '@openvtc/vti-tsp-js-v1'
import Ajv2020 from 'ajv/dist/2020'
import canonicalize from 'canonicalize'

import framework02 from './schemas/framework-0.2.schema.json'
import framework03 from './schemas/framework-0.3.schema.json'
import envelope05 from './schemas/trust-task-0.5.schema.json'
import proposeSchema from './schemas/propose-0.1.payload.schema.json'
import issueSchema from './schemas/issue-0.1.payload.schema.json'

export const PROPOSE = 'https://trusttasks.org/spec/vrc/relationships/propose/0.1'
export const ISSUE = 'https://trusttasks.org/spec/vrc/relationships/issue/0.1'
export const BINDING_ENVELOPE = 'https://trusttasks.org/binding/tsp/0.1/envelope'
export const FLOW_TYPE = '/vti/flow/shared-connect/0.1'
export const LINK_HOST = 'https://link.trustoverip.org/t'

// ---- encodings --------------------------------------------------------------------------------------------
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function base58(bytes: Uint8Array): string {
  let n = 0n
  for (const b of bytes) n = n * 256n + BigInt(b)
  let out = ''
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out
    n /= 58n
  }
  for (const b of bytes) {
    if (b !== 0) break
    out = '1' + out
  }
  return out
}
export function unbase58(text: string): Uint8Array {
  let n = 0n
  for (const c of text) {
    const i = ALPHABET.indexOf(c)
    if (i < 0) throw new Error(`not base58: ${c}`)
    n = n * 58n + BigInt(i)
  }
  const bytes: number[] = []
  while (n > 0n) {
    bytes.unshift(Number(n % 256n))
    n /= 256n
  }
  for (const c of text) {
    if (c !== '1') break
    bytes.unshift(0)
  }
  return Uint8Array.from(bytes)
}
const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')
const utf8 = (s: string) => new TextEncoder().encode(s)
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const ED25519_PUB = Uint8Array.from([0xed, 0x01])
const X25519_PUB = Uint8Array.from([0xec, 0x01])
export const multikey = (prefix: Uint8Array, key: Uint8Array) => 'z' + base58(cat(prefix, key))
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n))

// ---- did:peer, from the DIF method spec ------------------------------------------------------------------
const ABBREVIATIONS: Record<string, string> = { t: 'type', s: 'serviceEndpoint', r: 'routingKeys', a: 'accept' }
const TYPE_ABBREVIATIONS: Record<string, string> = { dm: 'DIDCommMessaging' }

export interface PeerKeys {
  edSk: Uint8Array
  edPk: Uint8Array
  xSk: Uint8Array
  xPk: Uint8Array
}
export function newKeys(): PeerKeys {
  const edSk = random(32)
  const xSk = random(32)
  return { edSk, edPk: ed25519.getPublicKey(edSk), xSk, xPk: x25519.getPublicKey(xSk) }
}

/** did:peer:2 with E (X25519) then V (Ed25519) then one S per service, abbreviated per the spec. */
export function peer2(keys: PeerKeys, services: Array<Record<string, unknown>>): string {
  const abbreviate = (s: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s)) {
      const key = Object.entries(ABBREVIATIONS).find(([, long]) => long === k)?.[0] ?? k
      out[key] = k === 'type' && v === 'DIDCommMessaging' ? 'dm' : v
    }
    return out
  }
  return [
    'did:peer:2',
    'E' + multikey(X25519_PUB, keys.xPk),
    'V' + multikey(ED25519_PUB, keys.edPk),
    ...services.map((s) => 'S' + b64u(utf8(JSON.stringify(abbreviate(s))))),
  ].join('.')
}

export type ProofPurpose = 'authentication' | 'assertionMethod'

export interface Resolved {
  id: string
  /** Every Ed25519 key, whatever its purpose (the TSP sender key is read from here, not a proof key). */
  signing: Array<{ id: string; key: Uint8Array }>
  /** Keys listed under `authentication`: a did:peer:2 `V` segment, or did:peer:0's one key. */
  authentication: Array<{ id: string; key: Uint8Array }>
  /** Keys listed under `assertionMethod`: a did:peer:2 `A` segment, or did:peer:0's one key. */
  assertionMethod: Array<{ id: string; key: Uint8Array }>
  agreement: Array<{ id: string; key: Uint8Array }>
  services: Array<Record<string, unknown>>
}

/** Resolve did:peer:2 and did:peer:0 ourselves; key ids are `#key-N` in the order of the key elements. */
export function resolvePeer(did: string): Resolved {
  if (did.startsWith('did:peer:0')) {
    const mk = did.slice('did:peer:0'.length)
    const bytes = unbase58(mk.slice(1))
    if (bytes[0] !== 0xed || bytes[1] !== 0x01) throw new Error('did:peer:0 is not Ed25519')
    const own = [{ id: `${did}#${mk}`, key: bytes.slice(2) }]
    return { id: did, signing: own, authentication: own, assertionMethod: own, agreement: [], services: [] }
  }
  if (!did.startsWith('did:peer:2.')) throw new Error(`cannot resolve ${did.slice(0, 16)}`)
  const out: Resolved = { id: did, signing: [], authentication: [], assertionMethod: [], agreement: [], services: [] }
  let n = 0
  for (const element of did.slice('did:peer:2.'.length).split('.')) {
    const purpose = element[0]
    const value = element.slice(1)
    if (purpose === 'S') {
      const raw = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
      const s: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(raw)) {
        const long = ABBREVIATIONS[k] ?? k
        s[long] = long === 'type' && typeof v === 'string' ? (TYPE_ABBREVIATIONS[v] ?? v) : v
      }
      out.services.push(s)
      continue
    }
    const bytes = unbase58(value.slice(1))
    n += 1
    const id = `${did}#key-${n}`
    // DIF Peer DID method: V is authentication only, A is assertionMethod only. One does not imply the other.
    if ((purpose === 'V' || purpose === 'A') && bytes[0] === 0xed) {
      out.signing.push({ id, key: bytes.slice(2) })
      if (purpose === 'V') out.authentication.push({ id, key: bytes.slice(2) })
      else out.assertionMethod.push({ id, key: bytes.slice(2) })
    }
    if (purpose === 'E' && bytes[0] === 0xec) out.agreement.push({ id, key: bytes.slice(2) })
  }
  return out
}

// ---- eddsa-jcs-2022 (W3C Data Integrity) -----------------------------------------------------------------
const jcs = (v: unknown) => {
  const c = canonicalize(v)
  if (c === undefined) throw new Error('no JCS form')
  return c
}
const hashInput = (proofConfig: Record<string, unknown>, unsecured: Record<string, unknown>) =>
  cat(sha256(utf8(jcs(proofConfig))), sha256(utf8(jcs(unsecured))))

export function signJcs(
  doc: Record<string, unknown>,
  sk: Uint8Array,
  verificationMethod: string,
  proofPurpose: ProofPurpose
) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { proof: _drop, ...unsecured } = doc
  const proofConfig: Record<string, unknown> = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    verificationMethod,
    proofPurpose,
    ...(unsecured['@context'] ? { '@context': unsecured['@context'] } : {}),
  }
  const signature = ed25519.sign(hashInput(proofConfig, unsecured), sk)
  return { ...unsecured, proof: { ...proofConfig, proofValue: 'z' + base58(signature) } }
}

/**
 * Verify under a controller we resolve ourselves, as a conforming verifier does: the proof must state the
 * `expected` purpose, and the method must be listed under that relationship (not merely be one of its keys).
 */
export function verifyJcs(doc: Record<string, unknown>, controller: string, expected: ProofPurpose): boolean {
  try {
    const { proof, ...unsecured } = doc as { proof?: Record<string, unknown> } & Record<string, unknown>
    if (!proof || proof.type !== 'DataIntegrityProof' || proof.cryptosuite !== 'eddsa-jcs-2022') return false
    const { proofValue, ...config } = proof
    const vm = String(config.verificationMethod ?? '')
    const resolved = resolvePeer(controller)
    const absolute = vm.startsWith('#') ? `${controller}${vm}` : vm
    if (config.proofPurpose !== expected) return false
    // eddsa-jcs-2022 (W3C Data Integrity): a document that has an @context carries it, unchanged, in its proof.
    if (unsecured['@context'] !== undefined && jcs(config['@context']) !== jcs(unsecured['@context'])) return false
    const key = resolved[expected].find((k) => k.id === absolute)
    if (!key) return false
    return ed25519.verify(unbase58(String(proofValue).slice(1)), hashInput(config, unsecured), key.key)
  } catch {
    return false
  }
}

export const digestOf = (v: unknown) => 'z' + base58(cat(Uint8Array.from([0x12, 0x20]), sha256(utf8(jcs(v)))))

// ---- the registry's schemas -------------------------------------------------------------------------------
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
ajv.addSchema({ ...framework02, $id: 'https://trusttasks.org/_framework/0.2/framework.schema.json' })
ajv.addSchema({ ...framework03, $id: 'https://trusttasks.org/_framework/0.3/framework.schema.json' })
ajv.addSchema(proposeSchema)
ajv.addSchema(issueSchema)
const envelopeCheck = ajv.compile(envelope05)
export function schemaProblems(doc: Record<string, unknown>): string[] {
  const problems: string[] = []
  if (!envelopeCheck(doc))
    problems.push(...(envelopeCheck.errors ?? []).map((e) => `envelope${e.instancePath} ${e.message}`))
  const [base, frag] = String(doc.type).split('#')
  const payloadCheck = ajv.getSchema(frag ? `${base}#${frag}` : base)
  if (!payloadCheck) problems.push(`no schema for ${doc.type}`)
  else if (!payloadCheck(doc.payload))
    problems.push(...(payloadCheck.errors ?? []).map((e) => `payload${e.instancePath} ${e.message}`))
  return problems
}

// ---- the inviter ------------------------------------------------------------------------------------------
export interface Faults {
  /** Send the issue before the propose#response (reordering on the wire). */
  issueBeforeResponse?: boolean
  /** Hold our issue back; the test releases it later (days, no maxDuration). */
  holdIssue?: boolean
  /** Sign our propose#response with a key that is not our VID's. */
  wrongKeyResponse?: boolean
  /** Put another enactment in our documents' ceremony member. */
  wrongEnactment?: boolean
  /** `ceremony.definition` without `definitionDigest` (the shape the registry's 0.5 envelope rejects). */
  definitionWithoutDigest?: boolean
  /** Our VRC names someone else as its subject. */
  vcSubjectWrong?: boolean
  /** Our receipt carries a digest of nothing Keyring sent. */
  receiptWrongDigest?: boolean
}

interface Enactment {
  id: string
  exp: number
  spent: boolean
  theirVid?: string
  proposeId?: string
  theirRelationshipDid?: string
  myVrcDigest?: string
  receiptMatched?: boolean
  theirVrc?: Record<string, unknown>
  heldIssue?: Record<string, unknown>
}

export class Inviter {
  readonly keys = newKeys()
  readonly relSk = random(32)
  readonly relDid = 'did:peer:0' + multikey(ED25519_PUB, ed25519.getPublicKey(this.relSk))
  readonly vid: string
  readonly events: string[] = []
  readonly enactments = new Map<string, Enactment>()
  private readonly relationships = new Map<string, RelationshipState>()

  constructor(
    readonly relay: string,
    readonly clock: () => number = () => Math.floor(Date.now() / 1000),
    readonly faults: Faults = {},
    services?: Array<Record<string, unknown>>
  ) {
    this.vid = peer2(this.keys, services ?? [{ type: 'TSPTransport', serviceEndpoint: relay }])
  }

  /** A shared-connect link (#86): `_from`, `_id`, `_exp`, `_type`, optional `_label`. */
  link(options: { ttlSeconds?: number; label?: string; from?: string; type?: string } = {}): string {
    const id = b64u(random(16))
    const exp = this.clock() + (options.ttlSeconds ?? 600)
    this.enactments.set(id, { id, exp, spent: false })
    let link = `${LINK_HOST}#_from=${options.from ?? this.vid}&_id=${id}&_exp=${exp}&_type=${options.type ?? FLOW_TYPE}`
    if (options.label !== undefined) link += `&_label=${encodeURIComponent(options.label)}`
    return link
  }

  private ceremony(e: Enactment, step: string) {
    return {
      enactment: this.faults.wrongEnactment ? b64u(random(16)) : e.id,
      step,
      ...(this.faults.definitionWithoutDigest
        ? { definition: 'https://trusttasks.org/ceremony/shared-connect/0.1' }
        : {}),
    }
  }

  private signAsVid(doc: Record<string, unknown>) {
    return signJcs(doc, this.keys.edSk, `${this.vid}#key-2`, 'authentication')
  }

  private async packFor(theirVid: string, document: Record<string, unknown>): Promise<Uint8Array> {
    const their = resolvePeer(theirVid)
    const body = utf8(JSON.stringify({ type: BINDING_ENVELOPE, document }))
    const packed = await pack(body, this.vid, theirVid, {
      senderSigningKey: this.keys.edSk,
      receiverEncryptionKey: their.agreement[0].key,
    })
    return packed.bytes
  }

  /** One inbound frame. Returns the frames to send back (none for a silent drop). */
  async onFrame(bytes: Uint8Array): Promise<Uint8Array[]> {
    let sender: string
    try {
      sender = decodeEnvelope(bytes).envelope.sender
    } catch (e) {
      this.events.push(
        isRevisionError(e) ? 'dropped:revision' : `dropped:unreadable:${(e as Error).message.slice(0, 60)}`
      )
      return []
    }
    let opened
    try {
      opened = await unpack(bytes, {
        receiverDecryptionKey: this.keys.xSk,
        senderSigningKey: resolvePeer(sender).signing[0].key,
      })
    } catch (e) {
      this.events.push(
        isRevisionError(e) ? 'dropped:revision' : `dropped:unopened:${(e as Error).message.slice(0, 60)}`
      )
      return []
    }
    const state = this.relationships.get(sender) ?? 'none'
    if (opened.messageType === 'control') {
      if (opened.control?.controlType !== 'invite') return []
      this.relationships.set(sender, transition(transition(state, 'receiveInvite'), 'sendAccept'))
      this.events.push('xrfi:accepted')
      const accept = await packAccept(opened.threadDigest, this.vid, sender, {
        senderSigningKey: this.keys.edSk,
        receiverEncryptionKey: resolvePeer(sender).agreement[0].key,
      })
      return [accept.bytes]
    }
    if (!admitsApplicationMessage(state)) {
      this.events.push('dropped:no-relationship')
      return []
    }
    const envelope = JSON.parse(new TextDecoder().decode(opened.payload)) as {
      type?: string
      document?: Record<string, unknown>
    }
    if (envelope.type !== BINDING_ENVELOPE || !envelope.document) {
      this.events.push('dropped:not-a-binding-envelope')
      return []
    }
    const doc = envelope.document
    if (doc.issuer !== sender || doc.recipient !== this.vid) {
      this.events.push('dropped:identity')
      return []
    }
    return this.onDocument(sender, doc)
  }

  private async onDocument(sender: string, doc: Record<string, unknown>): Promise<Uint8Array[]> {
    const drop = (why: string) => {
      this.events.push(`dropped:${why}`)
      return []
    }
    const problems = schemaProblems(doc)
    if (problems.length) return drop(`schema:${problems.join(';')}`)
    // A proof on every step (#1034), under the issuer VID, for authentication (a `.V`-only did:peer:2 lists its key there).
    if (!verifyJcs(doc, sender, 'authentication')) return drop('proof')
    const enactmentId = (doc.ceremony as { enactment?: string } | undefined)?.enactment
    const e = enactmentId ? this.enactments.get(enactmentId) : undefined
    if (!e) return drop('unknown-enactment')

    if (doc.type === PROPOSE) {
      if (e.spent) return drop('spent')
      if (this.clock() > e.exp) return drop('expired')
      e.spent = true
      e.theirVid = sender
      e.proposeId = String(doc.id)
      e.theirRelationshipDid = (doc.payload as { relationshipDid: string }).relationshipDid
      this.events.push('propose:accepted')
      const response = this.faults.wrongKeyResponse
        ? signJcs(this.responseFor(e), random(32), `${this.vid}#key-2`, 'authentication')
        : this.signAsVid(this.responseFor(e))
      const issue = this.issueFor(e)
      if (this.faults.holdIssue) {
        e.heldIssue = issue
        return [await this.packFor(sender, response)]
      }
      return this.faults.issueBeforeResponse
        ? [await this.packFor(sender, issue), await this.packFor(sender, response)]
        : [await this.packFor(sender, response), await this.packFor(sender, issue)]
    }
    if (e.theirVid !== sender || doc.threadId !== e.proposeId) return drop('wrong-thread')
    if (doc.type === `${ISSUE}#response`) {
      e.receiptMatched = (doc.payload as { vrcDigestMultibase?: string }).vrcDigestMultibase === e.myVrcDigest
      this.events.push(e.receiptMatched ? 'receipt:matched' : 'receipt:mismatch')
      return []
    }
    if (doc.type === ISSUE) {
      const vc = (doc.payload as { vrc: Record<string, unknown> }).vrc
      const subject = vc.credentialSubject as { id?: string }
      if (vc.issuer !== e.theirRelationshipDid) return drop('vc-issuer')
      if (subject?.id !== this.relDid) return drop('vc-subject')
      if (!verifyJcs(vc, String(vc.issuer), 'assertionMethod')) return drop('vc-proof')
      e.theirVrc = vc
      this.events.push('issue:stored')
      const receipt = this.signAsVid({
        id: b64u(random(16)),
        type: `${ISSUE}#response`,
        threadId: e.proposeId,
        issuer: this.vid,
        recipient: sender,
        issuedAt: new Date().toISOString(),
        ceremony: this.ceremony(e, 'issue-responder'),
        payload: { vrcDigestMultibase: this.faults.receiptWrongDigest ? digestOf({ nothing: true }) : digestOf(vc) },
      })
      return [await this.packFor(sender, receipt)]
    }
    return drop('unexpected-type')
  }

  private responseFor(e: Enactment) {
    return {
      id: b64u(random(16)),
      type: `${PROPOSE}#response`,
      threadId: e.proposeId,
      issuer: this.vid,
      recipient: e.theirVid,
      issuedAt: new Date().toISOString(),
      ceremony: this.ceremony(e, 'propose'),
      payload: { accept: true, relationshipDid: this.relDid },
    }
  }

  /** Our VRC in the shape the counterparts describe: VC 2.0, eddsa-jcs-2022, no validUntil. */
  private issueFor(e: Enactment) {
    const vc = signJcs(
      {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'RelationshipCredential'],
        issuer: this.relDid,
        validFrom: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        credentialSubject: { id: this.faults.vcSubjectWrong ? this.relDid : e.theirRelationshipDid },
      },
      this.relSk,
      `${this.relDid}#${this.relDid.slice('did:peer:0'.length)}`,
      'assertionMethod'
    )
    e.myVrcDigest = digestOf(vc)
    return this.signAsVid({
      id: b64u(random(16)),
      type: ISSUE,
      threadId: e.proposeId,
      issuer: this.vid,
      recipient: e.theirVid,
      issuedAt: new Date().toISOString(),
      ceremony: this.ceremony(e, 'issue-inviter'),
      payload: { vrc: vc, vrcDigestMultibase: e.myVrcDigest },
    })
  }

  /** Release an issue held by `holdIssue` (the test decides when: days later). */
  async releaseHeldIssue(enactmentId: string): Promise<Uint8Array[]> {
    const e = this.enactments.get(enactmentId)
    if (!e?.heldIssue || !e.theirVid) return []
    const issue = e.heldIssue
    e.heldIssue = undefined
    return [await this.packFor(e.theirVid, issue)]
  }

  /** A raw application frame to `theirVid` with no XRFI first, from a fresh VID (for the gap rung). */
  async strangerFrame(theirVid: string, document: Record<string, unknown>): Promise<Uint8Array> {
    return this.packFor(theirVid, document)
  }
}
