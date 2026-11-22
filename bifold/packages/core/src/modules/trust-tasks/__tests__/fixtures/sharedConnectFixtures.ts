/** Shared fixtures for the shared-connect tests: peer DIDs shaped like the ones the flow carries, and links to them. */

const b64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')

const VERIFICATION = 'Vz6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const ENCRYPTION = 'Ez6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc'

/** A numalgo-2 DID with the given services written as numalgo 2 writes them (`t` type, `s` endpoint). */
export const peer2 = (services: Record<string, unknown>[]): string =>
  `did:peer:2.${VERIFICATION}.${ENCRYPTION}${services.map((s) => `.S${b64url(s)}`).join('')}`

export const MEDIATOR_DID = 'did:peer:2.Vz6MkMediatorKeyForTests.Ez6LSMediatorAgreementKeyForTests'

/** Keyring's own spelling: `TSPTransport` with a mediator DID, beside `DIDCommMessaging`. */
export const KEYRING_STYLE_DID = peer2([
  { t: 'dm', s: { uri: MEDIATOR_DID, a: ['didcomm/v2'] } },
  { t: 'TSPTransport', s: MEDIATOR_DID },
])

/** The TSP reference's spelling: `tsp` with an object endpoint. */
export const REFERENCE_STYLE_DID = peer2([{ t: 'tsp', s: { uri: 'https://relay.example.org/tsp' } }])

export const ENCOUNTER_ID = 'XOcGXOQTCHb5iz4T2JD2RQ'
export const NOW = 1_800_000_000

export const sharedConnectLink = (
  over: { from?: string; id?: string; exp?: number | null; label?: string; type?: string; host?: string } = {}
): string => {
  const from = over.from ?? KEYRING_STYLE_DID
  const exp = over.exp === undefined ? NOW + 600 : over.exp
  const parts = [`_from=${from}`, `_id=${over.id ?? ENCOUNTER_ID}`]
  if (exp !== null) parts.push(`_exp=${exp}`)
  if (over.label !== undefined) parts.push(`_label=${encodeURIComponent(over.label)}`)
  parts.push(`_type=${over.type ?? '/vti/flow/shared-connect/0.1'}`)
  return `https://${over.host ?? 'link.trustoverip.org'}/t#${parts.join('&')}`
}
