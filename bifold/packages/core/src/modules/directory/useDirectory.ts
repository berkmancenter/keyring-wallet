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

import { useMyName } from '../rooms/useMyName'

import { createDirectoryBackend } from './directoryBackend'
import { AgentDirectoryService, directoryStatusOf } from './directoryService'
import type {
  CardField,
  CardProposal,
  DirectoryAudience,
  DirectoryService,
  MemberRow,
  MyCard,
  OperationStatus,
} from './types'
import { NAME_FIELD } from './types'

/** The least time between two pages, so scrolling stays under a community's read limit (60 a minute by default). */
export const MEMBERS_PAGE_SPACING_MS = 1000

/** The directory client for this phone's agent; undefined until there is an agent. */
export function useDirectoryService(mediatorDid?: string): DirectoryService | undefined {
  const { agent } = useAgent()
  return useMemo(
    () => (agent ? new AgentDirectoryService(createDirectoryBackend(agent, { mediatorDid })) : undefined),
    [agent, mediatorDid]
  )
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
