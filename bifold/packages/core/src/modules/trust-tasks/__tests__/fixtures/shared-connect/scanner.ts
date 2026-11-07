/**
 * An independent shared-connect SCANNER for the inviter rungs (sharedConnectInviterRungs.test.ts): the mirror of
 * ./inviter.ts, written from the same specifications and NOT from Keyring's code, so that where Keyring-as-inviter
 * and the spec disagree the rungs fail. It imports nothing from Keyring: its did:peer, eddsa-jcs-2022, schemas and
 * encodings come from ./inviter.ts (itself spec-only), and its wire from upstream's TSP 1.0 library with its
 * relationship state machine.
 *
 * - it reads the inviter's link (`_from`, `_id`, `_exp`, `_type`), greets with a routed `XRFI` and waits for the
 *   `XRFA` before proposing, as an affinidi-based scanner does (application frames before it are dropped there);
 * - it proposes with a 16-byte challenge as the propose id and thread, the `ceremony` member, and a proof;
 * - it verifies every document it receives (schema, identity, proof under the inviter's VID or relationship DID),
 *   checks the inviter's VRC (issuer, subject, its own JCS proof), receipts it, and sends its own VRC;
 * - everything it refuses is recorded in `events`, never answered.
 */
import {
  admitsApplicationMessage,
  decodeEnvelope,
  isRevisionError,
  pack,
  packInvite,
  resolveAccept,
  transition,
  unpack,
  type RelationshipState,
} from '@openvtc/vti-tsp-js-v1'
import { ed25519 } from '@noble/curves/ed25519.js'

import {
  BINDING_ENVELOPE,
  digestOf,
  FLOW_TYPE,
  ISSUE,
  multikey,
  newKeys,
  peer2,
  PROPOSE,
  resolvePeer,
  schemaProblems,
  signJcs,
  verifyJcs,
} from './inviter'

const ED25519_PUB = Uint8Array.from([0xed, 0x01])
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n))
const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url') // the fixture's own (Node) encoding
const utf8 = (s: string) => new TextEncoder().encode(s)

export interface ScannerFaults {
  /** Propose without forming a relationship first. */
  noInvite?: boolean
  /** Put another enactment in the propose's ceremony member. */
  wrongEnactment?: boolean
  /** Sign the propose with a key that is not this VID's. */
  badProof?: boolean
  /** Our VRC names someone else as its subject. */
  vcSubjectWrong?: boolean
  /** Our VRC's own proof is made with a key that is not our relationship DID's. */
  vcBadProof?: boolean
  /** Our receipt carries the digest of something the inviter never sent. */
  receiptWrongDigest?: boolean
  /** Every document after the propose (receipt, issue) is signed with a key that is not this VID's. */
  badProofLater?: boolean
  /**
   * Not a fault: accept a document's proof ONLY under the sending VID (decision 3 as Keyring took it), instead of
   * either the VID or the inviter's relationship DID. With it, a Keyring that signed with its relationship DID fails.
   */
  strictVidProofs?: boolean
  /** Send a propose whose payload has no relationship DID. */
  proposeWithoutRelationshipDid?: boolean
}

export interface ReadLink {
  from: string
  id: string
  exp: number
  type: string
}

/** Parse a shared-connect link's fragment (#86), as a scanner would: nothing else in it is used. */
export function readLink(link: string): ReadLink {
  const fragment = link.slice(link.indexOf('#') + 1)
  const fields = Object.fromEntries(fragment.split('&').map((pair) => pair.split('=').map(decodeURIComponent)))
  return { from: fields._from, id: fields._id, exp: Number(fields._exp), type: fields._type }
}

export class Scanner {
  readonly keys = newKeys()
  readonly relSk = random(32)
  readonly relDid = 'did:peer:0' + multikey(ED25519_PUB, ed25519.getPublicKey(this.relSk))
  readonly vid: string
  readonly events: string[] = []
  state: RelationshipState = 'none'
  link?: ReadLink
  inviteDigest?: Uint8Array
  proposeId?: string
  proposeFrameBytes?: Uint8Array
  theirRelationshipDid?: string
  myVrcDigest?: string
  theirVrc?: Record<string, unknown>
  receiptMatched = false
  errors: string[] = []
  /** Every document from the inviter that passed identity, thread, schema and proof, in arrival order. */
  readonly received: Record<string, unknown>[] = []
  private heldIssue?: Record<string, unknown>

