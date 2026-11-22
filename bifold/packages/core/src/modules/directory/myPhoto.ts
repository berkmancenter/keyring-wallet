/**
 * Which profile photo this phone put on the member's card in a community, so "Your card" can ask when the profile's
 * photo changes since (the name has the same prompt). The community keeps its own re-encoding, so the card's digest
 * can't be compared with the profile's photo: this keeps both digests, the profile photo's as sent and the card's as
 * the community answered, and nothing else, never the photo.
 *
 * Asked about only while the card still holds the picture this phone put there: a picture changed elsewhere (the
 * portal, another phone) is not this phone's to offer to replace. One record per community in the agent's encrypted
 * store. When the photo comes off the card or the phone leaves, the record is rewritten empty rather than deleted, as
 * the names are (`names.ts`): no digest is left behind.
 *
 * @module directory/myPhoto
 */
import type { Agent } from '@credo-ts/core'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { createKeyLock } from '../../utils/keyLock'

const PHOTO_TYPE = 'directory-my-photo'
const recordId = (communityDid: string) => `${PHOTO_TYPE}:${communityDid}`

// One community's reads and writes in turn: a leave racing a save would otherwise leave the save's digests behind.
const inTurn = createKeyLock()

export interface SentPhoto {
  /** SHA-256 of the profile photo's `data:` URI as it was sent. */
  profile: string
  /** The digest of the community's copy, as its card holds it. */
  card: string
}

/** The digest this module compares a profile photo by. */
export const photoDigest = (photo: string): string => bytesToHex(sha256(utf8ToBytes(photo)))

const isDigest = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

export function loadSentPhoto(agent: Agent, communityDid: string): Promise<SentPhoto | undefined> {
  return inTurn(communityDid, async () => {
    const content = (await agent.genericRecords.findById(recordId(communityDid)))?.content
    return isDigest(content?.profile) && isDigest(content?.card)
      ? { profile: content.profile, card: content.card }
      : undefined
  })
}

/** Keep what was sent, or with nothing, forget it: the photo came off the card, or the phone left. */
export function keepSentPhoto(agent: Agent, communityDid: string, sent: SentPhoto | undefined): Promise<void> {
  return inTurn(communityDid, async () => {
    const record = await agent.genericRecords.findById(recordId(communityDid))
    const content = sent ? { profile: sent.profile, card: sent.card } : {}
    if (record) {
      record.content = content
      await agent.genericRecords.update(record)
    } else if (sent) {
      await agent.genericRecords.save({ id: recordId(communityDid), content, tags: { type: PHOTO_TYPE } })
    }
  })
}
