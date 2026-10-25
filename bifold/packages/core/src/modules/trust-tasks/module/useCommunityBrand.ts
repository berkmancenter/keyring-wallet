/**
 * A community's card look, for the Wallet: unknown until the phone has read what it keeps (and, for a community with a
 * logo, whether that logo is here), then known for good. A card shows a neutral face while it is unknown, never the
 * default look first and the community's own a moment later; known without a colour or logo is the DID's colour and
 * the monogram, and that is final too.
 *
 * Every card reads the same kept looks, read once and again whenever one is kept (a manifest read).
 *
 * @module trust-tasks/module/useCommunityBrand
 */
import { useAgent } from '@bifold/react-hooks'
import type { Agent } from '@credo-ts/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { COMMUNITY_BRAND_EVENT } from './communityChanged'
import { communityBrand, type CommunityBrand, type CommunityBrandRecord } from './communityBrand'
import { cachedCommunityLogo } from './communityLogo'
import { GenericRecordsCommunityStore } from './VtiCommunityStore'

export type Known<T> = { known: false } | { known: true; value: T }

let kept: ReadonlyMap<string, CommunityBrandRecord> | undefined
let reading: Promise<void> | undefined
/** A look was kept while a read was under way: that read may have missed it, so read once more after it. */
let again = false
const listeners = new Set<() => void>()

function read(agent: Agent): Promise<void> {
  if (reading) {
    again = true
    return reading
  }
  reading = new GenericRecordsCommunityStore(agent)
    .listCommunityBrands()
    .then((records) => new Map(records.map((record) => [record.communityDid, record])))
    // A failed read is "none kept": every card takes its DID's colour rather than staying neutral for ever.
    .catch(() => kept ?? new Map<string, CommunityBrandRecord>())
    .then((map) => {
      kept = map
      listeners.forEach((listener) => listener())
    })
    .finally(() => {
      reading = undefined
      if (again) {
        again = false
        void read(agent)
      }
    })
  return reading
}

/** Forget the kept looks read so far (tests). */
export function resetCommunityBrands(): void {
  kept = undefined
  reading = undefined
  again = false
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The look of `communityDid`'s cards; `name` is what it calls itself, when known (for the monogram). */
export function useCommunityBrand(communityDid: string | undefined, name?: string): Known<CommunityBrand> {
  const { agent } = useAgent()
  const records = useSyncExternalStore(subscribe, () => kept)
  const [logo, setLogo] = useState<{ url?: string; file?: string; settled: boolean }>({ settled: false })

  useEffect(() => {
    if (!agent) return
    if (!kept) void read(agent)
    const subscription = DeviceEventEmitter.addListener(COMMUNITY_BRAND_EVENT, () => void read(agent))
    return () => subscription.remove()
  }, [agent])

  const record = communityDid ? records?.get(communityDid) : undefined
  const logoUrl = record?.logoUrl

  useEffect(() => {
    if (!records) return
    if (!communityDid || !logoUrl) {
      setLogo({ url: undefined, settled: true })
      return
    }
    let live = true
    setLogo({ url: logoUrl, settled: false })
    void cachedCommunityLogo(communityDid, logoUrl).then((file) => {
      if (live) setLogo({ url: logoUrl, file, settled: true })
    })
    return () => {
      live = false
    }
  }, [records, communityDid, logoUrl])

  if (!communityDid || !records || !logo.settled || logo.url !== logoUrl) return { known: false }
  return {
    known: true,
    value: communityBrand({ communityDid, name, accentColor: record?.accentColor, logo: logo.file }),
  }
}
