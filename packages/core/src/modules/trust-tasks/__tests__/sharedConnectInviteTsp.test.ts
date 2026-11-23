/**
 * The inviter's TSP half against upstream's own 1.0 library (@openvtc/vti-tsp-js 0.4.0), real crypto, no network:
 * a scanner written with upstream's codec sends `XRFI` to a code's encounter VID; the inviter's frame opener
 * (openInviterFrame) reads it, its accept (answerInviteOverTsp) is one upstream ADOPTS against its pending invite,
 * and the scanner's propose that follows opens as a document from that scanner. This is the exchange an
 * affinidi-based scanner holds its propose for (relationship-over-tsp plan WP9, §3.3).
 */
import {
  admitsApplicationMessage,
  pack as v1Pack,
  packAccept as v1PackAccept,
  packInvite as v1PackInvite,
  resolveAccept as v1ResolveAccept,
  transition as v1Transition,
  unpack as v1Unpack,
} from '@openvtc/vti-tsp-js-v1'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'

import { tsp } from '@bifold/trust-tasks'

import { openInviterFrame } from '../module/sharedConnectInvite'
import { answerInviteOverTsp, type TspSessionIdentity } from '../module/vtiTsp'

const INVITER = 'did:peer:2.inviter-encounter-vid'
const SCANNER = 'did:peer:2.scanner-encounter-vid'
const RELAY = 'did:webvh:relay.example'
const sk = {
  inviterSign: ed25519.utils.randomSecretKey(),
  inviterEnc: x25519.utils.randomSecretKey(),
  scannerSign: ed25519.utils.randomSecretKey(),
  scannerEnc: x25519.utils.randomSecretKey(),
}
const pk = {
  inviterSign: ed25519.getPublicKey(sk.inviterSign),
  inviterEnc: x25519.getPublicKey(sk.inviterEnc),
  scannerSign: ed25519.getPublicKey(sk.scannerSign),
  scannerEnc: x25519.getPublicKey(sk.scannerEnc),
}
const resolver: tsp.VidResolver = {
  async resolve(vid) {
    if (vid === INVITER) return { signingPublicKey: pk.inviterSign, encryptionPublicKey: pk.inviterEnc }
    if (vid === SCANNER) return { signingPublicKey: pk.scannerSign, encryptionPublicKey: pk.scannerEnc }
    throw new Error(`unknown ${vid}`)
  },
}
const inviter: TspSessionIdentity = {
  identity: {
    signingKey: { publicKey: pk.inviterSign, sign: async (m) => ed25519.sign(m, sk.inviterSign) },
    keyAgreement: { publicKey: pk.inviterEnc, agree: async (peer) => x25519.getSharedSecret(sk.inviterEnc, peer) },
  },
  resolver,
  codec: tsp.createTspCodec(),
}
const scannerKeys = { senderSigningKey: sk.scannerSign, receiverEncryptionKey: pk.inviterEnc }

test("upstream's XRFI is read by the inviter, our XRFA is adopted, and the propose after it opens as the scanner's", async () => {
  // The scanner greets, routed back to itself through the relay, as Keyring's own scanner does.
  let state = v1Transition('none', 'sendInvite')
  const invite = await v1PackInvite(SCANNER, INVITER, scannerKeys, { route: [RELAY, SCANNER] })

  const read = await openInviterFrame(inviter, INVITER, invite.bytes)
  expect(read).toMatchObject({ kind: 'invite', sender: SCANNER, revision: 'v1' })
  if (read.kind !== 'invite') return

  const accept = await answerInviteOverTsp(inviter, INVITER, SCANNER, read.digest, read.revision)
  const opened = await v1Unpack(accept.bytes, {
    receiverDecryptionKey: sk.scannerEnc,
    senderSigningKey: pk.inviterSign,
  })
  expect(opened.control?.controlType).toBe('accept')
  expect(v1ResolveAccept(state, opened.control?.inReplyTo, invite.threadDigest)).toEqual({ action: 'adopt' })
  state = v1Transition(state, 'receiveAccept')
  expect(admitsApplicationMessage(state)).toBe(true)

  // With the relationship formed, the scanner proposes.
  const document = {
    id: 'AAECAwQFBgcICQoLDA0ODw',
    type: 'https://trusttasks.org/spec/vrc/relationships/propose/0.1',
    issuer: SCANNER,
    recipient: INVITER,
  }
  const proposeFrame = await v1Pack(tsp.encodeTrustTaskEnvelope(document), SCANNER, INVITER, scannerKeys)
  expect(await openInviterFrame(inviter, INVITER, proposeFrame.bytes)).toMatchObject({
    kind: 'document',
    sender: SCANNER,
    document,
    revision: 'v1',
  })
})

test('control: an invite to ANOTHER VID, or a frame sealed to another key, is nothing the inviter answers', async () => {
  const other = await v1PackInvite(SCANNER, 'did:peer:2.someone-else', { ...scannerKeys }, {})
  // Sealed to the inviter's key but addressed to another VID: opens, then fails the receiver check.
  expect(await openInviterFrame(inviter, INVITER, other.bytes)).toEqual({ kind: 'none' })
  const sealedElsewhere = await v1PackInvite(
    SCANNER,
    INVITER,
    { senderSigningKey: sk.scannerSign, receiverEncryptionKey: pk.scannerEnc },
    {}
  )
  expect(await openInviterFrame(inviter, INVITER, sealedElsewhere.bytes)).toEqual({ kind: 'none' })
})

test("control: upstream's own ACCEPT arriving at the inviter is not an invite, and is not answered", async () => {
  const ourInvite = await tsp.packInviteV1(INVITER, SCANNER, inviter.identity, resolver)
  const theirAccept = await v1PackAccept(ourInvite.threadDigest, SCANNER, INVITER, scannerKeys)
  expect(await openInviterFrame(inviter, INVITER, theirAccept.bytes)).toEqual({ kind: 'none' })
})
