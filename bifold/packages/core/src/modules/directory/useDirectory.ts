/**
 * The screens' side of the directory: the service for a community screen, the members list a page at a time, and
 * the member's own card with what "Your card" would put on it.
 *
 * The members list is read only while a screen shows it and kept only in that screen's state: nothing here keeps a
 * list of a community's members (`vtc/directory/entries/show/0.1`, "A viewer MUST NOT reuse [the projection] to
 * build a list of the community's members outside the directory").
 *
 * @module directory/useDirectory
 */
import { useAgent } from '@bifold/react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { TOKENS, useServices } from '../../container-api'
import { useMyName } from '../rooms/useMyName'

import { createDirectoryBackend } from './directoryBackend'
import { AgentDirectoryService, directoryStatusOf } from './directoryService'
import { confirmDirectoryNames, keepDirectoryName, loadDirectoryNames } from './names'
import type {
  CardField,
  CardProposal,
  DirectoryAudience,
  DirectoryService,
  MemberCard,
  MemberRow,
  MyCard,
  OperationStatus,
} from './types'
import { NAME_FIELD } from './types'

/** The least time between two pages, so scrolling stays under a community's read limit (60 a minute by default). */
export const MEMBERS_PAGE_SPACING_MS = 1000

/**
 * The directory client for this phone's agent; undefined until there is an agent. The mediator is the build's
 * (`config.vti.mediatorDid`) unless a screen names one.
 */
export function useDirectoryService(mediatorDid?: string): DirectoryService | undefined {
  const { agent } = useAgent()
  const [config] = useServices([TOKENS.CONFIG])
  const mediator = mediatorDid ?? config.vti?.mediatorDid
  return useMemo(
    () => (agent ? new AgentDirectoryService(createDirectoryBackend(agent, { mediatorDid: mediator })) : undefined),
    [agent, mediator]
  )
}

/** At most this many authors are looked up each time a room's authors change, one at a time. */
export const NAME_LOOKUPS_PER_VISIT = 20
/**
 * A member asked about this recently is not asked again yet. A room's authors change as it scrolls and re-renders,
 * and every ask waits in the same queue as the community's other tasks: a rename shows within a quarter hour, and
 * reopening rooms doesn't keep asking about the same people.
 */
export const NAME_REASK_FLOOR_MS = 15 * 60_000

// When each member was last asked about, per community, this run.
const askedAt = new Map<string, Map<string, number>>()

/** Forget who was asked about when (tests). */
export function resetDirectoryNameLookups(): void {
  askedAt.clear()
}

const NO_NAMES: ReadonlyMap<string, string> = new Map()

/**
 * The names these members wrote on their own cards in this community, by DID, for the ones who show their identity to
 * members. Kept names are shown at once, and then every author is asked about again in the background, one at a time
 * (those with no kept name first): a new name or a rename shows the next time the room opens, not after the week a
 * name is kept, and a member who had none is asked again too. A member asked about within {@link NAME_REASK_FLOOR_MS}
 * is not asked again yet. A failed lookup stops the rest until the authors change, and the kept names stay shown: the
 * kept names are what a room shows offline.
 */