  constructor(
    readonly relay: string,
    readonly faults: ScannerFaults = {}
  ) {
    this.vid = peer2(this.keys, [{ type: 'TSPTransport', serviceEndpoint: relay }])
  }

  private get inviter(): string {
    if (!this.link) throw new Error('no link read')
    return this.link.from
  }

  private async packFor(document: Record<string, unknown>): Promise<Uint8Array> {
    const body = utf8(JSON.stringify({ type: BINDING_ENVELOPE, document }))
    const packed = await pack(body, this.vid, this.inviter, {
      senderSigningKey: this.keys.edSk,
      receiverEncryptionKey: resolvePeer(this.inviter).agreement[0].key,
    })
    return packed.bytes
  }

  private signLater(doc: Record<string, unknown>) {
    return this.faults.badProofLater ? signJcs(doc, random(32), `${this.vid}#key-2`) : this.signAsVid(doc)
  }

  private signAsVid(doc: Record<string, unknown>) {
    return this.faults.badProof
      ? signJcs(doc, random(32), `${this.vid}#key-2`)
      : signJcs(doc, this.keys.edSk, `${this.vid}#key-2`)
  }

  /** Read the code. */
  read(link: string): ReadLink {
    this.link = readLink(link)
    if (!this.link.type.endsWith(FLOW_TYPE)) this.events.push('link:not-shared-connect')
    return this.link
  }

  /** The routed invite (§7.2.4: the accept comes back through the relay to this VID). */
  async greet(): Promise<Uint8Array> {
    const invite = await packInvite(
      this.vid,
      this.inviter,
      { senderSigningKey: this.keys.edSk, receiverEncryptionKey: resolvePeer(this.inviter).agreement[0].key },
      { route: [this.relay, this.vid] }
    )
    this.state = transition(this.state, 'sendInvite')
    this.inviteDigest = invite.threadDigest
    return invite.bytes
  }

  /** The propose (step 1). The same bytes are re-sent by {@link proposeAgain}. */
  async propose(): Promise<Uint8Array> {
    if (!this.link) throw new Error('no link read')
    this.proposeId = b64u(random(16))
    const doc = this.signAsVid({
      id: this.proposeId,
      type: PROPOSE,
      threadId: this.proposeId,
      issuer: this.vid,
      recipient: this.inviter,
      issuedAt: new Date().toISOString(),
      ceremony: { enactment: this.faults.wrongEnactment ? b64u(random(16)) : this.link.id, step: 'propose' },
      payload: this.faults.proposeWithoutRelationshipDid
        ? { witnessed: false }
        : { relationshipDid: this.relDid, witnessed: false },
    })
    const problems = schemaProblems(doc)
    if (problems.length && !this.faults.proposeWithoutRelationshipDid)
      throw new Error(`our own propose fails the registry schema: ${problems.join('; ')}`)
    this.proposeFrameBytes = await this.packFor(doc)
    return this.proposeFrameBytes
  }

  /** The same propose again (a scanner that heard nothing re-sends; same id, same thread). */
  proposeAgain(): Uint8Array {
    if (!this.proposeFrameBytes) throw new Error('nothing proposed')
    return this.proposeFrameBytes
  }

