/**
 * A community badge credential built to upstream's shape: VTI 4abe40a2a,
 * vtc-service/src/badges/credential.rs `document()` (with `id` as `issue()`
 * sets it), `achievement()` and `community_profile()`. Its proof is a VTC's
 * proof shape (vtc-service credentials/signer.rs); the value is illustrative.
 */
export const BADGE_COMMUNITY = 'did:webvh:QmCommunity:vtc.example:keyring-test-vtc'
export const BADGE_PERSONA = 'did:webvh:QmPersona:dids.example:negative-weird'
export const BADGE_IMAGE_SHA = 'ab'.repeat(32)

const OB_CONTEXT = 'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json'
const OB_SCHEMA = 'https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json'

export function badgeCredential(
  options: {
    id?: string
    validFrom?: string
    validUntil?: string
    community?: string
    subject?: string
    badgeId?: string
    /** The community's public origin, for a badge its holders may show outside (no digest in the image id). */
    publicUrl?: string
    note?: string
  } = {}
): Record<string, unknown> {
  const community = options.community ?? BADGE_COMMUNITY
  const badgeId = options.badgeId ?? 'b-helper'
  const issuer = { id: community, type: ['Profile'], name: 'Keyring Test VTC' }
  const achievementId = options.publicUrl ? `${options.publicUrl}/badges/${badgeId}` : `urn:vtc:badge:${badgeId}`
  const imageId = options.publicUrl
    ? `${options.publicUrl}/public/badges/${badgeId}/image`
    : `urn:sha256:${BADGE_IMAGE_SHA.toUpperCase()}`
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', OB_CONTEXT],
    id: options.id ?? 'urn:uuid:7d0c5b1e-4f3a-4c2b-9e8d-1a2b3c4d5e6f',
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    name: 'Helper',
    issuer,
    validFrom: options.validFrom ?? '2026-11-10T09:00:00Z',
    validUntil: options.validUntil ?? '2026-12-10T09:00:00Z',
    credentialSchema: [{ id: OB_SCHEMA, type: '1EdTechJsonSchemaValidator2019' }],
    credentialSubject: {
      type: ['AchievementSubject'],
      id: options.subject ?? BADGE_PERSONA,
      achievement: {
        id: achievementId,
        type: ['Achievement'],
        name: 'Helper',
        description: 'Answers questions in the help room.',
        creator: issuer,
        achievementType: 'Badge',
        criteria: { narrative: 'Ten answers someone found useful.' },
        image: { id: imageId, type: 'Image', caption: 'Helper', mediaType: 'image/png' },
      },
    },
    evidence: [
      {
        type: ['Evidence'],
        name: 'Award',
        narrative: options.note ?? 'Thanks for the help with the rooms.',
        description: 'Accepted 2026-11-10T08:59:00Z',
      },
    ],
    proof: {
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      proofPurpose: 'assertionMethod',
      verificationMethod: `${community}#key-0`,
      created: options.validFrom ?? '2026-11-10T09:00:00Z',
      proofValue: 'z3FXQqFwbZxKBxGxqFpCDabcM5gTnBqXxqZ4nY8qGvLmM9Q4aXcR2p7nDtWsVbJ6kHfEoYuLiTzRyNmPqWxCvBnA',
    },
  }
}