export function useDirectoryNames(
  service: DirectoryService | undefined,
  communityDid: string | undefined,
  memberDids: readonly string[]
): ReadonlyMap<string, string> {
  const { agent } = useAgent()
  const [state, setState] = useState<{ communityDid?: string; names: ReadonlyMap<string, string> }>({
    names: NO_NAMES,
  })
  const wanted = [...new Set(memberDids)].sort().join('\n')

  useEffect(() => {
    if (!agent || !service || !communityDid) return
    let live = true
    const show = (names: ReadonlyMap<string, string>) => {
      if (live) setState({ communityDid, names })
    }
    const run = async () => {
      const kept = new Map(await loadDirectoryNames(agent, communityDid))
      show(new Map(kept))
      const asked = askedAt.get(communityDid) ?? new Map<string, number>()
      askedAt.set(communityDid, asked)
      const now = Date.now()
      const authors = wanted
        .split('\n')
        .filter((did) => did && now - (asked.get(did) ?? -Infinity) >= NAME_REASK_FLOOR_MS)
      const ask = [...authors.filter((did) => !kept.has(did)), ...authors.filter((did) => kept.has(did))].slice(
        0,
        NAME_LOOKUPS_PER_VISIT
      )
      // Names the community answered as kept: their week starts again, in one write at the end (not per name).
      const confirmed: string[] = []
      try {
        for (const did of ask) {
          if (!live) return
          asked.set(did, Date.now())
          const name = await service.lookupName(communityDid, did)
          if (name === kept.get(did)) {
            if (name) confirmed.push(did)
            continue
          }
          await keepDirectoryName(agent, communityDid, did, name)
          if (name) kept.set(did, name)
          else kept.delete(did)
          show(new Map(kept))
        }
      } finally {
        if (confirmed.length) await confirmDirectoryNames(agent, communityDid, confirmed)
      }
    }
    run().catch((error) => agent.config?.logger?.warn('[Directory] room author names were not read', { error }))
    return () => {
      live = false
    }
  }, [agent, service, communityDid, wanted])

  return state.communityDid === communityDid ? state.names : NO_NAMES
}

export interface CommunityMembers {
  /** The members read so far, in the community's order. */
  rows: readonly MemberRow[]
  /** Why there are none to show: set only when the first page failed. */
  status?: OperationStatus
  /** A page is being read. */
  loading: boolean
  /** There is another page. */
  more: boolean
  /** A later page failed; the rows read stay. Calling `loadMore` again tries it again. */
  moreFailed: boolean
  loadMore(): void
  reload(): void
}

export function useCommunityMembers(service: DirectoryService | undefined, communityDid: string): CommunityMembers {
  const [rows, setRows] = useState<readonly MemberRow[]>([])
  const [status, setStatus] = useState<OperationStatus>()
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor] = useState<string>()
  const [more, setMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const [generation, setGeneration] = useState(0)
  const inFlight = useRef(false)
  const lastAsked = useRef(0)
  const live = useRef(true)
  // The read a page belongs to: a page answered after a reload is dropped.
  const generationRef = useRef(generation)
  generationRef.current = generation

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const read = useCallback(
    (from: string | undefined, first: boolean, of: number) => {
      if (!service || inFlight.current) return
      inFlight.current = true
      setLoading(true)
      const wait = Math.max(0, lastAsked.current + MEMBERS_PAGE_SPACING_MS - Date.now())
      const go = () => {
        lastAsked.current = Date.now()
        service
          .listMembers(communityDid, from)
          .then((page) => {
            if (!live.current || of !== generationRef.current) return
            setRows((prev) => (first ? page.rows : [...prev, ...page.rows]))
            setCursor(page.nextCursor)
            setMore(page.nextCursor !== undefined)
            setMoreFailed(false)
            setStatus(undefined)
          })
          .catch((e: unknown) => {
            if (!live.current || of !== generationRef.current) return
            if (first) setStatus(directoryStatusOf(e))
            else setMoreFailed(true)
          })
          .finally(() => {
            if (of !== generationRef.current) return
            inFlight.current = false
            if (live.current) setLoading(false)
          })
      }
      if (wait > 0) setTimeout(go, wait)
      else go()
    },
    [service, communityDid]
  )

  useEffect(() => {
    setRows([])
    setCursor(undefined)
    setMore(false)
    setMoreFailed(false)
    setStatus(undefined)
    inFlight.current = false
    read(undefined, true, generation)
  }, [read, generation])

  const loadMore = useCallback(() => {
    if (more && cursor) read(cursor, false, generationRef.current)
  }, [more, cursor, read])

  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  return { rows, status, loading, more, moreFailed, loadMore, reload }
}

