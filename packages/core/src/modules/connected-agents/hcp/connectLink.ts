/**
 * The HCP connect link the CLI shows as a QR (step 7.27 track C, "The connect link"):
 *
 * `https://link.trustoverip.org/t#_from=<clientVid>&_id=<uuid>&_type=/vti/flow/hcp-connect/0.1`
 *
 * Exactly those three members, in any order, in the fragment; `_type` may also be the absolute form. Anything else, a
 * missing member or a member twice is not an HCP connect link. The link does not carry the VTA's DID (decided in the
 * brief: with one it can pass the 251-byte limit, VTI-LNK-081), and it carries no expiry: the consent request's own
 * `expiresAt` bounds a late scan.
 *
 * This file only reads and writes the link. It registers no trigger flow, and the scanner does not call it.
 *
 * @module connected-agents/hcp/connectLink
 */
import { utf8ToBytes } from '@noble/hashes/utils.js'

import type { HcpConnectLink } from './types'

const PREFIX = 'https://link.trustoverip.org/t#'
/** The longest link read, in UTF-8 bytes (VTI-LNK-081). */
export const HCP_LINK_MAX_BYTES = 251
export const HCP_CONNECT_TYPE = '/vti/flow/hcp-connect/0.1'
export const HCP_CONNECT_TYPE_ABSOLUTE = 'https://link.trustoverip.org/vti/flow/hcp-connect/0.1'

/** An Ed25519 `did:key` (multibase base58btc, multicodec `0xed`): 56 characters. */
const CLIENT_VID = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/
/** A lower-case v4 UUID. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const MEMBERS = ['_from', '_id', '_type'] as const

/** The link's parts, or `undefined` when `text` is not exactly an HCP connect link. */
export function readHcpConnectLink(text: string): HcpConnectLink | undefined {
  if (typeof text !== 'string' || utf8ToBytes(text).length > HCP_LINK_MAX_BYTES) return undefined
  if (!text.startsWith(PREFIX)) return undefined
  const fragment = text.slice(PREFIX.length)
  const values: Partial<Record<(typeof MEMBERS)[number], string>> = {}
  for (const part of fragment.split('&')) {
    const eq = part.indexOf('=')
    if (eq < 0) return undefined
    const name = part.slice(0, eq)
    if (!(MEMBERS as readonly string[]).includes(name)) return undefined
    const member = name as (typeof MEMBERS)[number]
    if (values[member] !== undefined) return undefined
    let value: string
    try {
      value = decodeURIComponent(part.slice(eq + 1))
    } catch {
      return undefined
    }
    values[member] = value
  }
  const { _from: clientVid, _id: uuid, _type: type } = values
  if (clientVid === undefined || uuid === undefined || type === undefined) return undefined
  if (!CLIENT_VID.test(clientVid) || !UUID.test(uuid)) return undefined
  if (type !== HCP_CONNECT_TYPE && type !== HCP_CONNECT_TYPE_ABSOLUTE) return undefined
  return { clientVid, uuid, threadId: `urn:uuid:${uuid}` }
}

/**
 * The link for `clientVid` and `uuid`, in the relative `_type` form. Throws on a value the reader would refuse: it
 * never writes a link `readHcpConnectLink` cannot read back.
 */
export function hcpConnectLink(link: { clientVid: string; uuid: string }): string {
  if (!CLIENT_VID.test(link.clientVid)) throw new Error('not an Ed25519 did:key')
  if (!UUID.test(link.uuid)) throw new Error('not a lower-case v4 UUID')
  return `${PREFIX}_from=${link.clientVid}&_id=${link.uuid}&_type=${HCP_CONNECT_TYPE}`
}
