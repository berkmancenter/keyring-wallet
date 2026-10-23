/**
 * Which relationships are the same person. Every relationship has its own pairwise DID (the card's issuer), so a
 * second exchange with someone you already know arrives as a new issuer and, grouped by issuer, a second contact
 * row. A link record, kept only on this phone, says that a relationship belongs to another contact:
 * `issuerDid → contactId`, where the contact id is the issuer DID of that contact's first relationship.
 *
 * With no link records, a contact is its one relationship (contact id = issuer DID), which is how the Contacts list
 * has always grouped. Links are written only by a merge the person chooses; nothing here deletes a credential,
 * connection or message, and removing a link separates the rows again.
 *
 * @module vrc/contacts/contactLinks
 */
import type { Agent } from '@credo-ts/core'

/** genericRecords recordType of a contact link. */
export const CONTACT_LINK = 'keyring.contact-link'

/** issuer DID → contact id, for linked relationships only. */
export type ContactLinks = ReadonlyMap<string, string>

/** The one empty set of links, shared so that "nothing linked" keeps one identity. Never written to. */
export const NO_CONTACT_LINKS: ContactLinks = new Map()

/** Whether two sets of links say the same thing: the same relationships, each linked to the same contact. */
export function sameContactLinks(a: ContactLinks, b: ContactLinks): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [issuerDid, contactId] of a) if (b.get(issuerDid) !== contactId) return false
  return true
}

/** The contact a relationship belongs to: its link's contact id, or the relationship itself. */
export function contactIdOf(links: ContactLinks, issuerDid: string): string {
  return links.get(issuerDid) ?? issuerDid
}

/**
 * Every relationship of the contact `issuerDid` belongs to, `issuerDid` first. An unlinked relationship is a group
 * of one.
 */
export function relationshipsOfContact(links: ContactLinks, issuerDid: string): string[] {
  const contactId = contactIdOf(links, issuerDid)
  const members = new Set<string>([issuerDid, contactId])
  for (const [member, id] of links) if (id === contactId) members.add(member)
  return [...members]
}

/** The links stored on this phone. None when there is no agent yet or no record store. */
export async function loadContactLinks(agent: Agent | undefined): Promise<ContactLinks> {
  const records =
    (agent?.genericRecords && (await agent.genericRecords.findAllByQuery({ recordType: CONTACT_LINK }))) || []
  const links = new Map<string, string>()
  for (const record of records) {
    const { issuerDid, contactId } = (record.content ?? {}) as { issuerDid?: unknown; contactId?: unknown }
    if (typeof issuerDid === 'string' && typeof contactId === 'string' && issuerDid !== contactId) {
      links.set(issuerDid, contactId)
    }
  }
  // The same empty map every time, so a list with nothing linked does not regroup on each read.
  return links.size > 0 ? links : NO_CONTACT_LINKS
}
