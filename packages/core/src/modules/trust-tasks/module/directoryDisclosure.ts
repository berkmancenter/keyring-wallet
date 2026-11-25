/**
 * directoryDisclosure — a community's statement of what its member directory
 * would show about a member, and to whom (VTI-DIR-130), as join manifest/0.4
 * carries it (tf#823: `vtc/directory/_shared/0.1/disclosure-statement`).
 *
 * Read strictly: the person is shown it before they apply, so a statement
 * that is missing a required member, or names an audience, listing, search or
 * source this wallet does not know, is refused (`MalformedDisclosure`) and
 * the join stops, rather than letting them apply without seeing what it says.
 * Members the statement does not need for that (a later member, `ext`) are
 * ignored, since the spec is a draft that may add them.
 *
 * Every audience is a maximum: a value reaches a viewer only where the
 * member's choice, the field's ceiling and the community's policy all admit
 * them. An absent statement says nothing — a 0.3 answer, or a community with
 * no directory, carries none — and is never read as "no directory".
 *
 * Types here are hand-written against tf#823 (head ad47ffbf) until the next
 * @openvtc/trust-tasks release generates `DirectoryDisclosure`.
 *
 * @module trust-tasks/module/directoryDisclosure
 */
import { digestMultibase } from '@bifold/trust-tasks'

export const DIRECTORY_AUDIENCES = ['admins', 'groups', 'connections', 'members', 'public'] as const
export type DirectoryAudience = (typeof DIRECTORY_AUDIENCES)[number]

export const FIELD_SOURCES = ['member', 'admin', 'credential', 'derived'] as const
export type FieldSource = (typeof FIELD_SOURCES)[number]

export const CARD_LISTINGS = ['listed', 'findable', 'hidden'] as const
export const CARD_SEARCH = ['byName', 'exactNickname', 'off'] as const
export const CARD_INTRODUCTIONS = ['anyone', 'groups', 'connections', 'off'] as const

/** One active field of the directory, as an applicant needs to see it. */
export interface DisclosedField {
  key: string
  /** The community's own label: shown as text, never as markup. */
  label: string
  /** The community's own description, when it gave one: shown as text, never as markup. */
  description?: string
  type: string
  /** Who writes the value. `admin`: what the community asserts about the member, which they cannot change. */
  source: FieldSource
  /** The widest audience the field may ever reach. */
  ceiling: DirectoryAudience
  /** The audience a new card gives the field until its member chooses. */
  defaultVisibility: DirectoryAudience
  searchable: boolean
  facet?: boolean
}

export interface DirectoryDisclosure {
  /** Every active field, in display order. A field the community does not collect is absent. */
  fields: DisclosedField[]
  newCard: {
    listing: (typeof CARD_LISTINGS)[number]
    search: (typeof CARD_SEARCH)[number]
    introductions?: (typeof CARD_INTRODUCTIONS)[number]
  }
  /** The widest audience the DID a member joined with can reach through the directory. */
  membershipIdentifiers: DirectoryAudience
  adminNotes: boolean
  /** Present when the community has groups: how long a group membership credential is valid (ISO 8601). */
  groups?: { credentialValidity: string }
  /** Whether a member may publish a card beyond the community (their own choice, off on a new card). */
  externalCards: boolean
  /** Names this exact statement: kept with the join record. */
  statementDigest: string
}

/** A disclosure that cannot be shown as it stands: the join stops. */
export class MalformedDisclosure extends Error {
  readonly code = 'keyring/join/disclosureMalformed'
  constructor(readonly reason: string) {
    super(`The community's directory statement could not be read: ${reason}`)
    this.name = 'MalformedDisclosure'
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function oneOf<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new MalformedDisclosure(`${where} is ${JSON.stringify(value)}, not one of ${allowed.join(', ')}`)
  }
  return value as T
}

function bool(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') throw new MalformedDisclosure(`${where} is missing or not true/false`)
  return value
}

function text(value: unknown, where: string, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new MalformedDisclosure(`${where} is missing or not text of 1 to ${max} characters`)
  }
  return value
}