  /** One frame from the inviter. Returns the frames to send back (none for a drop). */
  async onFrame(bytes: Uint8Array): Promise<Uint8Array[]> {
    let sender: string
    try {
      sender = decodeEnvelope(bytes).envelope.sender
    } catch (e) {
      this.events.push(isRevisionError(e) ? 'dropped:revision' : 'dropped:unreadable')
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
    if (opened.messageType === 'control') {
      if (opened.control?.controlType !== 'accept') return []
      const outcome = resolveAccept(this.state, opened.control.inReplyTo, this.inviteDigest)
      if (outcome.action !== 'adopt') {
        this.events.push('xrfa:ignored')
        return []
      }
      this.state = transition(this.state, 'receiveAccept')
      this.events.push('xrfa:adopted')
      return []
    }
    if (!admitsApplicationMessage(this.state)) {
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
    return this.onDocument(sender, envelope.document)
  }

  private async onDocument(sender: string, doc: Record<string, unknown>): Promise<Uint8Array[]> {
    const drop = (why: string) => {
      this.events.push(`dropped:${why}`)
      return []
    }
    if (sender !== this.inviter || doc.issuer !== sender || doc.recipient !== this.vid) return drop('identity')
    if (doc.threadId !== this.proposeId) return drop('wrong-thread')
    if ((doc.ceremony as { enactment?: string } | undefined)?.enactment !== this.link?.id) return drop('enactment')
    const isError = String(doc.type).includes('/trust-task-error/')
    if (!isError) {
      const problems = schemaProblems(doc)
      if (problems.length) return drop(`schema:${problems.join(';')}`)
    }
    // A proof on every step (#1034), under the issuer VID (or the inviter's relationship DID, once known).
    const underVid = verifyJcs(doc, sender)
    const underRel =
      !this.faults.strictVidProofs && !!this.theirRelationshipDid && verifyJcs(doc, this.theirRelationshipDid)
    if (!underVid && !underRel) return drop('proof')
    this.received.push(doc)
    if (isError) {
      const code = String((doc.payload as { code?: string }).code ?? '')
      this.errors.push(code)
      this.events.push(`error:${code.split('#').pop()?.split(':').pop()}`)
      return []
    }
    if (doc.type === `${PROPOSE}#response`) {
      const payload = doc.payload as { accept?: boolean; relationshipDid?: string }
      if (payload.accept !== true || typeof payload.relationshipDid !== 'string') return drop('response')
      this.theirRelationshipDid = payload.relationshipDid
      this.events.push('response:accepted')
      if (this.heldIssue) {
        const held = this.heldIssue
        this.heldIssue = undefined
        return this.onDocument(sender, held)
      }
      return []
    }
    if (doc.type === ISSUE) {
      if (!this.theirRelationshipDid) {
        this.heldIssue = doc
        return []
      }
      if (this.theirVrc) return drop('issue-again')
      const vc = (doc.payload as { vrc: Record<string, unknown> }).vrc
      const subject = vc.credentialSubject as { id?: string }
      if (vc.issuer !== this.theirRelationshipDid) return drop('vc-issuer')
      if (subject?.id !== this.relDid) return drop('vc-subject')
      if (!verifyJcs(vc, String(vc.issuer))) return drop('vc-proof')
      if (vc.validUntil !== undefined) return drop('vc-validUntil')
      this.theirVrc = vc
      this.events.push('issue:stored')
      const receipt = this.signLater({
        id: b64u(random(16)),
        type: `${ISSUE}#response`,
        threadId: this.proposeId,
        issuer: this.vid,
        recipient: this.inviter,
        issuedAt: new Date().toISOString(),
        ceremony: { enactment: this.link?.id, step: 'issue-inviter' },
        payload: { vrcDigestMultibase: this.faults.receiptWrongDigest ? digestOf({ nothing: true }) : digestOf(vc) },
      })
      return [await this.packFor(receipt), await this.packFor(this.ownIssue())]
    }
    if (doc.type === `${ISSUE}#response`) {
      this.receiptMatched = (doc.payload as { vrcDigestMultibase?: string }).vrcDigestMultibase === this.myVrcDigest
      this.events.push(this.receiptMatched ? 'receipt:matched' : 'receipt:mismatch')
      return []
    }
    return drop('unexpected-type')
  }

  /** Our VRC about the inviter's relationship DID: VC 2.0, eddsa-jcs-2022, no validUntil. */
  private ownIssue() {
    const vc = signJcs(
      {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'RelationshipCredential'],
        issuer: this.relDid,
        validFrom: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        credentialSubject: { id: this.faults.vcSubjectWrong ? this.relDid : this.theirRelationshipDid },
      },
      this.faults.vcBadProof ? random(32) : this.relSk,
      `${this.relDid}#${this.relDid.slice('did:peer:0'.length)}`
    )
    this.myVrcDigest = digestOf(vc)
    return this.signLater({
      id: b64u(random(16)),
      type: ISSUE,
      threadId: this.proposeId,
      issuer: this.vid,
      recipient: this.inviter,
      issuedAt: new Date().toISOString(),
      ceremony: { enactment: this.link?.id, step: 'issue-responder' },
      payload: { vrc: vc, vrcDigestMultibase: this.myVrcDigest },
    })
  }
}
