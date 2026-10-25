/**
 * Merging two contacts that are the same person, and separating them again, on the person's own word. A merge only
 * writes contact links (contactLinks.ts); a separation only removes them. No credential, connection or message is
 * touched by either, so a merge is always undone by separating.
 *
 * Candidates are offered, never merged on their own: two contacts are offered as the same person when their cards
 * give the same name (and, when both give an email, the same email). Two different people can share a name, so the
 * person decides.
 *
 * @module vrc/contacts/mergeContacts
 */
import type { W3cCredentialRecord } from '@credo-ts/core'

import { isPeerVrcCredential } from '../credentialTypes'
import { resolveContactDisplayInfo, toRawCredential } from '../utils/rcardDisplayUtils'

import { CONTACT_LINK, ContactLinkStore, ContactLinks, contactIdOf, relationshipsOfContact } from './contactLinks'

/** How a merge was confirmed: by the person ('user'), or also by the other phone ('peer', continuity.ts). */
export type MergeConfirmation = 'user' | 'peer'

export interface MergeCandidate {
  /** A relationship of the other contact (its newest), to merge with. */
  issuerId: string
  name: string
}

const issuerOf = (raw: { issuer?: unknown }): string | undefined =>
  typeof raw.issuer === 'string' ? raw.issuer : (raw.issuer as { id?: string } | undefined)?.id

const normalise = (value: string | undefined) => value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

/** Every relationship's issuer DID with the date of its newest card, newest first. */
function relationshipsByRecency(records: W3cCredentialRecord[]): { issuerId: string; at: string }[] {
  const newest = new Map<string, string>()
  for (const record of records) {
    const raw = toRawCredential(record)
    const issuer = raw && issuerOf(raw)
    if (!raw || !issuer || !isPeerVrcCredential(raw)) continue
    const at = String(raw.validFrom ?? raw.issuanceDate ?? '')
    if (!newest.has(issuer) || at > newest.get(issuer)!) newest.set(issuer, at)
  }
  return [...newest].map(([issuerId, at]) => ({ issuerId, at })).sort((a, b) => b.at.localeCompare(a.at))
}

/** Other contacts whose cards say they are the same person as the contact of `issuerId`. */
export function findMergeCandidates(
  records: W3cCredentialRecord[],
  links: ContactLinks,
  issuerId: string
): MergeCandidate[] {
  const mine = resolveContactDisplayInfo(records, issuerId)
  const name = normalise(mine.name)
  if (!name) return []
  const ownContact = contactIdOf(links, issuerId)
  const seen = new Set<string>([ownContact])
  const candidates: MergeCandidate[] = []
  for (const { issuerId: other } of relationshipsByRecency(records)) {
    const contact = contactIdOf(links, other)
    if (seen.has(contact)) continue
    seen.add(contact)
    const theirs = resolveContactDisplayInfo(records, other)
    if (normalise(theirs.name) !== name) continue
    const emails = [normalise(mine.email), normalise(theirs.email)]
    if (emails[0] && emails[1] && emails[0] !== emails[1]) continue
    candidates.push({ issuerId: other, name: theirs.name ?? mine.name ?? '' })
  }
  return candidates
}

/** The date of a contact's first card: the merged contact keeps the older contact's id. */
function firstCardAt(records: W3cCredentialRecord[], members: string[]): string {
  const dates = relationshipsByRecency(records)
    .filter((r) => members.includes(r.issuerId))
    .map((r) => r.at)
  return dates.sort()[0] ?? ''
}

async function linkRecordsOf(agent: ContactLinkStore, query: Record<string, string>) {
  return (await agent.genericRecords.findAllByQuery({ recordType: CONTACT_LINK, ...query })) ?? []
}

/**
 * Merge the contacts of every relationship in `issuerIds` into one, kept under the id of the contact whose first card
 * is oldest (the first given wins a tie). Every relationship of every other contact is linked straight to it, a link
 * it had before replaced, so no link ever points at another link. Three namesakes merge in one step this way, not two.
 */
export async function mergeAllContacts(
  agent: ContactLinkStore,
  records: W3cCredentialRecord[],
  links: ContactLinks,
  issuerIds: string[],
  confirmation: MergeConfirmation = 'user'
): Promise<void> {
  const contacts = new Map<string, string[]>()
  for (const issuerId of issuerIds) {
    const contact = contactIdOf(links, issuerId)
    if (!contacts.has(contact)) contacts.set(contact, relationshipsOfContact(links, issuerId))
  }
  if (contacts.size < 2) return
  let contactId = ''
  let oldest = ''
  for (const [contact, members] of contacts) {
    const first = firstCardAt(records, members)
    if (!contactId || first < oldest) {
      contactId = contact
      oldest = first
    }
  }
  for (const [contact, members] of contacts) {
    if (contact === contactId) continue
    for (const member of members) {
      for (const old of await linkRecordsOf(agent, { issuerDid: member })) await agent.genericRecords.deleteById(old.id)
      await agent.genericRecords.save({
        content: { issuerDid: member, contactId, confirmation },
        tags: { recordType: CONTACT_LINK, issuerDid: member, contactId },
      })
    }
  }
}

/** Merge the contacts of `issuerId` and `otherIssuerId` into one, kept under the older contact's id. */
export async function mergeContacts(
  agent: ContactLinkStore,
  records: W3cCredentialRecord[],
  links: ContactLinks,
  issuerId: string,
  otherIssuerId: string,
  confirmation: MergeConfirmation = 'user'
): Promise<void> {
  await mergeAllContacts(agent, records, links, [issuerId, otherIssuerId], confirmation)
}

/** Separate a merged contact: every relationship it holds is its own contact again. */
export async function separateContact(agent: ContactLinkStore, links: ContactLinks, issuerId: string): Promise<void> {
  for (const record of await linkRecordsOf(agent, { contactId: contactIdOf(links, issuerId) })) {
    await agent.genericRecords.deleteById(record.id)
  }
}
