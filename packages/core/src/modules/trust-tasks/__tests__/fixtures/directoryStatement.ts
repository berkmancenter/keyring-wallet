/**
 * A directory statement as tf#823 (head ad47ffbf) shapes it
 * (`vtc/directory/_shared/0.1/disclosure-statement`), with its
 * `statementDigest` computed as the spec defines: SHA-256 over the JCS of the
 * statement without that member, multibase base58btc.
 */
import { digestMultibase } from '@bifold/trust-tasks'

export const statementBody = () => ({
  fields: [
    {
      key: 'displayName',
      label: 'Name',
      type: 'text',
      source: 'member',
      ceiling: 'public',
      defaultVisibility: 'members',
      searchable: true,
    },
    {
      key: 'org.example.roleNote',
      label: 'Role note',
      description: 'What the <b>admins</b> say you do',
      type: 'longText',
      source: 'admin',
      ceiling: 'members',
      defaultVisibility: 'admins',
      searchable: false,
      facet: false,
    },
  ],
  newCard: { listing: 'findable', search: 'byName', introductions: 'connections' },
  membershipIdentifiers: 'admins',
  adminNotes: true,
  groups: { credentialValidity: 'P30D' },
  externalCards: false,
})

export const statement = (): Record<string, unknown> & { statementDigest: string } => {
  const body = statementBody()
  return { ...body, statementDigest: digestMultibase(body) }
}
