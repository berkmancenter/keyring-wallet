/**
 * Conformance vectors: Keyring's functions against values UPSTREAM's code
 * computed, for everything Keyring exchanges with VTI that is hashed,
 * committed or encoded. Every Keyring↔Keyring test agrees with itself; these
 * do not, and each of the defects they cover shipped once because only the
 * first kind existed (keyring-bifold#108, #116).
 *
 * `fixtures/vti-conformance-vectors.json` is produced by upstream code, never
 * by Keyring's: `card-verify vectors <card.json>` (wallet
 * `scripts/openvtc/card-verify`, built on the pinned vta-sdk, VTI a96fe02f, and
 * dtg-credentials 0.9.1). The other direction — upstream's functions run on
 * Keyring's output — is `card-verify verify-statement` and `verify_card`
 * (`check-keyring-card.sh`). To refresh after a pin advance: regenerate the
 * file with the tool at the new pin, and read every change as a finding
 * before accepting it.
 */
import { encodeTicketUri, parseTicketUri, vettingMatchCode, type TicketPresentation } from '@bifold/trust-tasks'

import { cardDigestMultibase, identityCommitment } from '../module/vtiVetting'

import vectors from './fixtures/vti-conformance-vectors.json'

type UpstreamPresentation = { ticketId?: string; secret?: string; code?: string }
const presentation = (p: UpstreamPresentation): TicketPresentation =>
  p.code ? { code: { code: p.code } } : { qr: { ticketId: p.ticketId as string, secret: p.secret as string } }

describe('the identity commitment (vta-sdk vetting/card.rs identity_commitment)', () => {
  it.each(vectors.identityCommitment.map((v, i) => [i, v] as const))('vector %i', (_i, v) => {
    const claims = (v.claims as { type: string; value: unknown }[]).filter((c) =>
      (v.requiredClaims as string[]).includes(c.type)
    )
    expect(identityCommitment(v.salt, claims)).toBe(v.expected)
  })
})

describe('the card digest (dtg-credentials digest_multibase_json, lib.rs:534)', () => {
  it('is the digest of the card without its proof', () => {
    expect(cardDigestMultibase(vectors.cardDigest.card as Record<string, unknown>)).toBe(vectors.cardDigest.expected)
  })
})

describe('the match code (vta-sdk vetting/match_code.rs vetting_match_code)', () => {
  it.each(vectors.matchCode.map((v) => [v.sessionDocumentId, v.expected] as const))('%s', (id, expected) => {
    expect(vettingMatchCode(id)).toBe(expected)
  })
})

describe('the ticket URI (vta-sdk vetting/ticket_uri.rs decode and encode)', () => {
  it.each(vectors.ticketUri.map((v) => [v.uri, v] as const))('%s', (uri, v) => {
    const parsed = parseTicketUri(uri)
    expect(parsed.community).toBe(v.decoded.community)
    expect(parsed.vetter).toBe(v.decoded.vetter)
    expect(parsed.presentation).toEqual(presentation(v.decoded.presentation as UpstreamPresentation))
    expect(
      encodeTicketUri({
        community: v.decoded.community,
        vetter: v.decoded.vetter,
        presentation: presentation(v.decoded.presentation as UpstreamPresentation),
      })
    ).toBe(v.reencoded)
  })
})
