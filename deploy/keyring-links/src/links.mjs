/**
 * Short invitation links: ids, what counts as an invitation, and the long link
 * a browser is sent to. No I/O here; see store.mjs and server.mjs.
 */
import { randomBytes } from 'node:crypto'

/** 128 random bits, base64url: 22 characters, unguessable, no sequence. */
export const newId = () => randomBytes(16).toString('base64url')

export const ID_RE = /^[A-Za-z0-9_-]{22}$/

/** Out-of-band invitation types a Keyring invitation can carry (`@type` for v1, `type` for v2). */
export const V1_TYPES = new Set([
  'https://didcomm.org/out-of-band/1.0/invitation',
  'https://didcomm.org/out-of-band/1.1/invitation',
  'did:sov:BzCbsNYhMrjHiqZDTUASHg;spec/out-of-band/1.0/invitation',
  'did:sov:BzCbsNYhMrjHiqZDTUASHg;spec/out-of-band/1.1/invitation',
])
export const V2_TYPE = 'https://didcomm.org/out-of-band/2.0/invitation'

/** A JSON object whose type is an out-of-band invitation. Nothing else is stored. */
export const isInvitation = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (V1_TYPES.has(value['@type']) || value.type === V2_TYPE)

/**
 * The long link the existing install page understands (`/invite/?oob=<base64url>`,
 * the form Credo's `toUrl` produces). Its "Already have the app?" fallback is built
 * from `?oob=`, so a browser is sent there rather than shown the page at /i/<id>.
 */
export const longInviteUrl = (publicUrl, invitationText) =>
  `${publicUrl.replace(/\/+$/, '')}/invite/?oob=${Buffer.from(invitationText, 'utf8').toString('base64url')}`