function fieldOf(raw: unknown, i: number): DisclosedField {
  const where = `fields[${i}]`
  if (!isRecord(raw)) throw new MalformedDisclosure(`${where} is not an object`)
  const description = raw.description === undefined ? undefined : text(raw.description, `${where}.description`, 280)
  return {
    key: text(raw.key, `${where}.key`, 128),
    label: text(raw.label, `${where}.label`, 64),
    ...(description !== undefined ? { description } : {}),
    type: text(raw.type, `${where}.type`, 64),
    source: oneOf(raw.source, FIELD_SOURCES, `${where}.source`),
    ceiling: oneOf(raw.ceiling, DIRECTORY_AUDIENCES, `${where}.ceiling`),
    defaultVisibility: oneOf(raw.defaultVisibility, DIRECTORY_AUDIENCES, `${where}.defaultVisibility`),
    searchable: bool(raw.searchable, `${where}.searchable`),
    ...(raw.facet === undefined ? {} : { facet: bool(raw.facet, `${where}.facet`) }),
  }
}

/**
 * The `statementDigest` recomputed: SHA-256 over the JCS of the statement
 * without that member, multibase base58btc (tf#823). Only a digest in that
 * RECOMMENDED form (`zQm…`) is compared; another algorithm or encoding is
 * kept as given, since this wallet computes only that one.
 */
function digestHolds(raw: Record<string, unknown>, published: string): boolean {
  if (!published.startsWith('zQm')) return true
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { statementDigest: _digest, ...rest } = raw
  return digestMultibase(rest) === published
}

/** The statement as received, read strictly (see the module note). Throws `MalformedDisclosure`. */
export function readDirectoryDisclosure(raw: unknown): DirectoryDisclosure {
  if (!isRecord(raw)) throw new MalformedDisclosure('it is not an object')
  if (!Array.isArray(raw.fields)) throw new MalformedDisclosure('fields is missing')
  if (raw.fields.length > 128) throw new MalformedDisclosure('fields has more than 128 entries')
  const fields = raw.fields.map(fieldOf)
  if (!isRecord(raw.newCard)) throw new MalformedDisclosure('newCard is missing')
  const newCard = {
    listing: oneOf(raw.newCard.listing, CARD_LISTINGS, 'newCard.listing'),
    search: oneOf(raw.newCard.search, CARD_SEARCH, 'newCard.search'),
    ...(raw.newCard.introductions === undefined
      ? {}
      : { introductions: oneOf(raw.newCard.introductions, CARD_INTRODUCTIONS, 'newCard.introductions') }),
  }
  let groups: DirectoryDisclosure['groups']
  if (raw.groups !== undefined) {
    if (!isRecord(raw.groups)) throw new MalformedDisclosure('groups is not an object')
    groups = { credentialValidity: text(raw.groups.credentialValidity, 'groups.credentialValidity', 32) }
  }
  const statementDigest = text(raw.statementDigest, 'statementDigest', 512)
  if (!digestHolds(raw, statementDigest)) {
    throw new MalformedDisclosure('statementDigest does not name this statement')
  }
  return {
    fields,
    newCard,
    membershipIdentifiers: oneOf(raw.membershipIdentifiers, DIRECTORY_AUDIENCES, 'membershipIdentifiers'),
    adminNotes: bool(raw.adminNotes, 'adminNotes'),
    ...(groups ? { groups } : {}),
    externalCards: bool(raw.externalCards, 'externalCards'),
    statementDigest,
  }
}

/**
 * A request about to be sent under a directory statement the person was not
 * shown: none shown, or a different one (the statement changed after it was
 * shown). Nothing is sent; the screen shows the current statement again.
 */
export class DisclosureNotShown extends Error {
  readonly code = 'keyring/join/disclosureNotShown'
  constructor(readonly statementDigest: string) {
    super("The community's directory statement must be shown before the request is sent")
    this.name = 'DisclosureNotShown'
  }
}

/**
 * Whether a request under `manifest` may go: it carries no statement, or the
 * person was shown this exact one (`seen` is the digest of the statement the
 * screen showed).
 */
export function disclosureShown(
  manifest: { directoryDisclosure?: Pick<DirectoryDisclosure, 'statementDigest'> },
  seen: string | undefined
): boolean {
  return !manifest.directoryDisclosure || manifest.directoryDisclosure.statementDigest === seen
}

/**
 * The order a screen sends in, when it asks for a confirmation (Face ID)
 * first: read the manifest, refuse if its statement is not the one shown,
 * and only then ask. Nobody is asked to confirm a request that will not be
 * sent. Undefined: the person declined to confirm.
 */
export async function readShownThenConfirm<
  M extends { directoryDisclosure?: Pick<DirectoryDisclosure, 'statementDigest'> },
>(shown: string | undefined, read: () => Promise<M>, confirm: () => Promise<boolean>): Promise<M | undefined> {
  const manifest = await read()
  if (!disclosureShown(manifest, shown)) throw new DisclosureNotShown(manifest.directoryDisclosure!.statementDigest)
  return (await confirm()) ? manifest : undefined
}
