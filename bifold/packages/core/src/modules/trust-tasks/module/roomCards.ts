/**
 * Which of an agent's cards a data room issued, so Bring back does not take a room for a community.
 *
 * Accepting a room offer stores two cards in the member's agent, both issued by the room's own DID
 * (`vtc/rooms/offers/accept`, stored with `vault/credentials/receive`): a `MembershipCredential` and an
 * `AuthorityCredential` for the actions the member holds in the room. The membership card carries exactly the
 * types a community's does (`VerifiableCredential`, `DTGCredential`, `MembershipCredential`), signed, in its
 * window and with no status list, so it passes the delivered-card check, and `classifyCredential` reads it as a
 * community membership with the room as the community. Bring back then kept a membership, and took on an
 * identity, for a "community" that is a room.
 *
 * The authority card tells the two apart. A room scopes it to its own DID and grants room actions
 * (`read`, `write`, `curate`, `admin`: data-rooms, `authority.actions`). A community's own authority card is
 * also scoped to its own DID, but grants roles (`role:member`, `role:vetter`) and carries `maxAttenuation`. An
 * issuer is a room when it gave the agent an authority card scoped to itself whose actions are all room actions;
 * every card that issuer gave is a room's card.
 *
 * Room actions are an allowlist: a room that gains an action outside the four stops matching, and its cards are
 * read as a community's again. A community group's membership card (issued by the group's DID, with the
 * community's `issue-membership` authority to the group) is the same kind of card and is not caught here either.
 *
 * @module trust-tasks/module/roomCards
 */

const ROOM_ACTIONS: ReadonlySet<string> = new Set(['read', 'write', 'curate', 'admin'])

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

const issuerOf = (credential: Record<string, unknown>): string | undefined => {
  const issuer = credential.issuer
  if (typeof issuer === 'string') return issuer
  const id = asObject(issuer)?.id
  return typeof id === 'string' ? id : undefined
}

/** The room an authority card names, when it is a room's grant of room actions at its own DID. */
function roomOfAuthority(credential: Record<string, unknown>): string | undefined {
  const types = ([] as unknown[]).concat(credential.type ?? []).map(String)
  if (!types.includes('AuthorityCredential')) return undefined
  const authority = asObject(asObject(credential.credentialSubject)?.authority)
  const issuer = issuerOf(credential)
  if (!authority || !issuer || authority.scope !== issuer) return undefined
  const actions = ([] as unknown[]).concat(authority.actions ?? [])
  if (!actions.length || !actions.every((a) => typeof a === 'string' && ROOM_ACTIONS.has(a))) return undefined
  return issuer
}

/** The issuers among `cards` that are data rooms. */
export function roomIssuersOf(cards: Iterable<{ credential?: Record<string, unknown> }>): Set<string> {
  const rooms = new Set<string>()
  for (const { credential } of cards) {
    const room = credential ? roomOfAuthority(credential) : undefined
    if (room) rooms.add(room)
  }
  return rooms
}

/** Whether a data room issued `credential`, given the rooms {@link roomIssuersOf} found among the same cards. */
export function issuedByRoom(credential: Record<string, unknown>, rooms: ReadonlySet<string>): boolean {
  const issuer = issuerOf(credential)
  return !!issuer && rooms.has(issuer)
}

/** `cards` without the ones a data room issued. */
export function withoutRoomCards<T extends { credential?: Record<string, unknown> }>(cards: readonly T[]): T[] {
  const rooms = roomIssuersOf(cards)
  if (rooms.size === 0) return [...cards]
  return cards.filter(({ credential }) => !credential || !issuedByRoom(credential, rooms))
}