export interface CommunityCard {
  /** The card as the community holds it; undefined while reading or when it could not be read. */
  card?: MyCard
  /** Its fields and who sees each, in the community's order. */
  fields?: readonly CardField[]
  /** Who sees the name: what the consent sheet says. */
  nameAudience?: DirectoryAudience
  /** What "Your card" would put on it: the name of the profile the member joined as. None without a profile name. */
  proposal?: CardProposal
  /**
   * The card shows a name, and the profile's name is now a different one: ask whether to update the card. Never
   * acted on without the member's yes.
   */
  differs: boolean
  /** Why the card is not shown: set when it could not be read. */
  status?: OperationStatus
  loading: boolean
  /**
   * Put the proposal's name on the card, at the revision read. Rejects with `DirectoryConflict` when the card changed
   * meanwhile (read it again with `reload`, then ask again), or `DirectoryRefused` with the community's code.
   */
  save(): Promise<void>
  reload(): void
}

export function useMyCommunityCard(service: DirectoryService | undefined, communityDid: string): CommunityCard {
  const mine = useMyName(communityDid)
  const [card, setCard] = useState<MyCard>()
  const [fields, setFields] = useState<readonly CardField[]>()
  const [status, setStatus] = useState<OperationStatus>()
  const [loading, setLoading] = useState(false)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!service) return
    let live = true
    setLoading(true)
    setStatus(undefined)
    service
      .showMyCard(communityDid)
      .then(async (shown) => {
        const listed = await service.cardFields(communityDid, shown)
        if (!live) return
        setCard(shown)
        setFields(listed)
      })
      .catch((e: unknown) => {
        if (live) setStatus(directoryStatusOf(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [service, communityDid, generation])

  const proposal = useMemo<CardProposal | undefined>(
    () => (mine.name && mine.profileId ? { name: mine.name, profileId: mine.profileId } : undefined),
    [mine.name, mine.profileId]
  )

  const save = useCallback(async () => {
    if (!service || !card || !proposal) return
    setCard(await service.setMyName(communityDid, proposal.name, card.revision))
  }, [service, card, proposal, communityDid])

  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  return {
    card,
    fields,
    nameAudience: fields?.find((f) => f.key === NAME_FIELD)?.audience,
    proposal,
    differs: !!card?.name && !!proposal && card.name !== proposal.name,
    status,
    loading,
    save,
    reload,
  }
}

export interface MemberCardView {
  card?: MemberCard
  /** The community has no card to show for them: no such member, or nothing shown to you. */
  none: boolean
  /** Why it could not be read (no answer, no directory): not the same as no card. */
  status?: OperationStatus
  loading: boolean
  reload(): void
}

/**
 * Another member's card, by the entry the members list gave or by a room author's DID. Held in this screen's state
 * only. A card the community does not show is `none`; a read that failed is a `status`, so a lost answer never
 * reads as "no card".
 */
export function useMemberCard(
  service: DirectoryService | undefined,
  communityDid: string,
  by: { entryId?: string; memberDid?: string }
): MemberCardView {
  const [card, setCard] = useState<MemberCard>()
  const [none, setNone] = useState(false)
  const [status, setStatus] = useState<OperationStatus>()
  const [loading, setLoading] = useState(false)
  const [generation, setGeneration] = useState(0)
  const { entryId, memberDid } = by

  useEffect(() => {
    if (!service || (!entryId && !memberDid)) return
    let live = true
    setLoading(true)
    setStatus(undefined)
    setNone(false)
    const read = entryId
      ? service.showMember(communityDid, entryId)
      : service.memberCardByDid(communityDid, memberDid as string)
    read
      .then((shown) => {
        if (!live) return
        setCard(shown)
        setNone(!shown)
      })
      .catch((e: unknown) => {
        if (live) setStatus(directoryStatusOf(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [service, communityDid, entryId, memberDid, generation])

  const reload = useCallback(() => setGeneration((g) => g + 1), [])
  return { card, none, status, loading, reload }
}
